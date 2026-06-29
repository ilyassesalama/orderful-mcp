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

Instead of each user running the server locally over stdio, you can host one instance and have clients connect over HTTP. Authentication uses **OAuth 2.1** — each user authenticates with **their own** Orderful API key during the Connect flow, so a single hosted instance safely serves a whole team and no key is ever shared or embedded in a URL.

Start it in HTTP mode:

```bash
MCP_TRANSPORT=http PORT=3000 OAUTH_ISSUER_URL=https://your-host.example.com node dist/index.js
```

This exposes:

- `POST /mcp` — the MCP endpoint (Streamable HTTP), protected by a Bearer access token
- `GET /authorize`, `POST /token`, `POST /register`, `POST /revoke` — OAuth 2.1 endpoints
- `GET /.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp` — discovery metadata
- `GET /health` — health check

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `MCP_TRANSPORT=http` | yes | Enables HTTP mode (default is stdio). |
| `OAUTH_ISSUER_URL` | yes (prod) | The externally reachable HTTPS base URL of this server. Used as the OAuth issuer and to build discovery metadata. Defaults to `http://localhost:<PORT>` for local dev. |
| `PORT` | no | Listen port (default `3000`). |
| `MCP_PATH` | no | Path the MCP endpoint is mounted at (default `/mcp`). |
| `OAUTH_ENCRYPTION_KEY` | recommended | Secret used to encrypt stored Orderful keys at rest (AES-256-GCM). If unset, a random per-process key is used and issued tokens won't survive a restart. |

### How a team connects

1. **The org owner adds the connector once**, with **no key in the URL**:

   ```
   https://your-host.example.com/mcp
   ```

   In **Organization settings → Connectors → Add → Custom → Web**, paste that URL. (On Teams plans, only Owners can add custom connectors.)

2. **Each member connects individually.** Under **Customize → Connectors → Connect**, Claude discovers the OAuth metadata, registers itself, and opens a page asking for **that member's own Orderful API key**. The key is validated against Orderful, bound to tokens issued just for that member, and never appears in shared connector settings.

- **Claude Code (terminal):**

  ```bash
  claude mcp add --transport http orderful "https://your-host.example.com/mcp"
  ```

  (Add `--scope user` to make it available across all your projects.) Claude Code runs the OAuth flow on first use.

The MCP endpoint also applies per-IP rate limiting and a 1 MB request size limit. **Always run it behind HTTPS** (a reverse proxy or your platform's TLS) — `OAUTH_ISSUER_URL` must be the public `https://` URL.

> **Per-user identity, no shared secret.** Because each member authenticates with their own key via OAuth, there's no `?key=` in the URL to leak across the team, and a member's key is never visible to anyone else. Rotate a key in Orderful at any time; that member just re-connects.

### Scaling beyond one instance

OAuth state (clients, codes, tokens) is held **in-memory** in a single process — fine for one instance. To run multiple instances behind a load balancer, replace the `Map`s in `src/oauth-store.ts` with a shared backend (Redis, Postgres, …); the surface is intentionally small so the swap is mechanical. Set a stable `OAUTH_ENCRYPTION_KEY` so stored keys decrypt across instances.

## Getting an API key

Generate an API key from your Orderful dashboard under **Settings → API Keys**. Pass it as the first argument to the `orderful` command (stdio), or enter it on the Connect page when authenticating to a hosted instance (HTTP/OAuth). Your key is sent directly to Orderful's API to authorize your requests.

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