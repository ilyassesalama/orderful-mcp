import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_create_sftp_inbound_channel',
    {
      annotations: { readOnlyHint: false },
      title: 'Create Inbound SFTP/FTP Communication Channel',
      description:
        'Create a new Inbound FTP/SFTP Communication Channel in Orderful for a self-hosted server (you or the trading partner host the SFTP — Orderful polls it for incoming transactions). Use this during migration to recreate SFTP connections from a source platform (e.g. SPS Commerce). Pair with sps_get_production_connection to retrieve host, port, username, and password from the source. For partners that use SFTP both ways, also call orderful_create_sftp_outbound_channel.',
      inputSchema: {
        name: z
          .string()
          .max(25)
          .describe('Friendly name for this channel. Max 25 characters (e.g. "Acme<>Orderful In").'),
        ownerId: z
          .number()
          .int()
          .describe('Orderful organization ID that owns this channel. Get from orderful_get_organization.'),
        host: z
          .string()
          .describe('SFTP/FTP server hostname or IP (e.g. sftp.example.com).'),
        port: z
          .number()
          .int()
          .default(22)
          .describe('Server port. Default 22 (SFTP), 21 (FTP).'),
        username: z.string().describe('Username for SFTP/FTP authentication.'),
        password: z.string().describe('Password for SFTP/FTP authentication.'),
        pollDirectory: z
          .string()
          .describe('Remote directory Orderful polls for incoming files (e.g. /inbound).'),
        protocol: z
          .enum(['SFTP', 'FTP'])
          .default('SFTP')
          .describe('Transport protocol. SFTP (port 22) or FTP (port 21).'),
        namingConvention: z
          .string()
          .default(
            '<SENDER_ISA_ID>_<RECEIVER_ISA_ID>_<TRANSACTION_TYPE>_<RESOURCE_ID>.<FILE_EXTENSION>',
          )
          .describe(
            'File naming convention. Supports placeholders: <SENDER_ISA_ID>, <RECEIVER_ISA_ID>, <TRANSACTION_TYPE>, <RESOURCE_ID>, <FILE_EXTENSION>, <DELIVERY_ID>, <RESOURCE_CREATED_AT>.',
          ),
        guidelineFilter: z
          .boolean()
          .optional()
          .describe('Filter inbound documents by guideline. Default true.'),
        isActive: z
          .boolean()
          .optional()
          .describe('Activate channel immediately. Default true.'),
      },
    },
    async ({
      name,
      ownerId,
      host,
      port,
      username,
      password,
      pollDirectory,
      protocol,
      namingConvention,
      guidelineFilter,
      isActive,
    }) => {
      try {
        const body = {
          name,
          isActive: isActive ?? true,
          config: {
            destinationTypeName: 'sftp-externally-hosted',
            guidelineFilter: guidelineFilter ?? true,
            username,
            password,
            host,
            port,
            pollDirectory,
            protocol,
            namingConvention,
          },
          direction: 'IN',
          ownerId,
        };
        return ok(await orderfulApiCall('/v2/communication-channels', 'POST', body));
      } catch (e) {
        return err(e);
      }
    },
  );
};
