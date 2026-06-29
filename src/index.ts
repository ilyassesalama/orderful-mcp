#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';
import { credentialStore } from './credential-store.js';
import { setApiKey } from './api.js';

const faviconSvg = readFileSync(fileURLToPath(new URL('./favicon.svg', import.meta.url)));

const serverInfo = {
  name: 'orderful-edi',
  title: 'Orderful EDI',
  version: '1.0.0',
  icons: [
    {
      src: `data:image/svg+xml;base64,${faviconSvg.toString('base64')}`,
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    },
  ],
};

async function startStdio() {
  const apiKey = process.argv[2];
  if (!apiKey) {
    console.error('Error: Orderful API key required as first argument.');
    console.error('Usage: npx orderful <api-key>');
    process.exit(1);
  }
  setApiKey(apiKey);

  const server = new McpServer(serverInfo);
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
  const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = await import(
    '@modelcontextprotocol/sdk/server/auth/router.js'
  );
  const { requireBearerAuth } = await import(
    '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
  );
  const { securityHeaders, rateLimitMiddleware, JSON_LIMIT } = await import('./http-security.js');
  const {
    orderfulOAuthProvider,
    orderfulLoginSubmitHandler,
    ORDERFUL_LOGIN_SUBMIT_PATH,
    orderfulConnectPageHandler,
    orderfulConnectSubmitHandler,
    orderfulConnectDoneHandler,
    ORDERFUL_CONNECT_PATH,
    ORDERFUL_CONNECT_SUBMIT_PATH,
    ORDERFUL_CONNECT_DONE_PATH,
  } = await import('./oauth-provider.js');
  const { registerAccountTools } = await import('./account-tools.js');

  const port = process.env.PORT || 3000;

  // OAuth issuer — must be the public HTTPS URL in production.
  const baseUrl = new URL(
    process.env.OAUTH_ISSUER_URL || process.env.PUBLIC_URL || `http://localhost:${port}`,
  );

  const mcpPath = process.env.MCP_PATH || '/mcp';
  const resourceServerUrl = new URL(mcpPath, baseUrl);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl);

  const app = express();
  app.use(securityHeaders);

  const sendFavicon = (_req: import('express').Request, res: import('express').Response) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(faviconSvg);
  };
  app.get('/favicon.svg', sendFavicon);
  app.get('/favicon.ico', sendFavicon);

  app.use(
    mcpAuthRouter({
      provider: orderfulOAuthProvider,
      issuerUrl: baseUrl,
      baseUrl,
      resourceServerUrl,
      resourceName: 'Orderful EDI MCP',
    }),
  );

  app.post(ORDERFUL_LOGIN_SUBMIT_PATH, express.urlencoded({ extended: false }), orderfulLoginSubmitHandler);

  // Connect-another-organization flow (one-time link from the connect tool).
  app.get(ORDERFUL_CONNECT_PATH, orderfulConnectPageHandler);
  app.post(ORDERFUL_CONNECT_SUBMIT_PATH, express.urlencoded({ extended: false }), orderfulConnectSubmitHandler);
  app.get(ORDERFUL_CONNECT_DONE_PATH, orderfulConnectDoneHandler);

  // Fresh server per request; the member's key arrives in req.auth.extra.
  app.all(
    mcpPath,
    rateLimitMiddleware,
    requireBearerAuth({ verifier: orderfulOAuthProvider, resourceMetadataUrl }),
    express.json({ limit: JSON_LIMIT }),
    async (req, res) => {
      try {
        const auth = req.auth?.extra as { profileId?: string; orderfulKey?: string } | undefined;
        if (!auth?.profileId) {
          res.status(401).json({ error: 'invalid_token' });
          return;
        }

        const credentials: Record<string, string> = { PROFILE_ID: auth.profileId };
        if (auth.orderfulKey) credentials.ORDERFUL_API_KEY = auth.orderfulKey;

        await credentialStore.run(credentials, async () => {
          const server = new McpServer(serverInfo);
          registerAllTools(server);
          registerAccountTools(server, baseUrl);
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        });
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    },
  );

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.listen(port, () => {
    console.log(
      `Orderful EDI MCP server listening on port ${port} (HTTP mode), MCP endpoint at ${mcpPath}, OAuth issuer ${baseUrl.href}`,
    );
  });
}

const isHttpMode = process.env.MCP_TRANSPORT === 'http';

(isHttpMode ? startHttp() : startStdio()).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
