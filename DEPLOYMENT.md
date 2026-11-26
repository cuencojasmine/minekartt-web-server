# Deploying ShopKart

| Part | Service | Repository |
| --- | --- | --- |
| Storefront (Nuxt 4) | Vercel | `cuencojasmine/minekartt-web-frontend` |
| API + admin panel (Strapi 5) | Render, free Docker web service | `cuencojasmine/minekartt-web-server` |
| Database (PostgreSQL 18) | Neon | — |
| Product images | Cloudflare R2 bucket | — |
| Keep-awake ping | UptimeRobot | — |

Live addresses: storefront `https://minekartt.vercel.app`, API and admin panel `https://shopkart-server-10ey.onrender.com` (the `<service>` in the steps below is `shopkart-server-10ey`).

Never commit `.env`, `.env.render` or `.env.vercel`. They are git-ignored.

## Permissions

As in Guide 1, `/products` has no sign-in and the **Public role** does everything. The server sets these on every start (`src/index.ts`), and you can see them in the admin panel under **Settings > Users & Permissions Plugin > Roles > Public**:

- **Product**: `find`, `findOne`

The site is **read-only** since grading: `create`, `update`, `delete` and **Upload** `upload` were removed so nobody can add products or push images to R2. Manage products in the admin panel (`/admin`) instead. To reopen Product Management, add those four actions back to `PUBLIC_ACTIONS` in `src/index.ts` and set `READ_ONLY = false` in the storefront's `app/pages/products.vue`.

Everything else is removed from the Public role, so `/api/auth/*` (sign-in and sign-up) is closed and self-registration is off.

## Security without a sign-in

> Anyone who has the site address can change or delete products. Keep the address private and take the site down when it is no longer needed.

`src/middlewares/api-guard.ts` limits what one visitor can do:

| Requests | Limit per visitor IP |
| --- | --- |
| Product create / update / delete and image uploads | 30 per minute and 200 per hour |
| Checkout (`POST /api/products/checkout`, public route) | 10 per minute |
| Everything else under `/api` (reads) | 300 per minute |

- Over the limit, the API answers `429 Too Many Requests` with a `Retry-After` header and the storefront shows the message.
- Changes and checkouts are only accepted when the browser's `Origin` is in `FRONTEND_URL`. Requests from other sites, or from scripts without that header, get `403`.
- On Render the visitor IP comes from Cloudflare's `CF-Connecting-IP` header, which visitors cannot fake.
- Product data is validated on the server (`src/api/product/controllers/product.ts`): name up to 100 characters, description up to 2000, price 0 to 10,000,000 with at most 2 decimals, whole-number stock 0 to 1,000,000, and one of the 7 shop categories.
- Uploads accept one image of at most 5 MB, and SVG is refused. JSON bodies are capped at 100 KB.
- The API accepts browser requests only from the addresses in `FRONTEND_URL`.
- The Strapi admin panel (`/admin`) keeps its own sign-in.

## 1. Neon (database)

1. Create a project named `shopkart`. Choose **Postgres 18**, which matches your local PostgreSQL, and region **AWS Asia Pacific (Singapore)**.
2. Under **Connect**, turn **Connection pooling off** and copy the connection string. It looks like `postgresql://neondb_owner:...@ep-....ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.

## 2. Cloudflare R2 (images)

1. In **R2 Object Storage**, create a bucket named `shopkart-images`.
2. Leave **Public Development URL** (r2.dev) **disabled**. Some internet providers block r2.dev, so the backend serves the images itself at `/images/<file>` (`src/middlewares/r2-images.ts`) and the bucket stays private.
3. In **R2 > Manage API tokens**, create an API token with **Object Read & Write**, limited to `shopkart-images`. Copy the **Access Key ID**, the **Secret Access Key** and your **Account ID**.

## 3. Production environment file

Create `shopkart-server/.env.render` with the content below. Generate the five secrets once with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. `APP_KEYS` needs two values separated by a comma.

```env
NODE_ENV=production
IS_PROXIED=true
PUBLIC_URL=https://shopkart-server-10ey.onrender.com
FRONTEND_URL=https://minekartt.vercel.app

