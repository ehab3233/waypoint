'use strict';

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  }
  return pool;
}

module.exports = { getPool };
