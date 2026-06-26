import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_send_transaction',
    {
      annotations: { readOnlyHint: false, destructiveHint: true },
      title: 'Send Transaction',
      description:
        'Send an existing transaction to a trading partner (e.g., sending an 850 Purchase Order to NetSuite). This triggers delivery of the transaction to the receiver.',
      inputSchema: {
        transactionId: z.string().describe('The ID of the transaction to send'),
        requesterId: z.number().describe('The organization ID of the requester'),
        shouldReprocess: z.boolean().optional().default(true).describe('Whether to reprocess the transaction before sending'),
      },
    },
    async ({ transactionId, requesterId, shouldReprocess }) => {
      try {
        const body = { requesterId, shouldReprocess };
        return ok(
          await orderfulApiCall(`/v2/transactions/${transactionId}/send`, 'POST', body, 'application/json', 'application/json', {
            'x-actingorgid': String(requesterId),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
};
