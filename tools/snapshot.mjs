// Snapshot of every search set, for a quick first visit.
// Opens index.html headless, lets the page itself fetch every set from the real APIs (so there is exactly one
// implementation of the sources), and writes sets.json next to index.html. Run weekly by .github/workflows/snapshot.yml.
// Run by hand: node tools/snapshot.mjs   (needs Playwright with Chromium)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { UA, thumb, routeOutside, inkOf, BLANK_BELOW } from "./common.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const outFile = new URL("../sets.json", import.meta.url);

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA });
const page = await ctx.newPage();
page.on("pageerror", e => console.error("page error:", e.message));
await page.route("http://localhost:8123/", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("http://localhost:8123/sets.json", r => r.fulfill({ status: 404, body: "" }));   // start from nothing, not from the old snapshot
// The Art Institute gives a browser on a hosted runner no answer, and image hosts throttle it: both go through Node.
await routeOutside(ctx);
await page.goto("http://localhost:8123/");
await page.evaluate(() => window.schetsklok.loadAll(true));   // true: also the sets that exist in the snapshot only
await page.waitForFunction(() => window.schetsklok.sets.every(s => ["ok", "error", "empty"].includes(s.status)), null, { timeout: 15 * 60 * 1000 });

// Scanned books where every second image is an empty page: look at a thumbnail of each image and drop
// the blank ones. If too many thumbnails cannot be read, the set is left out rather than shipped with blanks.
const toScreen = await page.evaluate(() => window.schetsklok.sets.filter(s => s.set.screen === "blank" && s.status === "ok").map(s => ({ name: s.set.name, items: s.items.map(i => ({ id: i.id, url: i.url })) })));
for (const set of toScreen) {
  const scores = await page.evaluate(async ([urls, ink]) => { const f = eval(ink), out = [];
    for (const u of urls) out.push(await new Promise(res => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(f(im)); im.onerror = () => res(null); im.src = u; }));
    return out; }, [set.items.map(i => thumb(i.url, 500)), inkOf]);   // the size the review sheets use, so their printed score is this score
  const unread = scores.filter(v => v == null).length, blank = set.items.filter((it, k) => scores[k] != null && scores[k] < BLANK_BELOW).map(it => it.id);
  const verdict = unread > set.items.length * 0.2 ? "unreadable" : "ok";
  await page.evaluate(([name, blank, verdict]) => { const st = window.schetsklok.sets.find(s => s.set.name === name);
    if (verdict !== "ok") { st.status = "error"; st.err = "could not look at the images"; st.items = []; } else st.items = st.items.filter(i => !blank.includes(i.id)); }, [set.name, blank, verdict]);
  console.log(`screen  ${String(blank.length).padStart(4)}  ${set.name}: blank pages dropped of ${set.items.length}${unread ? `, ${unread} unread` : ""}${verdict !== "ok" ? " — set left out" : ""}`);
}

const rows = await page.evaluate(() => window.schetsklok.sets.map(s => ({ status: s.status, n: s.items.length, name: s.set.name, err: s.err })));
for (const r of rows) console.log(`${r.status.padEnd(6)} ${String(r.n).padStart(4)}  ${r.name}${r.err ? "  — " + r.err : ""}`);
for (const r of rows.filter(r => r.status === "ok" && r.n < 30)) console.log(`thin    ${String(r.n).padStart(4)}  ${r.name}: raise its calls or widen the search`);
const bad = rows.filter(r => r.status !== "ok");
console.log(`\n${rows.length - bad.length} of ${rows.length} sets ok, ${rows.reduce((a, r) => a + r.n, 0)} images` + (bad.length ? `; not in the snapshot: ${bad.map(r => r.name).join(", ")}` : ""));

const snap = await page.evaluate(() => window.schetsklok.snapshot());
// A set that failed this time keeps the previous snapshot's entry, as long as its definition is unchanged.
let old = null; try { old = JSON.parse(readFileSync(outFile, "utf8")); } catch {}
const keys = await page.evaluate(() => Object.fromEntries(window.schetsklok.sets.map(s => [s.set.name, window.schetsklok.keyOf(s.set)])));
for (const r of rows) if (r.status !== "ok" && old && old.sets && old.sets[r.name] && old.sets[r.name].k === keys[r.name]) {
  snap.sets[r.name] = old.sets[r.name]; console.log(`kept    ${String(old.sets[r.name].items.length).padStart(4)}  ${r.name} — from the previous snapshot`);
}
await browser.close();
if (Object.keys(snap.sets).length < rows.length / 2) { console.error("fewer than half the sets loaded; keeping the old snapshot"); process.exit(1); }
writeFileSync(outFile, JSON.stringify(snap));
console.log(`wrote ${outFile.pathname} (${(JSON.stringify(snap).length / 1e6).toFixed(1)} MB)`);
