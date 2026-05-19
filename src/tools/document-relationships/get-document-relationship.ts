import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_get_document_relationship',
    {
      title: 'Get Document Relationship',
      description:
        'Fetch a single document-relationship by id (per partner × transaction-type × direction) and return its full configuration: bound test/prod communication channels, autoSend, sendAcks, ackTimeout, partner guideline set, status (TEST/PROD), data format, and any additional workflow config. Useful before issuing a PATCH via orderful_update_document_relationship, when troubleshooting a specific partner flow, or when inspecting an id taken from the Orderful UI URL.',
      inputSchema: {
        relationshipId: z
          .number()
          .int()
          .describe('The numeric document-relationship id (e.g. 226966). Get from orderful_list_relationships or the Orderful UI URL.'),
      },
    },
    async ({ relationshipId }) => {
      try {
        return ok(
          await orderfulApiCall(
            `/v2/document-relationships/${relationshipId}`,
            'GET',
          ),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
};
