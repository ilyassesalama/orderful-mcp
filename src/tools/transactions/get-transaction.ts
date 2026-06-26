import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_get_transaction',
    {
      annotations: { readOnlyHint: true },
      title: 'Get Transaction',
      description:
        'Get details of a specific Orderful transaction by ID. Returns sender, receiver, type, stream, validation/delivery/acknowledgment statuses, and timestamps.',
      inputSchema: {
        transactionId: z.string().describe('The transaction ID to retrieve'),
        expand: z.enum(['message']).optional().describe('Set to "message" to embed the full transaction message in the response'),
      },
    },
    async ({ transactionId, expand }) => {
      try {
        const qs = expand ? `?expand=${expand}` : '';
        return ok(await orderfulApiCall(`/v3/transactions/${transactionId}${qs}`));
      } catch (e) {
        return err(e);
      }
    },
  );
};
