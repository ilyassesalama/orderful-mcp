import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_create_transaction',
    {
      title: 'Create Transaction',
      description:
        'Create a new EDI transaction in Orderful. Only one transaction can be posted at a time. The message field must conform to the JSON structure defined by the specified transaction type.',
      inputSchema: {
        typeName: z.string().describe('Transaction type name (e.g. "850_PURCHASE_ORDER")'),
        stream: z.enum(['TEST', 'LIVE']).describe('Stream to create the transaction in'),
        senderIsaId: z.string().describe('Sender ISA ID (1-35 characters)'),
        receiverIsaId: z.string().describe('Receiver ISA ID (1-35 characters)'),
        message: z.string().optional().describe('Transaction message as a JSON string conforming to the transaction type schema'),
      },
    },
    async ({ typeName, stream, senderIsaId, receiverIsaId, message }) => {
      try {
        const body: Record<string, unknown> = {
          type: { name: typeName },
          stream,
          sender: { isaId: senderIsaId },
          receiver: { isaId: receiverIsaId },
        };
        if (message) body.message = JSON.parse(message);

        return ok(await orderfulApiCall('/v3/transactions', 'POST', body));
      } catch (e) {
        return err(e);
      }
    },
  );
};
