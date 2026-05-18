#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';
import { credentialStore } from './credential-store.js';

async function startStdio() {
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
    parseCredentials,
    JSON_LIMIT,
  } = await import('./http-security.js');

  const app = express();
  app.use(express.json({ limit: JSON_LIMIT }));
  app.use(securityHeaders);

  // Authenticated MCP endpoint — fresh server per request (MCP servers are single-connect)
  app.all('/mcp', authMiddleware, async (req, res) => {
    try {
      const creds = parseCredentials(req);

      // Run in async context so getApiKey() picks up per-request credentials
      await credentialStore.run(creds, async () => {
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
    console.log(`Orderful EDI MCP server listening on port ${port} (HTTP mode)`);
  });
}

const isHttpMode = process.env.MCP_TRANSPORT === 'http';

(isHttpMode ? startHttp() : startStdio()).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
