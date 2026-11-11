// Headless test of index.html against mocked APIs (AIC + Wikimedia Commons).
// Run: node test/schetsklok.test.mjs   (needs Playwright)
// Proves: filters, one-plate-per-subcategory, session building (short = simple, long = complex),
// and that a whole "Build-up · 30 min" runs without an empty image, even when ~30% of images fail to load.
// Env: BROKEN=0.6 (share of images that deliberately fail) · SHOTS=dir · DSF=2 (screenshot scale).
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright"); // also works with a globally installed Playwright
const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const out = process.env.SHOTS || join(here, "shots"); mkdirSync(out, { recursive: true });
const BROKEN_RATE = +(process.env.BROKEN || 0.3);
const fails = []; const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fails.push(msg); };

// ---------- mocked Commons ----------
let pid = 1000;
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const broken = key => (hash(key) % 1000) / 1000 < BROKEN_RATE;
function file(cat, n, opt = {}) {
  const id = ++pid, name = `${cat.replace(/\W+/g, "_")}_${n}${opt.ext || ".jpg"}`;
  const bad = broken(name) ? "BROKEN_" : "";
  const thumb = opt.tif ? `https://upload.wikimedia.org/x/${name}` : `https://upload.wikimedia.org/thumb/${bad}${name}/1280px-${name}${opt.ext === ".tif" ? ".jpg" : ""}`;
  return { pageid: id, ns: 6, title: "File:" + name, imageinfo: [{
    thumburl: thumb, url: `https://upload.wikimedia.org/${name}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`,
    mime: opt.mime || "image/jpeg",
    extmetadata: {
      ObjectName: { value: `Plate ${n} of ${cat}` },
      Artist: { value: `<a href="//commons.wikimedia.org/wiki/Gustave_Dor%C3%A9">Gustave Doré</a>` },
      DateTimeOriginal: { value: "1866" },
      LicenseShortName: { value: opt.lic || "Public domain" } } }] };
}
const commonsCalls = new Map();
const commonsMade = {}; // title → files (to check the filters)
function commons(url) {
  const p = new URL(url).searchParams, t = p.get("gcmtitle"), cont = p.get("gcmcontinue");
  commonsCalls.set(t, (commonsCalls.get(t) || 0) + 1);
  const depth = (t.match(/\/sub/g) || []).length;
  let pages = [], next = null;
  if (depth === 0) {
    if (!cont) {
      pages = Array.from({ length: 40 }, (_, i) => file(t, i));
      pages.push(file(t, "svg", { mime: "image/svg+xml", ext: ".svg" }), file(t, "bysa", { lic: "CC BY-SA 4.0" }), file(t, "tif", { mime: "image/tiff", ext: ".tif", tif: true }));
      pages.push(...[1, 2, 3].map(k => ({ pageid: ++pid, ns: 14, title: `${t}/sub${k}` })));
      next = { gcmcontinue: "page2", continue: "gcmcontinue||" };
    } else pages = Array.from({ length: 20 }, (_, i) => file(t, 40 + i));
  } else if (depth === 1) {
    const k = +t.slice(-1), n = { 1: 4, 2: 10, 3: 3 }[k];
    pages = Array.from({ length: n }, (_, i) => file(t, i));
    if (k === 1) pages.push({ pageid: ++pid, ns: 14, title: `${t}/sub9` });
  } else pages = [file(t, 0), file(t, 1)];
  commonsMade[t] = (commonsMade[t] || []).concat(pages.filter(x => x.ns === 6));
  return { batchcomplete: true, ...(next ? { continue: next } : {}), query: { pages } };
}

// ---------- mocked Art Institute of Chicago ----------
const aicMade = [];
function aic(url) {
  const p = new URL(url).searchParams, page = +p.get("page"), q = p.get("q");
  const base = (q.includes("red") ? 50 : 0) + (page - 1) * 100;   // the two sets partly overlap → de-duplication
  const data = Array.from({ length: 100 }, (_, k) => {
    const i = base + k, id = 9000 + i;
    const a = { id, title: `Figure study ${i}`, artist_title: "Jean-Antoine Watteau", artist_display: "Jean-Antoine Watteau\nFrench, 1684–1721",
      date_display: "c. 1715", image_id: `img-${id}`, is_public_domain: true, classification_title: "drawing",
      artwork_type_title: "Drawing and Watercolor", medium_display: "Red and black chalk on cream laid paper" };
    if (i % 5 === 0) { a.artwork_type_title = "Print"; a.classification_title = "etching"; a.medium_display = "Etching on paper"; }
    if (i % 7 === 0) a.title = "Landscape with Trees";
    if (i % 11 === 0) a.image_id = null;
    if (i % 13 === 0) a.medium_display = "Graphite on paper";
    if (a.image_id && broken(a.image_id)) a.image_id = "bad-" + a.image_id;
    return a;
  });
  aicMade.push(...data);
  return { pagination: { total: 200, limit: 100, total_pages: 2, current_page: page }, data, config: { iiif_url: "https://www.artic.edu/iiif/2" } };
}

