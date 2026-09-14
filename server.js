#!/usr/bin/env node
/**
 * 🚀 Freebuff Local Server — Diamond Stock System (localhost)
 *
 * Run:  node server.js
 * Open: http://localhost:3000
 *
 * - No Firebase needed — data stored locally in local-data.json
 * - Real-time sync between multiple tabs/devices on same network
 * - Backup/restore works exactly like before
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT  = parseInt(process.env.PORT, 10) || 3000;
const HOST  = process.env.HOST || '0.0.0.0';
const DATA_FILE = path.join(__dirname, 'local-data.json');
// Tombstones: record of rows deleted on purpose (date/kapan purge). Kept so an old
// device that still holds the deleted copy can never push it back in.
const DELETED_FILE = path.join(__dirname, 'local-data.deleted.json');
const HTML_FILE = path.join(__dirname, 'index.html');  // index.html = newest app code (restore fix included)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

// ─────────────────────────────────────────────
//  Data persistence
// ─────────────────────────────────────────────
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};  // first run — empty
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────
//  Delete protection (tombstones) + append-only history
// ─────────────────────────────────────────────
function loadDeleted() {
  try {
    const v = JSON.parse(fs.readFileSync(DELETED_FILE, 'utf8'));
    const out = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of Object.keys(v)) if (Array.isArray(v[k])) out[k] = v[k];
    }
    return out;
  } catch (e) { return {}; }
}
function saveDeleted(del) {
  const out = {};
  for (const k of Object.keys(del || {})) {
    if (Array.isArray(del[k]) && del[k].length) out[k] = Array.from(new Set(del[k]));
  }
  out.at = Date.now();
  fs.writeFileSync(DELETED_FILE, JSON.stringify(out, null, 2));
}
function canonJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonJson(v[k])).join(',') + '}';
}
function rowKey(row) {
  try { return crypto.createHash('sha1').update(canonJson(row)).digest('hex'); } catch (e) { return null; }
}
const APPEND_ONLY_SECTIONS = ['hist'];
const TOMBSTONE_SECTIONS = ['hist', 'reps', 'sugs', 'sugAll', 'fourP', 'stock', 'jangads'];
// History is APPEND-ONLY: an incoming save is merged with what is stored, so a browser
// whose copy was trimmed can never erase history. Only /api/data/delete removes rows.
function mergeData(stored, incoming, deleted) {
  const out = Object.assign({}, stored || {}, incoming || {});
  for (const sec of APPEND_ONLY_SECTIONS) {
    const oldArr = Array.isArray(stored && stored[sec]) ? stored[sec] : [];
    const newArr = Array.isArray(incoming && incoming[sec]) ? incoming[sec] : [];
    if (!oldArr.length && !newArr.length) { out[sec] = []; continue; }
    const dead = new Set((deleted && deleted[sec]) || []);
    const seen = new Set();
    const merged = [];
    for (const row of oldArr.concat(newArr)) {
      const k = rowKey(row);
      if (k && (dead.has(k) || seen.has(k))) continue;
      if (k) seen.add(k);
      merged.push(row);
    }
    out[sec] = merged;
  }
  for (const sec of TOMBSTONE_SECTIONS) {
    if (APPEND_ONLY_SECTIONS.indexOf(sec) !== -1) continue;
    if (!Array.isArray(out[sec])) continue;
    const dead = new Set((deleted && deleted[sec]) || []);
    if (!dead.size) continue;
    out[sec] = out[sec].filter(row => { const k = rowKey(row); return !(k && dead.has(k)); });
  }
  out.updated = Math.max(Number(stored && stored.updated) || 0, Number(incoming && incoming.updated) || 0) || Date.now();
  return out;
}

// ─────────────────────────────────────────────
//  SSE (Server-Sent Events) — real-time push
// ─────────────────────────────────────────────
let sseClients = [];

function broadcastData(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(msg); } catch (_) { /* dead client */ }
  });
}

// ─────────────────────────────────────────────
//  HTML patching — replace Firebase with local sync
// ─────────────────────────────────────────────
const LOCAL_SYNC_MODULE = `<script type="module">
  // ═══════════════════════════════════════════
  //  Local Server Sync — replaces Firebase
  //  Runs on http://localhost:${PORT}
  // ═══════════════════════════════════════════

  // No cloud trimming needed locally — unlimited storage
  window.cloudTrim = function(p) { return p; };

  // ─── Save: POST /api/data (debounced) ───
  let _saveTimeout = null;
  window.cloudSave = function(p) {
    if (_saveTimeout) clearTimeout(_saveTimeout);
    _saveTimeout = setTimeout(async () => {
      try {
        await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p)
        });
      } catch(e) {
        console.error('Save err', e);
        if (window.toast) window.toast('❌ સેવ ન થયું: ' + e.message, 'error');
      }
    }, 150);
  };

  // ─── Load: GET /api/data ───
  window.cloudLoad = function(cb) {
    fetch('/api/data')
      .then(r => r.json())
      .then(d => cb(d))
      .catch(e => { console.warn('Load err', e); cb(null); });
  };

  // ─── Listen: SSE /api/stream (real-time) ───
  window.cloudListen = function(cb) {
    const es = new EventSource('/api/stream');
    es.onmessage = function(e) {
      try { cb(JSON.parse(e.data)); } catch(_) {}
    };
    es.onerror = function() {
      // EventSource auto-reconnects; no action needed
    };
  };

  // ─── Clean: overwrite with empty data ───
  window.cloudCleanNow = async function() {
    try {
      await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      return { ok: true };
    } catch(e) {
      return { ok: false, error: e.message };
    }
  };

  window.firebaseReady = true;
  console.log('✅ Local Server જોડાઈ ગયું! (http://localhost:${PORT})');
</script>`;

