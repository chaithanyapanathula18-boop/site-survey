import test from 'node:test';
import assert from 'node:assert/strict';
import { hostingRedirectTarget } from '../src/hosting.js';

const loc = (hostname, pathname = '/', search = '', hash = '') => ({ hostname, pathname, search, hash });

test('live web.app address moves to firebaseapp.com, keeping the route', () => {
  assert.equal(hostingRedirectTarget(loc('my-survey.web.app', '/', '?x=1', '#/p/abc')), 'https://my-survey.firebaseapp.com/?x=1#/p/abc');
});

test('preview channels are never redirected', () => {
  assert.equal(hostingRedirectTarget(loc('my-survey--pr12-abc123.web.app')), null);
  assert.equal(hostingRedirectTarget(loc('my-survey--staging-k2j3h4.web.app', '/', '', '#/')), null);
});

test('other hosts stay put', () => {
  assert.equal(hostingRedirectTarget(loc('my-survey.firebaseapp.com')), null);
  assert.equal(hostingRedirectTarget(loc('localhost')), null);
  assert.equal(hostingRedirectTarget(loc('survey.example.com')), null);
  assert.equal(hostingRedirectTarget(loc('a.b.web.app')), null);
});
