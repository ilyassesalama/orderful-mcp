import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_get_acknowledgment',
    {
      annotations: { readOnlyHint: true },
      title: 'Get Acknowledgment',
      description:
        'Get acknowledgment details for a transaction. Returns status, creation timestamp, associated transaction reference, and any errors.',
      inputSchema: {
        transactionId: z.number().describe('The transaction ID to get the acknowledgment for'),
      },
    },
    async ({ transactionId }) => {
      try {
        return ok(await orderfulApiCall(`/v3/transactions/${transactionId}/acknowledgment`));
      } catch (e) {
        return err(e);
      }
    },
  );
};
