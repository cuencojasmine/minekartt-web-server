import type { Core } from '@strapi/strapi';

/**
 * API permissions, applied every time the server starts so the local database
 * and the live one (Neon) always match. They can be seen in the admin panel
 * under Settings > Users & Permissions Plugin > Roles > Public.
 *
 * As in Guide 1, Product Management has no sign-in: the Public role can read,
 * create, update and delete products and upload product images. Nothing else
 * is allowed, so the sign-in and sign-up endpoints (/api/auth/*) are closed.
 *
 * The checkout route (POST /api/products/checkout) is public through
 * `auth: false` in src/api/product/routes/01-checkout.ts.
 *
 * Abuse protection (rate limits, storefront-only changes) lives in
 * src/middlewares/api-guard.ts, and product data is validated in
 * src/api/product/controllers/product.ts.
 */

const PUBLIC_ACTIONS = [
  'api::product.product.find',
  'api::product.product.findOne',
  'api::product.product.create',
  'api::product.product.update',
  'api::product.product.delete',
  'plugin::upload.content-api.upload',
];

async function setupPublicPermissions(strapi: Core.Strapi) {
  const roles = strapi.db.query('plugin::users-permissions.role');
  const permissions = strapi.db.query('plugin::users-permissions.permission');

  const publicRole = await roles.findOne({ where: { type: 'public' } });
  if (!publicRole) return;

  const current: { id: number; action: string }[] = await permissions.findMany({
    where: { role: publicRole.id },
    select: ['id', 'action'],
  });

  // Remove anything extra (e.g. the old sign-in permissions)...
  for (const permission of current.filter((p) => !PUBLIC_ACTIONS.includes(p.action))) {
    await permissions.delete({ where: { id: permission.id } });
  }

  // ...and add whatever is missing.
  const existing = new Set(current.map((p) => p.action));
  for (const action of PUBLIC_ACTIONS.filter((a) => !existing.has(a))) {
    await permissions.create({ data: { action, role: publicRole.id } });
  }

  // Nobody can create an account from the storefront.
  const store = strapi.store({ type: 'plugin', name: 'users-permissions' });
  const advanced = ((await store.get({ key: 'advanced' })) as Record<string, unknown>) || {};
  if (advanced.allow_register !== false) {
    await store.set({ key: 'advanced', value: { ...advanced, allow_register: false } });
  }
}

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await setupPublicPermissions(strapi);
  },
};
