import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_generate_label',
    {
      title: 'Generate Label',
      description:
        'Generate shipping labels from transaction data. Provide the retailer/distributor type and label details. Returns label in ZPL or PDF format.',
      inputSchema: {
        type: z.string().describe('Company identifier for label generation (retailer/distributor name)'),
        format: z.enum(['zpl', 'pdf']).optional().describe('Output format: zpl (Zebra Programming Language) or pdf'),
        skipValidation: z.boolean().optional().describe('Whether to skip validation'),
        labelData: z
          .string()
          .optional()
          .describe(
            'JSON string with label fields: shipFrom, shipTo, vendor, store, distributionCenter, carrier, shipment, department, purchaseOrder, pallet, case, carton, item, merchandise, optionalInformation',
          ),
      },
    },
    async ({ type, format, skipValidation, labelData }) => {
      try {
        const query = new URLSearchParams();
        if (format) query.set('format', format);
        if (skipValidation) query.set('skipValidation', 'true');

        const body: Record<string, unknown> = { type };
        if (labelData) {
          const parsed = JSON.parse(labelData);
          Object.assign(body, parsed);
        }

        const qs = query.toString();
        return ok(await orderfulApiCall(`/v3/labels${qs ? `?${qs}` : ''}`, 'POST', body));
      } catch (e) {
        return err(e);
      }
    },
  );
};
