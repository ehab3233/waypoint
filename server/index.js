'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { getPool } = require('./db');
const { Graph } = require('./graph');
const { plan } = require('./optimizer');

const PORT = Number(process.env.PORT || 8080);
const app = express();

// This is a public origin (published through a Cloudflare tunnel), so the
// front door is hardened even though the app holds no accounts or user data.
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    // Self-hosted assets only; the map fetches CARTO tiles over https.
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: https://*.basemaps.cartocdn.com; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; " +
      "font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  next();
});

/**
 * Fixed-window rate limiting, in memory. Planning is CPU-bound and synchronous,
 * so an unthrottled /api/plan is a denial of service on a single-core VM: the
 * per-IP limit stops one client hogging it, and the global limit bounds how
 * much of each minute the box can be made to spend optimizing.
 */
function rateLimiter({ perIp, global: globalMax, windowMs, name }) {
  let windowStart = Date.now();
  let globalCount = 0;
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      globalCount = 0;
      hits.clear();
    }
    // Behind the tunnel every request shares a socket address, so prefer the
    // header Cloudflare sets. It is spoofable by a direct caller, which is why
    // the global limit exists as a backstop that no header can bypass.
    const ip = String(req.headers['cf-connecting-ip'] || req.ip || 'unknown').slice(0, 64);
    const used = (hits.get(ip) || 0) + 1;
    hits.set(ip, used);
    globalCount++;

    const retry = Math.ceil((windowStart + windowMs - now) / 1000);
    if (used > perIp) {
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: `Too many ${name} requests. Try again in ${retry}s.` });
    }
    if (globalCount > globalMax) {
      res.set('Retry-After', String(retry));
      return res.status(503).json({ error: 'Waypoint is busy right now. Try again shortly.' });
    }
    next();
  };
}

const planLimiter = rateLimiter({ perIp: 20, global: 120, windowMs: 60_000, name: 'planning' });
const readLimiter = rateLimiter({ perIp: 240, global: 3000, windowMs: 60_000, name: 'API' });

app.use(express.json({ limit: '32kb' }));
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

const SEARCH_LOG_LIMIT = 50000;
let searchWrites = 0;
let graph = null;
let passes = [];
let cityList = [];
let dataSource = 'file';

async function loadData() {
  const pool = getPool();
  if (pool) {
    try {
      const cities = (
        await pool.query(
          'SELECT id, name, country, cc, region, lat, lon, hub, gateway FROM cities ORDER BY name'
        )
      ).rows;
      const legs = (
        await pool.query(
          'SELECT from_id AS "from", to_id AS "to", mode, price::float, min, xfers, op, pass, res::float, note FROM legs'
        )
      ).rows;
      const passRows = (
        await pool.query('SELECT name, travel_days AS "travelDays", price::float FROM rail_passes ORDER BY price')
      ).rows;
      if (cities.length && legs.length) {
        cityList = cities;
        passes = passRows;
        graph = new Graph(cities, legs);
        dataSource = 'postgres';
        console.log(`[data] loaded ${cities.length} cities / ${legs.length} legs from PostgreSQL`);
        return;
      }
      console.warn('[data] database is empty — falling back to bundled dataset');
    } catch (err) {
      console.warn(`[data] database unavailable (${err.message}) — falling back to bundled dataset`);
    }
  }
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dataset.json'), 'utf8'));
  cityList = dataset.cities.slice().sort((a, b) => a.name.localeCompare(b.name));
  passes = dataset.railPasses;
  graph = new Graph(dataset.cities, dataset.legs);
  dataSource = 'file';
  console.log(`[data] loaded ${dataset.cities.length} cities / ${dataset.legs.length} legs from data/dataset.json`);
}

app.get('/api/health', readLimiter, (req, res) => {
  res.json({
    ok: true,
    dataSource,
    cities: cityList.length,
    curatedLegs: graph ? graph.curatedCount : 0,
    syntheticLegs: graph ? graph.syntheticCount : 0,
  });
});

app.get('/api/cities', readLimiter, (req, res) => {
  res.json(cityList);
});

app.post('/api/plan', planLimiter, (req, res) => {
  const body = req.body || {};
  const { cities: cityIds, locks, roundTrip, nights, defaultNights, modes } = body;
  try {
    const itineraries = plan(
      graph,
      {
        cityIds,
        locks: locks && typeof locks === 'object' ? locks : {},
        roundTrip: !!roundTrip,
        nights: nights && typeof nights === 'object' ? nights : {},
        defaultNights: defaultNights ?? 2,
        modes: Array.isArray(modes) ? modes : null,
      },
      passes
    );
    res.json({
      itineraries,
      cities: Object.fromEntries(
        [...new Set([].concat(...itineraries.map((i) => i.order)))].map((id) => [id, graph.city(id)])
      ),
    });

    // /api/plan is public and unauthenticated, so this write path is capped:
    // without a ceiling anyone could grow the table until the disk fills.
    const pool = getPool();
    if (pool) {
      pool
        .query('INSERT INTO searches (payload) VALUES ($1)', [
          JSON.stringify({ cities: cityIds, locks, roundTrip, nights, defaultNights, modes }),
        ])
        .then(() => {
          if (++searchWrites % 200 === 0) {
            return pool.query(
              'DELETE FROM searches WHERE id < (SELECT COALESCE(MAX(id), 0) - $1 FROM searches)',
              [SEARCH_LOG_LIMIT]
            );
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    if (err && err.status && err.status < 500) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[plan] unexpected error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Could not plan that trip.' });
  }
});

// Anything unmatched is not an invitation to probe.
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request too large.' });
  }
  if (err && err.status === 400) {
    return res.status(400).json({ error: 'Malformed request.' });
  }
  console.error('[http] unexpected error:', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Something went wrong.' });
});

loadData().then(() => {
  app.listen(PORT, () => console.log(`Waypoint listening on http://0.0.0.0:${PORT} (data: ${dataSource})`));
});
