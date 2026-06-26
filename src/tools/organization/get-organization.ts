import { orderfulApiCall } from '../../api.js';
import { ok, err, type ToolRegistrar } from '../utils.js';

export const register: ToolRegistrar = (server) => {
  server.registerTool(
    'orderful_get_organization',
    {
      annotations: { readOnlyHint: true },
      title: 'Get Organization',
      description:
        "Get the current Orderful organization's profile info including ID and name.",
    },
    async () => {
      try {
        return ok(await orderfulApiCall('/v3/organizations/me'));
      } catch (e) {
        return err(e);
      }
    },
  );
};
