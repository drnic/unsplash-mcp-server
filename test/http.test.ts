import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { extractKey, handle, handleAndLog, redactPath } from "../src/http.ts";
import { samplePhoto } from "./fixtures.ts";

const KEY = "abcdefghijklmnop_KEY-123";
const realFetch = globalThis.fetch;
let upstream: { url: URL; auth: string }[] = [];

function mockUnsplash() {
  upstream = [];
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(String(input));
    upstream.push({ url, auth: init?.headers?.Authorization });
    if (url.pathname === "/search/photos") return Response.json({ results: [samplePhoto()] });
    return new Response("nope", { status: 404 });
  }) as any;
}
afterEach(() => (globalThis.fetch = realFetch));

const rpc = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body),
    }),
  );

describe("extractKey", () => {
  const k = (headers: Record<string, string>, path = "/mcp") => extractKey(new Request(`http://x${path}`, { headers }));
  test("bearer / client-id / custom header", () => {
    expect(k({ authorization: `Bearer ${KEY}` })).toBe(KEY);
    expect(k({ authorization: `Client-ID ${KEY}` })).toBe(KEY);
    expect(k({ "x-unsplash-access-key": KEY })).toBe(KEY);
    expect(k({})).toBeNull();
    expect(k({ authorization: "Bearer bad key!" })).toBeNull();
  });
  test("ignores a key in the URL", () => expect(k({}, `/mcp/${KEY}`)).toBeNull());
});

describe("redactPath", () => {
  test("keeps known routes", () => {
    for (const p of ["/", "/health", "/favicon.ico", "/favicon.svg", "/mcp", "/mcp/"]) expect(redactPath(p)).toBe(p);
  });
  test("hides everything else", () => {
    expect(redactPath(`/mcp/${KEY}`)).toBe("/mcp/[redacted]");
    expect(redactPath(`/mcp//${KEY}`)).toBe("/mcp/[redacted]");
    expect(redactPath(`/${KEY}`)).toBe("[unmatched]");
    expect(redactPath(`/MCP/${KEY}`)).toBe("[unmatched]");
  });
});

