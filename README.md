# Nyapture Web

## Development and validation

Use the declared package manager, pnpm 11.25.0. For local verification, use
Node 24.15 or newer within the 24.x line (validated with Node 24.19.0).

```sh
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm build
pnpm verify
```

`pnpm build` includes application TypeScript checks. `pnpm typecheck:test`
checks tests and fixtures; `pnpm check` runs lint and both type checks without
bundling. `pnpm verify` runs all checks, tests, and the production build.
`pnpm test` uses Node's test runner with the tsx loader (no tsx CLI IPC pipe).
Hook tests mount React in jsdom with mocked requests and connections.
Tests must not use the real API, SignalR service, credentials, or production data.

The local-only UI fixture can be started with
`node --import tsx tests/fixtures/review-api.ts`; run Vite with
`VITE_NYA_API_TARGET=http://127.0.0.1:5271 pnpm dev --port 5174` to use it.
It supplies synthetic data, simulates reset/reload failure, and never forwards
requests to the real backend. It does not implement SignalR or a complete API.

Review decisions and implementation evidence are in [docs/review](docs/review/README.md).

## Styling

Tailwind CSS 4 is configured through `@tailwindcss/vite` and
`src/styles/tailwind.css`. Use the `tw:` prefix for utility classes in JSX.
Feature stylesheets use `@reference` to that entry and `@apply` for layout,
spacing, sizing, and typography while keeping existing component selectors.
Keep gradients, animations, complex selectors, and background/border shorthands
in CSS when that is clearer or preserves their reset behavior.

`src/styles/tokens.css` remains the source for both color themes and semantic
dimensions. Reference its variables with utilities such as
`tw:text-(--color-text)` and `tw:gap-(--layout-control-gap)`; do not copy theme
colors into components. The spacing unit is 4px; `sm`, `md`, and `lg` are
640px, 880px, and 1200px. Preflight is omitted because `base.css` owns the
existing reset, focus styles, and reduced-motion support.

Run `pnpm verify` after styling changes, then inspect desktop/mobile layouts
and both color themes with the local UI fixture above.

## Docker deployment

The default setup serves the production build with Nginx on
`127.0.0.1:8080` and proxies `/alive` and `/api/*` (including SignalR
WebSockets) to the API running on the Docker host at port `5270`.

```sh
docker compose up --build -d
```

Open <http://localhost:8080>. To change the bind address, published port, or API
target, copy `.env.example` to `.env` and edit the values before starting
Compose. `NYA_API_TARGET` can be omitted; it defaults to
`http://host.docker.internal:5270`. For an API on another machine or Compose
network, set it to the URL reachable from the web container, for example
`http://api:5270`.

`NYA_WEB_BIND` is the host address to which Docker binds the web port and
defaults to `127.0.0.1`. Keep this value for local-only access, or set it to
`0.0.0.0` to accept connections through every host interface. `NYA_WEB_PORT`
is the port exposed on the Docker host and defaults to `8080`.
`NYA_API_TARGET` is the optional API URL used by Nginx inside the web container.
It is not sent to the browser; Nginx forwards same-origin `/alive` and `/api/*`
requests to this address.

To expose the same container through a path-based reverse proxy, forward the
request prefix in `X-Forwarded-Prefix`. The serving Nginx accepts only a
`/nyapture/viewer` prefix (with an optional trailing slash) and rewrites the
document base for that request; direct requests and unrecognized header values
continue to use `/`. Publish the web container on the LAN-facing Viewer port
with `NYA_WEB_BIND=0.0.0.0` and `NYA_WEB_PORT=5370`, then have the gateway strip
the public prefix and send `X-Forwarded-Prefix: /nyapture/viewer`.

The reverse proxy must also forward WebSocket upgrade headers when the saved
API URL points through that proxy. API URLs and credentials are not derived
from the UI path prefix; the configured API settings are used unchanged.

`VITE_NYA_API_URL` is optional. Leave it empty for same-origin access through
Nginx. Set it only when browsers should connect directly to an external API;
because Vite embeds it during the image build, rebuild after changing it.

`NYA_API_KEY` and `NYA_EDIT_KEY` optionally provide the initial API and edit
keys. They are embedded during the image build, and a value saved in the
browser's API settings takes precedence. These keys are delivered to every
browser that loads the app and must not be treated as secrets. Rebuild the
image after changing them.

Check container state with:

```sh
docker compose ps
curl --fail http://localhost:8080/healthz
```
