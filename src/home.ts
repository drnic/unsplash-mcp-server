/**
 * The HTML homepage at "/". assets/home.html is self-contained: its styles and script
 * are inline, and it loads nothing from other hosts except photos from images.unsplash.com.
 */
import { readFileSync } from "node:fs";
import { utmSource } from "./config.ts";

// Unsplash asks that utm_source names your app, so credit links follow UNSPLASH_UTM_SOURCE.
const homeHtml = readFileSync(new URL("../assets/home.html", import.meta.url), "utf8").replaceAll(
  "utm_source=unsplash_mcp_server",
  () => `utm_source=${encodeURIComponent(utmSource)}`,
);
const body = new TextEncoder().encode(homeHtml);

const CSP = [
  "default-src 'none'",
  "img-src 'self' https://images.unsplash.com",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function serveHome(req: Request): Response {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  return new Response(req.method === "HEAD" ? null : body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(body.byteLength),
      "cache-control": "public, max-age=300",
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
    },
  });
}
