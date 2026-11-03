import { describe, expect, test } from "bun:test";
import { UnsplashClient, toInt, toPhoto } from "../src/unsplash.ts";
import { samplePhoto } from "./fixtures.ts";

describe("toPhoto", () => {
  test("builds attribution with utm params", () => {
    const p = toPhoto(samplePhoto(), "myapp");
    expect(p.attribution_text).toBe("Photo by John Doe on Unsplash");
    expect(p.photographer_url).toBe("https://unsplash.com/@johndoe?utm_source=myapp&utm_medium=referral");
    expect(p.photo_url).toBe("https://unsplash.com/photos/abc123?utm_source=myapp&utm_medium=referral");
    expect(p.attribution_html).toBe(
      'Photo by <a href="https://unsplash.com/@johndoe?utm_source=myapp&amp;utm_medium=referral">John Doe</a> ' +
        'on <a href="https://unsplash.com/?utm_source=myapp&amp;utm_medium=referral">Unsplash</a>',
    );
    expect(p.download_location).toBe("https://api.unsplash.com/photos/abc123/download?ixid=xyz");
  });

  test("escapes photographer name in HTML", () => {
    const p = toPhoto(samplePhoto({ user: { username: "x", name: '<script>alert("hi")</script>' } }), "a");
    expect(p.attribution_html).not.toContain("<script>");
    expect(p.attribution_html).toContain("&lt;script&gt;");
  });

  test("falls back to username when name missing", () => {
    expect(toPhoto(samplePhoto({ user: { username: "jd" } }), "a").photographer_name).toBe("jd");
  });
});

test("toInt is lenient", () => {
  expect(toInt("5", 1)).toBe(5);
  expect(toInt(7, 1)).toBe(7);
  expect(toInt("abc", 10)).toBe(10);
  expect(toInt(undefined, 3)).toBe(3);
});

describe("UnsplashClient", () => {
  const mk = (handler: (url: URL, init: RequestInit) => Response) => {
    const calls: { url: URL; init: RequestInit }[] = [];
    const client = new UnsplashClient({
      accessKey: "test-key-123456",
      utmSource: "t",
      fetch: (async (url: URL, init: RequestInit) => {
        calls.push({ url, init });
        return handler(url, init);
      }) as any,
    });
    return { client, calls };
  };

  test("search sends key and params", async () => {
    const { client, calls } = mk(() => Response.json({ results: [samplePhoto()] }));
    const photos = await client.searchPhotos({ query: "cat", page: 1, per_page: 5, order_by: "relevant", content_filter: "low" });
    expect(photos).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe("/search/photos");
    expect(calls[0]!.url.searchParams.get("per_page")).toBe("5");
    expect(calls[0]!.url.searchParams.has("color")).toBe(false);
    expect((calls[0]!.init.headers as any).Authorization).toBe("Client-ID test-key-123456");
  });

  test("random handles single object response", async () => {
    const { client } = mk(() => Response.json(samplePhoto()));
    expect(await client.randomPhotos({ count: 1, content_filter: "low" })).toHaveLength(1);
  });

  test("track_download accepts id or download_location", async () => {
    const { client, calls } = mk(() => Response.json({ url: "https://dl" }));
    expect(await client.trackDownload("abc123")).toBe("https://dl");
    expect(await client.trackDownload("https://api.unsplash.com/photos/abc123/download?ixid=xyz")).toBe("https://dl");
    expect(calls[1]!.url.searchParams.get("ixid")).toBe("xyz");
  });

  test("track_download refuses non-Unsplash URLs (key never leaves for other hosts)", async () => {
    const { client, calls } = mk(() => Response.json({}));
    await expect(client.trackDownload("https://evil.example/photos/a/download")).rejects.toThrow();
    await expect(client.trackDownload("https://api.unsplash.com/me")).rejects.toThrow();
    await expect(client.trackDownload("../me")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test("maps errors", async () => {
    const r401 = mk(() => new Response("no", { status: 401 }));
    await expect(r401.client.trackDownload("a")).rejects.toThrow(/Invalid Unsplash access key/);
    const r403 = mk(() => new Response("Rate Limit Exceeded", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    await expect(r403.client.trackDownload("a")).rejects.toThrow(/rate limit/);
    const r403b = mk(() => new Response("forbidden", { status: 403, headers: { "x-ratelimit-remaining": "40" } }));
    await expect(r403b.client.trackDownload("a")).rejects.toThrow(/refused/);
  });
});
