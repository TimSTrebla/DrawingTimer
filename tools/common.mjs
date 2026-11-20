// Shared by the snapshot and review tools: a generic client name, thumbnail addresses, and fetching images and the
// Art Institute's API outside the browser (headless browsers on hosted runners are turned away or throttled).
export const UA = "drawing-reference-tools/1.0 (automated, low volume)";   // generic: no account or project details
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// A smaller version of an image the app would show. Commons hands out the original when a file is narrower than
// the width asked for, so a thumbnail address is built for those too. Widths must be ones Wikimedia serves.
export function thumb(u, w = 500) {
  u = String(u).replace(/\?utm_source=.*$/, "");
  const m = u.match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?]+)$/);
  if (m) return `https://thumb.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${m[3]}/${w}px-${m[3]}`;
  return u.replace(/\/(\d+)px-/, (x, n) => +n > w ? `/${w}px-` : x).replace(/\/full\/\d+,\//, `/full/${w <= 250 ? 200 : 400},/`).replace(/([?&]width=)\d+/, `$1${w}`);
}

async function get(url, headers, tries = 4) {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(url, { headers, redirect: "follow" });
      if ((r.status === 429 || r.status >= 500) && k < tries) { await sleep(1000 * Math.min(60, +(r.headers.get("retry-after") || 0) || 4 * (k + 1))); continue; }
      return r;
    } catch (e) { if (k >= tries) throw e; await sleep(1500 * (k + 1)); }
  }
}

// Route the image hosts and the Art Institute's API through Node. Images come back readable by a canvas.
export async function routeOutside(ctx) {
  const cors = { "access-control-allow-origin": "*" };
  await ctx.route("https://api.artic.edu/**", async r => {
    try { const res = await get(r.request().url(), { "User-Agent": UA, "AIC-User-Agent": UA, "Accept": "application/json" });
      r.fulfill({ status: res.status, contentType: "application/json", headers: cors, body: await res.text() }); }
    catch (e) { r.fulfill({ status: 502, contentType: "application/json", headers: cors, body: JSON.stringify({ error: String(e) }) }); }
  });
  const image = async r => {
    try { const res = await get(r.request().url(), { "User-Agent": UA, "AIC-User-Agent": UA });
      r.fulfill({ status: res.status, contentType: res.headers.get("content-type") || "image/jpeg", headers: cors, body: Buffer.from(await res.arrayBuffer()) }); }
    catch { r.fulfill({ status: 502, headers: cors, body: "" }); }
  };
  for (const pattern of ["https://upload.wikimedia.org/**", "https://thumb.wikimedia.org/**", "https://commons.wikimedia.org/wiki/Special:FilePath/**", "https://www.artic.edu/iiif/**", "https://openaccess-cdn.clevelandart.org/**"]) await ctx.route(pattern, image);
}

// How much is on the page: runs inside the browser on a loaded, CORS-readable <img>. Returns the standard deviation
// of brightness (0–255) over the middle of the image; a blank sheet of paper scores low.
export const inkOf = `(img => { try {
  const n = 64, c = document.createElement("canvas"); c.width = c.height = n;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, n, n);
  const d = g.getImageData(6, 6, n - 12, n - 12).data; let s = 0, s2 = 0, k = 0;
  for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; s += y; s2 += y * y; k++; }
  const m = s / k; return Math.round(Math.sqrt(Math.max(0, s2 / k - m * m)) * 10) / 10;
} catch { return null; } })`;
export const BLANK_BELOW = 6;   // brightness spread under which a scan counts as a blank page
