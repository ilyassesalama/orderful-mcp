import { readFileSync } from 'node:fs';
import * as z from 'zod/v4';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { orderfulApiCall } from '../../api.js';
import { err, type ToolRegistrar } from '../utils.js';

// MCP Apps view: hosts that support the apps extension (claude.ai, Claude
// Desktop, …) render this tool's result as an interactive table; others
// just use the text content.
const VIEW_URI = 'ui://orderful/transactions.html';
const viewHtml = () => readFileSync(new URL('../../ui/transactions.html', import.meta.url), 'utf8');

export const register: ToolRegistrar = (server) => {
  registerAppResource(
    server,
    'Orderful Transactions View',
    VIEW_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: viewHtml() }],
    }),
  );

  registerAppTool(
    server,
    'orderful_list_transactions',
    {
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: VIEW_URI } },
      title: 'List Transactions',
      description:
        'List Orderful transactions with optional filters. Returns paginated results (max 100 per request, newest first). Use nextCursor/prevCursor for pagination.',
      inputSchema: {
        stream: z.array(z.enum(['TEST', 'LIVE'])).optional().describe('Filter by stream: TEST and/or LIVE'),
        transactionType: z.array(z.string()).optional().describe('Filter by transaction type (e.g. "850_PURCHASE_ORDER", "856_ADVANCE_SHIP_NOTICE"). Max 5.'),
        createdAt: z.string().optional().describe('ISO-8601 date range with bracket notation, e.g. "[2024-01-01,2024-02-01)"'),
        validationStatus: z.array(z.string()).optional().describe('Filter by validation status'),
        deliveryStatus: z.array(z.string()).optional().describe('Filter by delivery status'),
        acknowledgmentStatus: z.array(z.string()).optional().describe('Filter by acknowledgment status'),
        senderIsaId: z.array(z.string()).optional().describe('Filter by sender ISA ID. Max 5.'),
        receiverIsaId: z.array(z.string()).optional().describe('Filter by receiver ISA ID. Max 5.'),
        businessNumber: z.array(z.string()).optional().describe('Filter by business number. Max 5.'),
        nextCursor: z.string().optional().describe('Cursor for next page of results'),
        prevCursor: z.string().optional().describe('Cursor for previous page of results'),
      },
    },
    async (params) => {
      try {
        const query = new URLSearchParams();
        if (params.stream) params.stream.forEach(s => query.append('stream', s));
        if (params.transactionType) params.transactionType.forEach(t => query.append('transactionType', t));
        if (params.createdAt) query.set('createdAt', params.createdAt);
        if (params.validationStatus) params.validationStatus.forEach(v => query.append('validationStatus', v));
        if (params.deliveryStatus) params.deliveryStatus.forEach(d => query.append('deliveryStatus', d));
        if (params.acknowledgmentStatus) params.acknowledgmentStatus.forEach(a => query.append('acknowledgmentStatus', a));
        if (params.senderIsaId) params.senderIsaId.forEach(s => query.append('senderIsaId', s));
        if (params.receiverIsaId) params.receiverIsaId.forEach(r => query.append('receiverIsaId', r));
        if (params.businessNumber) params.businessNumber.forEach(b => query.append('businessNumber', b));
        if (params.nextCursor) query.set('nextCursor', params.nextCursor);
        if (params.prevCursor) query.set('prevCursor', params.prevCursor);

        const qs = query.toString();
        const page = await orderfulApiCall(`/v3/transactions${qs ? `?${qs}` : ''}`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(page, null, 2) }],
          structuredContent: page as Record<string, unknown>,
        };
      } catch (e) {
        return err(e);
      }
    },
  );
};
