import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_create_trading_request',
    {
      title: 'Create Trading Request',
      description:
        'Create a new Orderful trading request to establish a trading partnership. Use orderful_search_trading_partner first to get the receiver ISA details.',
      inputSchema: {
        scenarioIds: z.array(z.number()).optional().describe('Optional scenario IDs to include'),
        senderEdiAccountId: z.number().describe('Your EDI account ID (sender)'),
        senderContactEmail: z.string().describe('Contact email for the sender'),
        receiverIsaId: z.string().describe('Receiver ISA ID (from search results)'),
        receiverIsaIdQualifier: z.string().describe('Receiver ISA ID qualifier (from search results)'),
        receiverContactEmail: z.string().describe('Contact email for the receiver'),
        receiverOrganizationName: z.string().describe('Receiver organization name'),
        shouldSkipOutreach: z.boolean().describe('Whether to skip outreach to the receiver'),
      },
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          requestDetails: {
            partnershipType: 'NEW',
            type: 'INITIAL',
            sender: {
              ediAccountId: params.senderEdiAccountId,
              contactEmail: params.senderContactEmail,
            },
            receiver: {
              isaId: params.receiverIsaId,
              isaIdQualifier: params.receiverIsaIdQualifier,
              contactEmail: params.receiverContactEmail,
              organizationName: params.receiverOrganizationName,
            },
            shouldSkipOutreach: params.shouldSkipOutreach,
          },
        };
        if (params.scenarioIds) body.scenarioIds = params.scenarioIds;

        return ok(await orderfulApiCall('/v2/trading-requests', 'POST', body));
      } catch (e) {
        return err(e);
      }
    },
  );
};
