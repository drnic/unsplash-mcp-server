/**
 * Thin Unsplash API client + response shaping.
 *
 * The access key is always passed in explicitly — this module never reads
 * process.env — so the HTTP server can pass each caller's own key through.
 */

export const UNSPLASH_API_BASE = "https://api.unsplash.com";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY = 300;

export interface UnsplashPhoto {
  id: string;
  description: string | null;
  alt_description: string | null;
  /** Image URLs: raw, full, regular, small, thumb */
  urls: Record<string, string>;
  width: number;
  height: number;
  /** Dominant hex color, useful as a placeholder background */
  color: string;
  blur_hash: string | null;
  photographer_name: string;
  photographer_username: string;
  photographer_url: string;
  photo_url: string;
  /** Pass this (or the photo id) to track_download */
  download_location: string | null;
  attribution_text: string;
  attribution_html: string;
}

export interface ClientOptions {
  accessKey: string;
  /** Your Unsplash app name, used as utm_source in attribution links. */
  utmSource: string;
  fetch?: typeof fetch;
}

export class UnsplashError extends Error {}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function withUtm(url: string, utmSource: string): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", utmSource);
  u.searchParams.set("utm_medium", "referral");
  return u.toString();
}

export function toPhoto(photo: any, utmSource: string): UnsplashPhoto {
  const user = photo.user ?? {};
  const username: string = user.username;
  const name: string = user.name || username;
  const photographerUrl = withUtm(`https://unsplash.com/@${username}`, utmSource);
  const photoUrl = withUtm(photo.links.html, utmSource);
  const unsplashUrl = withUtm("https://unsplash.com/", utmSource);

  return {
    id: photo.id,
    description: photo.description ?? null,
    alt_description: photo.alt_description ?? null,
    urls: photo.urls,
    width: photo.width,
    height: photo.height,
    color: photo.color ?? "#000000",
    blur_hash: photo.blur_hash ?? null,
    photographer_name: name,
    photographer_username: username,
    photographer_url: photographerUrl,
    photo_url: photoUrl,
    download_location: photo.links?.download_location ?? null,
    attribution_text: `Photo by ${name} on Unsplash`,
    attribution_html:
      `Photo by <a href="${escapeHtml(photographerUrl)}">${escapeHtml(name)}</a> ` +
      `on <a href="${escapeHtml(unsplashUrl)}">Unsplash</a>`,
  };
}

/** Lenient integer parsing: accepts numbers or numeric strings, falls back to a default. */
export function toInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

export class UnsplashClient {
  constructor(private opts: ClientOptions) {}

  private async get(pathOrUrl: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
    const url = new URL(pathOrUrl, UNSPLASH_API_BASE);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(url, {
        headers: {
          "Accept-Version": "v1",
          Authorization: `Client-ID ${this.opts.accessKey}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e: any) {
      if (e?.name === "TimeoutError") throw new UnsplashError("Request to Unsplash timed out. Please try again.");
      throw new UnsplashError(`Failed to reach Unsplash: ${e?.message ?? e}`);
    }

    if (!res.ok) throw await this.toError(res);
    return res.json() as Promise<any>;
  }

  private async toError(res: Response): Promise<UnsplashError> {
    const body = (await res.text().catch(() => "")).slice(0, MAX_ERROR_BODY);
    switch (res.status) {
      case 401:
        return new UnsplashError("Invalid Unsplash access key. Check the key configured for this MCP server.");
      case 403:
        if (res.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(body)) {
          return new UnsplashError(
            "Unsplash rate limit exceeded for this access key (50 requests/hour in demo mode, 5,000/hour in production). Try again later.",
          );
        }
        return new UnsplashError(`Unsplash refused the request (403): ${body}`);
      case 404:
        return new UnsplashError("Not found on Unsplash (404). Check the photo id.");
      default:
        return new UnsplashError(`Unsplash API error ${res.status}: ${body}`);
    }
  }

  async searchPhotos(p: {
    query: string;
    page: number;
    per_page: number;
    order_by: string;
    color?: string;
    orientation?: string;
    content_filter: string;
  }): Promise<UnsplashPhoto[]> {
    const data = await this.get("/search/photos", p);
    return (data.results ?? []).map((ph: any) => toPhoto(ph, this.opts.utmSource));
  }

  async randomPhotos(p: {
    query?: string;
    count: number;
    orientation?: string;
    content_filter: string;
  }): Promise<UnsplashPhoto[]> {
    const data = await this.get("/photos/random", p);
    const list = Array.isArray(data) ? data : [data];
    return list.map((ph: any) => toPhoto(ph, this.opts.utmSource));
  }

  /**
   * Accepts a photo id, or a photo's `download_location` URL (preferred by
   * Unsplash because it carries tracking params). URLs are restricted to
   * api.unsplash.com so the access key is never sent anywhere else.
   */
  async trackDownload(photoIdOrLocation: string): Promise<string> {
    const input = photoIdOrLocation.trim();
    if (!input) throw new UnsplashError("photo_id is required");

    let target: string;
    if (/^https?:\/\//i.test(input)) {
      const u = new URL(input);
      if (u.protocol !== "https:" || u.host !== "api.unsplash.com" || !/^\/photos\/[^/]+\/download\/?$/.test(u.pathname)) {
        throw new UnsplashError("download_location must be an https://api.unsplash.com/photos/<id>/download URL");
      }
      target = u.toString();
    } else {
      if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new UnsplashError(`Invalid photo id: ${input}`);
      target = `/photos/${input}/download`;
    }

    const data = await this.get(target);
    return data.url ?? "";
  }
}
