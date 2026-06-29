// OAuth 2.1 provider. Orderful has no OAuth IdP, so this server is the
// authorization server and the "login" step is each member pasting their own
// Orderful key — which is then bound to the tokens we issue.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response, RequestHandler } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { getOrganizationInfo } from './api.js';
import {
  saveClient,
  getClient,
  createAuthCode,
  peekAuthCodeChallenge,
  consumeAuthCode,
  issueTokens,
  verifyAccessToken as storeVerifyAccessToken,
  consumeRefreshToken,
  revokeToken as storeRevokeToken,
  createProfile,
  addOrgToProfile,
  createConnectToken,
  peekConnectToken,
  consumeConnectToken,
} from './oauth-store.js';

export const ORDERFUL_LOGIN_SUBMIT_PATH = '/oauth/orderful/submit';
export const ORDERFUL_CONNECT_PATH = '/oauth/orderful/connect';
export const ORDERFUL_CONNECT_SUBMIT_PATH = '/oauth/orderful/connect/submit';
export const ORDERFUL_CONNECT_DONE_PATH = '/oauth/orderful/connect/done';

const ADD_ORG_SUBTITLE =
  "Add another Orderful organization to use in Claude. Enter that organization's API key — it stays bound to your account and is never shown to anyone else.";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const TEMPLATE_PATH = fileURLToPath(new URL('./oauth-login.html', import.meta.url));
let loginTemplate: string | undefined;

function loginPage(opts: {
  action: string;
  heading: string;
  subtitle: string; // trusted HTML — callers escape any interpolated values
  hidden: Record<string, string | undefined>;
  invalid?: boolean;
}): string {
  if (loginTemplate === undefined) {
    loginTemplate = readFileSync(TEMPLATE_PATH, 'utf8');
  }

  const hiddenFields = Object.entries(opts.hidden)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `<input type="hidden" name="${escapeAttr(k)}" value="${escapeAttr(String(v))}">`)
    .join('\n      ');

  const replacements: Record<string, string> = {
    '{{ACTION}}': escapeAttr(opts.action),
    '{{HEADING}}': escapeAttr(opts.heading),
    '{{SUBTITLE}}': opts.subtitle,
    '{{HIDDEN_FIELDS}}': hiddenFields,
    '{{FORM_CLASS}}': opts.invalid ? 'invalid' : '',
  };

  return Object.entries(replacements).reduce(
    (html, [token, value]) => html.split(token).join(value),
    loginTemplate,
  );
}

function loginSubtitle(clientName?: string): string {
  const who = clientName ? escapeAttr(clientName) : 'An application';
  return `${who} wants to access Orderful on your behalf. Enter your own Orderful API key to connect — it authorizes only your requests and is never shown to other members.`;
}

