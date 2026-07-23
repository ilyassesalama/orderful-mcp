import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as z from 'zod/v4';
import { orderfulApiCall, orderfulApiDownload, extensionForContentType } from '../../api.js';
import { credentialStore } from '../../credential-store.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

interface DocumentRelationship {
  id: number;
  partnerId: number;
  partnerOrganizationName: string;
  partnerEdiAccountId: number;
  transactionTypeName: string;
  direction: string;
  partnerGuidelineSetId: number | null;
  partnerTestGuidelineSetId: number | null;
}

interface RelationshipPage {
  pagination: { total: number };
  data: DocumentRelationship[];
}

interface GuidelineTarget {
  guidelineSetId: number;
  environment: 'PROD' | 'TEST';
  partnerId: number;
  partnerName: string;
  transactionTypes: string[];
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180);
}

async function fetchAllRelationships(queryParam: string, ids: number[]): Promise<DocumentRelationship[]> {
  const all: DocumentRelationship[] = [];
  const limit = 100;
  let offset = 0;
  for (;;) {
    const query = new URLSearchParams();
    for (const id of ids) query.append(queryParam, String(id));
    query.set('limit', String(limit));
    query.set('offset', String(offset));
    const page = (await orderfulApiCall(`/v2/document-relationships?${query.toString()}`)) as RelationshipPage;
    all.push(...page.data);
    offset += limit;
    if (all.length >= page.pagination.total || page.data.length === 0) break;
  }
  return all;
}

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_download_partner_guidelines',
    {
      annotations: { readOnlyHint: true },
      title: 'Download Partner Guidelines',
      description:
        'Download the EDI guideline documents (PDF/Excel) of one or more trading partners. Provide partner organization IDs (from orderful_list_trading_partners) and/or EDI account IDs (from orderful_search_trading_partner); the tool finds every document-relationship with those partners, collects their published guideline sets (prod and test), and fetches each one. You can also pass explicit guidelineSetIds directly. On the hosted (HTTP) server it returns temporary download links (valid 1 hour) that must be shown to the user — per file, plus a single all-in-one ZIP link when there are several; in stdio mode it saves the files to a local directory. Also reports any partners or relationships without guidelines.',
      inputSchema: {
        partnerIds: z
          .array(z.number().int())
          .optional()
          .describe('Trading partner organization IDs (the organizationId field from orderful_list_trading_partners)'),
        partnerEdiAccountIds: z
          .array(z.number().int())
          .optional()
          .describe('Trading partner EDI account IDs (the id field from orderful_search_trading_partner)'),
        guidelineSetIds: z
          .array(z.number().int())
          .optional()
          .describe('Explicit guideline set IDs to download, if already known'),
        outputDir: z
          .string()
          .optional()
          .describe(
            'Stdio mode only: directory to save the files into (created if missing). Defaults to ./orderful-guidelines. Ignored on the hosted server, which returns download links instead.',
          ),
      },
    },
    async ({ partnerIds, partnerEdiAccountIds, guidelineSetIds, outputDir }) => {
      try {
        if (!partnerIds?.length && !partnerEdiAccountIds?.length && !guidelineSetIds?.length) {
          throw new Error('Provide at least one of: partnerIds, partnerEdiAccountIds, guidelineSetIds.');
        }

        // 1. Resolve partner IDs -> document relationships (two queries: the API
        //    ANDs its filters, so partnerId and partnerEdiAccountId go separately).
        const relationships = new Map<number, DocumentRelationship>();
        if (partnerIds?.length) {
          for (const r of await fetchAllRelationships('partnerId', partnerIds)) relationships.set(r.id, r);
        }
        if (partnerEdiAccountIds?.length) {
          for (const r of await fetchAllRelationships('partnerEdiAccountId', partnerEdiAccountIds)) relationships.set(r.id, r);
        }

        // 2. Collect unique guideline sets with partner context.
        const targets = new Map<number, GuidelineTarget>();
        const addTarget = (gsId: number | null, environment: 'PROD' | 'TEST', r: DocumentRelationship) => {
          if (!gsId) return;
          const existing = targets.get(gsId);
          const label = `${r.transactionTypeName} (${r.direction})`;
          if (existing) {
            if (!existing.transactionTypes.includes(label)) existing.transactionTypes.push(label);
          } else {
            targets.set(gsId, {
              guidelineSetId: gsId,
              environment,
              partnerId: r.partnerId,
              partnerName: r.partnerOrganizationName,
              transactionTypes: [label],
            });
          }
        };
        for (const r of relationships.values()) {
          addTarget(r.partnerGuidelineSetId, 'PROD', r);
          addTarget(r.partnerTestGuidelineSetId, 'TEST', r);
        }
        for (const gsId of guidelineSetIds ?? []) {
          if (!targets.has(gsId)) {
            targets.set(gsId, { guidelineSetId: gsId, environment: 'PROD', partnerId: 0, partnerName: '', transactionTypes: [] });
          }
        }

        // 3. Deliver each guideline set. On the hosted (HTTP) server the
        //    files live on the server's disk, useless to the member — so mint
        //    temporary download links served by this server instead. In stdio
        //    mode the server runs on the user's machine, so save to disk.
        const store = credentialStore.getStore();
        const httpMode = Boolean(store?.PROFILE_ID);

        const usedNames = new Set<string>();
        const downloaded: Array<Record<string, unknown>> = [];
        const failed: Array<Record<string, unknown>> = [];
        const bundleFiles: Array<{ endpoint: string; filenameBase: string }> = [];

        let dir: string | undefined;
        let makeLink: ((endpoint: string, filenameBase: string) => Promise<string>) | undefined;
        let makeBundleLink:
          | ((bundleName: string, files: Array<{ endpoint: string; filenameBase: string }>) => Promise<string>)
          | undefined;
        if (httpMode) {
          const { createDownloadToken, createBundleToken } = await import('../../oauth-store.js');
          const port = process.env.PORT || 3000;
          const baseUrl = new URL(
            process.env.OAUTH_ISSUER_URL || process.env.PUBLIC_URL || `http://localhost:${port}`,
          );
          const apiKey = store?.ORDERFUL_API_KEY ?? '';
          makeLink = async (endpoint, filenameBase) =>
            new URL(`/downloads/${await createDownloadToken(apiKey, endpoint, filenameBase)}`, baseUrl).href;
          makeBundleLink = async (bundleName, files) =>
            new URL(`/downloads/bundle/${await createBundleToken(apiKey, bundleName, files)}`, baseUrl).href;
        } else {
          dir = resolve(outputDir ?? 'orderful-guidelines');
          await mkdir(dir, { recursive: true });
        }

        for (const target of targets.values()) {
          try {
            let name = `guideline-set-${target.guidelineSetId}`;
            try {
              const meta = (await orderfulApiCall(`/v2/guideline-sets/${target.guidelineSetId}`)) as { name?: string };
              if (meta.name) name = meta.name;
            } catch {
              // metadata is best-effort; fall back to the id-based name
            }

            const prefix = target.partnerName ? `${target.partnerName} - ` : '';
            const suffix = target.environment === 'TEST' ? ' (TEST)' : '';
            let base = sanitizeFilename(`${prefix}${name}${suffix}`);
            if (usedNames.has(base)) base = `${base} (${target.guidelineSetId})`;
            usedNames.add(base);

            const entry: Record<string, unknown> = {
              guidelineSetId: target.guidelineSetId,
              partnerId: target.partnerId || undefined,
              partnerName: target.partnerName || undefined,
              environment: target.environment,
              transactionTypes: target.transactionTypes,
              guidelineName: name,
            };

            if (makeLink) {
              entry.downloadUrl = await makeLink(`/v2/guideline-sets/${target.guidelineSetId}/download`, base);
              entry.linkExpiresIn = '1 hour';
              bundleFiles.push({ endpoint: `/v2/guideline-sets/${target.guidelineSetId}/download`, filenameBase: base });
            } else {
              const { data, contentType } = await orderfulApiDownload(
                `/v2/guideline-sets/${target.guidelineSetId}/download`,
              );
              const filePath = join(dir!, `${base}${extensionForContentType(contentType)}`);
              await writeFile(filePath, data);
              entry.file = filePath;
              entry.sizeBytes = data.length;
            }
            downloaded.push(entry);
          } catch (e) {
            failed.push({
              guidelineSetId: target.guidelineSetId,
              partnerName: target.partnerName || undefined,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        // 4. Report partners/relationships that had nothing to download.
        const relationshipsWithoutGuidelines = [...relationships.values()]
          .filter((r) => !r.partnerGuidelineSetId && !r.partnerTestGuidelineSetId)
          .map((r) => ({
            relationshipId: r.id,
            partnerId: r.partnerId,
            partnerName: r.partnerOrganizationName,
            transactionType: r.transactionTypeName,
            direction: r.direction,
          }));
        const foundPartnerIds = new Set([...relationships.values()].map((r) => r.partnerId));
        const foundEdiAccountIds = new Set([...relationships.values()].map((r) => r.partnerEdiAccountId));
        const partnersWithNoRelationships = [
          ...(partnerIds ?? []).filter((id) => !foundPartnerIds.has(id)),
          ...(partnerEdiAccountIds ?? []).filter((id) => !foundEdiAccountIds.has(id)),
        ];

        // One extra link that zips everything, when there are several files.
        let bundleDownloadUrl: string | undefined;
        if (makeBundleLink && bundleFiles.length > 1) {
          const partnerNames = [...new Set([...targets.values()].map((t) => t.partnerName).filter(Boolean))];
          const bundleName = sanitizeFilename(
            partnerNames.length === 1 ? `${partnerNames[0]} guidelines` : 'Orderful partner guidelines',
          );
          bundleDownloadUrl = await makeBundleLink(bundleName, bundleFiles);
        }

        return ok({
          ...(httpMode
            ? { note: 'Present each downloadUrl to the user as a clickable link — links expire in 1 hour.' }
            : { outputDir: dir }),
          ...(bundleDownloadUrl
            ? { bundleDownloadUrl, bundleNote: 'Single link that downloads all files above as one ZIP.' }
            : {}),
          downloaded,
          failed,
          relationshipsWithoutGuidelines,
          partnersWithNoRelationships,
        });
      } catch (e) {
        return err(e);
      }
    },
  );
};
