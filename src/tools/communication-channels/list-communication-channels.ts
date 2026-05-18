import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_list_communication_channels',
    {
      title: 'List Communication Channels',
      description:
        "List all communication channels (AS2, SFTP, POLLER, HTTP) configured for an organization. Returns each channel's id, name, type, direction (IN/OUT), and config. Critical for VAN partner migration: Orderful does not have a dedicated VAN channel type — VAN partners route through the organization's existing POLLER channels via document relationships. Use this tool to find the relevant POLLER channel id, then pass it into orderful_update_document_relationship when wiring up VAN partners.",
      inputSchema: {
        ownerId: z
          .number()
          .int()
          .describe('Orderful organization ID. Get from orderful_get_organization.'),
        direction: z
          .enum(['IN', 'OUT'])
          .optional()
          .describe('Filter by direction. Omit to return both inbound and outbound channels.'),
      },
    },
    async ({ ownerId, direction }) => {
      try {
        const params = new URLSearchParams({ ownerId: String(ownerId) });
        if (direction) params.append('direction', direction);
        return ok(
          await orderfulApiCall(
            `/v2/communication-channels?${params.toString()}`,
            'GET',
          ),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
};
