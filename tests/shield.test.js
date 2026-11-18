import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createShield } from '../lib/shield.js';

test('shield turns Under Attack on at a spike and off after calm minutes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-shield-'));
  let level = 'medium';
  const calls = [];
  const fetchImpl = async (url, { method, body }) => {
    calls.push(method);
    if (method === 'PATCH') level = JSON.parse(body).value;
    return { ok: true, json: async () => ({ success: true, result: { value: level } }) };
  };
  const s = createShield({ token: 't', zoneId: 'z', dataDir: dir, rpm: 10, calmMinutes: 2, fetchImpl });
  for (let i = 0; i < 12; i++) s.hit();
  await s.tick();
  assert.equal(level, 'under_attack');
  await s.tick();
  assert.equal(level, 'under_attack', 'still on after one calm minute');
  await s.tick();
  assert.equal(level, 'medium', 'restored after two calm minutes');
  assert.match(fs.readFileSync(path.join(dir, 'shield.log'), 'utf8'), /ON[\s\S]*OFF/);
  s.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shield does nothing without a token', async () => {
  const s = createShield({ dataDir: os.tmpdir(), fetchImpl: () => assert.fail('no calls') });
  for (let i = 0; i < 5000; i++) s.hit();
  await s.tick();
  assert.equal(s.enabled, false);
});
