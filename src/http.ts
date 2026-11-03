#!/usr/bin/env bun
/**
 * Stateless Streamable HTTP MCP server.
 *
 * The server holds no Unsplash key. Each request carries the caller's own key,
 * which is used for that request only and then forgotten:
 *
 *   X-Unsplash-Access-Key: <key>
 *   X-API-Key: <key>                     (claude.ai only accepts approved header names)
 *   Authorization: Bearer <key>          (or "Client-ID <key>")
 *
 * Keys are never accepted in the URL, because URLs leak through logs and screenshots.
 * Old clients may still call /mcp/<key>: they get a 404, and the logger must not print the key.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./server.ts";
import { utmSource } from "./config.ts";
import { faviconIco, iconSvg } from "./icon.ts";
import { serveHome } from "./home.ts";
import pkg from "../package.json" with { type: "json" };

const KEY_RE = /^[A-Za-z0-9_-]{10,128}$/;

export function extractKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = auth.match(/^(?:Bearer|Client-ID)\s+(\S+)$/i);
    if (m && KEY_RE.test(m[1]!)) return m[1]!;
  }
  for (const name of ["x-unsplash-access-key", "x-api-key"]) {
    const header = req.headers.get(name)?.trim();
    if (header && KEY_RE.test(header)) return header;
  }
  return null;
}

const jsonRpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status, headers });

const LOGGABLE_PATHS = new Set(["/", "/health", "/favicon.ico", "/favicon.svg", "/mcp", "/mcp/"]);

/**
 * Only known routes are logged as sent, because any other path may hold a key.
 * "/mcp/[redacted]" stays distinct so the logs show which old clients still call /mcp/<key>.
 */
export const redactPath = (p: string) => {
  if (LOGGABLE_PATHS.has(p)) return p;
  return p.startsWith("/mcp/") ? "/mcp/[redacted]" : "[unmatched]";
};

const ICONS: Record<string, { body: Uint8Array<ArrayBuffer>; type: string }> = {
  "/favicon.ico": { body: faviconIco, type: "image/x-icon" },
  "/favicon.svg": { body: iconSvg, type: "image/svg+xml" },
};

function serveIcon(req: Request, icon: { body: Uint8Array<ArrayBuffer>; type: string }): Response {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  return new Response(req.method === "HEAD" ? null : icon.body, {
    headers: {
      "content-type": icon.type,
      "content-length": String(icon.body.byteLength),
      // 30 days, not "immutable": these URLs have no version in them, so a new icon must still reach clients.
      "cache-control": "public, max-age=2592000",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/") return serveHome(req);

  if (url.pathname === "/health") {
    return Response.json({ name: pkg.name, version: pkg.version, status: "ok", mcp_endpoint: "/mcp" });
  }

  const icon = ICONS[url.pathname];
  if (icon) return serveIcon(req, icon);

  if (!/^\/mcp\/?$/.test(url.pathname)) {
    return new Response("Not found", { status: 404 });
  }

  const accessKey = extractKey(req);
  if (!accessKey) {
    return jsonRpcError(
      401,
      "Missing Unsplash access key. Send 'X-Unsplash-Access-Key: <key>', 'X-API-Key: <key>' or 'Authorization: Bearer <key>'.",
    );
  }

  // Stateless: a fresh server + transport per request, bound to this caller's key.
  const server = createServer({ accessKey, utmSource });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON response mode has fully resolved by now; release per-request resources.
    void transport.close();
    void server.close();
  }
}

/** The request logger: handles the request, then logs one line with the path redacted. */
export async function handleAndLog(req: Request): Promise<Response> {
  const started = performance.now();
  const res = await handle(req).catch((e) => {
    console.error("Unhandled error:", e?.message ?? e);
    return jsonRpcError(500, "Internal server error");
  });
  const path = redactPath(new URL(req.url).pathname);
  console.log(`${req.method} ${path} ${res.status} ${Math.round(performance.now() - started)}ms`);
  return res;
}

if (import.meta.main) {
  const port = Number(process.env.PORT) || 3000;
  const hostname = process.env.HOST || "0.0.0.0";
  Bun.serve({ port, hostname, fetch: handleAndLog });
  console.log(`Unsplash MCP server listening on http://${hostname}:${port}/mcp`);
}
