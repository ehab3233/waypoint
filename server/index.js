'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { getPool } = require('./db');
const { Graph } = require('./graph');
const { plan } = require('./optimizer');

const PORT = Number(process.env.PORT || 8080);
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

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

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    dataSource,
    cities: cityList.length,
    curatedLegs: graph ? graph.curatedCount : 0,
    syntheticLegs: graph ? graph.syntheticCount : 0,
  });
});

app.get('/api/cities', (req, res) => {
  res.json(cityList);
});

app.post('/api/plan', (req, res) => {
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

    const pool = getPool();
    if (pool) {
      pool
        .query('INSERT INTO searches (payload) VALUES ($1)', [
          JSON.stringify({ cities: cityIds, locks, roundTrip, nights, defaultNights, modes }),
        ])
        .catch(() => {});
    }
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

loadData().then(() => {
  app.listen(PORT, () => console.log(`Waypoint listening on http://0.0.0.0:${PORT} (data: ${dataSource})`));
});
