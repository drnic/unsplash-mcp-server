/**
 * The server's icon: an original picture glyph (sun over a mountain on a teal tile).
 *
 * It is deliberately not based on the Unsplash logo. Unsplash's API guidelines say
 * "you cannot use the Unsplash logo as an app icon", and its terms and press page
 * forbid altering its marks, so a variation of the logo is not allowed either.
 *
 * assets/icon.svg is the source. To change the icon, regenerate the other two files from it.
 */
import { readFileSync } from "node:fs";

const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../assets/${name}`, import.meta.url)));

export const iconSvg = asset("icon.svg");
export const iconPng = asset("icon-48.png");
export const faviconIco = asset("favicon.ico");

const dataUri = (type: string, bytes: Uint8Array) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

/**
 * Icons for MCP `serverInfo`. These are data URIs because the same server code runs
 * over stdio and on any host, so it has no public URL of its own to point at.
 * PNG comes first: the spec says clients MUST support PNG and only SHOULD support SVG.
 */
export const serverIcons = [
  { src: dataUri("image/png", iconPng), mimeType: "image/png", sizes: ["48x48"] },
  { src: dataUri("image/svg+xml", iconSvg), mimeType: "image/svg+xml", sizes: ["any"] },
];
