import * as z from 'zod/v4';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { orderfulApiBinary, orderfulApiCall } from '../../api.js';
import { credentialStore } from '../../credential-store.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_download_guideline_pdf',
    {
      annotations: { readOnlyHint: true },
      title: 'Download Guideline PDF',
      description:
        "Download a guideline set as a human-readable PDF. Works for your own guideline sets and for partner-owned ones (partnerGuidelineSetId from orderful_list_document_relationships). In stdio mode the PDF is saved to disk and the file path is returned — pass filePath to control where. In hosted/HTTP mode there is no local disk, so the PDF is returned as a base64 resource instead; prefer orderful_get_guidelines there for machine-readable rules.",
      inputSchema: {
        guidelineSetId: z
          .number()
          .int()
          .describe('The guideline set id (e.g. 169681). Get from orderful_list_document_relationships or orderful_list_guideline_sets.'),
        filePath: z
          .string()
          .optional()
          .describe(
            'Absolute path to save the PDF to (stdio mode only). Defaults to guideline-set-<id>.pdf in the current working directory.',
          ),
      },
    },
    async ({ guidelineSetId, filePath }) => {
      try {
        const { data, contentType } = await orderfulApiBinary(`/v2/guideline-sets/${guidelineSetId}/download`);

        // HTTP mode: no user-accessible disk — return the PDF as a base64 resource.
        if (credentialStore.getStore()) {
          return {
            content: [
              {
                type: 'resource' as const,
                resource: {
                  uri: `orderful://guideline-sets/${guidelineSetId}.pdf`,
                  mimeType: contentType,
                  blob: data.toString('base64'),
                },
              },
            ],
          };
        }

        let target = filePath ?? '';
        if (!target) {
          const set = (await orderfulApiCall(`/v2/guideline-sets/${guidelineSetId}`)) as { name?: string };
          const safeName = (set.name ?? `guideline-set-${guidelineSetId}`).replace(/[^\w.-]+/g, '_');
          target = join(process.cwd(), `${safeName}.pdf`);
        } else if (!isAbsolute(target)) {
          target = join(process.cwd(), target);
        }

        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data);

        return ok({ saved: true, filePath: target, sizeBytes: data.length, contentType });
      } catch (e) {
        return err(e);
      }
    },
  );
};
