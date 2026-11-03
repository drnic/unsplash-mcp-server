import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UnsplashClient, clamp, toInt, type ClientOptions } from "./unsplash.ts";
import { serverIcons } from "./icon.ts";
import pkg from "../package.json" with { type: "json" };

// Models sometimes send numbers as strings ("5"); accept both, like the original server.
const intLike = z.union([z.number(), z.string()]);

const photoSchema = z.object({
  id: z.string(),
  description: z.string().nullable(),
  alt_description: z.string().nullable(),
  urls: z.record(z.string(), z.string()),
  width: z.number(),
  height: z.number(),
  color: z.string(),
  blur_hash: z.string().nullable(),
  photographer_name: z.string(),
  photographer_username: z.string(),
  photographer_url: z.string(),
  photo_url: z.string(),
  download_location: z.string().nullable(),
  attribution_text: z.string(),
  attribution_html: z.string(),
});

const photosOutput = { photos: z.array(photoSchema) };

function result<T extends Record<string, unknown>>(structured: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

export function createServer(opts: ClientOptions): McpServer {
  const client = new UnsplashClient(opts);
  const server = new McpServer({ name: "Unsplash MCP Server", version: pkg.version, icons: serverIcons });

  server.registerTool(
    "search_photos",
    {
      title: "Search Unsplash photos",
      description: `Search for photos on Unsplash by keyword.

Use this tool when you need to find photos for a specific topic or theme.
Each result includes full attribution data that MUST be displayed when
using the image (required by Unsplash API guidelines).

Returns a list of photos. Each photo includes:
- urls: raw, full, regular, small, thumb sizes ("regular" is recommended for web; hotlink these URLs directly)
- attribution_text: Plain text credit (e.g. "Photo by John Doe on Unsplash")
- attribution_html: HTML credit with proper links for web pages
- color / blur_hash: for placeholders and progressive loading

Example: search_photos(query="sunset beach", per_page=5, orientation="landscape"),
then use photos[0].urls.regular for the image and photos[0].attribution_html for the credit line.`,
      inputSchema: {
        query: z.string().describe('Search keyword(s), e.g. "mountain landscape", "coffee shop interior"'),
        page: intLike.optional().describe("Page number for pagination (default: 1)"),
        per_page: intLike.optional().describe("Number of results per page, 1-30 (default: 10)"),
        order_by: z
          .string()
          .optional()
          .describe('Sort order - "relevant" (best match, default) or "latest" (newest first)'),
        color: z
          .string()
          .optional()
          .describe(
            "Filter by color - black_and_white, black, white, yellow, orange, red, purple, magenta, green, teal, blue",
          ),
        orientation: z.string().optional().describe("Filter by orientation - landscape, portrait, squarish"),
        content_filter: z.string().optional().describe('Safety filter - "low" (default) or "high" (stricter)'),
      },
      outputSchema: photosOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const photos = await client.searchPhotos({
        query: args.query,
        page: Math.max(1, toInt(args.page, 1)),
        per_page: clamp(toInt(args.per_page, 10), 1, 30),
        order_by: args.order_by || "relevant",
        color: args.color || undefined,
        orientation: args.orientation || undefined,
        content_filter: args.content_filter || "low",
      });
      return result({ photos });
    },
  );

  server.registerTool(
    "get_random_photos",
    {
      title: "Get random Unsplash photos",
      description: `Get random photos from Unsplash, optionally filtered by keyword.

Use this tool when you need variety or don't have a specific image in mind.
Great for hero images, backgrounds, or when you want to avoid repetitive results.

Returns a list of photos with full attribution data (attribution_text and
attribution_html) that MUST be displayed when using the image.

Example: get_random_photos(query="nature", count=3, orientation="landscape")`,
      inputSchema: {
        query: z.string().optional().describe('Optional keyword to filter random photos (e.g. "nature", "technology")'),
        count: intLike.optional().describe("Number of random photos to return, 1-30 (default: 1)"),
        orientation: z.string().optional().describe("Filter by orientation - landscape, portrait, squarish"),
        content_filter: z.string().optional().describe('Safety filter - "low" (default) or "high" (stricter)'),
      },
      outputSchema: photosOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const photos = await client.randomPhotos({
        query: args.query || undefined,
        count: clamp(toInt(args.count, 1), 1, 30),
        orientation: args.orientation || undefined,
        content_filter: args.content_filter || "low",
      });
      return result({ photos });
    },
  );

  server.registerTool(
    "track_download",
    {
      title: "Track an Unsplash photo download",
      description: `Track a photo download (REQUIRED by Unsplash API guidelines).

You MUST call this function when a user downloads or saves a photo, or when
you use a photo in content you are producing. This is required by Unsplash's
API guidelines to properly credit photographers and track usage statistics.

Call this AFTER the user confirms they want to download/use the image,
not when just displaying search results.

Pass either the photo's id or its download_location URL (preferred) from a
previous search_photos or get_random_photos result.

Returns the download URL for the photo (full resolution).`,
      inputSchema: {
        photo_id: z
          .string()
          .describe("The photo id, or its download_location URL, from a previous search_photos or get_random_photos result"),
      },
      outputSchema: { download_url: z.string() },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ photo_id }) => result({ download_url: await client.trackDownload(photo_id) }),
  );

  return server;
}
