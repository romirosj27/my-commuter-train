# Deploying to Fly.io

This puts the backend on Fly.io in London (`lhr`). It's made of three Fly apps plus a database:

| Fly app | what | notes |
|---|---|---|
| `my-commuter-train-api` | API (Fastify, Better Auth) | public HTTPS; runs migrations on each release |
| `my-commuter-train-worker` | feeds, alerts, scheduled jobs | always on, exactly one machine, no public address |
| `my-commuter-train-redis` | Redis for the job queues | private network only, 1 GB volume, never evicts keys |
| Fly Managed Postgres | the database | created once, by you, in the dashboard or CLI |

The web app stays on Vercel. Vercel forwards `/api/*` to the Fly API (see `vercel.json`), so the
browser sees one site and sign-in cookies work without a custom domain.

The feeds run on **mock data** until the live adapters are implemented. Everything else (accounts,
commutes, boards, alerts by email, Delay Repay) is real.

> I prepared this from Fly's documentation without being able to run it against a Fly account. If
> a command's flags have changed, `fly <command> --help` shows the current ones, and tell me what you saw.

## 1. Before you start

1. **Fly account:** create one, add a payment method, then install `flyctl` and run `fly auth login`.
2. **Resend account** (for email): verify the domain you'll send from, and create an API key.
3. **Your Vercel production URL**, e.g. `https://my-commuter-train.vercel.app`. Use the production
   URL, not a preview one; sign-in only accepts requests from this address.

## 2. Create the database

```bash
fly mpg create            # choose region lhr (London) and the smallest plan
```

In the Fly dashboard, open the cluster's **Connect** tab and copy the **pooled** connection string.
That's your `DATABASE_URL`. The apps are already set up for the pooled connection
(`DATABASE_PREPARE=false`).

The first migration enables the `pg_trgm` extension (used by station search). If that step fails
with a permissions error, send me the message and I'll adapt the migration.

## 3. Run the setup script (once)

From the repository root:

```bash
DATABASE_URL='postgres://…pooled…' \
WEB_URL='https://my-commuter-train.vercel.app' \
API_PUBLIC_URL='https://my-commuter-train.vercel.app' \
EMAIL_FROM='My Commuter Train <alerts@yourdomain.com>' \
RESEND_API_KEY='re_…' \
ADMIN_EMAILS='you@example.com' \
bash infra/fly/setup.sh
```

`API_PUBLIC_URL` is the Vercel URL because the API is reached through Vercel's `/api` forwarding.

The script:
1. Creates the three Fly apps.
2. Gives Redis a generated password and a 1 GB volume, then deploys it.
3. Stores all settings as Fly secrets, including a generated `BETTER_AUTH_SECRET`.
4. Deploys the API, whose release step applies migrations and loads reference data and the
   placeholder Delay Repay rules.
5. Deploys the worker and pins it to one machine.

Re-running it keeps existing apps, the volume and the auth secret. To re-run after the first time,
also pass `REDIS_PASSWORD` (`fly ssh console -a my-commuter-train-redis -C 'printenv REDIS_PASSWORD'`).

If you use a different app prefix (`PREFIX=…`), change the API address in `vercel.json` to match.

## 4. Check it's running

```bash
curl https://my-commuter-train-api.fly.dev/health      # {"status":"ok",…}
fly logs -a my-commuter-train-worker                   # "worker started", feeds connected
fly status -a my-commuter-train-worker                 # exactly 1 machine
```

## 5. Connect the web app

In the Vercel project: **Settings → Environment Variables**, add `VITE_DEMO` = `0` for Production,
then redeploy. The site now uses the real API: sign up, confirm the email from Resend, add a commute.

## 6. Later deploys

- From your machine: `bash infra/fly/deploy.sh`
- From GitHub: create a deploy token (`fly tokens create org` or one per app), save it as the
  repository secret `FLY_API_TOKEN`, then run **Actions → Deploy to Fly.io**.

## Own domain (optional)

To use e.g. `app.example.com` (Vercel) and `api.example.com` (Fly) instead of forwarding:
1. Run `fly certs add api.example.com -a my-commuter-train-api` and add the DNS records it prints.
2. Re-run the setup script with `WEB_URL=https://app.example.com`,
   `API_PUBLIC_URL=https://api.example.com` and `COOKIE_DOMAIN=example.com`.
3. In Vercel, set `VITE_API_URL=https://api.example.com`, and remove the `/api` rewrite from
   `vercel.json`.

## Troubleshooting

- **Release step failed:** run `fly logs -a my-commuter-train-api`. It is usually the database URL or the
  `pg_trgm` extension. Nothing is switched over until the release step succeeds.
- **Worker can't reach Redis:** `REDIS_URL` must end in `.internal:6379/0?family=6` (Fly's private
  network is IPv6), and the Redis app must be running (`fly status -a my-commuter-train-redis`).
- **Sign-in fails:** check `WEB_URL` exactly matches the Vercel address in the browser (scheme, no
  trailing slash).
- **No emails:** check the sending domain is verified in Resend and `EMAIL_FROM` uses it.
- **Backups:** Managed Postgres handles database backups. Redis holds only queues, which rebuild
  themselves; its volume can be snapshotted with `fly volumes snapshots`.
