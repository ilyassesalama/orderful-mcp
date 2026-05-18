# orderful-mcp

An MCP (Model Context Protocol) server for the [Orderful](https://www.orderful.com) EDI API. Brings Orderful's trading-partner, transaction, delivery, and conversion capabilities into Claude and any other MCP-compatible AI client — so you can manage EDI workflows in natural language.

## What you can do

With this server connected, your AI assistant can:

- List, fetch, create, upload, and send EDI transactions
- Inspect transaction messages and validation errors
- Approve, fail, and poll deliveries
- Manage acknowledgments (functional ACKs / 997)
- Search trading partners and create trading requests
- Set up AS2 and SFTP (inbound/outbound) communication channels
- Convert data between EDI and JSON
- Generate shipping labels
- Manage document relationships and attachments
- Query your organization, relationships, and polling buckets

## Installation

### Claude Code

```bash
claude mcp add orderful npx orderful your-orderful-api-key
```

### Claude Desktop (and other MCP clients)

Add to your client's MCP config:

```json
{
  "mcpServers": {
    "orderful": {
      "command": "npx",
      "args": ["-y", "orderful", "your-orderful-api-key"]
    }
  }
}
```

Restart the client and the Orderful tools will be available.

### Manual / global install

```bash
npm install -g orderful
orderful your-orderful-api-key
```

## Getting an API key

Generate an API key from your Orderful dashboard under **Settings → API Keys**. Pass it as the first argument to the `orderful` command.

## Tools


| Category               | Tools                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization           | `get-organization`                                                                                                                                               |
| Transactions           | `list-transactions`, `get-transaction`, `get-transaction-message`, `get-transaction-validations`, `upload-transaction`, `create-transaction`, `send-transaction` |
| Polling                | `get-polling-bucket`                                                                                                                                             |
| Deliveries             | `get-delivery`, `approve-delivery`, `fail-delivery`                                                                                                              |
| Relationships          | `list-relationships`                                                                                                                                             |
| Acknowledgments        | `create-acknowledgment`, `get-acknowledgment`                                                                                                                    |
| Attachments            | `get-attachment`                                                                                                                                                 |
| Conversion             | `convert-data`                                                                                                                                                   |
| Labels                 | `generate-label`                                                                                                                                                 |
| Trading Partners       | `search-trading-partner`, `create-trading-request`                                                                                                               |
| Communication Channels | `create-as2-channel`, `create-sftp-inbound-channel`, `create-sftp-outbound-channel`, `list-communication-channels`                                               |
| Document Relationships | `update-document-relationship`                                                                                                                                   |


## Example prompts

Once installed, try asking your assistant:

- *"List the last 10 transactions for partner X"*
- *"Convert this 850 EDI document to JSON"*
- *"Create an SFTP outbound channel for our new trading partner"*
- *"Show me all failed deliveries from this week and approve the ones blocked on validation Y"*
- *"Generate a shipping label for delivery 12345"*

## Requirements

- Node.js 18+
- An Orderful API key

## Development

```bash
git clone <repo>
cd orderful
pnpm install
pnpm dev      # tsx watch mode
pnpm build    # compile to dist/
pnpm start    # run compiled output
```

## License

MIT