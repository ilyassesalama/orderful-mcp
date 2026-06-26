import * as z from 'zod/v4';
import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_update_document_relationship',
    {
      annotations: { readOnlyHint: false },
      title: 'Update Document Relationship',
      description:
        'Update settings on an existing document-relationship in Orderful (per partner × transaction-type × direction). Sparse PATCH — only fields you specify are changed; everything else is preserved. Common migration uses: enable/disable autoSend, toggle 997 acknowledgments (sendAcks), bind newly-created Communication Channels (test/prod channel IDs), or apply additional config keys via the additionalUpdates escape hatch (e.g. ackTimeout, partnerGuidelineSetId, status). The response returns the full updated relationship.',
      inputSchema: {
        relationshipId: z
          .number()
          .int()
          .describe('The numeric document-relationship id (e.g. 222524). Get from orderful_list_relationships or the Orderful UI URL.'),
        autoSend: z
          .enum(['ENABLED', 'DISABLED'])
          .optional()
          .describe('Whether transactions on this relationship are auto-sent to the partner.'),
        sendAcks: z
          .boolean()
          .optional()
          .describe('Whether to automatically send 997 functional acknowledgments back to the partner.'),
        ackTimeout: z
          .number()
          .int()
          .optional()
          .describe('Time in seconds to wait for a 997 ACK before flagging missing (default 7200 = 2h).'),
        testCommunicationChannelId: z
          .number()
          .int()
          .optional()
          .describe('Communication channel id used for the TEST stream. Bind to a channel created via orderful_create_as2_channel.'),
        prodCommunicationChannelId: z
          .number()
          .int()
          .optional()
          .describe('Communication channel id used for the LIVE stream.'),
        partnerGuidelineSetId: z
          .number()
          .int()
          .optional()
          .describe('Guideline set id used to validate the partner side.'),
        status: z
          .string()
          .optional()
          .describe('Relationship status, e.g. "TEST" or "PROD". Move from TEST to PROD when migration validates successfully.'),
        additionalUpdates: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Escape hatch for any other PATCH-able fields not listed above (e.g. dataFormat, partnerDataVersion, config.workflowConfig.autoAcceptItems). Merged into the request body.',
          ),
      },
    },
    async ({
      relationshipId,
      autoSend,
      sendAcks,
      ackTimeout,
      testCommunicationChannelId,
      prodCommunicationChannelId,
      partnerGuidelineSetId,
      status,
      additionalUpdates,
    }) => {
      try {
        const body: Record<string, unknown> = { ...(additionalUpdates ?? {}) };
        if (autoSend !== undefined) body.autoSend = autoSend;
        if (sendAcks !== undefined) body.sendAcks = sendAcks;
        if (ackTimeout !== undefined) body.ackTimeout = ackTimeout;
        if (testCommunicationChannelId !== undefined) body.testCommunicationChannelId = testCommunicationChannelId;
        if (prodCommunicationChannelId !== undefined) body.prodCommunicationChannelId = prodCommunicationChannelId;
        if (partnerGuidelineSetId !== undefined) body.partnerGuidelineSetId = partnerGuidelineSetId;
        if (status !== undefined) body.status = status;

        if (Object.keys(body).length === 0) {
          throw new Error('At least one field must be provided to update.');
        }

        return ok(
          await orderfulApiCall(
            `/v2/document-relationships/${relationshipId}`,
            'PATCH',
            body,
          ),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
};
