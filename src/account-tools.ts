import { readFileSync } from 'node:fs';
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { credentialStore } from './credential-store.js';
import { ok, err } from './tools/utils.js';
import { getOrganizationInfo } from './api.js';
import {
  listOrgs,
  addOrgToProfile,
  setActiveOrg,
  removeOrgFromProfile,
  createConnectToken,
  peekConnectToken,
  type OrgSummary,
} from './oauth-store.js';
import { ORDERFUL_CONNECT_PATH } from './oauth-provider.js';

// MCP Apps view for connect_organization: an inline form where the member
// pastes the org's API key directly in the conversation. Hosts without apps
// support fall back to the one-time link + wait tool flow.
const CONNECT_VIEW_URI = 'ui://orderful/connect.html';
const connectViewHtml = () => readFileSync(new URL('./ui/connect.html', import.meta.url), 'utf8');

const profileId = () => credentialStore.getStore()?.PROFILE_ID;
const NO_PROFILE = 'Organization management is only available on the hosted server.';

// Kept under common proxy/LB request timeouts; the wait tool is re-callable to extend.
const WAIT_DEADLINE_MS = 90_000;
const WAIT_INTERVAL_MS = 1_500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function matchOrg(orgs: OrgSummary[], query: string): OrgSummary | undefined {
  const q = query.trim().toLowerCase();
  const byId = orgs.find((o) => o.orgId === query);
  if (byId) return byId;
  const byName = orgs.find((o) => o.orgName.toLowerCase() === q);
  if (byName) return byName;
  const partial = orgs.filter((o) => o.orgName.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0] : undefined;
}

