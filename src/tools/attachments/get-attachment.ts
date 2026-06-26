import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_get_attachment',
    {
      annotations: { readOnlyHint: true },
      title: 'Get Attachment',
      description:
        'Get attachment metadata by ID. Returns the attachment format (x12, json, xml, txt, edifact), description, content URL, and size in bytes.',
      inputSchema: {
        attachmentId: z.number().describe('The attachment ID to retrieve'),
      },
    },
    async ({ attachmentId }) => {
      try {
        return ok(await orderfulApiCall(`/v3/attachments/${attachmentId}`));
      } catch (e) {
        return err(e);
      }
    },
  );
};
