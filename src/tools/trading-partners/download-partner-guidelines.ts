import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as z from 'zod/v4';
import { orderfulApiCall, orderfulApiDownload } from '../../api.js';
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

function extensionFor(contentType: string): string {
  if (contentType.includes('pdf')) return '.pdf';
  if (contentType.includes('spreadsheetml')) return '.xlsx';
  if (contentType.includes('wordprocessingml')) return '.docx';
  if (contentType.includes('ms-excel')) return '.xls';
  if (contentType.includes('json')) return '.json';
  if (contentType.includes('csv')) return '.csv';
  if (contentType.includes('zip')) return '.zip';
  return '.bin';
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
        'Download the EDI guideline documents (PDF/Excel) of one or more trading partners and save them to a local directory. Provide partner organization IDs (from orderful_list_trading_partners) and/or EDI account IDs (from orderful_search_trading_partner); the tool finds every document-relationship with those partners, collects their published guideline sets (prod and test), and downloads each one. You can also pass explicit guidelineSetIds directly. Files are written on the machine running this MCP server. Returns a per-partner summary of saved files and any partners or relationships without guidelines.',
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
          .describe('Directory to save the PDFs into (created if missing). Defaults to ./orderful-guidelines'),
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

        // 3. Download each guideline set.
        const dir = resolve(outputDir ?? 'orderful-guidelines');
        await mkdir(dir, { recursive: true });
        const usedNames = new Set<string>();
        const downloaded: Array<Record<string, unknown>> = [];
        const failed: Array<Record<string, unknown>> = [];

        for (const target of targets.values()) {
          try {
            let name = `guideline-set-${target.guidelineSetId}`;
            try {
              const meta = (await orderfulApiCall(`/v2/guideline-sets/${target.guidelineSetId}`)) as { name?: string };
              if (meta.name) name = meta.name;
            } catch {
              // metadata is best-effort; fall back to the id-based name
            }
            const { data, contentType } = await orderfulApiDownload(`/v2/guideline-sets/${target.guidelineSetId}/download`);

            const prefix = target.partnerName ? `${target.partnerName} - ` : '';
            const suffix = target.environment === 'TEST' ? ' (TEST)' : '';
            let base = sanitizeFilename(`${prefix}${name}${suffix}`);
            if (usedNames.has(base)) base = `${base} (${target.guidelineSetId})`;
            usedNames.add(base);
            const filePath = join(dir, `${base}${extensionFor(contentType)}`);
            await writeFile(filePath, data);

            downloaded.push({
              guidelineSetId: target.guidelineSetId,
              partnerId: target.partnerId || undefined,
              partnerName: target.partnerName || undefined,
              environment: target.environment,
              transactionTypes: target.transactionTypes,
              file: filePath,
              sizeBytes: data.length,
            });
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

        return ok({
          outputDir: dir,
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
