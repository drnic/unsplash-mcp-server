#!/usr/bin/env bun
/** Local stdio mode: reads the key from UNSPLASH_ACCESS_KEY. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";
import { utmSource } from "./config.ts";

const accessKey = process.env.UNSPLASH_ACCESS_KEY;
if (!accessKey) {
  console.error("Missing UNSPLASH_ACCESS_KEY. Get a key from https://unsplash.com/developers");
  process.exit(1);
}

await createServer({ accessKey, utmSource }).connect(new StdioServerTransport());
