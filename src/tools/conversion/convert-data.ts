import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

const FORMAT_CONTENT_TYPE: Record<string, string> = {
  'x12': 'application/edi-x12',
  'json': 'application/json',
};

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_convert_data',
    {
      annotations: { readOnlyHint: true },
      title: 'Convert Data',
      description:
        'Convert data between X12 EDI and JSON formats. Specify the input and output formats and provide the data to convert.',
      inputSchema: {
        data: z.string().describe('The data to convert (raw X12 EDI string or JSON string)'),
        inputFormat: z.enum(['x12', 'json']).describe('Format of the input data'),
        outputFormat: z.enum(['x12', 'json']).describe('Desired output format'),
      },
    },
    async ({ data, inputFormat, outputFormat }) => {
      try {
        const contentType = FORMAT_CONTENT_TYPE[inputFormat];
        const accept = FORMAT_CONTENT_TYPE[outputFormat];
        const body = inputFormat === 'json' ? JSON.parse(data) : data;

        return ok(await orderfulApiCall('/v3/convert', 'POST', body, contentType, accept));
      } catch (e) {
        return err(e);
      }
    },
  );
};
