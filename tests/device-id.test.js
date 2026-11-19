import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'device-id.js'), 'utf8');
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);

function load(initial) {
  const map = new Map(Object.entries(initial || {}));
  const localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
  const sandbox = { localStorage, crypto: globalThis.crypto, module: { exports: {} }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { api: sandbox.module.exports, map };
}

test('a fresh browser gets a new device id with a timestamp', () => {
  const { api, map } = load();
  const result = api.current(NOW);
  assert.equal(result.rotated, true);
  assert.match(result.id, /^d-[0-9a-f]{24}$/);
  assert.equal(map.get('wy:device'), result.id);
  assert.equal(Number(map.get('wy:device:ts')), NOW);
  assert.equal(api.days, 180);
  assert.equal(api.ttl(), 180 * DAY);
});

test('a valid id is reused instead of rotating on every page view', () => {
  const { api } = load();
  const first = api.current(NOW);
  const second = api.current(NOW + 30 * DAY);
  assert.equal(second.id, first.id);
  assert.equal(second.rotated, false);
});

test('legacy users with an id but no timestamp are adopted, not rotated', () => {
  const legacy = 'd-0123456789abcdef01234567';
  const { api, map } = load({ 'wy:device': legacy });
  const result = api.current(NOW);
  assert.equal(result.id, legacy);
  assert.equal(result.adopted, true);
  assert.equal(result.rotated, false);
  assert.equal(Number(map.get('wy:device:ts')), NOW);
});

test('the id rotates after 180 days without activity', () => {
  const { api, map } = load();
  const first = api.current(NOW);
  const refreshed = api.current(NOW + 179 * DAY);
  assert.equal(refreshed.id, first.id);

  api.touch(NOW + 179 * DAY);
  const extended = api.current(NOW + 179 * DAY + 179 * DAY);
  assert.equal(extended.id, first.id, 'touch 之后计时重置，不应轮换');

  const expired = api.current(NOW + 179 * DAY + 181 * DAY);
  assert.equal(expired.rotated, true);
  assert.notEqual(expired.id, first.id);
  assert.equal(map.get('wy:device'), expired.id);
});

test('a timestamp from the future is treated as tampering and rotated', () => {
  const first = 'd-aaaaaaaaaaaaaaaaaaaaaaaa';
  const { api } = load({ 'wy:device': first, 'wy:device:ts': String(NOW + 3 * DAY) });
  const result = api.current(NOW);
  assert.equal(result.rotated, true);
  assert.notEqual(result.id, first);
});

test('touch only extends a valid id and reset clears both keys', () => {
  const { api, map } = load();
  const first = api.current(NOW);
  assert.equal(api.touch(NOW + DAY), true);
  assert.equal(Number(map.get('wy:device:ts')), NOW + DAY);
  assert.equal(map.get('wy:device'), first.id);

  api.reset();
  assert.equal(map.has('wy:device'), false);
  assert.equal(map.has('wy:device:ts'), false);

  const fresh = load({ 'wy:device': 'not_a_device_id!!' });
  assert.equal(fresh.api.touch(NOW), false);
  const regenerated = fresh.api.current(NOW);
  assert.equal(regenerated.rotated, true);
});

test('storage that throws (private mode) does not crash', () => {
  const throwing = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
    removeItem() {
      throw new Error('denied');
    },
  };
  const sandbox = { localStorage: throwing, crypto: globalThis.crypto, module: { exports: {} }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const result = sandbox.module.exports.current(NOW);
  assert.equal(result.rotated, true);
  assert.match(result.id, /^d-[0-9a-f]{24}$/);
});
