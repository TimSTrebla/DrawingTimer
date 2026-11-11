# DrawingTimer (Schetsklok)

**Live:** https://timstrebla.github.io/DrawingTimer/


Timed drawing practice in the spirit of Line of Action: public-domain reference images from Wikimedia Commons and
the Art Institute of Chicago, plus your own folder. In a class session the poses grow longer (30 s → 20 min) and the
images grow with them from simple (n1) to complex (n3). One static file, `index.html`: no build step, no backend,
no API keys.

## Use
Open the live URL above (or serve `index.html` locally), pick categories and a session, start.
Keys: space pause · ← → previous/next · G greyscale · F mirror · R grid · Esc stop. ⛶ = full screen.

## Edit the sources
Everything lives in the `CONFIG` object at the top of the script in `index.html`. One line per search set:
`{cat, name, source: "commons" | "aic", query, level}`.
- **commons**: `query` is a Commons category; subcategories are included (max 16 API calls per set).
  A small subcategory (≤ 6 files) is usually one plate in several scans, so only one of them goes into the pot.
  Only public domain / PD / CC0 licences.
- **aic**: `query` is a search term; always `is_public_domain`, then filtered by the category's `aicFilter`
  (type, medium, and words in the title you do *not* want).

Search results are cached on the device for 72 hours; "Fetch sources again" (under *Review sources*) refreshes them.

## Review
*Review sources · 20 per set* shows a sample per search set. Tap an image to reject it (it stays out of sessions on
that device). *Copy verdict* produces a text you can feed back to improve the search set itself.

## Your own folder
Subfolder = category (Engraving, Drawing, AI, …; Dutch names work too), `n1`/`n2`/`n3` in a folder or file name =
level. The images never leave the device.

## Test
`node test/schetsklok.test.mjs` (needs Playwright). Runs against mocked APIs: filters, session building and a full
"Build-up · 30 min" without an empty image, even when 30% of images fail to load (`BROKEN=0.6` for the stress run).
The real APIs are deliberately not used in the test; the quality of their results is reviewed by hand.

## Sources and licences
Images: public domain according to the source. Every image shows title, maker, year and a link to its source page
(Wikimedia Commons or artic.edu); they are not covered by this repository's licence. AIC metadata: CC0.
Code and documentation: [MIT](LICENSE).
