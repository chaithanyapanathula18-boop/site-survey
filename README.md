# Site Surveyor

A phone web app for measuring a piece of land. Walk the boundary and capture each corner with GPS (or tap the corners on the map), and the app shows the shape, the area in every local unit, and exports a site plan PDF, a CAD drawing (DXF), Google Earth (KML), coordinates (CSV) and a backup file. It installs on the iPhone Home Screen and works offline.

Measurements come from phone GPS, which is usually good to a few metres. Use them for planning, not as a legal survey.

## What it does

- **GPS capture.** Live position with an accuracy circle and a weak-signal warning. Each corner is captured by averaging readings for about 10 seconds (5 to 30 s in Settings).
- **My Location.** Fits your position and every captured corner on screen, and shows the distance to the nearest corner with a dashed line.
- **Two ways to add corners.** Walk mode (GPS) or tap on the map. Corners can be dragged, deleted, re-captured, or inserted after another corner. Undo for every boundary edit. Labels P1, P2, …
- **Plan tab.** CAD-style drawing with grid, north arrow, scale bar, side lengths in metres and feet, corner angles and the road side. Pinch to zoom, double-tap to fit.
- **Data tab.** Area in sq m, sq ft, sq yd, cents, guntas, acres and hectares, a ± estimate from GPS accuracy, perimeter, facing (from the side marked as the road), and the corner list.
- **Photos** with GPS spot, time and caption, linked to the nearest corner. Shown on the map, the plan and in the PDF.
- **Sites.** Any number of sites with name, survey number, village, owner and notes. Backup export and import.
- **Exports.** DXF (R12, layers, UTM or local coordinates), PDF site plan, KML, CSV, backup JSON. Uses the share sheet where the phone supports it, otherwise downloads.
- **Accounts (optional).** Google sign-in with Firebase. Signed out, sites stay on the phone (IndexedDB). Signed in, sites and photos sync to Firestore (`users/{uid}/projects/{id}` and `…/images/{photoId}`) with an offline cache. On first sign-in the app offers to copy the phone's sites into the account.
- **PWA.** Manifest, icons and a service worker that caches the app and every map tile you have viewed.

## Run it locally

Needs Node 20 or newer.

```sh
npm install
npm run dev        # builds into dist/ and serves http://localhost:8080, rebuilding on change
```

Locally there is no Firebase config, so the app runs in on-device mode (no sign-in). Geolocation works on `localhost`; to try it on a phone, deploy to Firebase Hosting (a preview channel is fine) because browsers only allow GPS on HTTPS.

## Tests

```sh
npm test           # unit tests: geometry against known shapes, units, UTM, hosting redirect
npm run test:e2e   # headless Chromium, iPhone 13 viewport, simulated GPS walk (17 checks)
```

The end-to-end test builds the app, serves it, walks a 30 m × 40 m plot with simulated GPS, and checks capture, My Location, tap mode, undo, the road side, insert-after, the plan, photos, details, all five exports, reload persistence, backup import, settings, offline loading through the service worker, and that the Google sign-in option appears when a Firebase config is served. Pass a folder to keep its screenshots and exported files: `node test/e2e.mjs ./e2e-out`.

The e2e test uses Playwright 1.56.1. If its browser is not installed, run `npx playwright install chromium` once.

`test/crosscheck.py` and `test/check_dxf.py` are the earlier cross-checks of the geometry against pyproj and of the DXF against ezdxf (need `pip install pyproj ezdxf matplotlib`).

## Publish on Firebase with GitHub

1. **Firebase project.** In the [Firebase console](https://console.firebase.google.com) create a project (Spark plan is enough).
2. **Hosting.** Build ▸ Hosting ▸ Get started (you can skip the CLI steps).
3. **Google sign-in.** Build ▸ Authentication ▸ Get started ▸ Sign-in method ▸ Google ▸ Enable.
4. **Firestore.** Build ▸ Firestore Database ▸ Create database (production mode, a region near you).
5. **Security rules.** Deploy `firestore.rules` once from your computer:
   ```sh
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project YOUR_PROJECT_ID
   ```
   The rules let each signed-in person read and write only `users/{their uid}/**`.
6. **GitHub repo.** Push this folder to a new GitHub repository (branch `main`).
7. **Deploy key.** Create a service account for GitHub Actions, either with `npx firebase-tools init hosting:github` (it adds the secret for you; keep the workflow files already in `.github/workflows`), or by hand: Google Cloud console ▸ IAM ▸ Service accounts ▸ create one with the *Firebase Hosting Admin* role, create a JSON key, and add it to the GitHub repo as the secret **`FIREBASE_SERVICE_ACCOUNT`**.
8. **Project id.** In the GitHub repo, Settings ▸ Secrets and variables ▸ Actions ▸ Variables, add **`FIREBASE_PROJECT_ID`** with your Firebase project id. Optionally put the same id in `.firebaserc` for CLI use.
9. **Deploy.** Push to `main`. The *Deploy to Firebase Hosting* workflow tests, builds and publishes to `https://YOUR_PROJECT_ID.web.app`. Pull requests get a 7-day preview address from the *Preview* workflow.

The app reads its Firebase config from `/__/firebase/init.json`, which Firebase Hosting serves automatically, so no keys live in the code.

**Sign-in and web addresses.** Google sign-in on phones uses a redirect, which needs the page and the Firebase auth handler on the same address. The app therefore moves visitors from `PROJECT.web.app` to `PROJECT.firebaseapp.com` (the auth domain in the Firebase config). Preview channels (`PROJECT--name-xyz.web.app`) are never redirected because they have no `firebaseapp.com` twin; to sign in on a preview, add its address under Authentication ▸ Settings ▸ Authorized domains and use a desktop browser (popup sign-in). Share the `firebaseapp.com` address with people who will install the app.

## Install on iPhone

Open the `firebaseapp.com` address in Safari, tap Share, then **Add to Home Screen**. Allow location when asked (Settings ▸ Privacy & Security ▸ Location Services ▸ Safari Websites ▸ While Using the App).

## Project layout

```
build.mjs              esbuild build (code splitting, hashed assets), service worker, static server
static/                index.html template, manifest, icons (redraw with `npm run icons`)
src/main.js            entry: hosting redirect, service worker, account boot, routing
src/hosting.js         web.app → firebaseapp.com redirect rule
src/app.js             settings, GPS, account state, editing session (undo, save)
src/model.js           site data model, normalising, undo history
src/geo.js             measurements, area units, UTM, formatting
src/plan.js            shared drawing geometry for plan, PDF and DXF
src/gps.js             live GPS, averaged capture, screen wake lock
src/photos.js          photo resize, thumbnails, EXIF GPS
src/cloud.js           Firebase auth and Firestore store (loaded only when configured)
src/store/             on-device store (IndexedDB) and the active-store switch
src/export/            DXF, PDF, KML/CSV/backup, share or download
src/ui/                screens (projects, project), views (map, plan, data, photos), sheets, settings
src/styles.css         all styles (imports Leaflet's CSS)
src/sw.js              service worker template
firebase.json          Hosting (SPA rewrite, cache headers) and Firestore rules
firestore.rules        owner-only access
.github/workflows/     deploy on push to main, previews for pull requests
test/                  unit tests, end-to-end test, export cross-checks
```

## Data and limits

- A photo is resized to fit in one Firestore document (under 800 KB). Up to 60 photos per site.
- Map tiles: CARTO Voyager or Light, or OpenStreetMap, or no basemap. No satellite imagery and no API key. Up to about 5,000 viewed tiles are kept for offline use.
- Backup files (`.sitesurvey.json`) contain the site and full-size photos and can be imported on any device.