// Registered only in hosted (HTTP) mode, where a profile can hold several orgs.
export function registerAccountTools(server: McpServer, baseUrl: URL): void {
  server.registerTool(
    'orderful_list_organizations',
    {
      annotations: { readOnlyHint: true },
      title: 'List Connected Organizations',
      description: 'List the Orderful organizations connected to your account and which one is currently active.',
    },
    async () => {
      const pid = profileId();
      if (!pid) return err(NO_PROFILE);
      const orgs = await listOrgs(pid);
      if (!orgs) return err('Your session is no longer valid — reconnect Orderful from Claude.');
      if (!orgs.length) {
        return ok({ organizations: [], hint: 'No organizations connected. Use connect_organization to add one.' });
      }
      return ok({ organizations: orgs, active: orgs.find((o) => o.active)?.orgName ?? null });
    },
  );

  registerAppResource(
    server,
    'Orderful Connect Organization View',
    CONNECT_VIEW_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [{ uri: CONNECT_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: connectViewHtml() }],
    }),
  );

  registerAppTool(
    server,
    'orderful_connect_organization',
    {
      annotations: { readOnlyHint: false, destructiveHint: false },
      title: 'Connect Another Organization',
      description:
        'Start connecting another Orderful organization. On clients that render the interactive form, the user ' +
        'enters the API key right in the conversation and you are told when they finish — do not show the link. ' +
        'If the user says they see no form, present the returned message verbatim (it is markdown written for ' +
        'them) and then call wait_for_organization_connection with connect_token. Never expose the connect_token.',
      _meta: { ui: { resourceUri: CONNECT_VIEW_URI } },
    },
    async () => {
      const pid = profileId();
      if (!pid) return err(NO_PROFILE);
      const token = await createConnectToken(pid);
      const link = new URL(ORDERFUL_CONNECT_PATH, baseUrl);
      link.searchParams.set('t', token);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              connect_token: token,
              message:
                `**[Connect your organization](${link.href})** — click the link above, then:\n\n` +
                `1. Paste the API key for the organization you want to add.\n` +
                `2. Submit — the organization is verified and set as active.\n` +
                `3. Come back to this chat; I'll pick up the connection automatically.\n\n` +
                `_The link is secure and expires in 15 minutes._`,
              hint:
                'If an interactive form is shown to the user, wait for its result instead of sharing the link. ' +
                'Otherwise show `message` verbatim and call wait_for_organization_connection with connect_token.',
            }, null, 2),
          },
        ],
        // The view reads the fallback link from here; the key never appears in it.
        structuredContent: { connect_url: link.href } as Record<string, unknown>,
      };
    },
  );

  // Called by the connect view only (visibility: app) — the model never sees
  // this tool or the API key that flows through it. Runs on the member's
  // authenticated session, so no connect token is needed.
  server.registerTool(
    'orderful_submit_organization_key',
    {
      annotations: { readOnlyHint: false, destructiveHint: false },
      title: 'Submit Organization Key (in-app)',
      description: 'Internal: used by the connect form to add an organization with its API key.',
      inputSchema: {
        api_key: z.string().min(1).describe('The Orderful API key of the organization to connect'),
      },
      _meta: { ui: { visibility: ['app'] } },
    },
    async ({ api_key }) => {
      const pid = profileId();
      if (!pid) return err(NO_PROFILE);
      const org = await getOrganizationInfo(api_key.trim());
      if (!org) return err('That Orderful API key was rejected. Check it and try again.');
      const added = await addOrgToProfile(pid, org.id, org.name, api_key.trim());
      if (!added) return err('Your session is no longer valid — reconnect Orderful from Claude.');
      return {
        content: [
          { type: 'text' as const, text: `${org.name} is now connected and set as the active organization.` },
        ],
        structuredContent: { connected: true, organization: org.name } as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'orderful_wait_for_organization_connection',
    {
      annotations: { readOnlyHint: true },
      title: 'Wait for Organization Connection',
      description:
        'After giving the user a connect link, call this to wait until they finish connecting the organization ' +
        'in their browser. Blocks for up to ~90 seconds. If it returns pending (not connected yet), call it again ' +
        'with the same connect_token to keep waiting. Returns the newly active organization once connected.',
      inputSchema: {
        connect_token: z.string().describe('The connect_token returned by connect_organization'),
      },
    },
    async ({ connect_token }) => {
      const pid = profileId();
      if (!pid) return err(NO_PROFILE);

      const start = Date.now();
      let sawPending = false;
      while (Date.now() - start < WAIT_DEADLINE_MS) {
        const pendingProfile = await peekConnectToken(connect_token);
        if (pendingProfile) {
          if (pendingProfile !== pid) return err('That connect link belongs to a different account.');
          sawPending = true;
          await sleep(WAIT_INTERVAL_MS);
          continue;
        }

        // Token gone after we saw it pending = the browser submit consumed it. Gone on
        // the first check is ambiguous (expired vs already used), so ask to verify instead.
        if (!sawPending) {
          return err(
            'Could not confirm the connection — the link may have expired or was already used. ' +
              'Call list_organizations to check which organizations are connected.',
          );
        }
        const orgs = (await listOrgs(pid)) ?? [];
        const active = orgs.find((o) => o.active);
        return ok({
          connected: true,
          active: active?.orgName ?? null,
          organizations: orgs,
          message: active ? `Connected. Active organization is now ${active.orgName}.` : 'Organization connected.',
        });
      }

      return ok({
        connected: false,
        pending: true,
        hint:
          'Not connected yet. Call wait_for_organization_connection again with the same connect_token to keep ' +
          'waiting, or check with the user whether they still intend to connect.',
      });
    },
  );

  server.registerTool(
    'orderful_switch_organization',
    {
      annotations: { readOnlyHint: false, destructiveHint: false },
      title: 'Switch Active Organization',
      description: 'Switch which connected Orderful organization is active for subsequent requests.',
      inputSchema: { organization: z.string().describe('Name or ID of the organization to switch to') },
    },
    async ({ organization }) => {
      const pid = profileId();
      if (!pid) return err(NO_PROFILE);
      const orgs = await listOrgs(pid);
      if (!orgs) return err('Your session is no longer valid — reconnect Orderful from Claude.');
      const match = matchOrg(orgs, organization);
      if (!match) {
        const names = orgs.map((o) => o.orgName).join(', ') || 'none';
        return err(`No connected organization matches "${organization}". Connected: ${names}.`);
      }
      await setActiveOrg(pid, match.orgId);
      return ok({ active: match.orgName, message: `Switched to ${match.orgName}.` });
    },
  );

  server.registerTool(
    'orderful_disconnect_organization',
    {
      annotations: { readOnlyHint: false, destructiveHint: true },
      title: 'Disconnect Organization',
      description: 'Remove a connected Orderful organization from your account.',
      inputSchema: { organization: z.string().describe('Name or ID of the organization to disconnect') },
    },
    async ({ organization }) => {
      const pid = profileId();
      if (!pid) return err(NO_PROFILE);
      const orgs = await listOrgs(pid);
      if (!orgs) return err('Your session is no longer valid — reconnect Orderful from Claude.');
      const match = matchOrg(orgs, organization);
      if (!match) {
        const names = orgs.map((o) => o.orgName).join(', ') || 'none';
        return err(`No connected organization matches "${organization}". Connected: ${names}.`);
      }
      const result = await removeOrgFromProfile(pid, match.orgId);
      if (!result.removed) return err('Could not disconnect that organization.');
      const remaining = (await listOrgs(pid)) ?? [];
      return ok({
        disconnected: match.orgName,
        active: remaining.find((o) => o.active)?.orgName ?? null,
        message: `Disconnected ${match.orgName}.`,
      });
    },
  );
}
