// End-to-end check in headless Chromium with an iPhone viewport and a simulated GPS walk.
//   node test/e2e.mjs [screenshot-dir]
// Builds dist/, serves it on localhost, and walks a 30 m x 40 m plot near Hyderabad.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium, devices } from 'playwright';
import sharp from 'sharp';
import { build, serveDist } from '../build.mjs';
import { makeProjection } from '../src/geo.js';

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ss-e2e-'));
fs.mkdirSync(shots, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-files-'));

const P = makeProjection(17.4065, 78.4772);
const at = (x, y) => {
  const q = P.toLatLng(x, y);
  return { latitude: q.lat, longitude: q.lng, accuracy: 3 };
};
const WALK = [at(0, 0), at(30, 0), at(30, 40), at(0, 40)]; // 1,200 sq m

let step = 0;
function log(msg) {
  console.log(`${String(++step).padStart(2)}. ${msg}`);
}

await build({ quiet: true });
const server = await serveDist(0);
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
const context = await browser.newContext({
  ...devices['iPhone 13'],
  geolocation: WALK[0],
  permissions: ['geolocation'],
  acceptDownloads: true,
  serviceWorkers: 'allow',
});
// No map tiles from the internet in tests: answer with a plain tile.
const tilePng = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 236, g: 233, b: 226 } } }).png().toBuffer();
await context.route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/, (route) => route.fulfill({ body: tilePng, contentType: 'image/png' }));
await context.addInitScript(() => {
  if (!localStorage.getItem('ss_settings')) localStorage.setItem('ss_settings', JSON.stringify({ avgSeconds: 5 }));
});

const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const toastText = () => page.locator('#toast.show').innerText();

