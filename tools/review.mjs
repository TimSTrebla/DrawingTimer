// Review tool for the sources. Two modes, both run by .github/workflows/review.yml and published to the `review` branch:
//   node tools/review.mjs discover   search Wikimedia Commons for categories and scanned books by keyword (tools/review.json)
//   node tools/review.mjs sheets     contact sheets (24 thumbnails) of candidate sets and of existing sets, to judge by eye
// Output goes to out/: discovery.md, or README.md plus one JPEG per set.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const here = new URL(".", import.meta.url);
const cfg = JSON.parse(readFileSync(new URL("review.json", here), "utf8"));
const mode = process.argv[2] || "sheets";
const outDir = new URL("../out/", here); mkdirSync(outDir, { recursive: true });
const UA = "drawing-reference-review/1.0 (automated, low volume)";   // a generic client name: no account or project details
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = s => s.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function commons(params) {
  const u = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params });
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA } });
      if (r.status === 429 && k < 5) { await sleep(1000 * Math.min(120, +(r.headers.get("retry-after") || 0) || 30 * (k + 1))); continue; }   // the search API is rate-limited: wait as told
      if (!r.ok) throw new Error("HTTP " + r.status); return await r.json();
    } catch (e) { if (k >= 2) throw e; await sleep(1500 * (k + 1)); }
  }
}
const PACE = 3500;   // ms between searches; faster than this and Commons answers 429

async function discover() {
  const lines = [`# Commons discovery · ${new Date().toISOString().slice(0, 16)}`, "", "Categories by keyword: files · subcategories · title, in search order."];
  for (const kw of cfg.searches || []) {
    lines.push("", `## ${kw}`);
    try {
      const r = await commons({ generator: "search", gsrnamespace: "14", gsrlimit: "20", gsrsearch: kw, prop: "categoryinfo" });
      const pages = ((r.query && r.query.pages) || []).sort((a, b) => a.index - b.index);
      if (!pages.length) lines.push("(nothing)");
      for (const p of pages) { const c = p.categoryinfo || {}; lines.push(`${String(c.files ?? "?").padStart(5)} ${String(c.subcats ?? "?").padStart(4)}  ${p.title}`); }
    } catch (e) { lines.push(`(failed: ${e.message})`); }
    await sleep(PACE);
  }
  lines.push("", "# Subcategories: files · subcategories · title");
  for (const title of cfg.trees || []) {
    lines.push("", `## ${title}`);
    try {
      const r = await commons({ generator: "categorymembers", gcmtitle: title, gcmtype: "subcat", gcmlimit: "200", prop: "categoryinfo" });
      const pages = ((r.query && r.query.pages) || []).sort((a, b) => a.title.localeCompare(b.title));
      if (!pages.length) lines.push("(no subcategories, or no such category)");
      for (const p of pages) { const c = p.categoryinfo || {}; lines.push(`${String(c.files ?? "?").padStart(5)} ${String(c.subcats ?? "?").padStart(4)}  ${p.title}`); }
    } catch (e) { lines.push(`(failed: ${e.message})`); }
    await sleep(500);
  }
  lines.push("", "# Scanned books (PDF / DjVu): pages · file");
  for (const kw of cfg.books || []) {
    lines.push("", `## ${kw}`);
    let any = false;
    try {
      const r = await commons({ generator: "search", gsrnamespace: "6", gsrlimit: "10", gsrsearch: `${kw} filetype:office`, prop: "imageinfo", iiprop: "size" });   // office = PDF and DjVu
      for (const p of ((r.query && r.query.pages) || []).sort((a, b) => a.index - b.index)) { any = true; lines.push(`${String((p.imageinfo && p.imageinfo[0] && p.imageinfo[0].pagecount) ?? "?").padStart(5)}  ${p.title}`); }
    } catch (e) { any = true; lines.push(`(failed: ${e.message})`); }
    await sleep(PACE);
    if (!any) lines.push("(nothing)");
  }
  writeFileSync(new URL("discovery.md", outDir), lines.join("\n") + "\n");
  console.log(`discovery: ${(cfg.searches || []).length} category searches, ${(cfg.trees || []).length} trees, ${(cfg.books || []).length} book searches, ${lines.filter(l => /^\(failed/.test(l)).length} failed → out/discovery.md`);
}

// Smaller versions of the images the app would show, for the contact sheets.
// Commons hands out the original when a file is narrower than the width asked for; a sheet of 24 originals gets
// throttled, so a 500 px thumbnail address is built for those too.
const thumb = u => {
  u = String(u).replace(/\?utm_source=.*$/, "");
  const m = u.match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?]+)$/);
  if (m) return `https://thumb.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${m[3]}/500px-${m[3]}`;
  return u.replace(/\/(\d+)px-/, (x, w) => +w > 500 ? "/500px-" : x).replace(/\/full\/\d+,\//, "/full/400,/").replace(/([?&]width=)\d+/, "$1500");
};
const sample = (a, n) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };

