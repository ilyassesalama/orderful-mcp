import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolRegistrar } from './utils.js';

// Organization
import { register as getOrganization } from './organization/get-organization.js';

// Transactions
import { register as listTransactions } from './transactions/list-transactions.js';
import { register as getTransaction } from './transactions/get-transaction.js';
import { register as getTransactionMessage } from './transactions/get-transaction-message.js';
import { register as getTransactionValidations } from './transactions/get-transaction-validations.js';
import { register as uploadTransaction } from './transactions/upload-transaction.js';
import { register as createTransaction } from './transactions/create-transaction.js';
import { register as sendTransaction } from './transactions/send-transaction.js';

// Polling
import { register as getPollingBucket } from './polling/get-polling-bucket.js';

// Deliveries
import { register as getDelivery } from './deliveries/get-delivery.js';
import { register as approveDelivery } from './deliveries/approve-delivery.js';
import { register as failDelivery } from './deliveries/fail-delivery.js';

// Relationships
import { register as listRelationships } from './relationships/list-relationships.js';

// Acknowledgments
import { register as createAcknowledgment } from './acknowledgments/create-acknowledgment.js';
import { register as getAcknowledgment } from './acknowledgments/get-acknowledgment.js';

// Attachments
import { register as getAttachment } from './attachments/get-attachment.js';

// Conversion
import { register as convertData } from './conversion/convert-data.js';

// Labels
import { register as generateLabel } from './labels/generate-label.js';

// Trading Partners
import { register as searchTradingPartner } from './trading-partners/search-trading-partner.js';
import { register as createTradingRequest } from './trading-partners/create-trading-request.js';

// Communication Channels
import { register as createAs2Channel } from './communication-channels/create-as2-channel.js';
import { register as createSftpInboundChannel } from './communication-channels/create-sftp-inbound-channel.js';
import { register as createSftpOutboundChannel } from './communication-channels/create-sftp-outbound-channel.js';
import { register as listCommunicationChannels } from './communication-channels/list-communication-channels.js';

// Document Relationships
import { register as getDocumentRelationship } from './document-relationships/get-document-relationship.js';
import { register as updateDocumentRelationship } from './document-relationships/update-document-relationship.js';

const tools: ToolRegistrar[] = [
  getOrganization,
  listTransactions,
  getTransaction,
  getTransactionMessage,
  getTransactionValidations,
  uploadTransaction,
  createTransaction,
  sendTransaction,
  getPollingBucket,
  getDelivery,
  approveDelivery,
  failDelivery,
  listRelationships,
  createAcknowledgment,
  getAcknowledgment,
  getAttachment,
  convertData,
  generateLabel,
  searchTradingPartner,
  createTradingRequest,
  createAs2Channel,
  createSftpInboundChannel,
  createSftpOutboundChannel,
  listCommunicationChannels,
  getDocumentRelationship,
  updateDocumentRelationship,
];

export function registerAllTools(server: McpServer): void {
  for (const register of tools) {
    register(server);
  }
}