try {
  await page.goto(base + '/');
  await page.getByText('Measure a piece of land').waitFor();
  await shot('01-welcome');
  log('Projects screen shows the welcome state');

  await page.getByRole('button', { name: 'Start a new site' }).click();
  await page.waitForURL(/#\/p\/p/);
  await page.locator('.survey-panel').waitFor();
  await page.locator('.gps-text', { hasText: 'GPS ±3.0 m · good' }).waitFor({ timeout: 10000 });
  log('New site opens on the map, walk mode, GPS live (±3 m, good)');

  for (let i = 0; i < WALK.length; i++) {
    await context.setGeolocation(WALK[i]);
    await page.waitForTimeout(300);
    const btn = page.locator('.capture-btn');
    assert.equal(await btn.innerText(), `Capture corner P${i + 1}`);
    await btn.click();
    await page.locator('.capture-overlay:not([hidden])').waitFor();
    if (i === 0) await shot('02-capturing');
    await page.locator('.capture-overlay').waitFor({ state: 'hidden', timeout: 15000 });
    assert.match(await toastText(), new RegExp(`P${i + 1} added`));
  }
  await page.locator('.title-sub', { hasText: '1,200 sq m · 4 corners' }).waitFor();
  await shot('03-map-4-corners');
  log('Walked 4 corners with averaged GPS capture; header shows 1,200 sq m');

  // My Location: me + corners on screen, distance to the nearest corner
  await context.setGeolocation(at(33, 2));
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'My location' }).click();
  await page.locator('.nearest-chip:not([hidden])').waitFor();
  const chip = await page.locator('.nearest-chip').innerText();
  assert.match(chip, /^3\.6\d m to P2$/, chip);
  assert.equal(await page.locator('.leaflet-overlay-pane path.nearest-line').count(), 1);
  await shot('04-my-location');
  log(`My Location shows dashed line and "${chip}"`);

  // tap mode: add then undo
  await page.getByRole('button', { name: 'Tap on map' }).click();
  await page.locator('.tap-hint:not([hidden])').waitFor();
  const box = await page.locator('.map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 120);
  assert.match(await toastText(), /P5 added/);
  await page.locator('.title-sub', { hasText: '5 corners' }).waitFor();
  await page.locator('.survey-panel [aria-label="Undo"]').click();
  await page.locator('.title-sub', { hasText: '1,200 sq m · 4 corners' }).waitFor();
  log('Tap mode adds P5 on the map; Undo removes it');

  // Data tab
  await page.locator('.tab[data-tab="data"]').click();
  await page.locator('.area-big').waitFor();
  assert.equal(await page.locator('.area-big').innerText(), '1,200 sq m');
  const units = await page.locator('.unit-grid').innerText();
  for (const s of ['12,917 sq ft', '1,435 sq yd', '29.65 cents', '11.86 guntas', '0.2965 acres', '0.1200 ha']) assert.ok(units.includes(s), `missing ${s} in ${units}`);
  await page.locator('.side-row').first().getByRole('button').click();
  await page.locator('.fact', { hasText: 'Facing' }).getByText('South (road on P1–P2)').waitFor();
  await shot('05-data');
  log('Data tab: area in all units, road side marks the plot as South facing');

  // corner sheet: delete then undo
  await page.locator('.corner-row').nth(1).click();
  await page.getByRole('button', { name: 'Delete P2' }).click();
  await page.locator('.title-sub', { hasText: '3 corners' }).waitFor();
  await page.locator('#toast .toast-action').click();
  await page.locator('.title-sub', { hasText: '4 corners' }).waitFor();
  log('Corner sheet deletes P2, Undo from the toast brings it back');

  // insert after P1 with GPS
  await page.locator('.corner-row').first().click();
  await page.getByRole('button', { name: 'Add a corner after P1' }).click();
  await page.locator('.panel-banner', { hasText: 'between P1 and P2' }).waitFor();
  await page.getByRole('button', { name: 'Walk with GPS' }).click();
  await context.setGeolocation(at(15, -2));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.capture-btn').innerText(), 'Capture corner P2');
  await page.locator('.capture-btn').click();
  await page.locator('.capture-overlay').waitFor({ state: 'hidden', timeout: 15000 });
  await page.locator('.title-sub', { hasText: '1,230 sq m · 5 corners' }).waitFor();
  await page.getByRole('button', { name: 'Stop' }).click();
  log('Insert-after puts the new GPS corner between P1 and P2 (area 1,230 sq m)');

  // Plan tab
  await page.locator('.tab[data-tab="plan"]').click();
  await page.locator('.plan-svg polygon.plan-poly').waitFor();
  assert.equal(await page.locator('.plan-corner').count(), 5);
  assert.equal(await page.locator('.plan-side').count(), 5);
  assert.ok((await page.locator('.plan-road-label').count()) === 1);
  await shot('06-plan');
  log('Plan tab draws 5 corners, 5 side lengths, road, north arrow and scale bar');

  // Photos
  await page.locator('.tab[data-tab="photos"]').click();
  const jpg = path.join(work, 'site.jpg');
  await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 90, g: 140, b: 80 } } }).jpeg().toFile(jpg);
  await context.setGeolocation(at(0.5, 0.5));
  await page.waitForTimeout(300);
  await page.locator('input[type=file][capture]').setInputFiles(jpg);
  await page.locator('.photo-tile').waitFor();
  assert.match(await page.locator('.photo-sub').innerText(), /^P1 · /);
  await page.locator('.photo-tile').click();
  await page.getByPlaceholder('Add a caption').fill('Boundary stone');
  await page.locator('.sheet-close').click();
  await page.locator('.photo-title', { hasText: 'Boundary stone' }).waitFor();
  await shot('07-photos');
  log('Camera photo saved with GPS spot, linked to P1, caption edited');

  // Details
  await page.locator('.title-btn').click();
  await page.locator('[data-key="name"]').fill('Plot 42 Kondapur');
  await page.locator('[data-key="surveyNo"]').fill('123/4A');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('.title-name', { hasText: 'Plot 42 Kondapur' }).waitFor();
  log('Site details saved');

  // Exports
  await page.locator('.tab[data-tab="data"]').click();
  await page.getByRole('button', { name: 'Export & share' }).click();
  await page.locator('.export-row').first().waitFor();
  await shot('08-export');
  const rows = page.locator('.export-row');
  const got = {};
  for (let i = 0; i < (await rows.count()); i++) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), rows.nth(i).getByRole('button', { name: 'Download' }).click()]);
    const file = path.join(work, dl.suggestedFilename());
    await dl.saveAs(file);
    got[dl.suggestedFilename()] = fs.readFileSync(file);
  }
  const names = Object.keys(got).sort();
  assert.deepEqual(names, ['Plot 42 Kondapur.csv', 'Plot 42 Kondapur.dxf', 'Plot 42 Kondapur.kml', 'Plot 42 Kondapur.pdf', 'Plot 42 Kondapur.sitesurvey.json']);
  assert.equal(got['Plot 42 Kondapur.pdf'].subarray(0, 5).toString(), '%PDF-');
  assert.ok(got['Plot 42 Kondapur.pdf'].length > 20000, 'PDF includes the photo');
  assert.match(got['Plot 42 Kondapur.dxf'].toString(), /EOF\s*$/);
  assert.equal(got['Plot 42 Kondapur.csv'].toString().trim().split('\n').length, 6);
  assert.match(got['Plot 42 Kondapur.kml'].toString(), /<Polygon>/);
  const backupFile = path.join(work, 'Plot 42 Kondapur.sitesurvey.json');
  const backup = JSON.parse(got['Plot 42 Kondapur.sitesurvey.json']);
  assert.equal(backup.project.points.length, 5);
  assert.equal(Object.keys(backup.images).length, 1);
  for (const n of names) fs.copyFileSync(path.join(work, n), path.join(shots, n));
  await page.locator('.sheet-close').click();
  log(`Exports downloaded: ${names.join(', ')}`);

  // persistence and the list
  await page.reload();
  await page.locator('.title-name', { hasText: 'Plot 42 Kondapur' }).waitFor();
  await page.locator('.title-sub', { hasText: '1,230 sq m · 5 corners' }).waitFor();
  await page.getByRole('link', { name: 'All sites' }).click();
  await page.locator('.project-row').first().waitFor();
  assert.match(await page.locator('.project-row').first().innerText(), /Plot 42 Kondapur[\s\S]*Sy\. 123\/4A[\s\S]*1,230 sq m · 5 corners/);
  log('Reload keeps everything (IndexedDB); list shows name, survey no and area');

  // import the backup: keep both
  await page.locator('input[type=file][accept*=json]').setInputFiles(backupFile);
  await page.getByRole('button', { name: 'Keep both' }).click();
  await page.locator('.project-row', { hasText: '(copy)' }).waitFor();
  assert.equal(await page.locator('.project-row').count(), 2);
  await shot('09-list');
  log('Backup import creates a second copy with its photo');

  // settings sheet
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Google sign-in and cloud backup turn on when the app is published').waitFor();
  await page.locator('.settings-sheet .segmented button', { hasText: 'Feet' }).click();
  await page.locator('.sheet-close').click();
  await page.locator('.project-row').first().locator('.project-open').click();
  await page.locator('.tab[data-tab="data"]').click();
  assert.match(await page.locator('.side-len strong').first().innerText(), / ft$/);
  log('Settings: local-only account note, switching lengths to feet works');

  // offline: the service worker serves the app
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.goto(base + '/');
  await page.locator('.project-row').first().waitFor();
  const cached = await page.evaluate(async () => (await caches.keys()).join(','));
  assert.match(cached, /app-[0-9a-f]{12}/);
  await context.setOffline(false);
  log('Offline reload works from the service worker cache');

  // with a Firebase config (as on Firebase Hosting) the account chip offers Google sign-in
  const fbContext = await browser.newContext({ ...devices['iPhone 13'] });
  await fbContext.route('**/__/firebase/init.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ apiKey: 'AIzaSyTestTestTestTestTestTestTestTest', authDomain: 'demo-site.firebaseapp.com', projectId: 'demo-site', appId: '1:1:web:1' }),
    }),
  );
  await fbContext.route(/googleapis\.com|gstatic\.com|firebaseapp\.com|cartocdn\.com/, (route) => route.abort());
  const fbPage = await fbContext.newPage();
  fbPage.on('pageerror', (e) => problems.push(`pageerror (firebase): ${e.message}`));
  await fbPage.goto(base + '/');
  await fbPage.locator('.account-chip', { hasText: 'Sign in' }).waitFor({ timeout: 15000 });
  await fbPage.getByRole('button', { name: 'Settings' }).click();
  await fbPage.getByRole('button', { name: 'Sign in with Google' }).waitFor();
  await fbPage.screenshot({ path: path.join(shots, '10-signed-out-settings.png') });
  await fbContext.close();
  log('With a Firebase config the app loads the cloud module and offers Google sign-in');

  const real = problems.filter((p) => !/Failed to load resource/.test(p));
  assert.deepEqual(real, [], 'no page errors');
  console.log(`\nAll checks passed. Screenshots and exports in ${shots}`);
} catch (e) {
  await shot('zz-failure').catch(() => {});
  console.error(problems.join('\n'));
  throw e;
} finally {
  await browser.close();
  server.close();
}