describe("request logger", () => {
  // Runs a request through the real logger and returns everything written to the console.
  async function logged(path: string, headers: Record<string, string> = {}) {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.join(" "));
    const spies = [spyOn(console, "log").mockImplementation(capture), spyOn(console, "error").mockImplementation(capture)];
    try {
      const res = await handleAndLog(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      return { res, output: lines.join("\n") };
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }

  test.each([
    [`/mcp/${KEY}`, "/mcp/[redacted]"],
    [`/mcp/${KEY}/`, "/mcp/[redacted]"],
    [`/mcp//${KEY}`, "/mcp/[redacted]"],
    [`/mcp/${KEY}/extra`, "/mcp/[redacted]"],
    [`/mcp/x/${KEY}`, "/mcp/[redacted]"],
    [`/MCP/${KEY}`, "[unmatched]"],
    [`//mcp/${KEY}`, "[unmatched]"],
    [`/mcp${KEY}`, "[unmatched]"],
    [`/${KEY}`, "[unmatched]"],
    [`/v1/mcp/${KEY}`, "[unmatched]"],
    [`/health/${KEY}`, "[unmatched]"],
    [`/favicon.ico/${KEY}`, "[unmatched]"],
  ])("does not log the key from %s", async (path, shown) => {
    const { res, output } = await logged(path);
    expect(res.status).toBe(404);
    expect(output).toContain(`POST ${shown} 404 `);
    expect(output).not.toContain(KEY);
  });

  test("does not log a key sent in the query string or a header", async () => {
    const { res, output } = await logged(`/mcp?key=${KEY}`, { authorization: `Bearer ${KEY}` });
    expect(res.status).toBe(200);
    expect(output).toContain("POST /mcp 200 ");
    expect(output).not.toContain(KEY);
  });
});

describe("icons", () => {
  const get = (path: string, method = "GET") => handle(new Request(`http://x${path}`, { method }));

  test("/favicon.ico is a real ICO, long-cached, with no key", async () => {
    const res = await get("/favicon.ico");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/x-icon");
    expect(res.headers.get("cache-control")).toBe("public, max-age=2592000");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0, 0, 1, 0]); // ICO magic number
    expect(bytes[4]).toBe(3); // 16, 32 and 48 px images
    expect(res.headers.get("content-length")).toBe(String(bytes.byteLength));
  });

  test("/favicon.svg is a script-free SVG, long-cached, with no key", async () => {
    const res = await get("/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=2592000");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const svg = await res.text();
    expect(svg).toStartWith("<svg");
    expect(svg).not.toMatch(/<script|\son\w+=|href=/i);
  });

  test("HEAD has the headers and no body", async () => {
    const res = await get("/favicon.ico", "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/x-icon");
    expect(Number(res.headers.get("content-length"))).toBeGreaterThan(0);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  test("other methods get 405", async () => {
    const res = await get("/favicon.ico", "POST");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  test("other paths still 404", async () => expect((await get("/favicon.png")).status).toBe(404));

  test("serverInfo lists the icons as decodable data URIs", async () => {
    const init = await rpc(
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
      { authorization: `Bearer ${KEY}` },
    );
    const { icons } = ((await init.json()) as any).result.serverInfo;
    expect(icons.map((i: any) => [i.mimeType, i.sizes])).toEqual([
      ["image/png", ["48x48"]],
      ["image/svg+xml", ["any"]],
    ]);
    const decode = (i: any) => Buffer.from(i.src.slice(`data:${i.mimeType};base64,`.length), "base64");
    expect(icons[0].src).toStartWith("data:image/png;base64,");
    expect([...decode(icons[0]).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
    expect(decode(icons[1]).toString()).toStartWith("<svg");
  });
});

describe("HTTP MCP", () => {
  test("health", async () => expect((await handle(new Request("http://x/health"))).status).toBe(200));

  test("401 without key", async () => {
    const res = await rpc("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
  });

  test("401 message does not offer the URL form", async () => {
    const res = await rpc("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const body: any = await res.json();
    expect(body.error.message).toContain("Authorization: Bearer <key>");
    expect(body.error.message).toContain("X-Unsplash-Access-Key: <key>");
    expect(body.error.message).not.toContain("/mcp");
  });

  test("/mcp/ with a trailing slash is served", async () => {
    const res = await rpc("/mcp/", { jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${KEY}` });
    expect(res.status).toBe(200);
  });

  test("/mcp/<anything> returns 404, even with a valid header", async () => {
    mockUnsplash();
    const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_photos", arguments: { query: "x" } } };
    for (const path of [`/mcp/${KEY}`, `/mcp/${KEY}/`, "/mcp/short", "/mcp//"]) {
      expect((await rpc(path, call)).status).toBe(404);
      expect((await rpc(path, call, { authorization: `Bearer ${KEY}` })).status).toBe(404);
    }
    expect(upstream).toHaveLength(0);
  });

  test("initialize + tools/list", async () => {
    const init = await rpc(
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
      { authorization: `Bearer ${KEY}` },
    );
    expect(init.status).toBe(200);
    expect(((await init.json()) as any).result.serverInfo.name).toBe("Unsplash MCP Server");

    const list = await rpc("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" }, { authorization: `Bearer ${KEY}` });
    const names = ((await list.json()) as any).result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(["get_random_photos", "search_photos", "track_download"]);
  });

  test("tools/call passes the caller's key through", async () => {
    mockUnsplash();
    const res = await rpc(
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "search_photos", arguments: { query: "mountain", per_page: "50" } },
      },
      { authorization: `Bearer ${KEY}` },
    );
    const body: any = await res.json();
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.photos[0].attribution_text).toBe("Photo by John Doe on Unsplash");
    expect(upstream[0]!.auth).toBe(`Client-ID ${KEY}`);
    expect(upstream[0]!.url.searchParams.get("per_page")).toBe("30"); // clamped
  });

  test("upstream errors surface as tool errors", async () => {
    mockUnsplash();
    const res = await rpc(
      "/mcp",
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "track_download", arguments: { photo_id: "missing" } } },
      { "x-unsplash-access-key": KEY },
    );
    const body: any = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Not found");
  });
});
