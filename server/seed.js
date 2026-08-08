'use strict';

// Idempotent schema + data load. Safe to re-run on every install/update:
// the dataset tables are rebuilt from data/dataset.json, search history is kept.

const fs = require('fs');
const path = require('path');
const { getPool } = require('./db');

async function main() {
  const pool = getPool();
  if (!pool) {
    console.error('DATABASE_URL is not set — nothing to seed. (Dev mode reads data/dataset.json directly.)');
    process.exit(1);
  }
  const dataset = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'dataset.json'), 'utf8')
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS cities (
        id      text PRIMARY KEY,
        name    text NOT NULL,
        country text NOT NULL,
        cc      text NOT NULL,
        region  text,
        lat     double precision NOT NULL,
        lon     double precision NOT NULL,
        hub     boolean NOT NULL DEFAULT false,
        gateway boolean NOT NULL DEFAULT false
      );
      CREATE TABLE IF NOT EXISTS legs (
        id       serial PRIMARY KEY,
        from_id  text NOT NULL REFERENCES cities(id),
        to_id    text NOT NULL REFERENCES cities(id),
        mode     text NOT NULL,
        price    numeric NOT NULL,
        min      integer NOT NULL,
        xfers    integer NOT NULL DEFAULT 0,
        op       text,
        pass     boolean NOT NULL DEFAULT false,
        res      numeric NOT NULL DEFAULT 0,
        note     text
      );
      CREATE TABLE IF NOT EXISTS rail_passes (
        id          serial PRIMARY KEY,
        name        text NOT NULL,
        travel_days integer NOT NULL,
        price       numeric NOT NULL
      );
      CREATE TABLE IF NOT EXISTS searches (
        id         serial PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        payload    jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key   text PRIMARY KEY,
        value text NOT NULL
      );
    `);

    // Older installs predate these columns; add them before loading.
    await client.query(`
      ALTER TABLE cities ADD COLUMN IF NOT EXISTS region text;
      ALTER TABLE cities ADD COLUMN IF NOT EXISTS hub boolean NOT NULL DEFAULT false;
      ALTER TABLE cities ADD COLUMN IF NOT EXISTS gateway boolean NOT NULL DEFAULT false;
    `);

    await client.query('TRUNCATE legs, rail_passes; DELETE FROM cities;');

    for (const c of dataset.cities) {
      await client.query(
        'INSERT INTO cities (id, name, country, cc, region, lat, lon, hub, gateway) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [c.id, c.name, c.country, c.cc, c.region || null, c.lat, c.lon, !!c.hub, !!c.gateway]
      );
    }
    for (const l of dataset.legs) {
      await client.query(
        'INSERT INTO legs (from_id, to_id, mode, price, min, xfers, op, pass, res, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [l.from, l.to, l.mode, l.price, l.min, l.xfers || 0, l.op, !!l.pass, l.res || 0, l.note || null]
      );
    }
    for (const p of dataset.railPasses) {
      await client.query('INSERT INTO rail_passes (name, travel_days, price) VALUES ($1,$2,$3)', [
        p.name,
        p.travelDays,
        p.price,
      ]);
    }
    await client.query(
      `INSERT INTO meta (key, value) VALUES ('dataset_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(dataset.version)]
    );
    await client.query('COMMIT');
    console.log(
      `Seeded ${dataset.cities.length} cities, ${dataset.legs.length} legs, ${dataset.railPasses.length} rail passes (dataset v${dataset.version}).`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
