import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_fail_delivery',
    {
      annotations: { readOnlyHint: false, destructiveHint: true },
      title: 'Fail Delivery',
      description:
        'Mark a delivery as failed. If this is the most recent delivery for a transaction, the transaction delivery status updates to FAILED.',
      inputSchema: {
        deliveryId: z.string().describe('The delivery ID to mark as failed'),
        note: z.string().optional().describe('Optional note to attach to the delivery failure'),
      },
    },
    async ({ deliveryId, note }) => {
      try {
        const body = note ? { note } : undefined;
        return ok(await orderfulApiCall(`/v3/deliveries/${deliveryId}/fail`, 'POST', body));
      } catch (e) {
        return err(e);
      }
    },
  );
};
