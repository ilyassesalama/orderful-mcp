import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_create_acknowledgment',
    {
      annotations: { readOnlyHint: false },
      title: 'Create Acknowledgment',
      description:
        'Create an acknowledgment (997/999) for a transaction. Set status to ACCEPTED or REJECTED, optionally with error details.',
      inputSchema: {
        transactionId: z.number().describe('The transaction ID to acknowledge'),
        status: z.enum(['ACCEPTED', 'REJECTED']).describe('Acknowledgment status'),
        errors: z
          .array(
            z.object({
              path: z.string().describe('The path where the error occurred (e.g. /message)'),
              code: z.string().describe('Error code (e.g. 00)'),
              message: z.string().describe('Error message with additional information'),
            }),
          )
          .optional()
          .describe('Error details (typically used when status is REJECTED)'),
      },
    },
    async ({ transactionId, status, errors }) => {
      try {
        const body: Record<string, unknown> = { status };
        if (errors) body.errors = errors;

        return ok(await orderfulApiCall(`/v3/transactions/${transactionId}/acknowledgment`, 'POST', body));
      } catch (e) {
        return err(e);
      }
    },
  );
};