// Minimal standalone page for connect link expiry / success states.
function messagePage(title: string, message: string, ok = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeAttr(title)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;
padding:32px;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:#faf9f7;color:#1a1815;-webkit-font-smoothing:antialiased}
@media(prefers-color-scheme:dark){body{background:#0e0d0c;color:#f2efe9}}
main{max-width:360px;text-align:center}
.badge{width:48px;height:48px;border-radius:999px;display:grid;place-items:center;margin:0 auto 18px;
font-size:24px;background:${ok ? 'rgba(34,160,90,.15)' : 'rgba(120,113,108,.15)'};color:${ok ? '#22a05a' : '#78716c'}}
h1{font-size:20px;margin:0 0 8px;letter-spacing:-.02em}p{margin:0;color:#78716c;font-size:14.5px;line-height:1.55}
@media(prefers-color-scheme:dark){p{color:#9c948b}}</style></head>
<body><main><div class="badge">${ok ? '✓' : '⏳'}</div><h1>${escapeAttr(title)}</h1><p>${escapeAttr(message)}</p></main></body></html>`;
}

const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId) {
    return getClient(clientId);
  },
  registerClient(client) {
    return saveClient(client as OAuthClientInformationFull);
  },
};

export const orderfulOAuthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(
      loginPage({
        action: ORDERFUL_LOGIN_SUBMIT_PATH,
        heading: 'Connect Orderful to Claude',
        subtitle: loginSubtitle(client.client_name),
        hidden: {
          client_id: client.client_id,
          redirect_uri: params.redirectUri,
          code_challenge: params.codeChallenge,
          state: params.state,
          resource: params.resource?.href,
          scope: params.scopes?.join(' '),
        },
      }),
    );
  },

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string) {
    const challenge = await peekAuthCodeChallenge(authorizationCode);
    if (!challenge) throw new Error('Invalid or expired authorization code');
    return challenge;
  },

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const rec = await consumeAuthCode(authorizationCode);
    if (!rec) throw new Error('Invalid or expired authorization code');
    if (rec.clientId !== client.client_id) throw new Error('Authorization code was issued to a different client');
    if (redirectUri !== undefined && redirectUri !== rec.redirectUri) {
      throw new Error('redirect_uri mismatch');
    }

    const { accessToken, refreshToken, expiresInSec } = await issueTokens({
      clientId: rec.clientId,
      scopes: rec.scopes,
      resource: rec.resource,
      profileId: rec.profileId,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresInSec,
      refresh_token: refreshToken,
      scope: rec.scopes.join(' ') || undefined,
    };
  },

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const rec = await consumeRefreshToken(refreshToken);
    if (!rec) throw new Error('Invalid or expired refresh token');
    if (rec.clientId !== client.client_id) throw new Error('Refresh token was issued to a different client');

    const grantedScopes = scopes && scopes.length ? scopes : rec.scopes;
    const { accessToken, refreshToken: newRefresh, expiresInSec } = await issueTokens({
      clientId: rec.clientId,
      scopes: grantedScopes,
      resource: rec.resource,
      profileId: rec.profileId,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresInSec,
      refresh_token: newRefresh,
      scope: grantedScopes.join(' ') || undefined,
    };
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const rec = await storeVerifyAccessToken(token);
    if (!rec) throw new Error('Invalid or expired access token');
    return {
      token,
      clientId: rec.clientId,
      scopes: rec.scopes,
      expiresAt: rec.expiresAtSec,
      resource: rec.resource ? new URL(rec.resource) : undefined,
      extra: { profileId: rec.profileId, orderfulKey: rec.orderfulKey },
    };
  },

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    await storeRevokeToken(request.token);
  },
};

export const orderfulLoginSubmitHandler: RequestHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const orderfulKey = typeof body.orderful_key === 'string' ? body.orderful_key.trim() : '';
  const clientId = typeof body.client_id === 'string' ? body.client_id : '';
  const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : '';
  const codeChallenge = typeof body.code_challenge === 'string' ? body.code_challenge : '';
  const state = typeof body.state === 'string' ? body.state : undefined;
  const resource = typeof body.resource === 'string' && body.resource ? body.resource : undefined;
  const scope = typeof body.scope === 'string' ? body.scope : '';
  const scopes = scope.split(' ').filter(Boolean);

  // The page submits via fetch with this header; reply with JSON instead of a
  // redirect/HTML re-render so it can show a loading state and inline errors.
  const wantsJson = (req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest';

  // Re-validate the client and redirect_uri server-side — never trust the
  // hidden fields for the redirect target (open-redirect / code-injection).
  const client = await getClient(clientId);
  if (!client || !codeChallenge) {
    res.status(400).json({ error: 'Unknown client or missing PKCE challenge' });
    return;
  }
  if (!client.redirect_uris.includes(redirectUri)) {
    res.status(400).json({ error: 'Unregistered redirect_uri' });
    return;
  }

  const fail = (message: string) => {
    if (wantsJson) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      loginPage({
        action: ORDERFUL_LOGIN_SUBMIT_PATH,
        heading: 'Connect Orderful to Claude',
        subtitle: loginSubtitle(client.client_name),
        invalid: true,
        hidden: { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, state, resource, scope },
      }),
    );
  };

  if (!orderfulKey) {
    fail('Please enter your Orderful API key.');
    return;
  }

  const org = await getOrganizationInfo(orderfulKey);
  if (!org) {
    fail('That Orderful API key was rejected. Check it and try again.');
    return;
  }

  const profileId = await createProfile(orderfulKey, org.id, org.name);
  const code = await createAuthCode({
    clientId,
    codeChallenge,
    redirectUri,
    resource,
    scopes,
    profileId,
  });

  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state !== undefined) url.searchParams.set('state', state);

  if (wantsJson) {
    res.json({ redirect: url.href });
    return;
  }
  res.redirect(302, url.href);
};

// ── Connect another org to an existing profile (via a one-time link) ──
export const orderfulConnectPageHandler: RequestHandler = async (req: Request, res: Response) => {
  const t = typeof req.query.t === 'string' ? req.query.t : '';
  const profileId = t ? await peekConnectToken(t) : undefined;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!profileId) {
    res.status(400).send(
      messagePage('Link expired', 'This connect link has expired or was already used. Ask Claude to generate a new one.'),
    );
    return;
  }
  res.send(
    loginPage({
      action: ORDERFUL_CONNECT_SUBMIT_PATH,
      heading: 'Connect another organization',
      subtitle: ADD_ORG_SUBTITLE,
      hidden: { t },
    }),
  );
};

export const orderfulConnectSubmitHandler: RequestHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const orderfulKey = typeof body.orderful_key === 'string' ? body.orderful_key.trim() : '';
  const t = typeof body.t === 'string' ? body.t : '';
  const wantsJson = (req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest';

  const profileId = t ? await peekConnectToken(t) : undefined;
  if (!profileId) {
    const msg = 'This connect link has expired. Ask Claude to generate a new one.';
    if (wantsJson) res.status(400).json({ error: msg });
    else res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8').send(messagePage('Link expired', msg));
    return;
  }

  const fail = (message: string) => {
    if (wantsJson) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      loginPage({
        action: ORDERFUL_CONNECT_SUBMIT_PATH,
        heading: 'Connect another organization',
        subtitle: ADD_ORG_SUBTITLE,
        invalid: true,
        hidden: { t },
      }),
    );
  };

  if (!orderfulKey) {
    fail('Please enter your Orderful API key.');
    return;
  }

  const org = await getOrganizationInfo(orderfulKey);
  if (!org) {
    fail('That Orderful API key was rejected. Check it and try again.');
    return;
  }

  const added = await addOrgToProfile(profileId, org.id, org.name, orderfulKey);
  if (!added) {
    fail('Your session is no longer valid — reconnect Orderful from Claude.');
    return;
  }
  await consumeConnectToken(t);

  const doneUrl = `${ORDERFUL_CONNECT_DONE_PATH}?org=${encodeURIComponent(org.name)}`;
  if (wantsJson) {
    res.json({ redirect: doneUrl });
    return;
  }
  res.redirect(302, doneUrl);
};

export const orderfulConnectDoneHandler: RequestHandler = (req: Request, res: Response) => {
  const org = typeof req.query.org === 'string' ? req.query.org : 'Your organization';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(messagePage('Connected', `${org} is now connected and active. You can close this tab and return to Claude.`, true));
};
