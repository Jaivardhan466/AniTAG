# AniTAG

A responsive anime discovery and personal watchlist app with an in-site episode page, custom glass player, resume progress, and installable PWA shell.

## Run locally

```sh
npm install
npm run dev
```

The dev command starts the Vite frontend (normally http://localhost:5173) and Node API (http://localhost:4000). Copy `.env.example` to `.env` to set optional frontend values.

## What runs where

- **Frontend:** React/Vite static build in `dist/`; run `npm run build`. Host the contents of `dist` on any static host with SPA fallback to `index.html`. Configure `VITE_STREAM_API_BASE` at build time if the API is on another host.
- **Backend:** separate Node server in `api/`; start it with `npm run dev:api` locally or `node api/server.js` on a Node host. Put it behind HTTPS in production. It serves the API and the stream proxy.
- **Metadata:** AniList GraphQL is called directly from the browser. Metadata responses are cached in memory for five minutes and identical concurrent requests are coalesced. Secondary homepage rails load as they approach the viewport.

For a separate production API origin, set the backend environment variable `CORS_ORIGINS` to the exact comma-separated frontend origins, for example `https://anitag.example,https://www.anitag.example`. Set frontend `VITE_STREAM_API_BASE=https://api.example` before building. Do not include a trailing path unless the API is hosted below a path prefix.

Set `STREAM_PROXY_ALLOWED_HOSTS` to the exact stream hostnames (comma-separated) that you own or are authorized to proxy. The server only proxies HTTPS and validates redirects. Keep the defaults restricted; do not deploy a public open proxy. Set the optional cache variables in `api/.env.example` only when you configure the required Upstash REST endpoint and token.

Set `VITE_CONTACT_EMAIL` at build time to show a real contact mail link. Until configured, the Contact page explains how the maintainer can add it.

## Data and PWA

Watchlist, library statuses, favourites, history, and progress are stored in this browser. Settings are also local. Use Settings → Library & history → Export backup to download a JSON backup, and Import backup on another browser to restore it. This is portable manual backup, not automatic cloud sync. Account-based sync needs an authenticated storage service and is not configured in this project.

The web app manifest and service worker provide the installable shell and offline fallback. Service worker registration is enabled for production builds. Stream playback still requires a working network and an authorized API/source.

## API contract expected by the frontend

- `GET /episodes/:anilistId` returns provider objects with `episodes.sub` and/or `episodes.dub` arrays. Episode entries include `id`, `number`, and optional `title`.
- Episode IDs are relative API paths, such as `watch/provider/ANILIST_ID/sub/provider-1`.
- `GET /<episode-id>` returns `{ "streams": [{ "url": "https://...", "type": "hls", "server": "...", "subtitles": [] }] }`; a `sources` array is also accepted.

Use content providers you are authorized to access. AniList supplies metadata, not video. Source availability, playback quality, subtitle tracks, and cross-origin behavior depend on the configured provider.

## Deploy the complete app on Render

The included `render.yaml` deploys the React build and Node API together as one HTTPS web service. In production the app calls the API on the same origin, so no separate frontend API URL or CORS setting is needed.

1. Push this project to a GitHub repository you control. Render needs access to that repository to build and deploy it.
2. In Render, choose **New → Blueprint**, connect the repository, review the `anitag` web service, and create it on the Free plan.
3. Wait for the deploy to finish, then open the generated `https://…onrender.com` address on your phone. Keep the Render service awake while testing video; free services can sleep after 15 minutes idle and the next visit may take time to start.
4. For direct HLS proxying, set `STREAM_PROXY_ALLOWED_HOSTS` to exact HTTPS hosts you operate or are authorized to proxy. Do not configure an unrestricted public proxy.

Render requires a Git repository connection for this deployment flow. The free web service provides an HTTPS `onrender.com` URL; free instances have usage and sleep limitations. See [Render's free instance limits](https://render.com/docs/free) before relying on it for regular use.
