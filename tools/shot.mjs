// Dev-only screenshotter using Chrome DevTools Protocol with real mobile emulation.
// Usage: node tools/shot.mjs <url> <out.png> [width] [height] [full]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [, , url, out, w = '390', h = '844', full = 'full', scrollYArg = '0'] = process.argv;
if (!url || !out) {
  console.error('usage: node tools/shot.mjs <url> <out.png> [width] [height] [full|viewport]');
  process.exit(1);
}
const width = Number(w);
const height = Number(h);
const fullPage = full !== 'viewport';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9300 + Math.floor(Math.random() * 300);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wy-shot-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
chrome.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  if (text.includes('DevTools listening')) process.stderr.write(text);
});
chrome.on('exit', (code) => {
  if (code !== 0 && code !== null) console.error(`chrome exited early: ${code}`);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(pathname, init) {
  for (let i = 0; i < 150; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
      if (response.ok) return response.json();
    } catch {
      /* not ready */
    }
    await sleep(100);
  }
  throw new Error(`chrome devtools not reachable (port ${port})`);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (event) => reject(new Error(`ws error: ${event.message || 'unknown'}`));
  });
}

function client(ws) {
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  };
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
}

try {
  await getJson('/json/version');
  const target = await getJson('/json/new?about:blank', { method: 'PUT' });
  const ws = await connect(target.webSocketDebuggerUrl);
  const send = client(ws);

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
    screenOrientation: { type: 'portraitPrimary', angle: 0 },
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url });
  await sleep(3200);
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${Number(scrollYArg) || 0})` });
  await sleep(600);

  const metrics = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({w: innerWidth, h: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth})',
    returnByValue: true,
  });
  console.log(metrics.result.value);
  const size = JSON.parse(metrics.result.value);

  if (fullPage) {
    const fullHeight = Math.min(Math.max(size.h, height), 12000);
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: fullHeight,
      deviceScaleFactor: 2,
      mobile: true,
      screenOrientation: { type: 'portraitPrimary', angle: 0 },
    });
    await sleep(900);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${out}`);
  ws.close();
} catch (error) {
  console.error('shot failed:', error.message);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
  await sleep(400);
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(process.exitCode ?? 0);
}
