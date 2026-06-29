import { credentialStore } from './credential-store.js';

const BASE_URL = 'https://api.orderful.com';

let cliApiKey: string | undefined;

export function setApiKey(key: string): void {
  cliApiKey = key;
}

// Resolve the organization a key belongs to, used at connect time to both
// validate the key and label it. Returns null if the key is rejected.
export async function getOrganizationInfo(key: string): Promise<{ id: string; name: string } | null> {
  try {
    const response = await fetch(`${BASE_URL}/v3/organizations/me`, {
      method: 'GET',
      headers: { accept: 'application/json', 'orderful-api-key': key },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    const id = String(data.id ?? data.organizationId ?? '');
    if (!id) return null;
    const name = String(data.name ?? data.businessName ?? data.organizationName ?? 'Organization');
    return { id, name };
  } catch {
    return null;
  }
}

function getApiKey(): string {
  // HTTP mode: per-request credentials via AsyncLocalStorage
  const store = credentialStore.getStore();
  if (store?.ORDERFUL_API_KEY) return store.ORDERFUL_API_KEY;
  // HTTP mode but no active org selected.
  if (store?.PROFILE_ID) {
    throw new Error('No active Orderful organization. Use connect_organization to add one, or switch_organization to pick one.');
  }
  // Stdio mode: CLI argument
  if (cliApiKey) return cliApiKey;
  throw new Error('Orderful API key is required. Pass it as the first argument: `npx orderful <api-key>`');
}

export async function orderfulApiCall(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
  contentType: string = 'application/json',
  accept: string = 'application/json',
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const headers: Record<string, string> = {
    'accept': accept,
    'orderful-api-key': getApiKey(),
    'content-type': contentType,
    ...extraHeaders,
  };

  const options: RequestInit = { method, headers };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = contentType === 'application/json' ? JSON.stringify(body) : String(body);
  }

  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `Orderful API error: ${response.status} ${response.statusText} - ${url}${errorBody ? ` - ${errorBody}` : ''}`,
    );
  }

  const text = await response.text();
  if (response.status === 204 || !text.trim()) {
    return { success: true };
  }
  return JSON.parse(text) as unknown;
}
