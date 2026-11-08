// JSON response for the functions. cacheSeconds > 0 lets Netlify's CDN reuse the response that
// long, so a busy night makes one ESPN call per half minute instead of one per visitor. Browsers
// always re-check, so a deploy (which clears the CDN) shows up right away.
export function json(body, status = 200, cacheSeconds = 0) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (cacheSeconds > 0 && status === 200) {
    headers["cache-control"] = "public, max-age=0, must-revalidate";
    headers["netlify-cdn-cache-control"] = `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds}`;
  }
  return new Response(JSON.stringify(body), { status, headers });
}