APP_KEYS=<secret>,<secret>
API_TOKEN_SALT=<secret>
ADMIN_JWT_SECRET=<secret>
TRANSFER_TOKEN_SALT=<secret>
JWT_SECRET=<secret>
ENCRYPTION_KEY=<secret>

DATABASE_CLIENT=postgres
DATABASE_URL=<Neon connection string>
DATABASE_SSL=true
DATABASE_POOL_MIN=0
DATABASE_POOL_MAX=5

R2_ACCOUNT_ID=<account id>
R2_ACCESS_KEY_ID=<access key id>
R2_SECRET_ACCESS_KEY=<secret access key>
R2_BUCKET=shopkart-images
R2_PUBLIC_URL=https://shopkart-server-10ey.onrender.com/images
```

Fix `PUBLIC_URL`, `R2_PUBLIC_URL` and `FRONTEND_URL` after steps 5 and 6 if Render or Vercel gives a different address.

## 4. Copy the local data to Neon and the images to R2

Run these in Git Bash from `shopkart-server/`:

```bash
export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"
pg_dump -h 127.0.0.1 -U postgres -Fc -d shopkart-db -f shopkart.dump
pg_restore --no-owner --no-acl -d "$(grep '^DATABASE_URL=' .env.render | cut -d= -f2-)" shopkart.dump
node --env-file=.env.render scripts/migrate-uploads-to-r2.mjs           # dry run
node --env-file=.env.render scripts/migrate-uploads-to-r2.mjs --apply   # upload and repoint
rm shopkart.dump
```

The restore brings your Strapi admin account with it, so nobody else can claim the admin panel on the live site.

## 5. Render (backend)

> **Use a separate Render workspace.** Free hours (750 per month) are shared by every service in a workspace. If iMapSU and ShopKart are both kept awake around the clock in one workspace, the hours run out mid-month and Render suspends **both**. Create a new workspace (for example "ShopKart") from the workspace menu at the top left.

1. **New > Web Service**, then connect `minekartt-web-server`.
2. Set **Language** to *Docker*, **Branch** to `main`, **Region** to *Singapore* and **Instance type** to *Free*.
3. Under **Advanced**, set **Health Check Path** to `/_health`.
4. Under **Environment**, choose **Add from .env** and paste the whole `.env.render`.
5. Deploy. The first build takes about 5 to 10 minutes. When it finishes, `https://<service>.onrender.com/_health` returns an empty 204 response.

## 6. Vercel (frontend)

1. **Add New > Project**, then import `minekartt-web-frontend`. Vercel detects Nuxt.
2. Under **Environment Variables**, add `NUXT_PUBLIC_STRAPI_URL` = `https://<service>.onrender.com` (no trailing slash).
3. Deploy. If the address is not `https://minekartt.vercel.app`, set the real one as `FRONTEND_URL` on Render. Render redeploys automatically.

## 7. Check the Public permissions

1. Open `https://<service>.onrender.com/admin` and sign in with your existing Strapi admin account.
2. Check that the Public role has the permissions listed under [Permissions](#permissions). The server sets them on start.
3. On the live site, open **Manage Products** and add a test product to check that it works.

## 8. UptimeRobot (keep the backend awake)

Render's free service sleeps after 15 minutes without traffic, and waking up takes about a minute.

1. **New monitor > HTTP(s)**.
2. Set the URL to `https://<service>.onrender.com/_health` and the interval to **5 minutes**.

The health check does not touch the database, so Neon can still sleep and save its free compute hours.

## Updating the live site

- Push to `main` in either repository. Render and Vercel deploy on their own.
- Schema changes (new fields) are applied to Neon automatically when Strapi starts.
