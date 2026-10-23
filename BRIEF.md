# Site Surveyor: build brief

Phone web app (installable on iPhone Home Screen) to survey land: walk the boundary, capture a GPS point at each corner, see shape/area, export CAD.

## Decisions
- Vanilla JS + esbuild, Leaflet map with CARTO graphical tiles (no satellite, no API key).
- Firebase: Hosting (link), Auth (optional Google sign-in), Firestore (cloud sync, offline cache). Config auto-loaded from `/__/firebase/init.json`.
- Code goes in a GitHub repo; GitHub Action deploys to Firebase Hosting on push.
- Data local-first (IndexedDB) when signed out; Firestore `users/{uid}/projects/{id}` (+ `images/{photoId}`) when signed in.

## Features
- GPS: live position + accuracy circle, weak-signal warning, corner capture averaging ~10 s.
- My Location button: fits live position AND all captured corners on screen, shows distance to nearest corner with a dashed line.
- Walk mode and tap-on-map mode; drag/delete/undo/insert-after corners; labels P1, P2…
- Plan tab: CAD-style drawing, grid, north arrow, scale bar, side lengths (m + ft), angles, road side.
- Data tab: area in sq m, sq ft, sq yd, cents, guntas, acres, ha; ± area estimate; perimeter; facing (mark road side); corner list.
- Photos with GPS spot, time, caption, link to a corner; shown on map/plan/PDF.
- Projects: multiple sites, details (name, survey no, village, owner, notes), backup export/import.
- Exports: DXF (R12, layers, UTM or local coords), PDF site plan, KML, CSV, backup JSON. Share sheet or download.
- PWA: manifest, icons, service worker caching app + viewed tiles.

## Status
All items below are done (23 Oct 2026). See README.md for setup, tests and deployment.

Done and tested earlier: `src/geo.js` (matches pyproj to mm), `src/export/dxf.js` (ezdxf audit 0 errors), `src/export/pdf.js`, `src/export/text.js` (KML/CSV/backup).

Finished in this round:
1. `src/ui/project.js` (screen shell, tabs, map overlay controls, capture overlay, My Location, photo capture), `src/ui/projects.js` (list, sign-in chip, import), `src/ui/settings.js` (settings sheet, sign-in/out, copy phone sites to account), `src/main.js` (routing, account/cloud boot, service worker), `src/styles.css`, `static/index.html`.
2. `build.mjs` (esbuild with splitting, CSS + Leaflet CSS, hashed assets, local server), `src/sw.js` service worker, `static/manifest.webmanifest`, icons (`scripts/make-icons.mjs`).
3. Fix: `src/hosting.js` redirects `PROJECT.web.app` to `PROJECT.firebaseapp.com` only when the hostname has no `--` (preview channels stay put). Unit-tested in `test/hosting.test.mjs`.
4. `test/e2e.mjs`: headless Chromium, iPhone 13 viewport, mocked geolocation walk, 17 checks passing. The earlier-written modules (store, gps, photos, model, app, views, sheets) all run in it; two bugs found and fixed along the way.
5. `firebase.json`, `firestore.rules` (users/{uid}/** owner only), `.github/workflows/deploy.yml` + `preview.yml`, `README.md` with setup steps.

Not covered by automated tests: real Google sign-in and Firestore sync (needs a live Firebase project); the code path that loads them is smoke-tested with a stub config.
