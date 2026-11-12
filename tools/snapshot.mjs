// Snapshot of every search set, for a quick first visit.
// Opens index.html headless, lets the page itself fetch every set from the real APIs (so there is exactly one
// implementation of the sources), and writes sets.json next to index.html. Run weekly by .github/workflows/snapshot.yml.
// Run by hand: node tools/snapshot.mjs   (needs Playwright with Chromium)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const outFile = new URL("../sets.json", import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", e => console.error("page error:", e.message));
await page.route("http://localhost:8123/", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("http://localhost:8123/sets.json", r => r.fulfill({ status: 404, body: "" }));   // start from nothing, not from the old snapshot
await page.goto("http://localhost:8123/");
await page.evaluate(() => window.schetsklok.loadAll());
await page.waitForFunction(() => window.schetsklok.sets.every(s => ["ok", "error", "empty"].includes(s.status)), null, { timeout: 15 * 60 * 1000 });

const rows = await page.evaluate(() => window.schetsklok.sets.map(s => ({ status: s.status, n: s.items.length, name: s.set.name, err: s.err })));
for (const r of rows) console.log(`${r.status.padEnd(6)} ${String(r.n).padStart(4)}  ${r.name}${r.err ? "  — " + r.err : ""}`);
const bad = rows.filter(r => r.status !== "ok");
console.log(`\n${rows.length - bad.length} of ${rows.length} sets ok, ${rows.reduce((a, r) => a + r.n, 0)} images` + (bad.length ? `; not in the snapshot: ${bad.map(r => r.name).join(", ")}` : ""));

const snap = await page.evaluate(() => window.schetsklok.snapshot());
await browser.close();
if (Object.keys(snap.sets).length < rows.length / 2) { console.error("fewer than half the sets loaded; keeping the old snapshot"); process.exit(1); }
writeFileSync(outFile, JSON.stringify(snap));
console.log(`wrote ${outFile.pathname} (${(JSON.stringify(snap).length / 1e6).toFixed(1)} MB)`);
