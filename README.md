# Orderful MCP

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the [Orderful](https://www.orderful.com) EDI API. It brings Orderful's trading-partner, transaction, delivery, and conversion capabilities into Claude and any other MCP-compatible AI client — so you can manage EDI workflows in plain language.

> **Unofficial.** This is a community-built integration and is not affiliated with, endorsed by, or maintained by Orderful. "Orderful" is a trademark of its respective owner. You'll need your own Orderful account and API key.

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



## Quick start

You need [Node.js](https://nodejs.org) 18+ and an Orderful API key (see [Getting an API key](#getting-an-api-key)).

### Claude Code

```bash
claude mcp add orderful npx orderful your-orderful-api-key
```



### Claude Desktop (and other MCP clients)

Add this to your client's MCP config:

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

### Global install

```bash
npm install -g orderful
orderful your-orderful-api-key
```



## Self-hosting (HTTP mode)

Instead of each user running the server locally over stdio, you can host one instance and have clients connect over HTTP. Start it in HTTP mode:

```bash
MCP_TRANSPORT=http PORT=3000 node dist/index.js
```

This exposes:

- `POST /mcp` — the MCP endpoint (Streamable HTTP)
- `GET /health` — health check

Each user passes **their own** Orderful API key as a Bearer token. The server isolates credentials per request, so a single instance can safely serve many users:

```json
{
  "mcpServers": {
    "orderful": {
      "type": "http",
      "url": "https://your-host.example.com/mcp",
      "headers": { "Authorization": "Bearer your-orderful-api-key" }
    }
  }
}
```

Requests without a valid `Authorization: Bearer <key>` header are rejected. The endpoint also applies per-IP rate limiting and a 1 MB request size limit. Always run it behind HTTPS (a reverse proxy or your platform's TLS).

## Getting an API key

Generate an API key from your Orderful dashboard under **Settings → API Keys**. Pass it as the first argument to the `orderful` command (stdio) or as a Bearer token (HTTP). Your key is sent directly to Orderful's API and is never stored or transmitted anywhere else.

## Tools

All tools are exposed with an `orderful_` prefix (e.g. `orderful_get_organization`).


| Category               | Tools                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization           | `get_organization`                                                                                                                                               |
| Transactions           | `list_transactions`, `get_transaction`, `get_transaction_message`, `get_transaction_validations`, `upload_transaction`, `create_transaction`, `send_transaction` |
| Polling                | `get_polling_bucket`                                                                                                                                             |
| Deliveries             | `get_delivery`, `approve_delivery`, `fail_delivery`                                                                                                              |
| Relationships          | `list_relationships`                                                                                                                                             |
| Acknowledgments        | `create_acknowledgment`, `get_acknowledgment`                                                                                                                    |
| Attachments            | `get_attachment`                                                                                                                                                 |
| Conversion             | `convert_data`                                                                                                                                                   |
| Labels                 | `generate_label`                                                                                                                                                 |
| Trading Partners       | `search_trading_partner`, `create_trading_request`                                                                                                               |
| Communication Channels | `create_as2_channel`, `create_sftp_inbound_channel`, `create_sftp_outbound_channel`, `list_communication_channels`                                               |
| Document Relationships | `get_document_relationship`, `update_document_relationship`                                                                                                      |




## Example prompts

Once connected, try asking your assistant:

- *"List the last 10 transactions for partner X"*
- *"Convert this 850 EDI document to JSON"*
- *"Create an SFTP outbound channel for our new trading partner"*
- *"Show me all failed deliveries from this week and approve the ones blocked on validation Y"*
- *"Generate a shipping label for delivery 12345"*



## Development

```bash
git clone https://github.com/ilyassesalama/orderful-mcp.git
cd orderful-mcp
pnpm install
pnpm dev      # tsx watch mode (stdio)
pnpm build    # compile to dist/
pnpm start    # run compiled output
```

The project is plain TypeScript with no build step beyond `tsc`. Each tool lives in its own file under `src/tools/<category>/` and is registered in `src/tools/index.ts`.

## Contributing

Issues and pull requests are welcome. If you're adding a tool:

1. Create it under the appropriate `src/tools/<category>/` directory following the existing pattern.
2. Register it in `src/tools/index.ts`.
3. Run `pnpm build` to confirm it compiles.
4. Update the tools table above.

For bugs or feature requests, please [open an issue](https://github.com/ilyassesalama/orderful-mcp/issues).

## License

[MIT](./LICENSE)