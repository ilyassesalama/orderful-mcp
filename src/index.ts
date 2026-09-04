#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';
import { credentialStore } from './credential-store.js';
import { setApiKey } from './api.js';

const faviconSvg = readFileSync(fileURLToPath(new URL('./favicon.svg', import.meta.url)));
const iconPng = readFileSync(fileURLToPath(new URL('./icon.png', import.meta.url)));

const serverInfo = {
  name: 'orderful',
  title: 'Orderful',
  version: '1.0.0',
  icons: [
    {
      src: `data:image/png;base64,${iconPng.toString('base64')}`,
      mimeType: 'image/png',
      sizes: ['256x256'],
    },
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
  console.error('Orderful MCP server running on stdio');
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
    OAUTH_ISSUER,
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
  const { getDownloadToken, getBundleToken } = await import('./oauth-store.js');
  const { orderfulApiDownload, extensionForContentType, mapLimit } = await import('./api.js');
  const { Zip, ZipPassThrough } = await import('fflate');

  const port = process.env.PORT || 3000;

  // OAuth issuer — must be the public HTTPS URL in production.
  const baseUrl = OAUTH_ISSUER;

  const mcpPath = process.env.MCP_PATH || '/mcp';
  const resourceServerUrl = new URL(mcpPath, baseUrl);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl);

  const app = express();
  const trustProxy = process.env.TRUST_PROXY ?? '1';
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  app.use(securityHeaders);

  type Res = import('express').Response;
  const sendImage = (res: Res, type: string, body: Buffer) => {
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(body);
  };
  // /favicon.ico serves PNG (not SVG): favicon resolvers expect a raster here and
  // reject SVG-typed bytes, which is what made clients fall back to another icon.
  app.get('/favicon.svg', (_req, res: Res) => sendImage(res, 'image/svg+xml', faviconSvg));
  app.get('/favicon.png', (_req, res: Res) => sendImage(res, 'image/png', iconPng));
  app.get('/favicon.ico', (_req, res: Res) => sendImage(res, 'image/png', iconPng));

  app.use(
    mcpAuthRouter({
      provider: orderfulOAuthProvider,
      issuerUrl: baseUrl,
      baseUrl,
      resourceServerUrl,
      resourceName: 'Orderful',
    }),
  );

  app.post(ORDERFUL_LOGIN_SUBMIT_PATH, express.urlencoded({ extended: false }), orderfulLoginSubmitHandler);

  // Connect-another-organization flow (one-time link from the connect tool).
  app.get(ORDERFUL_CONNECT_PATH, orderfulConnectPageHandler);
  app.post(ORDERFUL_CONNECT_SUBMIT_PATH, express.urlencoded({ extended: false }), orderfulConnectSubmitHandler);
  app.get(ORDERFUL_CONNECT_DONE_PATH, orderfulConnectDoneHandler);

  // Fresh server per request; the member's key arrives in req.auth.extra.
  app.post(
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
          // Stateless: tear down this request's server+transport when the response closes,
          // or the per-request McpServer graph (and any SSE keep-alive timer) leaks until OOM.
          res.on('close', () => {
            transport.close();
            server.close();
          });
          await transport.handleRequest(req, res, req.body);
        });
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    },
  );

  // Stateless server: no session to resume, so GET (SSE) and DELETE have nothing to do.
  const methodNotAllowed = (_req: unknown, res: Res) =>
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get(mcpPath, methodNotAllowed);
  app.delete(mcpPath, methodNotAllowed);

  // Temporary tokenized file downloads (e.g. partner guideline documents).
  // The token was minted by a tool call and is bound to one Orderful endpoint
  // plus the member's key; it expires on its own (1 h).
  app.get('/downloads/:token', rateLimitMiddleware, async (req, res) => {
    try {
      const token = req.params.token;
      const rec = typeof token === 'string' ? await getDownloadToken(token) : undefined;
      if (!rec) {
        res.status(404).send('This download link is invalid or has expired. Ask the assistant for a fresh one.');
        return;
      }
      const { data, contentType } = await credentialStore.run(
        { ORDERFUL_API_KEY: rec.orderfulKey },
        () => orderfulApiDownload(rec.endpoint),
      );
      const ext = extensionForContentType(contentType);
      const asciiName = `${rec.filenameBase.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}${ext}`;
      const utf8Name = encodeURIComponent(`${rec.filenameBase}${ext}`);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(data);
    } catch {
      if (!res.headersSent) res.status(502).send('Failed to fetch the file from Orderful.');
    }
  });

  // Bundle download: fetches every file in the bundle from Orderful and
  // streams them back as a single ZIP.
  app.get('/downloads/bundle/:token', rateLimitMiddleware, async (req, res) => {
    try {
      const token = req.params.token;
      const rec = typeof token === 'string' ? await getBundleToken(token) : undefined;
      if (!rec) {
        res.status(404).send('This download link is invalid or has expired. Ask the assistant for a fresh one.');
        return;
      }
      const files = await credentialStore.run({ ORDERFUL_API_KEY: rec.orderfulKey }, () =>
        mapLimit(rec.files, 4, async (file) => {
          const { data, contentType } = await orderfulApiDownload(file.endpoint);
          return { filenameBase: file.filenameBase, data, contentType };
        }),
      );

      const asciiName = `${rec.bundleName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}.zip`;
      const utf8Name = encodeURIComponent(`${rec.bundleName}.zip`);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      // Stream the ZIP in store mode: the files are already-compressed
      // formats (PDF/XLSX), so deflating again would cost CPU for no gain.
      const zip = new Zip((zipErr, chunk, final) => {
        if (zipErr) {
          res.destroy(zipErr);
          return;
        }
        res.write(Buffer.from(chunk));
        if (final) res.end();
      });
      const used = new Set<string>();
      for (const file of files) {
        const ext = extensionForContentType(file.contentType);
        let name = `${file.filenameBase}${ext}`;
        for (let n = 2; used.has(name); n++) name = `${file.filenameBase} (${n})${ext}`;
        used.add(name);
        const entry = new ZipPassThrough(name);
        zip.add(entry);
        entry.push(new Uint8Array(file.data), true);
      }
      zip.end();
    } catch {
      if (!res.headersSent) res.status(502).send('Failed to build the ZIP from Orderful.');
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.listen(port, () => {
    console.log(
      `Orderful MCP server listening on port ${port} (HTTP mode), MCP endpoint at ${mcpPath}, OAuth issuer ${baseUrl.href}`,
    );
  });
}

const isHttpMode = process.env.MCP_TRANSPORT === 'http';

(isHttpMode ? startHttp() : startStdio()).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
