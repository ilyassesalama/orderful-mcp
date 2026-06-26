import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_create_as2_channel',
    {
      annotations: { readOnlyHint: false },
      title: 'Create Inbound AS2 Communication Channel',
      description:
        "Create a new Inbound AS2 Communication Channel in Orderful for a trading partner, including the partner's PEM certificate, AS2 ID, and URL — all in a single POST. The cert MUST be valid for at least 30 days from upload (Orderful rejects shorter expiries). Use this during migration to recreate AS2 connections that were configured on a source platform (e.g. SPS Commerce). Pair with orderful_get_organization to find the ownerId, and with sps_get_production_connection to retrieve the partner's AS2 cert/URL/ID from the source.",
      inputSchema: {
        name: z
          .string()
          .max(25)
          .describe('Friendly name for this channel. Max 25 characters (e.g. "Acme<>Orderful Prod").'),
        ownerId: z
          .number()
          .int()
          .describe('Orderful organization ID that owns this channel. Get from orderful_get_organization.'),
        partnerAs2Id: z
          .string()
          .max(25)
          .describe("Partner's AS2 ID. Max 25 characters."),
        partnerUrl: z
          .string()
          .url()
          .describe("Partner's AS2 endpoint URL (e.g. http://edi.example.com:80/AS2)."),
        partnerCertificate: z
          .string()
          .describe(
            "Partner's PEM-encoded certificate as a string. Must include `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----` markers and be valid for at least 30 days.",
          ),
        guidelineFilter: z
          .boolean()
          .optional()
          .describe('Whether to filter inbound documents by guideline. Default true.'),
        isActive: z
          .boolean()
          .optional()
          .describe('Whether the channel is active immediately. Default true.'),
      },
    },
    async ({
      name,
      ownerId,
      partnerAs2Id,
      partnerUrl,
      partnerCertificate,
      guidelineFilter,
      isActive,
    }) => {
      try {
        const body = {
          name,
          isActive: isActive ?? true,
          config: {
            destinationTypeName: 'as2-native',
            guidelineFilter: guidelineFilter ?? true,
            partnerAs2Id,
            partnerUrl,
            partnerCertificate,
            auth: { type: 'NONE' },
          },
          ownerId,
        };
        return ok(await orderfulApiCall('/v2/communication-channels', 'POST', body));
      } catch (e) {
        return err(e);
      }
    },
  );
};
