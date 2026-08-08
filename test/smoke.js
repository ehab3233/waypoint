'use strict';

// Smoke test: builds the graph straight from the bundled dataset (no DB)
// and checks that the optimizer produces sane, connected results.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Graph, PROFILES } = require('../server/graph');
const { plan } = require('../server/optimizer');

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dataset.json'), 'utf8'));
const graph = new Graph(dataset.cities, dataset.legs);
const ids = dataset.cities.map((c) => c.id);

// 1. Every pair of cities must be reachable under every profile.
for (const profile of Object.keys(PROFILES)) {
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const hop = graph.hop(profile, a, b);
      assert(hop, `unreachable: ${a} -> ${b} (${profile})`);
      assert(hop.price > 0 && hop.durationMin > 0, `bad hop numbers: ${a} -> ${b}`);
    }
  }
}
console.log(`✓ all ${ids.length * (ids.length - 1)} city pairs reachable under all ${Object.keys(PROFILES).length} profiles`);

// 2. Basic plan: the brief's own example.
const itins = plan(
  graph,
  { cityIds: ['amsterdam', 'cologne', 'copenhagen', 'berlin', 'prague'], minNights: 2 },
  dataset.railPasses
);
assert.strictEqual(itins.length, 3);
for (const it of itins) {
  assert.strictEqual(it.order.length, 5);
  assert.strictEqual(new Set(it.order).size, 5);
  assert.strictEqual(it.hops.length, 4);
  assert(it.totals.price > 0);
  assert(Array.isArray(it.notes) && it.notes.length > 0);
  assert(typeof it.railPass.verdict === 'string');
}
const cheapest = itins.find((i) => i.profile === 'cheapest');
const fastest = itins.find((i) => i.profile === 'fastest');
assert(cheapest.totals.price <= fastest.totals.price + 1, 'cheapest should not cost more than fastest');
assert(fastest.totals.durationMin <= cheapest.totals.durationMin + 1, 'fastest should not be slower than cheapest');
console.log('✓ 3 itineraries with coherent cheapest/fastest ordering');

// 3. Locks are respected.
const locked = plan(
  graph,
  {
    cityIds: ['lisbon', 'madrid', 'paris', 'london'],
    locks: { london: 0, lisbon: 3 },
    minNights: 1,
  },
  dataset.railPasses
);
for (const it of locked) {
  assert.strictEqual(it.order[0], 'london', 'start lock violated');
  assert.strictEqual(it.order[3], 'lisbon', 'end lock violated');
}
console.log('✓ position locks respected');

// 4. Round trip adds the closing hop.
const round = plan(
  graph,
  { cityIds: ['paris', 'brussels', 'amsterdam'], roundTrip: true, minNights: 2 },
  dataset.railPasses
);
for (const it of round) assert.strictEqual(it.hops.length, 3, 'round trip should close the loop');
console.log('✓ round trip closes the loop');

// 5. Validation errors.
assert.throws(() => plan(graph, { cityIds: ['paris'] }, dataset.railPasses), /between 2 and 8/);
assert.throws(() => plan(graph, { cityIds: ['paris', 'narnia'] }, dataset.railPasses), /Unknown city/);
assert.throws(
  () => plan(graph, { cityIds: ['paris', 'paris', 'rome'] }, dataset.railPasses),
  /Duplicate/
);
console.log('✓ input validation');

console.log('\nAll smoke tests passed.');
