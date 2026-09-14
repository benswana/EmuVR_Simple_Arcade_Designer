// Browser smoke test: headless Chrome over the DevTools protocol (Node 25 global WebSocket).
// The caller starts tools/serve.ps1 first. Opens index.html and RoomEditor.html, records
// uncaught exceptions, console.error and Log errors (favicon ignored), checks the walls buttons
// exist, and exits 1 on any problem.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const BASE = 'http://localhost:8765';
const PAGES = ['/index.html', '/RoomEditor.html'];
const BUTTONS = ['trace', 'savewalls', 'clearwalls'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'roomeditor-smoke-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

async function cleanup() {
  try { chrome.kill(); } catch {}
  for (let i = 0; i < 20 && chrome.exitCode === null && chrome.signalCode === null; i++) await sleep(100);
  for (let i = 0; i < 10; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(200); } }
}

async function wsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error('Chrome DevTools endpoint did not come up');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url); let id = 0; const pending = new Map(); const listeners = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
      else if (msg.method) for (const l of listeners) l(msg);
    };
    ws.onerror = () => reject(new Error('websocket error'));
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
      on: (fn) => listeners.push(fn),
      close: () => ws.close(),
    });
  });
}

const errors = [];
let current = '';
const isFavicon = (s) => /favicon/i.test(String(s || ''));

try {
  const cdp = await connect(await wsUrl());
  cdp.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails; const text = (d.exception && d.exception.description) || d.text;
      errors.push(`${current}: exception: ${text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
      if (!isFavicon(text)) errors.push(`${current}: console.error: ${text}`);
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const e = m.params.entry;
      if (!isFavicon(e.url) && !isFavicon(e.text)) errors.push(`${current}: log error: ${e.text} ${e.url || ''}`);
    }
  });
  await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.enable');

  for (const path of PAGES) {
    current = path;
    const before = errors.length;
    const nav = await cdp.send('Page.navigate', { url: BASE + path });
    if (nav.errorText) { errors.push(`${path}: navigation failed: ${nav.errorText}`); continue; }
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      const r = await cdp.send('Runtime.evaluate', { expression: `document.readyState === 'complete' && location.pathname === ${JSON.stringify(path)}`, returnByValue: true });
      ready = r.result.value === true; if (!ready) await sleep(100);
    }
    if (!ready) { errors.push(`${path}: page did not finish loading`); continue; }
    await sleep(1500); // let startApp run and any async errors surface
    const r = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify(${JSON.stringify(BUTTONS)}.filter(id => !document.getElementById(id)))`, returnByValue: true });
    const missing = JSON.parse(r.result.value);
    if (missing.length) errors.push(`${path}: missing buttons: ${missing.join(', ')}`);
    const status = await cdp.send('Runtime.evaluate', { expression: `(document.getElementById('status') || {}).textContent || ''`, returnByValue: true });
    console.log(`${path}: ${errors.length === before ? 'OK' : 'FAILED'}  status="${status.result.value}"`);
  }
  cdp.close();
} catch (e) {
  errors.push(`smoke harness: ${e.message}`);
}

await cleanup();
if (errors.length) { console.log('SMOKE FAILED:'); for (const e of errors) console.log('  ' + e); process.exit(1); }
console.log('SMOKE PASSED: ' + PAGES.join(', ') + ' loaded with no errors; buttons ' + BUTTONS.join(', ') + ' present');
