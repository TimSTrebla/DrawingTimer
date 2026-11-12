# DrawingTimer (Schetsklok)

**Live:** https://timstrebla.github.io/DrawingTimer/

Timed drawing from the masters, set up like an academy course. Short poses get sketches and studies, long ones the
finished work. One static file, `index.html`: no build step, no backend, no API keys. Starting a session goes full
screen and the screen stays awake. Every image is scaled to fill the stage; pinch, drag, double-tap or scroll to
zoom into it, and the zoom resets with the next image.

| Group | Categories |
|---|---|
| Foundations | Bargue & casts · Anatomy (Albinus plates, Leonardo, écorchés) · Hands & feet · Heads · Drapery |
| Figure | Gesture & motion (Muybridge) · Figure studies (chalk, sanguine) · Life drawing |
| Sketch to finish | Studies & sketches · Oil sketches · Great scenes · Famous paintings · Rijksmuseum |
| Media | Engraving & etching (Doré, Dürer, Rembrandt, Goya) · Japanese woodblock · Pastel · Oil: head & figure · Sculpture |
| Modern | Colour & light · Impressionism · Expressionism (incl. Schiele) · Abstraction (Kandinsky, af Klint) |

Nothing is ticked on a first visit: you choose, and the device remembers it.
Sessions: Gesture · Build-up · Class · Sketch to finish · Thumbnails · Long study · Master copy · Free.
Keys: space pause · ← → previous/next · G greyscale · F mirror · R grid · Esc stop. Choices are remembered on the device.

## Time follows complexity
Every image gets a complexity score from 1 to 3: its set's level, nudged by the title and medium ("study", "sketch",
chalk and ink go down; oil goes up; battles, feasts and the like go up). Within a plan the shortest poses get the
lowest scores in the pot and the longest the highest, so a 30-second pose is a chalk study and the 20-minute one a
finished painting. The score is shown with every image and in the review grid.

## Sources and licences
- **Wikimedia Commons**: fixed categories; public domain, CC0 or CC BY (e.g. the Wellcome Collection's anatomy scans).
- **Wikidata (SPARQL)**: *Famous paintings* = works by 42 masters who died in 1955 or earlier, the most widely
  written-about first; *Rijksmuseum* = paintings in the Rijksmuseum, best known first. Images are the Commons files,
  mostly the museums' own releases. The Rijksmuseum's own API needs a key, hence this route.
- **Art Institute of Chicago**: searches, public domain only.
- **Cleveland Museum of Art**: searches, CC0 only.

Every image shows title, maker, year, licence and a link to its source page. CC BY-SA, NC and ND are never used.
Set `licences: "pd"` in `CONFIG` to allow public domain / CC0 only. Code and documentation: [MIT](LICENSE).

## Edit the course
Everything lives in the `CONFIG` object at the top of the script in `index.html`.
- **categories**: name, group, default level, a one-line "what it trains" (shown as a tooltip and in the review),
  and keywords for your own folders.
- **sets**: `{cat, name, source: "commons" | "wikidata" | "aic" | "cma", query, level}` plus optional filters
  (regular expressions): `type` (AIC artwork type; for Cleveland one of Painting/Drawing/Print/Sculpture), `medium`,
  `style` (AIC, soft: ignored when fewer than 12 works match), `exclude` (title words), `calls` (Commons API budget).
  Commons sets always drop blank pages, covers, title pages and book initials; a small subcategory (≤ 6 files) is
  usually one work in several scans, so only one of them goes into the pot.

Only the sets of ticked categories are loaded; results are cached on the device for 72 hours.

## Review
*Review sources* shows a sample of 20 per search set with its complexity score. Tap an image to reject it (it stays
out of sessions on that device). *Copy verdict* produces a text you can feed back to improve the search set itself.
*Load all sets* fetches every set for a full review.

## Your own images
Subfolder = category (Anatomy, Hands, Pastel, AI, …; Dutch names work too), `n1`/`n2`/`n3` in a folder or file name
= level. Keywords match at the start of a word ("ets" → "Etsen", not "Schetsen"); `~` matches anywhere. Nothing is
uploaded.

## Test
`node test/schetsklok.test.mjs` (needs Playwright). Runs against mocked APIs: defaults, filters and licences, lazy
loading, the soft style filter, complexity scores, folder keywords, full screen, remembered choices, and a full
"Build-up" without an empty image, with pinch, drag and double-tap zoom, even when 30% of images fail to load (`BROKEN=0.6` for the stress run). The real
APIs are deliberately not used in the test; the quality of their results is reviewed by hand.