function patchHTML(html) {
  // Replace the Firebase <script type="module"> block with local sync module
  // The Firebase block starts with <script type="module"> and ends at the next </script>
  return html.replace(
    /<script type="module">[\s\S]*?<\/script>/,
    LOCAL_SYNC_MODULE
  );
}  // Cache the patched HTML (reload on restart)
let patchedHTML = null;
function getPatchedHTML() {
  if (!patchedHTML) {
    const raw = fs.readFileSync(HTML_FILE, 'utf8');
    patchedHTML = patchHTML(raw);
    console.log(`📄 HTML loaded: ${raw.length} → ${patchedHTML.length} chars (Firebase → Local)`);
    // Debug: verify patches
    console.log(`   Has <script type="module">: ${patchedHTML.includes('<script type="module">')}`);
    console.log(`   Has <script type="text/javascript"> (local sync): ${patchedHTML.match(/<script type="text\/javascript">/g)||[]}.length}`);
  }
  return patchedHTML;
}

// ─────────────────────────────────────────────
//  HTTP Server
// ─────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const pathname = req.url.split('?')[0];

  // ─── API: GET /api/data ───
  if (pathname === '/api/data' && req.method === 'GET') {
    const data = loadData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  }

  // ─── API: POST /api/data ───
  if (pathname === '/api/data' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        const merged = mergeData(loadData(), incoming, loadDeleted());
        saveData(merged);
        broadcastData(merged);  // push to all connected clients
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, hist: (merged.hist || []).length }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── API: POST /api/data/delete ───
  // Date range + kapan wize HARD delete. Deleted rows are kept as tombstones, so a
  // stale device pushing its old copy can never bring them back.
  if (pathname === '/api/data/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const b = JSON.parse(body || '{}');
        const from = Number(b.dateFrom || 0) || 0;
        const to   = Number(b.dateTo || 0) || 0;
        const kapan = String(b.kapan || '').trim().toLowerCase();
        const want = (Array.isArray(b.sections) && b.sections.length) ? b.sections
                   : ['hist', 'reps', 'sugs', 'sugAll', 'fourP', 'stock'];
        const inRange = o => {
          if (!from && !to) return true;
          const t = o.sentMs || o.recvTime || o.movedMs || o.okMs || o.recvSendMs || 0;
          if (!t) return false;            // no timestamp -> never guess, keep the row
          if (from && t < from) return false;
          if (to && t > to) return false;
          return true;
        };
        const matchKapan = o => {
          if (!kapan) return true;
          return String(o.item || o.kapan || '').toLowerCase().includes(kapan);
        };
        const doomed = o => inRange(o) && matchKapan(o);
        const blob = loadData();
        const del = loadDeleted();
        const counts = {};
        for (const sec of want) {
          const arr = blob[sec];
          if (!Array.isArray(arr)) continue;
          const keep = [], dropped = [];
          for (const row of arr) (doomed(row) ? dropped : keep).push(row);
          if (TOMBSTONE_SECTIONS.indexOf(sec) !== -1 && dropped.length) {
            const set = new Set(del[sec] || []);
            for (const row of dropped) { const k = rowKey(row); if (k) set.add(k); }
            del[sec] = Array.from(set);
          }
          blob[sec] = keep;
          counts[sec] = dropped.length;
        }
        blob.updated = Date.now();
        saveData(blob);
        saveDeleted(del);
        broadcastData(blob);
        let tombCount = 0;
        for (const k of Object.keys(del)) tombCount += del[k].length;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deleted: counts, hist: (blob.hist || []).length, tombstones: tombCount, updated: blob.updated }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ─── API: GET /api/stream (SSE) ───
  if (req.url === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Send current data immediately on connect
    const data = loadData();
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Track this client
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // ─── API: GET /api/ping ───
  if (req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      time: new Date().toISOString(),
      clients: sseClients.length,
      dataSize: (() => {
        try { return fs.statSync(DATA_FILE).size; } catch(_) { return 0; }
      })()
    }));
  }

  // ─── Static files ───
  let urlPath = req.url.split('?')[0];  // strip query params
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(__dirname, urlPath);
  const ext = path.extname(filePath).toLowerCase();

  // Security: don't serve parent directories
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  try {
    if (filePath.endsWith('index.html') && !urlPath.includes('backup')) {
      // Serve patched HTML (Firebase → Local)
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(getPatchedHTML());
    }
    const fileData = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    return res.end(fileData);
  } catch (e) {
    res.writeHead(404);
    return res.end('404 Not Found');
  }
});

// ─────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🚀 Freebuff Local Server — ચાલુ છે!        ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  🌐 http://localhost:${PORT}                   ║`);
  console.log(`║  📁 Data: local-data.json                    ║`);
  console.log('║  📱 LAN: http://<your-ip>:3000               ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('💡 બીજા PC/Phone થી ચલાવવા માટે http://<your-ip>:3000 ઉપયોગ કરો.');
  console.log('💡 Data local-data.json માં સેવ થાય છે — backup રાખવા માટે એ ફાઈલ કૉપી કરો.');
  console.log('');
});
