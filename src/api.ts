import { credentialStore } from './credential-store.js';

const BASE_URL = 'https://api.orderful.com';

let cliApiKey: string | undefined;

export function setApiKey(key: string): void {
  cliApiKey = key;
}

/**
 * Validate an Orderful API key by making one cheap authenticated call.
 * Used during the OAuth login step to reject bad keys before issuing tokens.
 * Returns true if the key is accepted by Orderful, false otherwise.
 */
export async function validateOrderfulKey(key: string): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/v3/organizations/me`, {
      method: 'GET',
      headers: { accept: 'application/json', 'orderful-api-key': key },
    });
    return response.ok;
  } catch {
    return false;
  }
}

function getApiKey(): string {
  // HTTP mode: per-request credentials via AsyncLocalStorage
  const store = credentialStore.getStore();
  if (store?.ORDERFUL_API_KEY) return store.ORDERFUL_API_KEY;
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
