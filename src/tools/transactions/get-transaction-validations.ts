import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_get_transaction_validations',
    {
      annotations: { readOnlyHint: true },
      title: 'Get Transaction Validations',
      description:
        'Get validation results for an Orderful transaction. Returns isValid flag, validation errors with data paths, allowed values, and error descriptions.',
      inputSchema: {
        transactionId: z.string().describe('The transaction ID to get validations for'),
      },
    },
    async ({ transactionId }) => {
      try {
        return ok(await orderfulApiCall(`/v2/transactions/${transactionId}/validations`));
      } catch (e) {
        return err(e);
      }
    },
  );
};
