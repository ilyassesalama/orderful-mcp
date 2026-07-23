import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_list_guideline_sets',
    {
      annotations: { readOnlyHint: true },
      title: 'List Guideline Sets',
      description:
        "List your organization's own guideline sets (name, status DRAFT/PUBLISHED, transaction type, version group). Note: this only lists sets your org owns — a partner's guideline set ids come from orderful_list_document_relationships (partnerGuidelineSetId).",
      inputSchema: {
        includeOnlyLatestPerGroup: z
          .boolean()
          .optional()
          .describe('Only return the latest version of each guideline set group (default true)'),
        limit: z.number().int().max(100).optional().describe('Number of items to return (default 100, max 100)'),
        offset: z.number().int().optional().describe('Offset for pagination'),
      },
    },
    async ({ includeOnlyLatestPerGroup, limit, offset }) => {
      try {
        const me = (await orderfulApiCall('/v3/organizations/me')) as { id: number };

        const query = new URLSearchParams();
        query.set('includeOnlyLatestPerGroup', String(includeOnlyLatestPerGroup ?? true));
        if (limit) query.set('limit', String(limit));
        if (offset) query.set('offset', String(offset));

        return ok(await orderfulApiCall(`/v2/organizations/${me.id}/guideline-sets?${query}`));
      } catch (e) {
        return err(e);
      }
    },
  );
};
