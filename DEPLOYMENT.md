# MonCash BI Portal — Docker Deployment Guide

Turnkey deployment on any Linux host with Docker Engine + Docker Compose plugin.
The stack ships three containers on a private bridge network:

```
                 ┌───────────────────────────────────────────┐
                 │           Linux host (:80)                │
                 │                                           │
   Users  ────►  │  nginx (frontend container)               │
                 │    ├── serves the Vite SPA (static)       │
                 │    └── /api/*  →  backend:8000            │
                 │                                           │
                 │  FastAPI (backend container) ── redis     │
                 │        │                                  │
                 └────────┼──────────────────────────────────┘
                          ▼
                    Databricks SQL warehouse
```

Only port `80` (or whatever `WEB_PORT` you pick) is exposed on the host. The
backend and Redis stay internal — they cannot be reached from outside.

---

## 1. Prerequisites on the Linux server

- Docker Engine ≥ 24 with the `compose` plugin
  ```bash
  # Ubuntu / Debian
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER   # log out & back in
  ```
- Outbound network access to your Databricks workspace and Azure AD
- ≥ 2 GB RAM free (4 GB recommended)
- An **Azure AD Service Principal** with permission to hit the Databricks
  SQL warehouse — needed because the backend uses `DefaultAzureCredential`
  to acquire a Databricks token, and interactive login is impossible in a
  container.

  Create the SP once with:
  ```bash
  az ad sp create-for-rbac \
      --name moncash-bi-portal \
      --role Contributor \
      --scopes /subscriptions/<sub-id>
  ```
  Save the returned `tenant`, `appId`, and `password` — you'll put them into
  `.env` below.

---

## 2. Configure `.env`

```bash
git clone <this repo> /opt/moncash-bi
cd /opt/moncash-bi/App_base_system
cp .env.example .env
$EDITOR .env
```

Fill in every value under **Databricks**, **Azure Service Principal**, and
**JWT signing keys**. Generate the JWT secrets locally with:

```bash
openssl rand -hex 64
```

Adjust `WEB_PORT` if `80` is already used on the host.

---

## 3. Build & launch

```bash
docker compose build
docker compose up -d
```

First build takes ~3–5 minutes (installs tesseract for the ID Card scanner,
compiles the Vite bundle). Subsequent rebuilds are cached and take seconds.

Verify:

```bash
docker compose ps               # all three services "healthy" / "running"
docker compose logs -f backend  # follow startup logs
curl http://localhost/          # returns the SPA HTML
curl http://localhost/api/docs  # returns FastAPI Swagger
```

---

## 4. First-time login

The backend runs with `Base.metadata.create_all` **disabled** (analytics is
read-only). If you have never seeded the users table before, run the seed
script inside the container:

```bash
docker compose exec backend python scripts/seed_users.py     # if applicable
```

Then log in at `http://<server-ip>/login` with your admin credentials.

---

## 5. Operational commands

| Task                                | Command                                       |
| ----------------------------------- | --------------------------------------------- |
| Follow all logs                     | `docker compose logs -f`                      |
| Restart a single service            | `docker compose restart backend`              |
| Rebuild after a code change         | `docker compose build backend && docker compose up -d backend` |
| Flush the analytics cache           | `docker compose exec redis redis-cli FLUSHDB` |
| Open a Python shell in the backend  | `docker compose exec backend python`          |
| Tear everything down (keep data)    | `docker compose down`                         |
| Tear everything down (wipe Redis)   | `docker compose down -v`                      |

---

## 6. HTTPS (recommended for production)

The bundled nginx serves plain HTTP on the internal port. In production put a
reverse proxy in front (Caddy, Traefik, or a second nginx) that terminates TLS
and forwards to `http://localhost:${WEB_PORT}`.

Minimal Caddyfile example (drop into `/etc/caddy/Caddyfile`, install Caddy on
the host):

```
bi.moncash.example.com {
    reverse_proxy localhost:80
}
```

Then update `.env`:
```
CORS_ORIGINS=https://bi.moncash.example.com
```
and `docker compose restart backend`.

---

## 7. Upgrading

```bash
cd /opt/moncash-bi/App_base_system
git pull
docker compose build
docker compose up -d
```

Zero-downtime rolling upgrade of the backend (needs Redis for shared cache
across replicas — already the default configuration):

```bash
docker compose up -d --no-deps --scale backend=2 backend
sleep 15
docker compose up -d --no-deps --scale backend=1 backend
```

---

## 8. Troubleshooting

| Symptom                                                        | Fix                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `backend` restarts in a loop, logs show `AZURE_TENANT_ID` err  | The Service Principal env vars are missing / typoed in `.env`.                                           |
| Frontend loads but every API call returns 502                  | Backend isn't healthy yet — `docker compose logs backend` will show the underlying error.                |
| `CORS policy blocked` in the browser console                   | You're hitting the API from a different origin than `CORS_ORIGINS`. Add the origin, restart backend.     |
| Slow first response after redeploy                             | Expected — Databricks warehouses auto-suspend. First query wakes it (~15–30 s). Subsequent hits are fast.|
| Everything looks fine but a chart shows stale numbers          | Redis cache — hit the in-app **Clear Cache** button in the top nav, or `docker compose exec redis redis-cli FLUSHDB`. |

---

## 9. File layout added for Docker

```
App_base_system/
├── DEPLOYMENT.md              ← this guide
├── .env.example               ← env template (copy to .env)
├── docker-compose.yml         ← 3-service stack (backend + frontend + redis)
├── backend/
│   ├── Dockerfile             ← Python 3.11 + tesseract + uvicorn
│   └── .dockerignore
└── frontend/
    ├── Dockerfile             ← Node 20 builder → nginx 1.27 runtime
    ├── .dockerignore
    └── nginx.conf             ← serves SPA + reverse-proxies /api/* to backend
```
