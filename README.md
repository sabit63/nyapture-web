# Nyapture Web

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
