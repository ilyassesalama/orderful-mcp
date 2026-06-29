/**
 * OAuth 2.1 authorization-server provider for hosted (remote) mode.
 *
 * Orderful itself has no OAuth IdP — it authenticates with a static API key.
 * So this server *is* the authorization server, and the "login" step is where
 * each team member pastes their own Orderful key. That key is bound to the
 * tokens we issue, so the org owner adds a single keyless connector URL and
 * every member supplies their own credential privately during Connect.
 *
 * Flow:
 *   1. Claude hits GET /authorize  -> provider.authorize() renders a page
 *      asking for the member's Orderful API key (all OAuth params carried as
 *      hidden fields).
 *   2. The page POSTs to /oauth/orderful/submit (orderfulLoginSubmitHandler):
 *      we validate the key against Orderful, mint a single-use auth code bound
 *      to it, and redirect back to Claude with ?code=…&state=….
 *   3. Claude exchanges the code at POST /token (exchangeAuthorizationCode),
 *      PKCE is verified by the SDK via challengeForAuthorizationCode().
 *   4. Each MCP request carries the access token; verifyAccessToken() resolves
 *      it back to the member's Orderful key (surfaced via AuthInfo.extra).
 */
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
import { validateOrderfulKey } from './api.js';
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
} from './oauth-store.js';

/** Path the key-capture form POSTs to. Mounted in index.ts. */
export const ORDERFUL_LOGIN_SUBMIT_PATH = '/oauth/orderful/submit';

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// The HTML lives in a sibling oauth-login.html (copied to dist/ by the build).
// Read once and cache; render() fills the {{…}} placeholders per request.
const TEMPLATE_PATH = fileURLToPath(new URL('./oauth-login.html', import.meta.url));
let loginTemplate: string | undefined;

function loginPage(opts: {
  hidden: Record<string, string | undefined>;
  clientName?: string;
  error?: string;
}): string {
  if (loginTemplate === undefined) {
    loginTemplate = readFileSync(TEMPLATE_PATH, 'utf8');
  }

  const hiddenFields = Object.entries(opts.hidden)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `<input type="hidden" name="${escapeAttr(k)}" value="${escapeAttr(String(v))}">`)
    .join('\n      ');

  const who = opts.clientName ? escapeAttr(opts.clientName) : 'An application';
  const errorBlock = opts.error ? `<p class="error">${escapeAttr(opts.error)}</p>` : '';

  const replacements: Record<string, string> = {
    '{{CLIENT_NAME}}': who,
    '{{ACTION}}': escapeAttr(ORDERFUL_LOGIN_SUBMIT_PATH),
    '{{HIDDEN_FIELDS}}': hiddenFields,
    '{{ERROR}}': errorBlock,
  };

  return Object.entries(replacements).reduce(
    (html, [token, value]) => html.split(token).join(value),
    loginTemplate,
  );
}

const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId) {
    return getClient(clientId);
  },
  registerClient(client) {
    // The SDK has already generated client_id / client_secret.
    return saveClient(client as OAuthClientInformationFull);
  },
};

export const orderfulOAuthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    // Render the key-capture page. All parameters needed to resume the OAuth
    // flow are carried as hidden form fields and re-validated on submit.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(
      loginPage({
        clientName: client.client_name,
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
    const challenge = peekAuthCodeChallenge(authorizationCode);
    if (!challenge) throw new Error('Invalid or expired authorization code');
    return challenge;
  },

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const rec = consumeAuthCode(authorizationCode);
    if (!rec) throw new Error('Invalid or expired authorization code');
    if (rec.clientId !== client.client_id) throw new Error('Authorization code was issued to a different client');
    if (redirectUri !== undefined && redirectUri !== rec.redirectUri) {
      throw new Error('redirect_uri mismatch');
    }

    const { accessToken, refreshToken, expiresInSec } = issueTokens({
      clientId: rec.clientId,
      scopes: rec.scopes,
      resource: rec.resource,
      orderfulKey: rec.orderfulKey,
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
    const rec = consumeRefreshToken(refreshToken);
    if (!rec) throw new Error('Invalid or expired refresh token');
    if (rec.clientId !== client.client_id) throw new Error('Refresh token was issued to a different client');

    const grantedScopes = scopes && scopes.length ? scopes : rec.scopes;
    const { accessToken, refreshToken: newRefresh, expiresInSec } = issueTokens({
      clientId: rec.clientId,
      scopes: grantedScopes,
      resource: rec.resource,
      orderfulKey: rec.orderfulKey,
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
    const rec = storeVerifyAccessToken(token);
    if (!rec) throw new Error('Invalid or expired access token');
    return {
      token,
      clientId: rec.clientId,
      scopes: rec.scopes,
      expiresAt: rec.expiresAtSec,
      resource: rec.resource ? new URL(rec.resource) : undefined,
      // Surfaced to the MCP request handler as req.auth.extra.orderfulKey
      extra: { orderfulKey: rec.orderfulKey },
    };
  },

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    storeRevokeToken(request.token);
  },
};

/**
 * Handles the POST from the key-capture page. Validates the Orderful key,
 * then issues a single-use authorization code and redirects back to the client.
 */
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

  // Re-validate the client and redirect_uri server-side — never trust the
  // hidden fields for the redirect target (open-redirect / code-injection).
  const client = getClient(clientId);
  if (!client || !codeChallenge) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Unknown client or missing PKCE challenge' });
    return;
  }
  if (!client.redirect_uris.includes(redirectUri)) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Unregistered redirect_uri' });
    return;
  }

  const renderError = (message: string) => {
    res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      loginPage({
        clientName: client.client_name,
        error: message,
        hidden: { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, state, resource, scope },
      }),
    );
  };

  if (!orderfulKey) {
    renderError('Please enter your Orderful API key.');
    return;
  }

  const valid = await validateOrderfulKey(orderfulKey);
  if (!valid) {
    renderError('That Orderful API key was rejected. Check it and try again.');
    return;
  }

  const code = createAuthCode({
    clientId,
    codeChallenge,
    redirectUri,
    resource,
    scopes,
    orderfulKey,
  });

  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state !== undefined) url.searchParams.set('state', state);
  res.redirect(302, url.href);
};
