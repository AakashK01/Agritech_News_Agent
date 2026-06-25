#!/usr/bin/env node
/**
 * Export Inc42 auth from the login Chrome session using CDP only.
 * Does not invoke agent-browser — no extra Chrome windows or tabs.
 */
import fs from 'node:fs';
import path from 'node:path';

const profileDir = process.argv[2];
const debugPort = process.argv[3];
const authFile = process.argv[4];

if (!profileDir || !debugPort || !authFile) {
  console.error('Usage: inc42-save-auth.mjs <profileDir> <debugPort> <authFile>');
  process.exit(1);
}

const authPath = path.isAbsolute(authFile) ? authFile : path.join(profileDir, authFile);
const cdpBase = `http://127.0.0.1:${debugPort}`;

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  on(event, handler) {
    if (!this.events.has(event)) this.events.set(event, []);
    this.events.get(event).push(handler);
  }

  emit(event, params) {
    for (const handler of this.events.get(event) || []) {
      handler(params);
    }
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('CDP WebSocket connection failed'));
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.method) {
        this.emit(msg.method, msg.params);
      }
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    };
  }

  send(method, params = {}, sessionId = null) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, (response) => {
        if (response.error) {
          reject(new Error(response.error.message || `CDP ${method} failed`));
          return;
        }
        resolve(response.result);
      });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    this.ws?.close();
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CDP request failed: ${url} (${res.status})`);
  }
  return res.json();
}

function normalizeCookies(cdpCookies) {
  return (cdpCookies || []).map((c) => {
    const cookie = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: typeof c.expires === 'number' ? c.expires : -1,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      session: !!c.session,
    };
    if (c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None') {
      cookie.sameSite = c.sameSite;
    }
    return cookie;
  });
}

async function assertInc42TabPresent() {
  const targets = await fetchJson(`${cdpBase}/json/list`);
  const inc42Pages = targets.filter(
    (t) => t.type === 'page' && typeof t.url === 'string' && t.url.includes('inc42.com'),
  );
  if (inc42Pages.length === 0) {
    throw new Error(
      'No Inc42 tab found. Open https://inc42.com/industry/agritech/, confirm the feed loads, then press Enter again.',
    );
  }
  console.log(`Inc42 tab present: ${inc42Pages[0].url}`);
  return inc42Pages;
}

async function readPageStorage(webSocketDebuggerUrl) {
  const client = new CdpClient(webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.send('Runtime.enable');
    const { result } = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const origin = location.origin;
        const localStorage = Object.entries(window.localStorage || {}).map(([name, value]) => ({ name, value }));
        const sessionStorage = Object.entries(window.sessionStorage || {}).map(([name, value]) => ({ name, value }));
        return JSON.stringify({ origin, localStorage, sessionStorage });
      })()`,
      returnByValue: true,
    });
    if (!result?.value) return null;
    return JSON.parse(result.value);
  } catch {
    return null;
  } finally {
    client.close();
  }
}

async function getAllCookiesFromPageTarget(pageTarget) {
  const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.send('Network.enable');
    const result = await client.send('Network.getAllCookies');
    return normalizeCookies(result.cookies);
  } finally {
    client.close();
  }
}

async function waitForAttachedSession(client, timeoutMs = 5000) {
  let sessionId = null;
  client.on('Target.attachedToTarget', (params) => {
    if (!sessionId && params.sessionId) sessionId = params.sessionId;
  });

  await client.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

  const deadline = Date.now() + timeoutMs;
  while (!sessionId && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (!sessionId) {
    const { targetInfos } = await client.send('Target.getTargets');
    for (const target of targetInfos || []) {
      if (target.type !== 'page' && target.type !== 'iframe') continue;
      try {
        const attached = await client.send('Target.attachToTarget', {
          targetId: target.targetId,
          flatten: true,
        });
        if (attached.sessionId) {
          sessionId = attached.sessionId;
          break;
        }
      } catch {
        // try next target
      }
    }
  }

  if (!sessionId) {
    throw new Error('Could not attach CDP session to Chrome for cookie export');
  }

  return sessionId;
}

async function getAllCookiesFromBrowserTarget() {
  const version = await fetchJson(`${cdpBase}/json/version`);
  const client = new CdpClient(version.webSocketDebuggerUrl);
  await client.connect();

  try {
    const sessionId = await waitForAttachedSession(client);
    await client.send('Network.enable', {}, sessionId);
    const result = await client.send('Network.getAllCookies', {}, sessionId);
    return normalizeCookies(result.cookies);
  } finally {
    client.close();
  }
}

async function getAllCookies(inc42Pages) {
  try {
    return await getAllCookiesFromPageTarget(inc42Pages[0]);
  } catch (pageErr) {
    console.warn(`Page-target cookie export failed (${pageErr.message}); trying browser session attach...`);
    return getAllCookiesFromBrowserTarget();
  }
}

async function exportBrowserState(inc42Pages) {
  const cookies = await getAllCookies(inc42Pages);

  const originsByKey = new Map();
  for (const page of inc42Pages) {
    if (!page.webSocketDebuggerUrl) continue;
    const storage = await readPageStorage(page.webSocketDebuggerUrl);
    if (!storage?.origin) continue;
    originsByKey.set(storage.origin, {
      origin: storage.origin,
      localStorage: storage.localStorage || [],
      sessionStorage: storage.sessionStorage || [],
    });
  }

  return {
    cookies,
    origins: [...originsByKey.values()],
  };
}

function validateSavedState(state) {
  const cookies = state.cookies || [];
  const origins = state.origins || [];
  const hasWpLogin = cookies.some((c) => String(c.name || '').startsWith('wordpress_logged_in'));
  const hasInc42Domain = cookies.some((c) => String(c.domain || '').includes('inc42.com'));
  const inc42CookieCount = cookies.filter((c) => String(c.domain || '').includes('inc42.com')).length;

  if (!hasWpLogin) {
    throw new Error('Export missing wordpress_logged_in cookie — sign in on Inc42 and try again.');
  }
  if (!hasInc42Domain) {
    throw new Error('Export has no inc42.com cookies — ensure the agritech feed tab is logged in.');
  }

  const hasInc42Origin = origins.some((o) => String(o.origin || '').includes('inc42.com'));
  if (!hasInc42Origin) {
    console.warn('Warning: no inc42.com localStorage in export; session may still work via cookies.');
  }

  console.log(
    `Validated: ${cookies.length} cookies (${inc42CookieCount} for inc42.com), ${origins.length} origin(s) with storage`,
  );
}

try {
  const inc42Pages = await assertInc42TabPresent();
  const state = await exportBrowserState(inc42Pages);
  validateSavedState(state);
  fs.writeFileSync(authPath, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`Saved auth state to ${authPath}`);
} catch (err) {
  if (fs.existsSync(authPath)) {
    fs.unlinkSync(authPath);
  }
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
