import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type ToolRegistrar = (server: McpServer) => void;

export function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function err(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true as const,
  };
}
