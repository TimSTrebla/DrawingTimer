// Headless test of index.html against mocked APIs (Wikimedia Commons, Wikidata, AIC, Cleveland Museum of Art).
// Run: node test/schetsklok.test.mjs   (needs Playwright)
// Proves: defaults, filters and licences, one-work-per-subcategory, lazy loading per category, the soft style
// filter, complexity scores, session building (short = simple, long = complex), full screen on start, and that
// a whole "Build-up" runs without an empty image, even when ~30% of images fail to load.
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

const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const broken = key => (hash(key) % 1000) / 1000 < BROKEN_RATE;
const calls = { commons: new Map(), wikidata: [], aic: [], cma: [] };

// ---------- mocked Commons ----------
let pid = 1000;
function file(cat, n, opt = {}) {
  const id = ++pid, name = `${cat.replace(/\W+/g, "_")}_${n}${opt.ext || ".jpg"}`;
  const bad = broken(name) ? "BROKEN_" : "";
  const thumb = opt.tif ? `https://upload.wikimedia.org/x/${name}` : `https://upload.wikimedia.org/thumb/${bad}${name}/1280px-${name}${opt.ext === ".tif" ? ".jpg" : ""}`;
  return { pageid: id, ns: 6, title: "File:" + name, imageinfo: [{
    thumburl: thumb, url: `https://upload.wikimedia.org/${name}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`,
    mime: opt.mime || "image/jpeg",
    extmetadata: {
      ObjectName: { value: opt.title || `Plate ${n} of ${cat}` },
      Artist: { value: `<a href="//commons.wikimedia.org/wiki/Gustave_Dor%C3%A9">Gustave Doré</a>` },
      DateTimeOriginal: { value: "1866" },
      LicenseShortName: { value: opt.lic || "Public domain" } } }] };
}
const commonsMade = {};
function commons(url) {
  const p = new URL(url).searchParams, t = p.get("gcmtitle"), cont = p.get("gcmcontinue");
  calls.commons.set(t, (calls.commons.get(t) || 0) + 1);
  const depth = (t.match(/\/sub/g) || []).length;
  let pages = [], next = null;
  if (depth === 0) {
    if (!cont) {
      pages = Array.from({ length: 40 }, (_, i) => file(t, i));
      pages.push(file(t, "svg", { mime: "image/svg+xml", ext: ".svg" }), file(t, "bysa", { lic: "CC BY-SA 4.0" }), file(t, "tif", { mime: "image/tiff", ext: ".tif", tif: true }),
                 file(t, "ccby", { lic: "CC BY 4.0" }), file(t, "blank", { title: "Folio 003r blank" }));
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

// ---------- mocked Wikidata SPARQL ----------
function wikidata(url) {
  const q = new URL(url).searchParams.get("query");
  const rijks = /Q190804/.test(q); calls.wikidata.push(rijks ? "rijks" : "famous");
  const bindings = [];
  for (let i = 0; i < 60; i++) {
    const qid = (rijks ? 700000 : 800000) + i, name = `${rijks ? "Rijks" : "Master"}_painting_${i}${i % 9 === 0 ? ".tif" : ".jpg"}`;
    bindings.push({ item: { value: `http://www.wikidata.org/entity/Q${qid}` }, itemLabel: { value: i % 11 === 0 ? `Q${qid}` : i === 3 ? "The Night Watch" : `Painting ${i}` },
      creatorLabel: { value: rijks ? "Rembrandt" : "Johannes Vermeer" }, image: { value: `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}` },
      year: { value: String(1600 + i) }, links: { value: String(200 - i) } });
    if (i % 7 === 0) bindings.push({ ...bindings[bindings.length - 1] });   // duplicate row (second image or creator)
  }
  return { results: { bindings } };
}

// ---------- mocked Art Institute of Chicago: kind of record follows the query ----------
const aicMade = [];
function aic(url) {
  const p = new URL(url).searchParams, page = +p.get("page"), q = p.get("q");
  calls.aic.push(q);
  const KINDS = [["Drawing and Watercolor", "Red and black chalk on cream laid paper"], ["Drawing and Watercolor", "Pastel on paper"], ["Print", "Color woodblock print"], ["Painting", "Oil on canvas"], ["Sculpture", "Marble"]];
  const ki = /pastel/.test(q) ? 1 : /hokusai|utamaro|hiroshige/i.test(q) ? 2 : /marble/.test(q) ? 4 : /impression|portrait|figure$|landscape|battle|myth|abstraction|expression|oil sketch/.test(q) ? 3 : 0;
  const kind = KINDS[ki];
  const base = ki * 20000 + (hash(q) % 7) * 37 + (page - 1) * 100;   // queries of one kind overlap partly → de-duplication
  const data = Array.from({ length: 100 }, (_, k) => {
    const i = base + k, id = 9000 + i;
    const a = { id, title: `Study ${i}`, artist_title: "Jean-Antoine Watteau", artist_display: "Jean-Antoine Watteau\nFrench, 1684–1721",
      date_display: "c. 1715", image_id: `img-${id}`, is_public_domain: true, classification_title: kind[0].toLowerCase(),
      artwork_type_title: kind[0], medium_display: kind[1], style_titles: [], subject_titles: [] };
    if (i % 5 === 0) { a.artwork_type_title = "Print"; a.classification_title = "etching"; a.medium_display = "Etching on paper"; }
    if (i % 7 === 0) a.title = "Landscape with Trees";
    if (i % 11 === 0) a.image_id = null;
    if (i % 13 === 0) a.medium_display = "Graphite on paper";
    if (/^impressionism$/.test(q) && i % 2 === 0) a.style_titles = ["Impressionism"];   // abstraction gets no style → soft fallback
    if (a.image_id && broken(a.image_id)) a.image_id = "bad-" + a.image_id;
    return a;
  });
  aicMade.push(...data);
  return { pagination: { total: 200, limit: 100, total_pages: 2, current_page: page }, data, config: { iiif_url: "https://www.artic.edu/iiif/2" } };
}

// ---------- mocked Cleveland Museum of Art ----------
const cmaMade = [];
function cma(url) {
  const p = new URL(url).searchParams, q = p.get("q"), type = p.get("type"), skip = +p.get("skip");
  calls.cma.push(`${q}|${type || ""}`);
  const types = ["Drawing", "Painting", "Print", "Sculpture"];
  let data = Array.from({ length: 100 }, (_, k) => {
    const i = (hash(q) % 5) * 41 + skip + k, id = 50000 + i;
    const a = { id, accession_number: `1920.${i}`, title: `Work ${i}`, creation_date: "1880", creators: [{ description: "Edgar Degas (French, 1834–1917)" }],
      type: types[i % 4], technique: i % 3 ? "pastel on paper" : "black chalk", url: `https://clevelandart.org/art/1920.${i}`, share_license_status: "CC0",
      images: { web: { url: `https://openaccess-cdn.clevelandart.org/1920.${i}/${broken("m" + i) ? "BROKEN_" : ""}1920.${i}_web.jpg` } } };
    if (i % 6 === 0) a.share_license_status = "Copyrighted";
    if (i % 9 === 0) a.images = null;
    return a;
  });
  if (type) data = data.filter(a => a.type === type);
  cmaMade.push(...data);
  return { info: { total: 200 }, data };
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
let imgOk = 0, imgBad = 0; const badUrls = new Set();   // one broken image may be asked for at two sizes
const json = (route, body) => route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
await page.route("**/*", route => {
  const u = route.request().url();
  if (u === "http://localhost:8123/") return route.fulfill({ contentType: "text/html", body: html });
  if (u.startsWith("https://fonts.googleapis.com/")) return route.fulfill({ contentType: "text/css", body: "" });
  if (u.startsWith("https://commons.wikimedia.org/w/api.php")) return json(route, commons(u));
  if (u.startsWith("https://query.wikidata.org/sparql")) return json(route, wikidata(u));
  if (u.startsWith("https://api.artic.edu/api/v1/artworks/search")) return json(route, aic(u));
  if (u.startsWith("https://openaccess-api.clevelandart.org/api/artworks/")) return json(route, cma(u));
  if (/^https:\/\/(upload\.wikimedia\.org|commons\.wikimedia\.org\/wiki\/Special:FilePath|www\.artic\.edu\/iiif|openaccess-cdn\.clevelandart\.org)\//.test(u)) {
    if (/BROKEN_|\/bad-/.test(u)) { badUrls.add(u.replace(/\/full\/\d+,\//, "/full/W,/")); imgBad = badUrls.size; return route.fulfill({ status: 404, body: "" }); }
    imgOk++; return route.fulfill({ contentType: "image/jpeg", body: PICS[hash(u) % 3] });
  }
  unknown.push(u); return route.abort();
});
const settled = cats => page.waitForFunction(cs => window.schetsklok.sets.filter(s => cs.includes(s.set.cat)).every(s => ["ok", "error", "empty"].includes(s.status)), cats, { timeout: 30000 });
const setsOf = cats => page.evaluate(cs => window.schetsklok.sets.filter(s => cs.includes(s.set.cat)).map(s => ({ name: s.set.name, cat: s.set.cat, source: s.set.source, status: s.status, n: s.items.length, items: s.items })), cats);
const pressed = () => page.$$eval(".chip[data-cat]", els => els.filter(e => e.getAttribute("aria-pressed") === "true").map(e => e.dataset.cat));

await page.clock.install({ time: new Date("2026-11-12T10:00:00") });
await page.goto("http://localhost:8123/");

console.log("\n1 · First visit: nothing ticked, nothing loaded; ticking loads");
const catKeys = await page.evaluate(() => Object.keys(window.schetsklok.CONFIG.categories));
let on = await pressed();
check(on.length === 0, `no category ticked on a first visit (${on.length})`);
check(await page.isDisabled("#startBtn") && /tick what to draw/.test(await page.$eval("#sum", e => e.textContent)), "start disabled, with a hint to tick something");
check(await page.evaluate(() => window.schetsklok.sets.every(s => s.status === "idle")), "no set loaded before anything is ticked");
for (const k of catKeys) if (!["colour", "watercolour", "ai"].includes(k)) await page.click(`.chip[data-cat="${k}"]`);
on = await pressed();
check(on.length === catKeys.length - 3, `${on.length} categories ticked for the review`);
await settled(on);
const info = await setsOf(on);
for (const s of info) check(s.status === "ok" && s.n > 0, `${s.name} (${s.source}): ${s.status}, ${s.n} images`);
const idle = await page.evaluate(() => window.schetsklok.sets.filter(s => s.status === "idle").map(s => s.set.cat));
check(idle.length > 0 && idle.every(c => ["colour", "watercolour", "ai"].includes(c)), `lazy loading: only sets of unticked categories untouched (${idle.length})`);
check(await page.isEnabled("#startBtn"), "start button enabled once enough has arrived");
await page.screenshot({ path: join(out, "1-settings.png"), fullPage: true });

console.log("\n2 · Filters, licences, complexity");
const all = info.flatMap(s => s.items);
check(!all.some(x => /svg|bysa|\btif\b/i.test(x.title + x.url)), "no SVG, no CC BY-SA, no TIFF in the pot");
check(all.some(x => x.licence === "CC BY 4.0"), "CC BY 4.0 is accepted, with its licence kept for display");
check(all.every(x => x.title && x.maker && x.year && /^https:\/\//.test(x.link) && x.source && x.licence && typeof x.d === "number"), "every image has title, maker, year, source link, licence, complexity");
check(all.filter(x => x.source === "Wikimedia Commons" && x.id[0] === "c").every(x => x.maker === "Gustave Doré"), "HTML in the Commons maker field became plain text");
const anat = info.filter(s => s.cat === "anatomy").flatMap(s => s.items.filter(x => /blank/i.test(x.title)));
check(!anat.length, "Commons sets drop blank folios and front matter");
const aicIds = new Set(all.filter(x => x.source === "Art Institute of Chicago").map(x => +x.id.slice(1)));
const aicBad = aicMade.filter(a => aicIds.has(a.id) && !a.image_id);
check(aicBad.length === 0 && aicIds.size > 100, `AIC: no imageless works (${aicIds.size} passed)`);
const drawingSets = info.filter(s => s.cat === "drawing" && s.source === "aic").flatMap(s => s.items.map(x => +x.id.slice(1)));
const drawingBad = aicMade.filter(a => drawingSets.includes(a.id) && (a.artwork_type_title === "Print" || /Landscape/.test(a.title) || /Graphite/.test(a.medium_display)));
check(drawingBad.length === 0, `AIC figure studies: no prints, landscapes or graphite works${drawingBad.length ? " — " + drawingBad.slice(0, 3).map(a => `${a.id} ${a.artwork_type_title} / ${a.title} / ${a.medium_display}`).join(" | ") : ""}`);
const cmaIds = new Set(all.filter(x => x.source === "Cleveland Museum of Art").map(x => +x.id.slice(1)));
const cmaBad = cmaMade.filter(a => cmaIds.has(a.id) && (a.share_license_status !== "CC0" || !a.images));
check(cmaIds.size > 0 && cmaBad.length === 0, `Cleveland: only CC0 works with an image (${cmaIds.size} passed)`);
check(all.filter(x => x.source === "Cleveland Museum of Art").every(x => x.maker === "Edgar Degas"), "Cleveland maker without the nationality/dates suffix");
check(calls.cma.some(c => /^pastel\|Drawing$/.test(c)), "Cleveland type filter sent to the server");
const wd = info.filter(s => s.source === "wikidata");
check(wd.length === 2 && wd.every(s => s.n === 48), `Wikidata: duplicates and TIFFs and label-less items dropped (${wd.map(s => s.n).join(", ")} of 60)`);
const rijksItems = wd.find(s => s.cat === "rijks").items;
check(rijksItems.every(x => x.source === "Rijksmuseum · via Wikimedia" && /Special:FilePath\/.*width=1920/.test(x.url) && /commons\.wikimedia\.org\/wiki\/File:/.test(x.link)), "Rijksmuseum items: source label, 1920-wide Commons image, link to the file page");
check(all.filter(x => x.source === "Art Institute of Chicago").every(x => /\/full\/1686,\//.test(x.url)), "AIC images asked for at 1686 px");
check(!info.filter(s => s.cat === "anatomy").some(s => /Vesalius/.test(s.name)), "Vesalius book scans are gone from Anatomy");
const nw = rijksItems.find(x => x.title === "The Night Watch");
check(nw && nw.d === 3, `famous crowded scene scores 3 (Night Watch: ${nw && nw.d})`);
const cx = await page.evaluate(() => { const c = window.schetsklok.complexity; return [c(2, "Study for a figure", "black chalk"), c(2, "Portrait of a man", "oil on canvas"), c(1, "Battle of Anghiari", "pen and ink"), c(3, "Plate 9", "")]; });
check(cx.join() === "1.2,2.2,1.3,3", `complexity nudges: study+chalk 1.2 · oil 2.2 · battle+ink 1.3 · engraving 3 (${cx.join(", ")})`);
const only = t => all.filter(x => x.title.endsWith(" of " + t)).length;
const keptFromSub1 = Object.keys(commonsMade).filter(t => /\/sub1$/.test(t)).map(only);
check(keptFromSub1.every(n => n <= 1), `small subcategory (4 scans) yields at most 1 image: ${keptFromSub1.slice(0, 6).join(",")}…`);
const sub2 = Object.keys(commonsMade).filter(t => /\/sub2$/.test(t)).map(only);
check(sub2.some(n => n > 1), `larger subcategory (10) stays whole: ${sub2.slice(0, 6).join(",")}…`);
const imprIds = info.find(s => s.name === "Impressionism (AIC)").items.map(x => +x.id.slice(1));
check(imprIds.every(id => aicMade.find(a => a.id === id && a.style_titles.includes("Impressionism"))), `style filter used when enough works match (${imprIds.length} Impressionism-tagged)`);
check(info.find(s => s.name === "Abstraction (AIC)").n > 12, "style filter falls back when nothing is tagged (abstraction still has images)");
const folders = await page.evaluate(() => ["Schetsen", "Gravures", "Handen n1", "AI", "Pastel", "Etsen", "Anatomie", "Krijttekeningen", "Beeldhouwwerk", "Rijksmuseum", "Voorstudies"].map(window.schetsklok.catForFolder));
check(folders.join() === "drawing,engraving,hands,ai,pastel,engraving,anatomy,drawing,sculpture,rijks,studies", `own folders land in the right category: ${folders.join(", ")}`);

console.log("\n3 · Build-up with Engraving + Drawing only, full screen");
for (const k of on) if (k !== "drawing" && k !== "engraving") await page.click(`.chip[data-cat="${k}"]`);   // untick the rest
on = await pressed();
check(on.sort().join() === "drawing,engraving", `only Engraving and Drawing ticked (${on.join(", ")})`);
await page.click('[data-plan="buildup"]');
check(await page.$eval('.chip[data-pace="120"]', e => e.getAttribute("aria-pressed")) === "true", "shortest pose is 2 min by default");
check(/^12×2m · 2×3m · 1×10m · /.test(await page.$eval("#planInfo", e => e.textContent)) && await page.$eval('.chip[data-plan="buildup"] small', e => e.textContent) === "40 min", "Build-up at 2 min: 12×2m · 2×3m · 1×10m = 40 min, short blocks merged");
check(await page.$eval('.chip[data-plan="class"] small', e => e.textContent) === "80 min", "Class at 2 min: 80 min");
await page.click('.chip[data-pace="30"]');
check(/^8×30s · 4×1m · 2×3m · 1×10m · /.test(await page.$eval("#planInfo", e => e.textContent)), "at 30 s the plan is as written");
check(await page.isEnabled("#startBtn"), "start button enabled");
await page.click("#startBtn");
await page.waitForFunction(() => window.schetsklok.session()?.ready);
check(await page.evaluate(() => !!document.fullscreenElement), "session runs in full screen");
const fit = await page.evaluate(() => { const v = document.getElementById("view"), p = document.getElementById("pic"), cs = getComputedStyle(v);
  const vw = v.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), vh = v.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  return { pw: p.offsetWidth, ph: p.offsetHeight, vw, vh, nat: document.getElementById("img").naturalWidth }; });
check((Math.abs(fit.pw - fit.vw) <= 1 || Math.abs(fit.ph - fit.vh) <= 1) && fit.pw > fit.nat, `image scaled up to fill the stage (${fit.pw}×${fit.ph} in ${fit.vw}×${fit.vh}, natural ${fit.nat} wide)`);
const gesture = (seq) => page.evaluate(seq => { const v = document.getElementById("view"), r = v.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (const [type, id, dx, dy] of seq) v.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: cx + dx, clientY: cy + dy, bubbles: true, isPrimary: id === 1, pointerType: "touch" }));
  return window.schetsklok.zoom(); }, seq);
let z = await gesture([["pointerdown", 1, -50, 0], ["pointerdown", 2, 50, 0], ["pointermove", 1, -150, 0], ["pointermove", 2, 150, 0], ["pointerup", 1, -150, 0], ["pointerup", 2, 150, 0]]);
check(Math.abs(z.z - 3) < 0.01, `pinch: fingers 100 → 300 px apart zooms 3× (${z.z})`);
z = await gesture([["pointerdown", 1, 0, 0], ["pointermove", 1, -80, -40], ["pointerup", 1, -80, -40]]);
check(z.tx === -80 && z.ty === -40, `drag pans the zoomed image (${z.tx}, ${z.ty})`);
await page.click("#bNext"); await page.waitForFunction(() => window.schetsklok.session()?.ready && window.schetsklok.session().i === 1);
z = await page.evaluate(() => window.schetsklok.zoom());
check(z.z === 1 && z.tx === 0 && z.ty === 0, "next image resets the zoom");
z = await gesture([["pointerdown", 1, 100, 50], ["pointerup", 1, 100, 50], ["pointerdown", 1, 100, 50], ["pointerup", 1, 100, 50]]);
check(z.z === 2.5, `double-tap zooms 2.5× (${z.z})`);
z = await gesture([["pointerdown", 1, 0, 0], ["pointerup", 1, 0, 0], ["pointerdown", 1, 0, 0], ["pointerup", 1, 0, 0]]);
check(z.z === 1, "double-tap again fits the image");
const badBefore = imgBad;
let shot = false, breaks = 0, overlayWhileReady = 0;
for (let k = 0; k < 4000; k++) {
  const st = await page.evaluate(() => { const S = window.schetsklok.session(); return S && { over: S.over, ready: S.ready, i: S.i, brk: !document.getElementById("brk").hidden, load: !document.getElementById("loading").hidden }; });
  if (!st || st.over) break;
  if (st.ready && st.load) overlayWhileReady++;
  if (st.brk) { breaks++; await page.click("#brkGo"); continue; }
  if (!st.ready) { await page.waitForTimeout(20); continue; }
  if (!shot && st.i === 13) { await page.waitForTimeout(100); await page.screenshot({ path: join(out, "3-session.png") }); shot = true; }
  await page.clock.runFor(2000);
}
const S = await page.evaluate(() => { const S = window.schetsklok.session(); return { over: S.over, log: S.log, swaps: S.swaps.length, slots: S.slots.map(s => ({ dur: s.dur, d: s.it.d, ck: s.it.ck, url: s.it.url })) }; });
check(S.over, "session ran to the end screen");
check(S.log.length === 15, `15 poses shown (${S.log.length})`);
check(S.log.every(l => l.w > 1 && l.h > 1), "every image shown had real dimensions (no empty image)");
check(!S.slots.some(s => /BROKEN_|\/bad-/.test(s.url)), "no broken image stayed in the session");
const badInSession = imgBad - badBefore;
if (badInSession) check(S.swaps >= badInSession, `every broken image was replaced (${S.swaps} swaps for ${badInSession} × 404; extra swaps are slow loads)`);
else console.log("  info no broken image hit in this session; the stress run (BROKEN=0.6) covers swapping");
check(breaks === 3, `3 breaks between blocks (${breaks})`);
check(overlayWhileReady === 0, "loading screen never visible while a pose was running");
const lv = S.slots.map(s => Math.round(s.d)).join("");
check(/^1{12}3{3}$/.test(lv), `30 s and 1 min = drawing (~1), 3 and 10 min = engraving (3): ${lv}`);
await page.click("#back");
check(await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 3000 }).then(() => true, () => false), "stop leaves full screen");

console.log("\n4 · Review");
await page.click("#keur summary");
const bible = await page.evaluate(() => window.schetsklok.sets.findIndex(s => s.set.name === "Doré · Bible"));
await page.click(`[data-set="${bible}"]`);
check((await page.$$("#rev figure")).length === 20, "Show 20 shows 20 images, right under its set");
const before = await page.evaluate(() => window.schetsklok.pool().length);
await page.click("#rev figure:nth-child(2) button");
check(await page.$eval("#rev figure:nth-child(2)", f => f.classList.contains("nee")), "tapped image is rejected");
check(await page.evaluate(() => window.schetsklok.pool().length) === before - 1, "rejected image is out of the pot");
await page.click("#copyVerdict");
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => document.getElementById("verdictOut").value));
check(/Doré · Bible .*20 reviewed, 1 rejected/.test(clip) && /✕ /.test(clip) && /not loaded/.test(clip), "verdict names the set, 20 reviewed, 1 rejected, and which sets were not loaded");
await page.screenshot({ path: join(out, "4-review.png"), fullPage: true });
check(await page.evaluate(() => JSON.parse(localStorage.getItem("sk3:rejected")).length) === 1, "rejection stored on the device");

console.log("\n5 · Reload: choices remembered, results from the cache");
await page.click('[data-plan="sketch"]'); await page.click('.chip[data-pace="60"]');
await page.click('.chip[data-cat="hands"]');
await settled(["hands"]);
const total = () => [...calls.commons.values()].reduce((a, b) => a + b, 0) + calls.wikidata.length + calls.aic.length + calls.cma.length;
const callsBefore = total();
await page.reload();
await settled(["drawing", "engraving", "hands"]);
const after = { plan: await page.$eval(".chip[data-plan][aria-pressed=true]", e => e.dataset.plan), cats: (await pressed()).sort() };
check(after.plan === "sketch" && after.cats.join() === "drawing,engraving,hands", `plan and categories remembered (${after.plan}; ${after.cats.join(", ")})`);
check(await page.$eval('.chip[data-pace="60"]', e => e.getAttribute("aria-pressed")) === "true", "shortest pose remembered (1 min)");
check(total() === callsBefore, "second visit: no new API calls");
check(await page.$eval("#planInfo", e => e.textContent).then(t => /^6×1m · 3×3m · 2×5m · 1×20m/.test(t)), "plan breakdown shown under the chips");

console.log(`\nconsole errors: ${errors.length}${errors.length ? "\n  " + errors.join("\n  ") : ""}`);
console.log(`deliberately broken images (404 in console, expected): ${expected404.length}`);
check(errors.length === 0, "0 console errors (apart from the deliberate 404s)");
check(unknown.length === 0, `no unexpected network requests${unknown.length ? ": " + unknown.slice(0, 3).join(", ") : ""}`);
console.log(`\n${fails.length ? fails.length + " FAILED" : "ALL GREEN"} · images loaded ${imgOk}, refused ${imgBad} · screenshots in ${out}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
