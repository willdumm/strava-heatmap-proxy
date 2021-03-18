# strava-heatmap-proxy

This is a simple [Cloudflare Worker](https://workers.dev) allowing
unauthenticated access to personal and global Strava heatmaps. If you want to
use your personal Strava heatmap in Gaia or Locus, this will give you a URL
that you can use for that.

Note: you **will** need to be a Strava premium subscriber to use this.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/erik/strava-heatmap-proxy)

# Setup

Requirements:

  - [wrangler](https://github.com/cloudflare/wrangler) to manage Worker deployments
  - [deno](https://deno.land) to run Strava authentication script

Strava's API doesn't support this kind of access directly, so we'll need to
log in with an email and password and grab session cookies for
authentication.

This can either be done manually in the browser or via
`./scripts/refresh_strava_credentials.ts`

``` console
$ export STRAVA_EMAIL="my-strava-account@example.com"
$ export STRAVA_PASSWORD="hunter2"
$
$ ./scripts/refresh_strava_credentials.ts
STRAVA_ID=12345
STRAVA_COOKIES=...
```

Now that we have these values, let's store them as Worker secrets.

``` console
$ echo "1234" | wrangler secret put STRAVA_ID
$ echo "...." | wrangler secret put STRAVA_COOKIES
```

Check that everything's working by running `wrangler dev`.

Here's an example tile URL with some data:
[/global/mobileblue/11/351/817@2x.png](http://127.0.0.1:8787/global/mobileblue/11/351/817@2x.png)
(Downtown Los Angeles)

When you're all set, use `wrangler publish` to bring the site live on
`strava-heatmap-proxy.YOUR-NAMESPACE.workers.dev`