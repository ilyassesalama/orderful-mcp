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

export const ORDERFUL_LOGIN_SUBMIT_PATH = '/oauth/orderful/submit';

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
    const rec = await consumeRefreshToken(refreshToken);
    if (!rec) throw new Error('Invalid or expired refresh token');
    if (rec.clientId !== client.client_id) throw new Error('Refresh token was issued to a different client');

    const grantedScopes = scopes && scopes.length ? scopes : rec.scopes;
    const { accessToken, refreshToken: newRefresh, expiresInSec } = await issueTokens({
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
    const rec = await storeVerifyAccessToken(token);
    if (!rec) throw new Error('Invalid or expired access token');
    return {
      token,
      clientId: rec.clientId,
      scopes: rec.scopes,
      expiresAt: rec.expiresAtSec,
      resource: rec.resource ? new URL(rec.resource) : undefined,
      extra: { orderfulKey: rec.orderfulKey },
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

  // Re-validate the client and redirect_uri server-side — never trust the
  // hidden fields for the redirect target (open-redirect / code-injection).
  const client = await getClient(clientId);
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

  const code = await createAuthCode({
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
