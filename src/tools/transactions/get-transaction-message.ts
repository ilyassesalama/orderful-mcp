import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_get_transaction_message',
    {
      title: 'Get Transaction Message',
      description:
        'Get the full EDI message content of an Orderful transaction. Returns the complete transaction sets with all EDI segments.',
      inputSchema: {
        transactionId: z.string().describe('The transaction ID to get the message for'),
      },
    },
    async ({ transactionId }) => {
      try {
        return ok(await orderfulApiCall(`/v3/transactions/${transactionId}/message`));
      } catch (e) {
        return err(e);
      }
    },
  );
};
