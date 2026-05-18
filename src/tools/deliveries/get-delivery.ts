import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_get_delivery',
    {
      title: 'Get Delivery',
      description:
        'Get delivery details by ID. Returns status (CREATED, SENT, FAILED, DELIVERED), timestamps, and links to approve/fail the delivery.',
      inputSchema: {
        deliveryId: z.string().describe('The delivery ID to retrieve'),
      },
    },
    async ({ deliveryId }) => {
      try {
        return ok(await orderfulApiCall(`/v3/deliveries/${deliveryId}`));
      } catch (e) {
        return err(e);
      }
    },
  );
};
