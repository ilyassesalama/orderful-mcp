import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_list_trading_partners',
    {
      annotations: { readOnlyHint: true },
      title: 'List Trading Partners',
      description:
        'List all trading partners connected to your organization. Returns each partner\'s organizationId, organizationName, ediAccountId, ediAccountName, and ISA IDs/qualifiers. Use the organizationId (or ediAccountId) with orderful_download_partner_guidelines to fetch their EDI guideline documents.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await orderfulApiCall('/v2/trading-partners'));
      } catch (e) {
        return err(e);
      }
    },
  );
};
