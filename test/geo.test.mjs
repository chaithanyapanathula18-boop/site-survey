import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, makeProjection, toUTM, utmZone, isSelfIntersecting, areaIn, compass8, niceStep, distanceMeters } from '../src/geo.js';

const LAT = 17.385, LNG = 78.4867; // Hyderabad
const P = makeProjection(LAT, LNG);
const ll = (x, y) => { const q = P.toLatLng(x, y); return { lat: q.lat, lng: q.lng, acc: 4 }; };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('30 x 40 m rectangle', () => {
  const pts = [ll(0, 0), ll(30, 0), ll(30, 40), ll(0, 40)]; // anticlockwise
  const m = measure(pts);
  close(m.area, 1200, 0.01, 'area');
  close(m.perimeter, 140, 0.001, 'perimeter');
  m.angles.forEach((a) => close(a, 90, 1e-6, 'angle'));
  assert.equal(m.orientation, 'ccw');
  // side 0 runs west->east along the south edge, so it faces south
  close(m.sides[0].facing, 180, 1e-6, 'south side faces south');
  close(m.sides[1].facing, 90, 1e-6, 'east side faces east');
  close(m.sides[2].facing, 0, 1e-6, 'north side faces north');
  close(m.sides[3].facing, 270, 1e-6, 'west side faces west');
  assert.equal(compass8(m.sides[1].facing), 'E');
});

test('clockwise order gives the same answers', () => {
  const pts = [ll(0, 0), ll(0, 40), ll(30, 40), ll(30, 0)];
  const m = measure(pts);
  assert.equal(m.orientation, 'cw');
  close(m.area, 1200, 0.01, 'area');
  m.angles.forEach((a) => close(a, 90, 1e-6, 'angle'));
  close(m.sides[0].facing, 270, 1e-6, 'west side faces west'); // P1->P2 goes north on the west edge
  close(m.sides[2].facing, 90, 1e-6, 'east side faces east');
});

test('L-shape has a 270 degree corner and correct total', () => {
  const pts = [ll(0, 0), ll(20, 0), ll(20, 10), ll(10, 10), ll(10, 20), ll(0, 20)];
  const m = measure(pts);
  close(m.area, 300, 0.01, 'area');
  const sum = m.angles.reduce((s, a) => s + a, 0);
  close(sum, (pts.length - 2) * 180, 1e-6, 'angle sum');
  close(m.angles[3], 270, 1e-6, 'reflex corner');
  assert.equal(m.selfIntersecting, false);
});

test('bow tie is flagged', () => {
  const pts = [ll(0, 0), ll(20, 20), ll(20, 0), ll(0, 20)];
  assert.equal(measure(pts).selfIntersecting, true);
  assert.equal(isSelfIntersecting([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]), false);
});

test('area uncertainty for a square', () => {
  const s = 30;
  const pts = [ll(0, 0), ll(s, 0), ll(s, s), ll(0, s)]; // acc 4 => sigma 2 per axis
  const m = measure(pts);
  close(m.areaSigma, 2 * s * Math.SQRT2, 0.01, 'sigma');
});

test('units', () => {
  close(areaIn(4046.8564224, 'acre'), 1, 1e-12, 'acre');
  close(areaIn(4046.8564224, 'cent'), 100, 1e-9, 'cents');
  close(areaIn(4046.8564224, 'gunta'), 40, 1e-9, 'guntas');
  close(areaIn(0.83612736 * 9, 'sqft'), 81, 1e-9, 'sqft');
  close(areaIn(100, 'sqyd'), 119.599, 0.001, 'sqyd');
});

test('two points: one side, no area', () => {
  const m = measure([ll(0, 0), ll(3, 4)]);
  assert.equal(m.sides.length, 1);
  close(m.sides[0].length, 5, 1e-6, 'length');
  assert.equal(m.area, 0);
});

test('distance', () => {
  const a = ll(0, 0), b = ll(3, 4);
  close(distanceMeters(a.lat, a.lng, b.lat, b.lng), 5, 1e-4, 'distance');
});

test('utm zone and sample', () => {
  assert.equal(utmZone(78.4867), 44);
  assert.equal(utmZone(-0.1), 30);
  const u = toUTM(LAT, LNG);
  assert.equal(u.zone, 44); assert.equal(u.hemi, 'N');
});

test('nice steps', () => {
  assert.equal(niceStep(3), 2); assert.equal(niceStep(4), 5); assert.equal(niceStep(12), 10); assert.equal(niceStep(0.3), 0.2);
});
