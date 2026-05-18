import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_create_sftp_outbound_channel',
    {
      title: 'Create Outbound SFTP/FTP Communication Channel',
      description:
        'Create a new Outbound FTP/SFTP Communication Channel in Orderful for a self-hosted server (you or the trading partner host the SFTP — Orderful downloads files from it to send transactions onward). Use this during migration to recreate outbound SFTP delivery from a source platform (e.g. SPS Commerce). Pair with sps_get_production_connection to retrieve credentials from the source. For partners that use SFTP both ways, also call orderful_create_sftp_inbound_channel.',
      inputSchema: {
        name: z
          .string()
          .max(25)
          .describe('Friendly name for this channel. Max 25 characters (e.g. "Acme<>Orderful Out").'),
        ownerId: z
          .number()
          .int()
          .describe('Orderful organization ID that owns this channel. Get from orderful_get_organization.'),
        host: z
          .string()
          .describe('SFTP/FTP server URL (e.g. sftp://sftp.example.com). Outbound expects a URL-formatted host.'),
        port: z
          .number()
          .int()
          .default(22)
          .describe('Server port. Default 22 (SFTP), 21 (FTP).'),
        username: z.string().describe('Username for SFTP/FTP authentication.'),
        password: z.string().describe('Password for SFTP/FTP authentication.'),
        pollDirectory: z
          .string()
          .describe('Remote directory Orderful downloads files from (e.g. /outbound).'),
        protocol: z
          .enum(['SFTP', 'FTP'])
          .default('SFTP')
          .describe('Transport protocol. SFTP (port 22) or FTP (port 21).'),
        downloadPattern: z
          .string()
          .default('.*')
          .describe('Regex pattern selecting which files to download. Default ".*" matches all files.'),
        disposition: z
          .enum(['DELETE', 'ARCHIVE'])
          .default('DELETE')
          .describe('Action taken on files after download. DELETE removes them; ARCHIVE moves them aside.'),
        guidelineFilter: z
          .boolean()
          .optional()
          .describe('Filter outbound documents by guideline. Default true.'),
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
      downloadPattern,
      disposition,
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
            downloadPattern,
            disposition,
          },
          direction: 'OUT',
          ownerId,
        };
        return ok(await orderfulApiCall('/v2/communication-channels', 'POST', body));
      } catch (e) {
        return err(e);
      }
    },
  );
};
