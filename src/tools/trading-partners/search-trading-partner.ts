import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_search_trading_partner',
    {
      title: 'Search Trading Partner',
      description:
        'Search for Orderful trading partners by name or ISA ID. Returns matching EDI accounts with id, name, isaId, and isaIdQualifier.',
      inputSchema: {
        nameOrIsaId: z.string().describe('Trading partner name or ISA ID to search for'),
      },
    },
    async ({ nameOrIsaId }) => {
      try {
        return ok(await orderfulApiCall(`/v2/edi-accounts/search?nameOrIsaId=${encodeURIComponent(nameOrIsaId)}`));
      } catch (e) {
        return err(e);
      }
    },
  );
};
