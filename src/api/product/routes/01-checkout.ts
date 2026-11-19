/**
 * Custom checkout route.
 *
 * POST /api/products/checkout
 *
 * `auth: false` makes this route public so shoppers can check out without an
 * account. The core CRUD routes are still created by ./product.ts.
 *
 * Each visitor may check out 10 times per minute, so a script cannot drain the
 * stock. The limit is applied by src/middlewares/api-guard.ts.
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/products/checkout',
      handler: 'product.checkout',
      config: {
        auth: false,
      },
    },
  ],
};
