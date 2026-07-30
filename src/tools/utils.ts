import { readFileSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';

export type ToolRegistrar = (server: McpServer) => void;

export function ok(data: unknown, structured?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    ...(structured && { structuredContent: structured }),
  };
}

export function err(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true as const,
  };
}

/** Serve a bundled MCP Apps view (built into dist/ui/ by scripts/build-ui.mjs). */
export function registerAppView(server: McpServer, name: string, uri: string, htmlUrl: URL): void {
  registerAppResource(server, name, uri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: readFileSync(htmlUrl, 'utf8') }],
  }));
}
