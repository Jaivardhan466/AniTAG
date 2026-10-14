import http from "node:http";
import { Readable } from "node:stream";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, sep } from "node:path";
import worker from "./index.js";

const PORT  = Number(process.env.PORT) || 4000;
const BASE  = process.env.BASE_PATH ?? "";
const __dir = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dir, "../dist");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".webp": "image/webp",
};
const CORS_ORIGINS = new Set((process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean));
function isLocalDevOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.port !== '5173') return false;
    const parts = url.hostname.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  } catch { return false; }
}
function corsHeaders(req) { const origin = req.headers.origin; return { ...(origin && (CORS_ORIGINS.has(origin) || isLocalDevOrigin(origin)) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {}), 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Range', 'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range' }; }
const STREAM_PROXY_HOSTS = (process.env.STREAM_PROXY_ALLOWED_HOSTS || "flixcloud.cc")
  .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);

const STATIC = {
  "/":           { file: "docs/landing.html", mime: "text/html" },
  "/docs":       { file: "docs/index.html",   mime: "text/html" },
  "/style.css":  { file: "docs/style.css",    mime: "text/css"  },
  "/logo.svg":   { file: "docs/logo.svg",     mime: "image/svg+xml" },
};

function serveStatic(res, entry) {
  try {
    const body = readFileSync(join(__dir, entry.file));
    res.writeHead(200, {
      "Content-Type":  entry.mime + "; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function serveFrontend(req, res) {
  if (!existsSync(join(DIST, "index.html"))) return false;
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { res.writeHead(400); res.end("Invalid URL"); return true; }
  const candidate = resolve(DIST, `.${pathname}`);
  if (candidate !== DIST && !candidate.startsWith(DIST + sep)) { res.writeHead(403); res.end("Forbidden"); return true; }
  const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(DIST, "index.html");
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
  return true;
}

async function nodeToRequest(req) {
  const host     = req.headers["host"] ?? `localhost:${PORT}`;
  const stripped = BASE && req.url.startsWith(BASE) ? req.url.slice(BASE.length) || "/" : req.url;
  const url      = `http://${host}${stripped}`;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : null;

  return new Request(url, {
    method:  req.method,
    headers: req.headers,
    body:    body?.length ? body : undefined,
    duplex:  "half",
  });
}

function isAllowedStreamUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && STREAM_PROXY_HOSTS.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`));
  } catch { return false; }
}

function proxyAssetUrl(value, baseUrl, referer) {
  const target = new URL(value, baseUrl).toString();
  if (!isAllowedStreamUrl(target)) throw new Error(`Blocked stream asset host: ${new URL(target).hostname}`);
  const params = new URLSearchParams({ url: target, referer });
  return `/proxy?${params.toString()}`;
}

async function serveStreamProxy(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") { res.writeHead(204, headers); return res.end(); }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, headers); return res.end(); }

  const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
  let target;
  let referer;
  try {
    target = new URL(params.get("url") || "");
    referer = new URL(params.get("referer") || target.origin);
  } catch { res.writeHead(400, headers); return res.end("Invalid stream URL"); }
  if (!isAllowedStreamUrl(target.href)) { res.writeHead(403, headers); return res.end("Stream host is not allowed"); }
  if (referer.protocol !== "https:") { res.writeHead(400, headers); return res.end("Invalid stream referrer"); }

  try {
    const requestHeaders = { "User-Agent": "Mozilla/5.0 AniTAG/1.0", "Referer": referer.origin + "/", "Origin": referer.origin };
    if (req.headers.range) requestHeaders.Range = req.headers.range;
    let upstream;
    let current = target;
    for (let attempt = 0; attempt < 5; attempt++) {
      upstream = await fetch(current, { method: req.method, headers: requestHeaders, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location) break;
      current = new URL(location, current);
      if (!isAllowedStreamUrl(current.href)) throw new Error(`Blocked stream redirect host: ${current.hostname}`);
    }
    if (!upstream) throw new Error("No response from stream host");

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const isPlaylist = /\.m3u8(?:$|\?)/i.test(current.href) || contentType.includes("mpegurl");
    const responseHeaders = {
      ...headers,
      "Content-Type": isPlaylist ? "application/vnd.apple.mpegurl" : contentType,
      ...(upstream.headers.get("content-length") ? { "Content-Length": upstream.headers.get("content-length") } : {}),
      ...(upstream.headers.get("content-range") ? { "Content-Range": upstream.headers.get("content-range") } : {}),
      ...(upstream.headers.get("accept-ranges") ? { "Accept-Ranges": upstream.headers.get("accept-ranges") } : {}),
    };
    if (req.method === "HEAD" || !upstream.body) { res.writeHead(upstream.status, responseHeaders); return res.end(); }
    if (isPlaylist && upstream.ok) {
      const playlist = await upstream.text();
      const rewrite = (uri) => proxyAssetUrl(uri, current, referer.origin);
      const rewritten = playlist
        .replace(/(URI=")([^"]+)(")/g, (_match, before, uri, after) => `${before}${rewrite(uri)}${after}`)
        .split(/\r?\n/)
        .map((line) => line && !line.startsWith("#") ? rewrite(line) : line)
        .join("\n");
      delete responseHeaders["Content-Length"];
      res.writeHead(upstream.status, responseHeaders);
      return res.end(rewritten);
    }
    res.writeHead(upstream.status, responseHeaders);
    const body = Readable.fromWeb(upstream.body);
    res.on("close", () => body.destroy());
    body.on("error", (error) => { console.error("Stream proxy error:", error.message); if (!res.headersSent) res.writeHead(502, headers); res.end(); });
    body.pipe(res);
  } catch (error) {
    console.error("Stream proxy error:", error.message);
    if (!res.headersSent) res.writeHead(502, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Could not load this stream. Try another server.");
  }
}

const server = http.createServer(async (req, res) => {
  console.log(`→ ${req.method} ${req.url}`);

  const pathname = req.url.split("?")[0];
  if (req.method === "GET" && pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  const isApiRoute = /^\/(?:api|episodes|map|watch|proxy|healthz)(?:\/|$)/.test(pathname);
  const isStaticAsset = /^\/(?:assets\/|[\w.-]+\.(?:css|ico|js|json|png|svg|txt|webmanifest|webp))/.test(pathname);
  if (process.env.NODE_ENV === "production" && req.method === "GET" && !isApiRoute && pathname !== "/docs" && (req.headers.accept?.includes("text/html") || isStaticAsset)) {
    if (serveFrontend(req, res)) return;
  }
  const staticEntry = STATIC[pathname];

  if (req.method === "GET" && staticEntry) {
    return serveStatic(res, staticEntry);
  }
  if (pathname === "/proxy") return serveStreamProxy(req, res);

  try {
    const request  = await nodeToRequest(req);
    const response = await worker.fetch(request, {});

    res.statusCode = response.status;
    for (const [k, v] of response.headers) { if (!['access-control-allow-origin','access-control-allow-methods','access-control-allow-headers'].includes(k.toLowerCase())) res.setHeader(k, v); }
    for (const [k, v] of Object.entries(corsHeaders(req))) res.setHeader(k, v);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    const buf = await response.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (err) {
    console.error("Unhandled error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Anivexa dev server → http://localhost:${PORT}`);
});
