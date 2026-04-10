# strava-heatmap-proxy

A Cloudflare Worker that proxies authenticated Strava heatmap tiles, letting you use them as a tile layer in mapping apps like Gaia GPS, Locus Map, QGIS, OsmAnd, etc.

Pushes to `main` are automatically deployed via GitHub Actions.

---

## How it works

Strava requires authentication cookies to serve heatmap tiles. This worker:

1. Holds your Strava session cookie (`_strava4_session`) as a secret
2. Uses it to automatically fetch short-lived CloudFront auth cookies from Strava on demand
3. Caches those CloudFront cookies in a KV namespace (~24h TTL, auto-refreshed)
4. Forwards tile requests to Strava with the appropriate cookies attached

You only need to manually update credentials when your Strava session expires (every few months).

---

## Tile URLs

Once deployed, use these as tile layer URLs in your mapping app (replace `YOUR_NAMESPACE`):

| Size | URL |
|------|-----|
| 256px | `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/global/:color/:activity/{z}/{x}/{y}@small.png` |
| 512px | `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/global/:color/:activity/{z}/{x}/{y}.png` |
| 1024px | `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/global/:color/:activity/{z}/{x}/{y}@2x.png` |

Personal heatmap (requires Strava subscription):

| Size | URL |
|------|-----|
| 512px | `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/personal/:color/:activity/{z}/{x}/{y}.png` |
| 1024px | `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/personal/:color/:activity/{z}/{x}/{y}@2x.png` |

**Colors:** `mobileblue` `orange` `hot` `blue` `bluered` `purple` `gray`
**Activities:** `all` `ride` `winter` `run` `water`

Visit the worker root URL (`/`) for the full listing.

---

## First-time setup

### 1. Fork and clone this repo

### 2. Export your Strava cookies

Install the **strava-cookie-exporter** browser extension:
- [Firefox](https://addons.mozilla.org/firefox/addon/strava-cookie-exporter/)
- [Chrome](https://chromewebstore.google.com/detail/strava-cookie-exporter/apkhbbckeaminpphaaaabpkhgimojlhk)

Log into [Strava](https://www.strava.com/maps/global-heatmap), then use the extension to export your cookies as a JSON file.

### 3. Create a KV namespace

```console
npx wrangler kv namespace create STRAVA_CACHE
```

Copy the `id` from the output into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "STRAVA_CACHE"
id = "paste-your-id-here"
```

### 4. Set Worker secrets

Extract values from your exported cookies file and upload them as Worker secrets:

```console
# Get STRAVA_SESSION value
node -e "const c=JSON.parse(require('fs').readFileSync('strava-cookies.json','utf8')); console.log(c.find(x=>x.name==='_strava4_session').value)"

# Get STRAVA_ID value (personal heatmap only)
node -e "const c=JSON.parse(require('fs').readFileSync('strava-cookies.json','utf8')); console.log(c.find(x=>x.name==='strava_remember_id').value)"

# Upload secrets to Cloudflare
echo "<session-value>" | npx wrangler secret put STRAVA_SESSION
echo "<strava-id>"     | npx wrangler secret put STRAVA_ID
```

`STRAVA_ID` is only needed if you use the `/personal/` tile URLs.

### 5. Deploy manually (optional)

```console
npx wrangler deploy
```

### 6. Set up GitHub Actions (for auto-deploy on push)

Add these secrets to your GitHub repo (`Settings → Secrets → Actions`):

| Secret | Where to find it |
|--------|-----------------|
| `CF_ACCOUNT_ID` | [Cloudflare dashboard](https://dash.cloudflare.com) → right sidebar |
| `CF_API_TOKEN` | [Create a token](https://dash.cloudflare.com/profile/api-tokens) with the **Edit Cloudflare Workers** template |

After this, every push to `main` will automatically deploy the worker.

> **Note:** `STRAVA_SESSION` and `STRAVA_ID` are Cloudflare Worker secrets (set via wrangler), not GitHub secrets. GitHub Actions only needs `CF_ACCOUNT_ID` and `CF_API_TOKEN` to deploy code.

---

## Refreshing credentials

**CloudFront cookies** (~24h expiry) are refreshed automatically by the worker — no action needed.

**Strava session** (`STRAVA_SESSION`) lasts several months. When it expires the worker will return errors. To fix — you only need to update this one secret, nothing else (no KV changes, no redeployment):

1. Re-export cookies from your browser using the extension
2. Find the `_strava4_session` entry in the JSON file and copy its `value`:
   ```json
   { "name": "_strava4_session", "value": "abc123..." }
   ```
3. Update the secret:
   ```console
   echo "abc123..." | npx wrangler secret put STRAVA_SESSION
   ```

---

## Configuration

Edit `wrangler.toml` to change:

| Variable | Default | Description |
|----------|---------|-------------|
| `TILE_CACHE_SECS` | `86400` | Seconds Cloudflare caches each tile. Set to `0` to disable. |
| `ALLOWED_ORIGINS` | `` (all) | Comma-separated CORS origins to allow, e.g. `https://example.com`. Empty = allow all. |
