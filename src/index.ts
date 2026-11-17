// import type { Core } from '@strapi/strapi';

/**
 * API permissions are set in the Strapi admin panel, as in Guide 1:
 * Settings > Users & Permissions Plugin > Roles > Public
 * - Product: find, findOne, create, update, delete
 * - Upload: upload
 *
 * The checkout route (POST /api/products/checkout) is public through
 * `auth: false` in src/api/product/routes/01-checkout.ts, so it needs no
 * permission here.
 */

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   */
  bootstrap(/* { strapi }: { strapi: Core.Strapi } */) {},
};
