import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { credentialStore } from './credential-store.js';
import { ok, err } from './tools/utils.js';
import {
  listOrgs,
  setActiveOrg,
  removeOrgFromProfile,
  createConnectToken,
  peekConnectToken,
  type OrgSummary,
} from './oauth-store.js';
import { ORDERFUL_CONNECT_PATH } from './oauth-provider.js';

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

  server.registerTool(
    'orderful_connect_organization',
    {
      title: 'Connect Another Organization',
      description:
        "Get a secure link to connect another Orderful organization. Open the link, paste that organization's API key, and it becomes the active organization. Returns a link to give the user.",
    },
    async () => {
      const pid = profileId();
      if (!pid) return err(NO_PROFILE);
      const token = await createConnectToken(pid);
      const link = new URL(ORDERFUL_CONNECT_PATH, baseUrl);
      link.searchParams.set('t', token);
      return ok({
        url: link.href,
        connect_token: token,
        hint:
          `Give the user this link to connect another organization (expires in 15 minutes): ${link.href}. ` +
          `Then call wait_for_organization_connection with connect_token to be notified when they finish.`,
      });
    },
  );

  server.registerTool(
    'orderful_wait_for_organization_connection',
    {
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
