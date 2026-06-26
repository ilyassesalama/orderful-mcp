#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';
import { credentialStore } from './credential-store.js';
import { setApiKey } from './api.js';

async function startStdio() {
  const apiKey = process.argv[2];
  if (!apiKey) {
    console.error('Error: Orderful API key required as first argument.');
    console.error('Usage: npx orderful <api-key>');
    process.exit(1);
  }
  setApiKey(apiKey);

  const server = new McpServer({ name: 'orderful-edi', version: '1.0.0' });
  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Orderful EDI MCP server running on stdio');
}

async function startHttp() {
  const { default: express } = await import('express');
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );
  const {
    securityHeaders,
    authMiddleware,
    getApiKeyFromRequest,
    JSON_LIMIT,
  } = await import('./http-security.js');

  const app = express();
  app.use(express.json({ limit: JSON_LIMIT }));
  app.use(securityHeaders);

  // Path the MCP endpoint is mounted at. Defaults to /mcp; override with
  // MCP_PATH when serving behind a multi-server gateway (e.g. /mcp/orderful).
  const mcpPath = process.env.MCP_PATH || '/mcp';

  // Authenticated MCP endpoint — fresh server per request (MCP servers are single-connect)
  app.all(mcpPath, authMiddleware, async (req, res) => {
    try {
      // authMiddleware guarantees a key is present
      const apiKey = getApiKeyFromRequest(req)!;

      // Run in async context so getApiKey() picks up this request's key
      await credentialStore.run({ ORDERFUL_API_KEY: apiKey }, async () => {
        const server = new McpServer({ name: 'orderful-edi', version: '1.0.0' });
        registerAllTools(server);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Orderful EDI MCP server listening on port ${port} (HTTP mode), MCP endpoint at ${mcpPath}`);
  });
}

const isHttpMode = process.env.MCP_TRANSPORT === 'http';

(isHttpMode ? startHttp() : startStdio()).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
