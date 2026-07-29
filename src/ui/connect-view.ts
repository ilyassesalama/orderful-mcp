// Iframe script for the connect-organization MCP App view. Bundled by
// scripts/build-ui.mjs and inlined into connect.html.
//
// Happy path: the member pastes the org's API key here and we call the
// app-only tool orderful_submit_organization_key on the authenticated
// session. If the host can't proxy server tool calls, we degrade to the
// one-time browser link that connect_organization also returned.
import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';

const el = (id: string) => document.getElementById(id)!;

let connectUrl: string | undefined;

function show(state: 'form' | 'done' | 'fallback'): void {
  el('form-state').classList.toggle('hidden', state !== 'form');
  el('done-state').classList.toggle('hidden', state !== 'done');
  el('fallback-state').classList.toggle('hidden', state !== 'fallback');
}

function setStatus(text: string, kind: 'error' | 'muted' = 'muted'): void {
  const status = el('status');
  status.textContent = text;
  status.className = `status ${kind}`;
}

const app = new App({ name: 'Orderful Connect', version: '1.0.0' }, {});

app.ontoolresult = (params) => {
  const structured = params.structuredContent as { connect_url?: string } | undefined;
  connectUrl = structured?.connect_url;
  if (!el('fallback-state').classList.contains('hidden')) renderFallback();
};

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
};

function renderFallback(): void {
  show('fallback');
  const text = el('fallback-text');
  if (!connectUrl) {
    text.textContent = 'Ask the assistant for a connect link to add the organization in your browser.';
    return;
  }
  text.textContent = '';
  const link = document.createElement('a');
  link.href = connectUrl;
  link.textContent = 'Open the secure connect page';
  link.addEventListener('click', (event) => {
    event.preventDefault();
    void app.openLink({ url: connectUrl! }).catch(() => window.open(connectUrl, '_blank'));
  });
  text.append(link, ' and paste the organization’s API key there.');
}

el('form').addEventListener('submit', (event) => {
  event.preventDefault();
  void submit();
});

async function submit(): Promise<void> {
  const input = el('key') as HTMLInputElement;
  const button = el('submit') as HTMLButtonElement;
  const key = input.value.trim();
  if (!key) {
    setStatus('Enter the organization’s API key.', 'error');
    return;
  }
  button.disabled = true;
  input.disabled = true;
  setStatus('Verifying with Orderful…');
  try {
    const result = await app.callServerTool({
      name: 'orderful_submit_organization_key',
      arguments: { api_key: key },
    });
    if (result.isError) {
      const text = result.content?.find((c): c is { type: 'text'; text: string } => c.type === 'text');
      setStatus(text?.text.replace(/^Error:\s*/, '') ?? 'Something went wrong. Try again.', 'error');
      return;
    }
    const structured = result.structuredContent as { organization?: string } | undefined;
    const org = structured?.organization;
    input.value = '';
    el('done-title').textContent = org ? `${org} connected` : 'Connected';
    show('done');
    // Tell the model the outcome so the conversation can move on.
    if (app.getHostCapabilities()?.updateModelContext) {
      void app
        .updateModelContext({
          content: [
            {
              type: 'text',
              text: `The user connected the Orderful organization "${org ?? 'unknown'}" via the inline form. It is now active — no need to share the connect link or call wait_for_organization_connection.`,
            },
          ],
        })
        .catch(() => {});
    }
  } catch {
    setStatus('Could not reach the connector. Try again.', 'error');
  } finally {
    button.disabled = false;
    input.disabled = false;
  }
}

void app
  .connect()
  .then(() => {
    const theme = app.getHostContext()?.theme;
    if (theme) applyDocumentTheme(theme);
    // No server-tool proxying on this host → the inline form can't work;
    // degrade to the browser link flow.
    if (!app.getHostCapabilities()?.serverTools) renderFallback();
    else (el('key') as HTMLInputElement).focus();
  })
  .catch(() => {
    show('fallback');
  });
