# DrawingTimer (Schetsklok)

**Live:** https://timstrebla.github.io/DrawingTimer/

Timed drawing practice set up like an academy course. In a class session the poses grow longer (30 s → 45 min)
and the images grow with them from simple (n1) to complex (n3). One static file, `index.html`: no build step,
no backend, no API keys.

| Group | Categories |
|---|---|
| Foundations | Bargue & casts · Anatomy (Albinus, Vesalius, Leonardo) · Hands & feet · Heads · Drapery |
| Figure | Gesture & motion (Muybridge) · Figure studies (chalk, sanguine) · Life drawing (académies) |
| Masters & media | Engraving & etching (Doré, Dürer, Rembrandt, Goya) · Japanese woodblock · Pastel · Oil: head & figure · Sculpture |
| Composition | Great scenes (history, myth, bible) |
| Colour & modern | Colour & light · Impressionism · Expressionism (incl. Schiele) · Abstraction (Kandinsky, af Klint) |

Sessions: Gesture sprint · Build-up 30 min · Class 1 hour · Thumbnails 12 × 2 min · Long study 3 × 20 min ·
Master copy 1 × 45 min · Free. Keys: space pause · ← → previous/next · G greyscale · F mirror · R grid · Esc stop.
Your choices (categories, plan, options) are remembered on the device.

## Sources and licences
- **Wikimedia Commons**: fixed categories; public domain, CC0 or CC BY (e.g. the Wellcome Collection's anatomy scans).
- **Art Institute of Chicago**: searches, public domain only.
- **Cleveland Museum of Art**: searches, CC0 only.

Every image shows title, maker, year, licence and a link to its source page. CC BY-SA, NC and ND are never used.
Set `licences: "pd"` in `CONFIG` to allow public domain / CC0 only. Code and documentation: [MIT](LICENSE).

## Edit the course
Everything lives in the `CONFIG` object at the top of the script in `index.html`.
- **categories**: name, group, default level, one-line "what it trains", and keywords for your own folders.
- **sets**: `{cat, name, source: "commons" | "aic" | "cma", query, level}` plus optional filters (regular expressions):
  `type` (AIC artwork type; for Cleveland one of Painting/Drawing/Print/Sculpture), `medium`, `style` (AIC, soft:
  ignored when fewer than 12 works match), `exclude` (title words), `calls` (Commons API budget, default 16).
  Commons sets always drop blank pages, covers, title pages and book initials; a small subcategory (≤ 6 files) is
  usually one work in several scans, so only one of them goes into the pot.

Only the sets of ticked categories are loaded; results are cached on the device for 72 hours.

## Review
*Review sources · 20 per set* shows a sample per search set. Tap an image to reject it (it stays out of sessions on
that device). *Copy verdict* produces a text you can feed back to improve the search set itself. *Load all sets*
fetches every set for a full review.

## Your own folder
Subfolder = category (Anatomy, Hands, Pastel, AI, …; Dutch names work too), `n1`/`n2`/`n3` in a folder or file name
= level. Keywords match at the start of a word ("ets" → "Etsen", not "Schetsen"); `~` matches anywhere
("~tekening" → "Krijttekeningen"). The images never leave the device.

## Test
`node test/schetsklok.test.mjs` (needs Playwright). Runs against mocked APIs: filters and licences, lazy loading,
the soft style filter, folder keywords, remembered choices, and a full "Build-up · 30 min" without an empty image,
even when 30% of images fail to load (`BROKEN=0.6` for the stress run). The real APIs are deliberately not used in
the test; the quality of their results is reviewed by hand.
