import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_approve_delivery',
    {
      title: 'Approve Delivery',
      description:
        'Approve a transaction delivery. Updates the transaction delivery status to DELIVERED if this is the most recent delivery. Also removes associated transactions from poller buckets.',
      inputSchema: {
        deliveryId: z.string().describe('The delivery ID to approve'),
        note: z.string().optional().describe('Optional note to add to the audit trail'),
      },
    },
    async ({ deliveryId, note }) => {
      try {
        const body = note ? { note } : undefined;
        return ok(await orderfulApiCall(`/v3/deliveries/${deliveryId}/approve`, 'POST', body));
      } catch (e) {
        return err(e);
      }
    },
  );
};