// ---------- test images ----------
const browser = await chromium.launch();
const mk = await browser.newPage();
async function pic(w, h, hue) {
  await mk.setViewportSize({ width: w, height: h });
  await mk.setContent(`<body style="margin:0;background:hsl(${hue} 25% 80%)"><svg width="${w}" height="${h}"><ellipse cx="${w/2}" cy="${h*0.25}" rx="${w*0.08}" ry="${h*0.08}" fill="#5a3326"/><path d="M${w/2} ${h*0.33} L${w*0.4} ${h*0.7} M${w/2} ${h*0.33} L${w*0.62} ${h*0.68} M${w/2} ${h*0.33} L${w/2} ${h*0.55} L${w*0.42} ${h*0.9} M${w/2} ${h*0.55} L${w*0.6} ${h*0.9}" stroke="#5a3326" stroke-width="${w*0.03}" stroke-linecap="round" fill="none"/><text x="20" y="40" font-size="28" font-family="sans-serif" fill="#333">test image</text></svg></body>`);
  return mk.screenshot({ type: "jpeg", quality: 80 });
}
const PICS = [await pic(600, 800, 20), await pic(900, 620, 200), await pic(700, 700, 90)];
await mk.close();

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: +(process.env.DSF || 1), hasTouch: true });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:8123" });
const page = await ctx.newPage();
const errors = [], expected404 = [], unknown = [];
page.on("console", m => { if (m.type() === "error") (/404/.test(m.text()) ? expected404 : errors).push(m.text()); });
page.on("pageerror", e => errors.push("pageerror: " + e.message));
let imgOk = 0, imgBad = 0;
await page.route("**/*", route => {
  const u = route.request().url();
  if (u === "http://localhost:8123/") return route.fulfill({ contentType: "text/html", body: html });
  if (u.startsWith("https://fonts.googleapis.com/")) return route.fulfill({ contentType: "text/css", body: "" });
  if (u.startsWith("https://commons.wikimedia.org/w/api.php")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(commons(u)) });
  if (u.startsWith("https://api.artic.edu/api/v1/artworks/search")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(aic(u)) });
  if (u.startsWith("https://upload.wikimedia.org/") || u.startsWith("https://www.artic.edu/iiif/")) {
    if (/BROKEN_|\/bad-/.test(u)) { imgBad++; return route.fulfill({ status: 404, body: "" }); }
    imgOk++; return route.fulfill({ contentType: "image/jpeg", body: PICS[hash(u) % 3] });
  }
  unknown.push(u); return route.abort();
});

await page.clock.install({ time: new Date("2026-11-11T10:00:00") });
await page.goto("http://localhost:8123/");
await page.waitForFunction(() => window.schetsklok.sets.every(s => ["ok", "error", "empty"].includes(s.status)), null, { timeout: 15000 });

