# Unsplash MCP Server (Bun, Streamable HTTP)

An [MCP](https://modelcontextprotocol.io) server for fetching photos from [Unsplash](https://unsplash.com) **with proper attribution**, built for agents (Claude Code, Claude Code on the web, claude.ai, Codex, Cursor…) that create content pages needing credited images.

A Bun/TypeScript port of [cevatkerim/unsplash-mcp](https://github.com/cevatkerim/unsplash-mcp) (Python, stdio only), with the same tools, descriptions and output, plus:

- **Hosted web service** using stateless [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http).
- **Pass-through auth:** the server stores no Unsplash key. Each request carries the caller's own key, which is used for that request only. Rate limits apply to the caller's key.
- **Local stdio mode** for desktop clients.
- Fixes: photographer names are HTML-escaped in `attribution_html`; `utm_source` can be configured; rate-limit errors are told apart from other 403s; `track_download` accepts the photo's `download_location` URL (the form Unsplash prefers).

## Tools

| Tool | Unsplash endpoint | Parameters |
|---|---|---|
| `search_photos` | `GET /search/photos` | `query`, `page`=1, `per_page`=10 (1–30), `order_by`=`relevant`\|`latest`, `color`, `orientation`=`landscape`\|`portrait`\|`squarish`, `content_filter`=`low`\|`high` |
| `get_random_photos` | `GET /photos/random` | `query`, `count`=1 (1–30), `orientation`, `content_filter` |
| `track_download` | `GET /photos/:id/download` | `photo_id`: a photo id **or** its `download_location` URL |

Every photo in a result looks like this:

```jsonc
{
  "id": "abc123",
  "description": "…", "alt_description": "…",
  "urls": { "raw": "…", "full": "…", "regular": "…", "small": "…", "thumb": "…" },
  "width": 4000, "height": 3000,
  "color": "#a3c4f3", "blur_hash": "LKO2?U%2Tw=w…",
  "photographer_name": "John Doe", "photographer_username": "johndoe",
  "photographer_url": "https://unsplash.com/@johndoe?utm_source=…&utm_medium=referral",
  "photo_url": "https://unsplash.com/photos/abc123?utm_source=…&utm_medium=referral",
  "download_location": "https://api.unsplash.com/photos/abc123/download?ixid=…",
  "attribution_text": "Photo by John Doe on Unsplash",
  "attribution_html": "Photo by <a href=\"…\">John Doe</a> on <a href=\"…\">Unsplash</a>"
}
```

Search and random tools return `{ "photos": [...] }`; `track_download` returns `{ "download_url": "…" }`. Each result is sent both as MCP `structuredContent` and as JSON text.

## Sending your Unsplash key

Get an access key at <https://unsplash.com/developers>. The server accepts it in either of these headers:

| Method | Example |
|---|---|
| `Authorization` header **(preferred)** | `Authorization: Bearer <key>` or `Authorization: Client-ID <key>` |
| Custom header | `X-Unsplash-Access-Key: <key>` |

Requests with no key get a `401`. The server never falls back to a key of its own, so nobody can use up your quota through it.

## Client configuration

Replace `unsplash-mcp.example.com` below with your deployed host. You can check it's up by opening `https://<host>/health` in a browser.

### Claude Code on the web: `.mcp.json` in your project repo

1. **Commit `.mcp.json`** to the root of the repository your Claude Code sessions work on:

   ```json
   {
     "mcpServers": {
       "unsplash": {
         "type": "http",
         "url": "https://unsplash-mcp.example.com/mcp",
         "headers": { "Authorization": "Bearer ${UNSPLASH_ACCESS_KEY}" }
       }
     }
   }
   ```

   Claude Code expands `${UNSPLASH_ACCESS_KEY}` at runtime, so the key itself never goes into git.

2. **Add the key to the cloud environment.** Open the cloud environment menu in the session's title bar and choose **Edit**. Add an environment variable `UNSPLASH_ACCESS_KEY=<your key>`.

3. **Allow your host through the network policy.** In the same settings, under **Network access**, either choose a broader access level, or add `unsplash-mcp.example.com` under **Allowed domains** and leave **Allow package managers** ticked. Without this, the session can't reach your server. Details: <https://code.claude.com/docs/en/cloud-environments#network-access>.

4. **Start a new session.** Environment settings and MCP servers are read when a session starts. Check that `unsplash` is listed with `/mcp`, or ask Claude to "search Unsplash for …".

More: <https://code.claude.com/docs/en/claude-code-on-the-web> and <https://code.claude.com/docs/en/mcp>.

**Alternative:** if you've added the claude.ai connector described below, it's also available in Claude Code on the web sessions, with no `.mcp.json` or environment variable needed.

### Claude Code CLI (local terminal)

The same `.mcp.json` works locally, with `UNSPLASH_ACCESS_KEY` exported in your shell. Or add the server to your own user config:

```bash
claude mcp add --transport http --scope user unsplash https://unsplash-mcp.example.com/mcp \
  --header "Authorization: Bearer $UNSPLASH_ACCESS_KEY"
```

### claude.ai (web, desktop and mobile apps): custom connector

1. Go to <https://claude.ai/customize/connectors> and choose **Add custom connector**.
2. Name: `Unsplash`.
3. URL (with no key in it):

   ```
   https://unsplash-mcp.example.com/mcp
   ```

4. Authentication: **No sign-in**.
5. Under **Request headers**, add a header. Name: `Authorization`. Value: `Bearer <your-unsplash-access-key>`.
6. Save. Then enable the connector in a chat from the tools menu, or start a new Claude Code on the web session to pick it up.

These steps were checked on a Max plan. Other plans may differ.

On a Team or Enterprise plan, an owner may need to add custom connectors in organisation settings first. Help: <https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp>.

> Keep your key private. Anyone who has it can use your Unsplash quota. Rotate the key at <https://unsplash.com/oauth/applications> if it leaks.

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.unsplash]
url = "https://unsplash-mcp.example.com/mcp"
bearer_token_env_var = "UNSPLASH_ACCESS_KEY"
```

### Local stdio mode

```json
{
  "mcpServers": {
    "unsplash": {
      "command": "bun",
      "args": ["/path/to/unsplash-mcp-server/src/stdio.ts"],
      "env": { "UNSPLASH_ACCESS_KEY": "your_access_key_here" }
    }
  }
}
```

## Running

```bash
bun install
bun run start        # HTTP on $PORT (default 3000): POST /mcp, GET /health
bun run dev          # same, with --watch
bun run stdio        # stdio mode (needs UNSPLASH_ACCESS_KEY)
bun test
bun run typecheck
```

Environment variables (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `UNSPLASH_UTM_SOURCE` | `unsplash_mcp_server` | Your Unsplash app name, used in attribution links ([required by the guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)) |
| `UNSPLASH_ACCESS_KEY` | – | **stdio mode only** |

## Deploying (Hatchbox / any Ubuntu host)

1. Install Bun on the server (`curl -fsSL https://bun.sh/install | bash`).
2. Build command: `bun install --production`
3. Start command: `bun run start` (a `Procfile` is included: `web: bun run start`).
4. Expose the app over **HTTPS**, since keys travel in request headers. The health check is `GET /health`.
5. Set `UNSPLASH_UTM_SOURCE` to your Unsplash app's name.

The server is stateless (no sessions; it answers with JSON instead of SSE streams), so it runs fine behind nginx buffering and can scale to several processes.

## Unsplash API guidelines

1. **Attribution:** always credit the photographer and Unsplash (use `attribution_html`).
2. **Hotlinking:** use the returned `urls` directly.
3. **Download tracking:** call `track_download` when a photo is actually used or downloaded.
4. **Icon:** the guidelines forbid using the Unsplash logo as an app icon, so `/favicon.ico`, `/favicon.svg` and the MCP `serverInfo.icons` use an original picture glyph (source: `assets/icon.svg`). Do not replace it with the Unsplash logo or a variation of it.

This is an unofficial project. It is not affiliated with, sponsored by or endorsed by Unsplash.

Rate limits: 50 requests/hour in demo mode, 5,000/hour once Unsplash approves your app for production.

## License

MIT. See [LICENSE](LICENSE). Based on [cevatkerim/unsplash-mcp](https://github.com/cevatkerim/unsplash-mcp) (MIT).
