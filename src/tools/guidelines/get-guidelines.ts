import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_get_guidelines',
    {
      annotations: { readOnlyHint: true },
      title: 'Get Guidelines',
      description:
        'Fetch a guideline set and its full list of guideline rules (segment/element paths, mandatory/optional use, max-use, notes). Works for your own guideline sets and for partner-owned ones. Get the guideline set id from orderful_list_document_relationships (partnerGuidelineSetId for the partner\'s requirements, guidelineSetId for yours) or from orderful_list_guideline_sets. For a human-readable version, use orderful_download_guideline_pdf.',
      inputSchema: {
        guidelineSetId: z
          .number()
          .int()
          .describe('The guideline set id (e.g. 169681). Get from orderful_list_document_relationships or orderful_list_guideline_sets.'),
      },
    },
    async ({ guidelineSetId }) => {
      try {
        const [set, guidelines] = await Promise.all([
          orderfulApiCall(`/v2/guideline-sets/${guidelineSetId}`),
          orderfulApiCall(`/v2/guideline-sets/${guidelineSetId}/guidelines`),
        ]);
        return ok({ set, guidelines });
      } catch (e) {
        return err(e);
      }
    },
  );
};
