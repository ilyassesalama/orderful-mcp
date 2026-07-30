// Shared host-theme wiring for all views: follow the host's theme both at
// startup and when it changes at runtime.
import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';

export function followHostTheme(app: App): void {
  app.onhostcontextchanged = (ctx) => {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
  };
}

/** Call after app.connect() resolves. */
export function applyInitialTheme(app: App): void {
  const theme = app.getHostContext()?.theme;
  if (theme) applyDocumentTheme(theme);
}
