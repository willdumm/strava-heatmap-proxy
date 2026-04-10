#!/usr/bin/env -S deno run --allow-read --allow-env
//
// Extract STRAVA_SESSION and STRAVA_ID from a cookies JSON file exported
// by the strava-cookie-exporter browser extension.
//
// Usage:
//   ./scripts/extract_strava_session.ts /path/to/strava-cookies.json
//
// Then set the secrets:
//   echo "<value>" | wrangler secret put STRAVA_SESSION
//   echo "<value>" | wrangler secret put STRAVA_ID

const cookiesFile = Deno.args[0] || Deno.env.get("COOKIES_FILE") || "strava-cookies.json";

let text: string;
try {
  text = await Deno.readTextFile(cookiesFile);
} catch (e) {
  console.error(`Error reading ${cookiesFile}: ${e.message}`);
  console.error("Usage: ./scripts/extract_strava_session.ts /path/to/strava-cookies.json");
  Deno.exit(1);
}

const cookies: Array<{ name: string; value: string }> = JSON.parse(text);

const session = cookies.find((c) => c.name === "_strava4_session");
if (!session) {
  console.error("_strava4_session not found in cookies file. Are you logged in to Strava?");
  Deno.exit(1);
}

const stravaIdCookie = cookies.find((c) => c.name === "strava_remember_id");

console.log(`STRAVA_SESSION='${session.value}'`);
if (stravaIdCookie) {
  console.log(`STRAVA_ID='${stravaIdCookie.value}'`);
} else {
  console.log("# STRAVA_ID not found (only needed for personal heatmaps)");
}
