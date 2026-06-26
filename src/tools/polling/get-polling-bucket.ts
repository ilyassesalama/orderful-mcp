import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_get_polling_bucket',
    {
      annotations: { readOnlyHint: true },
      title: 'Get Polling Bucket',
      description:
        'Retrieve transactions from an Orderful polling bucket for processing. Returns an array of delivery objects. Response size is limited to 200MB.',
      inputSchema: {
        bucketId: z.number().describe('The polling bucket ID'),
        limit: z.number().min(1).max(100).optional().describe('Number of transactions to return (1-100, default 30)'),
      },
    },
    async ({ bucketId, limit }) => {
      try {
        const qs = limit ? `?limit=${limit}` : '';
        return ok(await orderfulApiCall(`/v3/polling-buckets/${bucketId}${qs}`));
      } catch (e) {
        return err(e);
      }
    },
  );
};
