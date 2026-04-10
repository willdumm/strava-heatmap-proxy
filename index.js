/**
 * Strava Heatmap Proxy - Cloudflare Worker
 *
 * Required secrets (set via `wrangler secret put`):
 *   STRAVA_SESSION  - value of _strava4_session cookie (from browser)
 *   STRAVA_ID       - your Strava user ID (for personal heatmaps only)
 *
 * Required KV namespace binding (see wrangler.toml):
 *   STRAVA_CACHE    - used to cache refreshed CloudFront cookies
 *
 * Optional vars (wrangler.toml):
 *   TILE_CACHE_SECS  - seconds to cache tiles (default 0 = disabled)
 *   ALLOWED_ORIGINS  - comma-separated CORS origins (default * = all)
 */

const CLOUDFRONT_CACHE_KEY = 'cloudfront_cookies';

// Strava changed the global heatmap endpoint. Old: heatmap-external-c.strava.com/tiles-auth/
const GLOBAL_MAP_URL =
  'https://content-a.strava.com/identified/globalheat/{activity}/{color}/{z}/{x}/{y}{res}.png?v=19{qs}';

const PERSONAL_MAP_URL =
  'https://personal-heatmaps-external.strava.com/' +
  'tiles/{strava_id}/{color}/{z}/{x}/{y}{res}.png' +
  '?filter_type={activity}&include_everyone=true&include_followers_only=true&respect_privacy_zones=true';

async function getCloudFrontCookies(env) {
  const cached = await env.STRAVA_CACHE.get(CLOUDFRONT_CACHE_KEY, { type: 'json' });
  if (cached && cached.expires > Date.now()) {
    return cached.cookieString;
  }
  return refreshCloudFrontCookies(env);
}

async function refreshCloudFrontCookies(env) {
  if (!env.STRAVA_SESSION) {
    throw new Error('STRAVA_SESSION secret is not set. See README for setup instructions.');
  }

  // A HEAD request to /maps with the session cookie causes Strava to issue fresh CloudFront cookies.
  const resp = await fetch('https://www.strava.com/maps', {
    method: 'HEAD',
    headers: {
      Cookie: `_strava4_session=${env.STRAVA_SESSION}`,
    },
    redirect: 'follow',
  });

  if (resp.status !== 200) {
    throw new Error(
      `Failed to refresh CloudFront cookies: HTTP ${resp.status}. ` +
      'STRAVA_SESSION may have expired — re-export cookies from your browser and update the secret.'
    );
  }

  const cookieValues = {};
  let expires = Date.now() + 86400 * 1000; // default 24h if expiry not specified

  // CF Workers supports getAll() to retrieve each Set-Cookie header individually
  const setCookies = typeof resp.headers.getAll === 'function'
    ? resp.headers.getAll('set-cookie')
    : [];
  for (const cookie of setCookies) {
    const eqIdx = cookie.indexOf('=');
    if (eqIdx === -1) continue;
    const name = cookie.substring(0, eqIdx).trim();
    const value = cookie.substring(eqIdx + 1).split(';')[0].trim();

    switch (name) {
      case 'CloudFront-Signature':
      case 'CloudFront-Policy':
      case 'CloudFront-Key-Pair-Id':
      case '_strava_idcf':
        cookieValues[name] = value;
        break;
      case '_strava_CloudFront-Expires': {
        const ts = parseInt(value, 10);
        if (!isNaN(ts)) expires = ts;
        break;
      }
    }
  }

  for (const name of ['CloudFront-Signature', 'CloudFront-Policy', 'CloudFront-Key-Pair-Id']) {
    if (!cookieValues[name]) {
      throw new Error(
        `Required cookie "${name}" not returned by Strava. ` +
        'STRAVA_SESSION may have expired — re-export cookies from your browser and update the secret.'
      );
    }
  }

  const cookieString = Object.entries(cookieValues).map(([k, v]) => `${k}=${v}`).join('; ');
  const ttl = Math.max(Math.ceil((expires - Date.now()) / 1000), 60);

  await env.STRAVA_CACHE.put(
    CLOUDFRONT_CACHE_KEY,
    JSON.stringify({ cookieString, expires }),
    { expirationTtl: ttl }
  );

  return cookieString;
}

function handleIndexRequest() {
  return new Response(`\
Global Heatmap
       256px: /global/:color/:activity/{z}/{x}/{y}@small.png
       512px: /global/:color/:activity/{z}/{x}/{y}.png
      1024px: /global/:color/:activity/{z}/{x}/{y}@2x.png

      colors: mobileblue, orange, hot, blue, bluered, purple, gray
  activities: all, ride, winter, run, water


Personal Heatmap
       512px: /personal/:color/:activity/{z}/{x}/{y}.png
      1024px: /personal/:color/:activity/{z}/{x}/{y}@2x.png

      colors: orange, hot, blue, bluered, purple, gray
  activities: all, ride, winter, run, water
`);
}

async function handleTileProxyRequest(request, env) {
  const url = new URL(request.url);

  const match = url.pathname.match(
    /\/(personal|global)\/(\w+)\/(\w+)\/(\d+)\/(\d+)\/(\d+)(@small|@2x)?\.png/
  );
  if (!match) {
    return new Response('invalid url, expected: /kind/color/activity/z/x/y.png', { status: 400 });
  }

  const allowedOrigins = (env.ALLOWED_ORIGINS || '*').split(',');
  const origin = request.headers.get('origin');
  if (!allowedOrigins.includes('*') && origin !== null && !allowedOrigins.includes(origin)) {
    return new Response('Origin not allowed', { status: 403 });
  }

  const [_, kind, color, activity, z, x, y, res] = match;

  const cloudFrontCookies = await getCloudFrontCookies(env);

  const data = {
    strava_id: env.STRAVA_ID || '',
    color,
    activity,
    x,
    y,
    z,
    res: res === '@small' ? '' : (res || ''),
    qs: res === '@small' ? '&px=256' : '',
  };

  const baseUrl = kind === 'personal' ? PERSONAL_MAP_URL : GLOBAL_MAP_URL;
  const proxyUrl = baseUrl.replace(/\{(\w+)\}/g, (_, key) => data[key]);

  let response = await fetch(proxyUrl, {
    method: 'GET',
    headers: { Cookie: cloudFrontCookies },
  });
  response = new Response(await response.arrayBuffer(), response);

  if (origin) {
    response.headers.append('Access-Control-Allow-Origin', origin);
  }

  return response;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const tileCacheSecs = +(env.TILE_CACHE_SECS || 0);

      let response = tileCacheSecs > 0
        ? await caches.default.match(request.url)
        : null;

      if (!response) {
        if (url.pathname === '/') {
          response = handleIndexRequest();
        } else if (/^\/(personal|global)\//.test(url.pathname)) {
          response = await handleTileProxyRequest(request, env);

          if (tileCacheSecs > 0 && response.status === 200) {
            response = new Response(response.body, response);
            response.headers.append('Cache-Control', `maxage=${tileCacheSecs}`);
            ctx.waitUntil(caches.default.put(request.url, response.clone()));
          }
        } else {
          response = new Response('not found', { status: 404 });
        }
      }

      return response;
    } catch (err) {
      return new Response(`error: ${err.message}`, { status: 500 });
    }
  },
};
