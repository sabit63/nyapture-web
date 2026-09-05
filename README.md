# Nyapture Web

## Docker deployment

The default setup serves the production build with Nginx on port `8080` and
proxies `/alive` and `/api/*` (including SignalR WebSockets) to the API running
on the Docker host at port `5270`.

```sh
docker compose up --build -d
```

Open <http://localhost:8080>. To change the published port or API target, copy
`.env.example` to `.env` and edit the values before starting Compose. For an API
on another machine or Compose network, set `NYA_API_TARGET` to the URL reachable
from the web container, for example `http://api:5270`.

`NYA_WEB_PORT` is the port exposed on the Docker host and defaults to `8080`.
`NYA_API_TARGET` is the API URL used by Nginx inside the web container. It is
not sent to the browser; Nginx forwards same-origin `/alive` and `/api/*`
requests to this address.

`VITE_NYA_API_URL` is optional. Leave it empty for same-origin access through
Nginx. Set it only when browsers should connect directly to an external API;
because Vite embeds it during the image build, rebuild after changing it.

Check container state with:

```sh
docker compose ps
curl --fail http://localhost:8080/healthz
```
