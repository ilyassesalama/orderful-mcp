import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_list_relationships',
    {
      title: 'List Relationships',
      description:
        'List all trading partner relationships. Returns sender/receiver details, transaction type, status (BLOCKED, PENDING, SETUP, TEST, READY, LIVE), and auto-send configuration.',
      inputSchema: {
        autoSend: z.enum(['ENABLED', 'DISABLED']).optional().describe('Filter by auto-send configuration'),
        limit: z.number().max(100).optional().describe('Number of items to return (max 100)'),
        nextCursor: z.string().optional().describe('Cursor for next page of results'),
        prevCursor: z.string().optional().describe('Cursor for previous page of results'),
      },
    },
    async (params) => {
      try {
        const query = new URLSearchParams();
        if (params.autoSend) query.set('autoSend', params.autoSend);
        if (params.limit) query.set('limit', String(params.limit));
        if (params.nextCursor) query.set('nextCursor', params.nextCursor);
        if (params.prevCursor) query.set('prevCursor', params.prevCursor);

        const qs = query.toString();
        return ok(await orderfulApiCall(`/v3/relationships${qs ? `?${qs}` : ''}`));
      } catch (e) {
        return err(e);
      }
    },
  );
};
