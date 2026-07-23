import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

interface DocumentRelationship {
  id: number;
  partnerId: number;
  partnerOrganizationName: string;
  partnerEdiAccountId: number;
  partnerEdiAccountName: string;
  transactionTypeName: string;
  direction: string;
  status: string;
  autoSend: string;
  dataFormat: string;
  guidelineSetId: number | null;
  testGuidelineSetId: number | null;
  partnerGuidelineSetId: number | null;
  partnerTestGuidelineSetId: number | null;
}

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_list_document_relationships',
    {
      annotations: { readOnlyHint: true },
      title: 'List Document Relationships',
      description:
        'List document-relationships (one per partner × transaction-type × direction), optionally filtered by trading partner organization id. Each row includes the guideline-set ids (yours and the partner\'s) needed by orderful_get_guidelines and orderful_download_guideline_pdf. Get the partner organization id from orderful_search_trading_partner. Returns a trimmed summary per row; use orderful_get_document_relationship for the full configuration of a single row.',
      inputSchema: {
        partnerId: z
          .number()
          .int()
          .optional()
          .describe('Filter by trading partner organization id (e.g. 400 for Walmart). Get from orderful_search_trading_partner.'),
        limit: z.number().int().max(100).optional().describe('Number of items to return (default 25, max 100)'),
        offset: z.number().int().optional().describe('Offset for pagination'),
      },
    },
    async ({ partnerId, limit, offset }) => {
      try {
        const me = (await orderfulApiCall('/v3/organizations/me')) as { id: number };

        const query = new URLSearchParams({ ownerId: String(me.id) });
        if (partnerId) query.set('partnerId', String(partnerId));
        query.set('limit', String(limit ?? 25));
        if (offset) query.set('offset', String(offset));

        const result = (await orderfulApiCall(`/v2/document-relationships?${query}`)) as {
          data: DocumentRelationship[];
          pagination: unknown;
        };

        return ok({
          pagination: result.pagination,
          data: result.data.map((r) => ({
            id: r.id,
            partnerId: r.partnerId,
            partnerOrganizationName: r.partnerOrganizationName,
            partnerEdiAccountId: r.partnerEdiAccountId,
            partnerEdiAccountName: r.partnerEdiAccountName,
            transactionTypeName: r.transactionTypeName,
            direction: r.direction,
            status: r.status,
            autoSend: r.autoSend,
            dataFormat: r.dataFormat,
            guidelineSetId: r.guidelineSetId,
            testGuidelineSetId: r.testGuidelineSetId,
            partnerGuidelineSetId: r.partnerGuidelineSetId,
            partnerTestGuidelineSetId: r.partnerTestGuidelineSetId,
          })),
        });
      } catch (e) {
        return err(e);
      }
    },
  );
};
