// Iframe script for the transactions MCP App view. Bundled by
// scripts/build-ui.mjs and inlined into transactions.html.
import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';

interface Party {
  isaId?: string;
  name?: string;
}

interface Tx {
  id?: string;
  type?: { name?: string };
  sender?: Party;
  receiver?: Party;
  stream?: string;
  validationStatus?: string;
  deliveryStatus?: string;
  acknowledgmentStatus?: string;
  createdAt?: string;
}

interface TxPage {
  data?: Tx[];
  metadata?: { nextCursor?: string | null; prevCursor?: string | null };
}

const root = document.getElementById('root')!;
let page: TxPage = {};
let filter = '';

const GOOD = /^(VALID|DELIVERED|ACCEPTED|ACKNOWLEDGED|APPROVED|SUCCESS)/;
const BAD = /^(INVALID|FAILED|REJECTED|ERROR|OVERDUE)/;
const WARN = /^(PENDING|IN_PROGRESS|QUEUED|SCHEDULED|WAITING|READY)/;

function chipClass(status: string): string {
  if (GOOD.test(status)) return 'chip good';
  if (BAD.test(status)) return 'chip bad';
  if (WARN.test(status)) return 'chip warn';
  return 'chip';
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

function pretty(status?: string): string {
  return (status ?? '—').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// "856_SHIP_NOTICE_MANIFEST" → code "856", label "Ship Notice Manifest"
function typeParts(name?: string): { code: string; label: string } {
  const raw = name ?? '';
  const match = raw.match(/^(\d+)_(.+)$/);
  return match
    ? { code: match[1], label: pretty(match[2]) }
    : { code: '', label: pretty(raw) || '—' };
}

function shortDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function chip(status: string | undefined, extraClass = ''): string {
  if (!status) return '<span class="chip">—</span>';
  return `<span class="${chipClass(status)}${extraClass}">${esc(pretty(status))}</span>`;
}

function rowText(tx: Tx): string {
  return [
    tx.id,
    tx.type?.name,
    tx.sender?.name,
    tx.sender?.isaId,
    tx.receiver?.name,
    tx.receiver?.isaId,
    tx.stream,
    tx.validationStatus,
    tx.deliveryStatus,
    tx.acknowledgmentStatus,
  ]
    .join(' ')
    .toLowerCase();
}

// The shell (header, input, table skeleton, footer) is built once; only the
// rows re-render on filter changes, so the input keeps focus and caret.
let shellBuilt = false;

function buildShell(): void {
  root.innerHTML = `
    <header>
      <h1>Transactions</h1>
      <span class="count" id="count"></span>
      <input id="filter" type="search" placeholder="Filter…" aria-label="Filter transactions">
    </header>
    <div class="frame" id="frame">
      <div class="table-wrap" id="scroller">
        <table>
          <thead><tr>
            <th>Type</th><th>Sender → Receiver</th><th>Stream</th>
            <th>Validation</th><th>Delivery</th><th>Ack</th><th>Created</th>
          </tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <div class="shade bottom"></div>
      <div class="shade left"></div>
      <div class="shade right"></div>
    </div>
    <footer>
      <span>Click a row to ask Claude about it</span>
      <span id="more"></span>
    </footer>`;

  const input = document.getElementById('filter') as HTMLInputElement;
  input.addEventListener('input', () => {
    filter = input.value.trim().toLowerCase();
    renderRows();
  });

  const scroller = document.getElementById('scroller')!;
  scroller.addEventListener('scroll', updateShades, { passive: true });
  new ResizeObserver(updateShades).observe(scroller);
  shellBuilt = true;
}

function updateShades(): void {
  const scroller = document.getElementById('scroller');
  const frame = document.getElementById('frame');
  if (!scroller || !frame) return;
  const fuzz = 1; // sub-pixel scroll positions
  frame.classList.toggle('can-up', scroller.scrollTop > fuzz);
  frame.classList.toggle('can-down', scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - fuzz);
  frame.classList.toggle('can-left', scroller.scrollLeft > fuzz);
  frame.classList.toggle('can-right', scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - fuzz);
}

function renderRows(): void {
  if (!shellBuilt) buildShell();
  const all = page.data ?? [];
  const rows = filter ? all.filter((tx) => rowText(tx).includes(filter)) : all;

  document.getElementById('rows')!.innerHTML = rows.length
    ? rows
        .map((tx) => {
          const type = typeParts(tx.type?.name);
          return `<tr data-id="${esc(tx.id)}" title="Ask Claude about this transaction">
            <td class="type">${type.code ? `<span class="code">${esc(type.code)}</span>` : ''}${esc(type.label)}</td>
            <td class="party">${esc(tx.sender?.name || tx.sender?.isaId || '—')}<span class="arrow">→</span>${esc(tx.receiver?.name || tx.receiver?.isaId || '—')}</td>
            <td><span class="chip stream">${esc(tx.stream ?? '—')}</span></td>
            <td>${chip(tx.validationStatus)}</td>
            <td>${chip(tx.deliveryStatus)}</td>
            <td>${chip(tx.acknowledgmentStatus)}</td>
            <td class="date">${esc(shortDate(tx.createdAt))}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="7"><div class="empty">${all.length ? 'No transactions match the filter.' : 'No transactions found.'}</div></td></tr>`;

  document.getElementById('count')!.textContent =
    rows.length === all.length ? String(all.length) : `${rows.length} of ${all.length}`;
  document.getElementById('more')!.textContent = page.metadata?.nextCursor
    ? 'More available — ask Claude for the next page'
    : '';
  updateShades();
}

const app = new App({ name: 'Orderful Transactions', version: '1.0.0' }, {});

app.ontoolresult = (params) => {
  const structured = params.structuredContent as TxPage | undefined;
  if (structured?.data) {
    page = structured;
  } else {
    // Fall back to parsing the text content (e.g. hosts that drop structuredContent).
    const text = (params.content ?? []).find((c): c is { type: 'text'; text: string } => c.type === 'text');
    try {
      page = text ? (JSON.parse(text.text) as TxPage) : {};
    } catch {
      page = {};
    }
  }
  renderRows();
};

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
};

root.addEventListener('click', (event) => {
  const tr = (event.target as HTMLElement).closest('tr[data-id]');
  if (!tr) return;
  const id = tr.getAttribute('data-id');
  void app
    .sendMessage({
      role: 'user',
      content: [{ type: 'text', text: `Tell me more about Orderful transaction ${id} — fetch it and summarize its status.` }],
    })
    .catch(() => {});
});

void app
  .connect()
  .then(() => {
    const theme = app.getHostContext()?.theme;
    if (theme) applyDocumentTheme(theme);
  })
  .catch((error: unknown) => {
    root.innerHTML = `<div class="empty">Could not connect to the host: ${esc(error instanceof Error ? error.message : String(error))}</div>`;
  });
