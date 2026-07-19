// Uber Routes backend — geocoding + saved routes storage for the R1 creation.
// Self-rides only for now: rides are built entirely client-side as m.uber.com deep links + a QR
// code. Guest rides ("for someone else") were removed after confirming Uber's deep link scheme
// has no recipient parameter, and the in-app picker isn't reachable once a deep link has already
// opened the app -- see the "guest-rides-deeplink" git branch if that's ever worth revisiting.
// This backend never talks to Uber's API at all -- just Nominatim geocoding + JSON storage.
//
// Env:
//   PORT               (default 8788)
//   UBER_CLIENT_ID     optional, only used to decorate the deep link.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8788;
const CLIENT_ID = process.env.UBER_CLIENT_ID || '';

const DATA_FILE = path.join(__dirname, 'data.json'); // saved routes

// Static file serving for the creation + setup page (relative to repo root).
const ROOT = path.join(__dirname, '..');
const STATIC = {
  '/':       { file: 'r1/index.html', type: 'text/html' },
  '/index.html': { file: 'r1/index.html', type: 'text/html' },
  '/qrcode.js':  { file: 'r1/qrcode.js', type: 'application/javascript' },
  '/setup':      { file: 'setup/index.html', type: 'text/html' },
  '/setup/':     { file: 'setup/index.html', type: 'text/html' }
};
function serveStatic(res, key) {
  const s = STATIC[key]; if (!s) return false;
  const fp = path.join(ROOT, s.file);
  if (!fs.existsSync(fp)) return false;
  res.writeHead(200, { 'Content-Type': s.type + '; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(fs.readFileSync(fp));
  return true;
}

// ---------- tiny persistence (single user) ----------
// Older entries saved before ids/aliases existed get backfilled on first load so
// edit/delete (which key off id, since a renamed route can't be matched by name) work
// for pre-existing data too.
function ensureIds(d) {
  var changed = false;
  (d.routes || []).forEach(function (r) { if (!r.id) { r.id = crypto.randomUUID(); changed = true; } if (!r.aliases) { r.aliases = []; changed = true; } });
  return changed;
}
function load() {
  var d;
  try { d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { d = { routes: [] }; }
  d.routes = d.routes || [];
  if (ensureIds(d)) save(d);
  return d;
}
function save(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

// ---------- http helpers ----------
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); }
    });
  });
}

// ---------- geocode via Nominatim (no key) ----------
async function geocode(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'User-Agent': 'uber-routes-creation/1.0' } });
  const j = await r.json();
  if (!j.length) throw new Error('No match for "' + q + '"');
  const hit = j[0];
  // "confident" = specific enough to skip the "did you mean" screen: either it resolved to
  // an exact building (has a house number) or it's a prominent/well-known place (Nominatim's
  // own importance score), vs. a fuzzy match over a whole city/road that genuinely needs review.
  const confident = !!(hit.address && hit.address.house_number) || parseFloat(hit.importance || 0) > 0.6;
  return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), addr: hit.display_name, confident: confident };
}

// ---------- reverse geocode (device GPS coords -> street address) ----------
async function reverseGeocode(lat, lng) {
  const url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng);
  const r = await fetch(url, { headers: { 'User-Agent': 'uber-routes-creation/1.0' } });
  const j = await r.json();
  if (!j || j.error || !j.display_name) throw new Error('No address for that location');
  return { addr: j.display_name };
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;

    if (req.method === 'GET' && p === '/config') {
      return send(res, 200, { clientId: CLIENT_ID });
    }

    // static assets (creation + setup page)
    if (req.method === 'GET' && serveStatic(res, p)) return;

    if (req.method === 'GET' && p === '/routes') {
      return send(res, 200, load());
    }

    if (req.method === 'POST' && p === '/routes') {
      const body = await readBody(req);
      const d = load();
      if (body.route) { d.routes = d.routes || []; d.routes.push(Object.assign({ id: crypto.randomUUID(), aliases: [] }, body.route)); }
      save(d);
      return send(res, 200, d);
    }

    // Edit or delete a saved route (matched by stable id, since a rename would break name-matching).
    {
      const m = p.match(/^\/routes\/([^\/]+)$/);
      if (m && (req.method === 'PUT' || req.method === 'DELETE')) {
        const id = decodeURIComponent(m[1]);
        const d = load();
        const idx = (d.routes || []).findIndex(r => r.id === id);
        if (idx === -1) return send(res, 404, { error: 'route not found' });
        if (req.method === 'DELETE') { d.routes.splice(idx, 1); save(d); return send(res, 200, d); }
        const body = await readBody(req);
        d.routes[idx] = Object.assign({}, d.routes[idx], body.route, { id });
        save(d);
        return send(res, 200, d);
      }
    }

    if (req.method === 'GET' && p === '/geocode') {
      const q = u.searchParams.get('q');
      if (!q) return send(res, 400, { error: 'missing q' });
      const g = await geocode(q);
      return send(res, 200, g);
    }

    if (req.method === 'GET' && p === '/reverse-geocode') {
      const lat = u.searchParams.get('lat'), lng = u.searchParams.get('lng');
      if (!lat || !lng) return send(res, 400, { error: 'missing lat/lng' });
      const g = await reverseGeocode(lat, lng);
      return send(res, 200, g);
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: e.message, detail: e.detail || null });
  }
});

server.listen(PORT, () => {
  console.log('Uber Routes backend on :' + PORT);
});
