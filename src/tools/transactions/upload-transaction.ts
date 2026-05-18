import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_upload_transaction',
    {
      title: 'Upload Transaction',
      description:
        'Upload an EDI X12 transaction to Orderful. Accepts raw EDI X12 content and submits it as a new EDI job.',
      inputSchema: {
        ediContent: z.string().describe('The raw EDI X12 content to upload (e.g. ISA*00*... IEA*1*...)'),
      },
    },
    async ({ ediContent }) => {
      try {
        return ok(await orderfulApiCall('/v2/edi-jobs', 'POST', ediContent, 'application/edi-x12'));
      } catch (e) {
        return err(e);
      }
    },
  );
};
