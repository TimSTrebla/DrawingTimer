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

// How much is drawn on the page: runs inside the browser on a loaded, CORS-readable <img>. Returns the share (in
// thousandths) of the inner area that is clearly darker than its surroundings, i.e. ink. Paper tone, a darker rim
// and uneven lighting change slowly and do not count; a line does.
export const inkOf = `(img => { try {
  const s = 160 / Math.max(img.naturalWidth, img.naturalHeight), w = Math.max(8, Math.round(img.naturalWidth * s)), h = Math.max(8, Math.round(img.naturalHeight * s));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, y = new Float32Array(w * h), I = new Float64Array((w + 1) * (h + 1)), W = w + 1;
  for (let i = 0; i < w * h; i++) y[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
  for (let r = 0; r < h; r++) for (let q = 0, row = 0; q < w; q++) { row += y[r * w + q]; I[(r + 1) * W + q + 1] = I[r * W + q + 1] + row; }   // summed-area table: local mean in four look-ups
  const R = 8; let ink = 0, k = 0;
  for (let r = Math.floor(h * 0.1); r < Math.floor(h * 0.9); r++) for (let q = Math.floor(w * 0.1); q < Math.floor(w * 0.9); q++) {
    const r0 = Math.max(0, r - R), r1 = Math.min(h, r + R + 1), q0 = Math.max(0, q - R), q1 = Math.min(w, q + R + 1);
    const around = (I[r1 * W + q1] - I[r0 * W + q1] - I[r1 * W + q0] + I[r0 * W + q0]) / ((r1 - r0) * (q1 - q0));
    if (around - y[r * w + q] > 8) ink++; k++; }
  return Math.round(ink / k * 10000) / 10;
} catch { return null; } })`;
// Calibrated on 24 scans of the Bargue course (8 plates, 16 empty backs, some on tinted paper with a darker rim):
// plates 57–150, empty pages 0–0.7. Spread of brightness, the first attempt, put a line-only plate (5.2) under its own limit.
export const BLANK_BELOW = 5;   // ink, in thousandths of the inner area, under which a scan counts as an empty page