async function sheets() {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const html = readFileSync(new URL("../index.html", here), "utf8");
  let snap = { sets: {} }; try { snap = JSON.parse(readFileSync(new URL("../sets.json", here), "utf8")); } catch {}
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1560, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.error("page error:", e.message));
  await page.route("http://localhost:8123/", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("http://localhost:8123/sets.json", r => r.fulfill({ status: 404, body: "" }));
  await page.route("https://api.artic.edu/**", async r => {   // no CORS answer for browsers; see tools/snapshot.mjs
    try { const res = await fetch(r.request().url(), { headers: { "User-Agent": UA, "AIC-User-Agent": UA, "Accept": "application/json" } });
      r.fulfill({ status: res.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: await res.text() }); }
    catch (e) { r.fulfill({ status: 502, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" }); }
  });
  // The Art Institute turns headless browsers away for images as well; fetch those outside the browser too.
  await ctx.route("https://www.artic.edu/iiif/**", async r => {
    try { const res = await fetch(r.request().url(), { headers: { "User-Agent": UA, "AIC-User-Agent": UA } });
      r.fulfill({ status: res.status, contentType: res.headers.get("content-type") || "image/jpeg", body: Buffer.from(await res.arrayBuffer()) }); }
    catch { r.fulfill({ status: 502, body: "" }); }
  });
  await page.goto("http://localhost:8123/");
  const defs = await page.evaluate(() => window.schetsklok.CONFIG.sets.map(s => ({ name: s.name, cat: s.cat, source: s.source, query: String(s.query), level: s.level })));
  const ex = cfg.existing ? new RegExp(cfg.existing, "i") : null;
  const jobs = [...(cfg.candidates || []).map(c => ({ ...c, candidate: true })), ...defs.filter(d => ex && (ex.test(d.cat) || ex.test(d.name))).map(d => ({ ...d, candidate: false }))];
  const md = [`# Review · ${new Date().toISOString().slice(0, 16)}`, "", "Contact sheets: 24 random images per set, as the app would get them. Candidates are not in the app yet.", "",
    "| set | kind | source | images | thumbnails loaded |", "|---|---|---|---|---|"], body = [];
  for (const job of jobs) {
    let items = [], err = "";
    if (!job.candidate && snap.sets[job.name]) items = snap.sets[job.name].items;
    else try { items = await page.evaluate(set => window.schetsklok.probe(set), job); } catch (e) { err = String(e.message || e).split("\n")[0]; }
    const pick = sample(items, 24), file = slug(job.name) + ".jpg";
    let loaded = 0;
    if (pick.length) {
      const sheet = await ctx.newPage();
      await sheet.setContent(`<body style="margin:0;background:#16171a;color:#e9e6df;font:14px system-ui,sans-serif;width:1560px">
        <div style="padding:10px 12px 0"><b style="font-size:20px">${esc(job.name)}</b> · ${items.length} images · ${esc(job.source)} · ${job.candidate ? "candidate" : "in the app"}<br><span style="color:#9a978f;font-size:12px">${esc(String(job.query).slice(0, 180))}</span></div>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:10px 12px">${pick.map(it => `<figure style="margin:0;min-width:0"><div style="height:250px;background:#000;display:grid;place-items:center"><img src="${esc(thumb(it.url))}" style="max-width:100%;max-height:250px"></div><figcaption style="font-size:11px;line-height:1.25;color:#9a978f;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(it.title)}</figcaption></figure>`).join("")}</div></body>`, { waitUntil: "domcontentloaded" });
      const settle = () => sheet.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 60000 }).catch(() => {});
      await settle();
      for (let round = 0; round < 3; round++) {   // throttled thumbnails: wait, then ask again for the ones that failed
        const failed = await sheet.evaluate(() => [...document.images].filter(i => !(i.naturalWidth > 1)).length);
        if (!failed) break;
        await sleep(6000 * (round + 1));
        await sheet.evaluate(() => { for (const i of document.images) if (!(i.naturalWidth > 1)) { const u = i.src; i.src = ""; i.src = u; } });
        await settle();
      }
      loaded = await sheet.evaluate(() => [...document.images].filter(i => i.naturalWidth > 1).length);
      await sheet.screenshot({ path: new URL(file, outDir).pathname, fullPage: true, type: "jpeg", quality: 72 });
      await sheet.close();
    }
    console.log(`${String(items.length).padStart(4)}  ${String(loaded).padStart(2)}/${String(pick.length).padStart(2)} thumbs  ${job.candidate ? "candidate" : "existing "}  ${job.name}${err ? "  — " + err : ""}`);
    md.push(`| ${job.name} | ${job.candidate ? "candidate" : "in the app"} | ${job.source} | ${items.length}${err ? " (" + err + ")" : ""} | ${loaded}/${pick.length} |`);
    body.push("", `## ${job.name}`, "", `${items.length} images · \`${String(job.query).slice(0, 140)}\`${job.note ? " · " + job.note : ""}`, "", pick.length ? `![${job.name}](${file})` : "_nothing found_", "",
      pick.slice(0, 8).map(it => `- ${it.title}${it.maker ? " — " + it.maker : ""}${it.year ? ", " + it.year : ""} · ${it.licence}`).join("\n"));
    await sleep(400);
  }
  await browser.close();
  writeFileSync(new URL("README.md", outDir), md.concat(body).join("\n") + "\n");
}

await (mode === "discover" ? discover() : sheets());