console.log("\n1 · Sources and filters");
const info = await page.evaluate(() => window.schetsklok.sets.map(s => ({ name: s.set.name, status: s.status, n: s.items.length, items: s.items })));
for (const s of info) check(s.status === "ok" && s.n > 0, `${s.name}: ${s.status}, ${s.n} images`);
const all = info.flatMap(s => s.items);
check(!all.some(x => /svg|bysa|tif/i.test(x.title + x.url)), "no SVG, no CC BY-SA, no TIFF in the pot");
check(all.every(x => x.title && x.maker && x.year && /^https:\/\//.test(x.link) && x.source), "every image has title, maker, year, source link");
check(all.filter(x => x.source === "Wikimedia Commons").every(x => x.maker === "Gustave Doré"), "HTML in the Commons maker field became plain text");
const aicIds = new Set(all.filter(x => x.source === "Art Institute of Chicago").map(x => +x.id.slice(1)));
const aicBad = aicMade.filter(a => aicIds.has(a.id) && (a.artwork_type_title === "Print" || /Landscape/.test(a.title) || !a.image_id || /Graphite/.test(a.medium_display)));
check(aicBad.length === 0, `AIC filter: no prints, landscapes, imageless or graphite works (${aicIds.size} passed the filter)`);
const only = t => all.filter(x => x.title.endsWith(" of " + t)).length;   // excluding its own subcategories
const keptFromSub1 = Object.keys(commonsMade).filter(t => /\/sub1$/.test(t)).map(only);
check(keptFromSub1.every(n => n <= 1), `small subcategory (4 scans) yields at most 1 image: ${keptFromSub1.join(",")}`);
const sub2 = Object.keys(commonsMade).filter(t => /\/sub2$/.test(t)).map(only);
check(sub2.some(n => n > 1), `larger subcategory (10) stays whole: ${sub2.join(",")}`);
const calls = Math.max(...[...commonsCalls.entries()].filter(([t]) => !t.includes("/")).map(([t]) => [...commonsCalls.entries()].filter(([u]) => u.startsWith(t)).reduce((a, [, n]) => a + n, 0)));
check(calls <= 16, `at most ${calls} Commons calls per set (limit 16)`);
const pot = await page.evaluate(() => window.schetsklok.pool().length);
check(pot < all.length, `AIC sets de-duplicated: pot ${pot} < ${all.length} separately`);
await page.screenshot({ path: join(out, "1-settings.png"), fullPage: true });

console.log("\n2 · Build-up · 30 min with Engraving + Drawing");
const cats = await page.$$eval(".cat", els => els.map(e => ({ k: e.dataset.cat, on: e.querySelector("input").checked })));
check(cats.find(c => c.k === "engraving")?.on && cats.find(c => c.k === "drawing")?.on, "Engraving and Drawing are on by default");
await page.click('[data-plan="buildup"]');
check(await page.isEnabled("#startBtn"), "start button enabled");
await page.click("#startBtn");
let shot = false, breaks = 0, overlayWhileReady = 0;
for (let k = 0; k < 4000; k++) {
  const st = await page.evaluate(() => { const S = window.schetsklok.session(); return S && { over: S.over, ready: S.ready, i: S.i, brk: !document.getElementById("brk").hidden, load: !document.getElementById("loading").hidden }; });
  if (!st || st.over) break;
  if (st.ready && st.load) overlayWhileReady++;
  if (st.brk) { breaks++; await page.click("#brkGo"); continue; }
  if (!st.ready) { await page.waitForTimeout(20); continue; }
  if (!shot && st.i === 13) { await page.waitForTimeout(100); await page.screenshot({ path: join(out, "2-session-engraving.png") }); shot = true; }
  await page.clock.runFor(2000);
}
const S = await page.evaluate(() => { const S = window.schetsklok.session(); return { over: S.over, log: S.log, swaps: S.swaps.length, slots: S.slots.map(s => ({ dur: s.dur, d: s.it.d, ck: s.it.ck, url: s.it.url })) }; });
check(S.over, "session ran to the end screen");
check(S.log.length === 15, `15 poses shown (${S.log.length})`);
check(S.log.every(l => l.w > 1 && l.h > 1), "every image shown had real dimensions (no empty image)");
check(!S.slots.some(s => /BROKEN_|\/bad-/.test(s.url)), "no broken image stayed in the session");
const badInSession = imgBad;
if (badInSession) check(S.swaps === badInSession, `every broken image was replaced (${S.swaps} swaps for ${badInSession} × 404)`);
else console.log("  info no broken image hit in this session; the stress run (BROKEN=0.6) covers swapping");
check(breaks === 3, `3 breaks between blocks (${breaks})`);
check(overlayWhileReady === 0, "loading screen never visible while a pose was running");
const lv = S.slots.map(s => s.d).join("");
check(/^1{12}3{3}$/.test(lv), `30 s and 1 min = drawing (n1), 3 and 10 min = engraving (n3): ${lv}`);
await page.screenshot({ path: join(out, "3-done.png") });

console.log("\n3 · Review");
await page.click("#back");
await page.click("#keur summary");
await page.click('[data-set="1"]');
check((await page.$$("#rev figure")).length === 20, "Show 20 shows 20 images");
const before = await page.evaluate(() => window.schetsklok.pool().length);
await page.click("#rev figure:nth-child(2) button");
check(await page.$eval("#rev figure:nth-child(2)", f => f.classList.contains("nee")), "tapped image is rejected");
check(await page.evaluate(() => window.schetsklok.pool().length) === before - 1, "rejected image is out of the pot");
await page.click("#copyVerdict");
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => document.getElementById("verdictOut").value));
check(/Doré · Bible .*20 reviewed, 1 rejected/.test(clip) && /✕ /.test(clip), "verdict names the set, 20 reviewed, 1 rejected with title");
await page.screenshot({ path: join(out, "4-review.png"), fullPage: true });
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sk1:rejected")).length);
check(stored === 1, "rejection stored on the device");

console.log("\n4 · Reload: search results from the cache");
const callsBefore = [...commonsCalls.values()].reduce((a, b) => a + b, 0);
await page.reload();
await page.waitForFunction(() => window.schetsklok.sets.every(s => s.status === "ok"));
check([...commonsCalls.values()].reduce((a, b) => a + b, 0) === callsBefore, "second visit: no new Commons calls");

console.log(`\nconsole errors: ${errors.length}${errors.length ? "\n  " + errors.join("\n  ") : ""}`);
console.log(`deliberately broken images (404 in console, expected): ${expected404.length}`);
check(errors.length === 0, "0 console errors (apart from the deliberate 404s)");
check(unknown.length === 0, `no unexpected network requests${unknown.length ? ": " + unknown.join(", ") : ""}`);
console.log(`\n${fails.length ? fails.length + " FAILED" : "ALL GREEN"} · images loaded ${imgOk}, refused ${imgBad} · screenshots in ${out}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
