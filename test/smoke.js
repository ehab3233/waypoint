'use strict';

// Smoke test: builds the graph straight from the bundled dataset (no DB)
// and checks that the optimizer produces sane, connected results.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Graph, PROFILES, ALL_MODES } = require('../server/graph');
const { plan } = require('../server/optimizer');

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dataset.json'), 'utf8'));
const graph = new Graph(dataset.cities, dataset.legs);
const ids = dataset.cities.map((c) => c.id);

// 0. Dataset integrity.
assert.strictEqual(new Set(ids).size, ids.length, 'duplicate city ids');
for (const c of dataset.cities) {
  assert(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180, `bad coords for ${c.id}`);
  assert(c.region, `${c.id} has no region`);
  if (c.gateway) assert(c.hub, `${c.id} is a gateway but not a hub`);
}
const cityIdSet = new Set(ids);
for (const l of dataset.legs) {
  assert(cityIdSet.has(l.from), `leg references unknown city ${l.from}`);
  assert(cityIdSet.has(l.to), `leg references unknown city ${l.to}`);
  assert(ALL_MODES.includes(l.mode), `unknown mode ${l.mode}`);
  assert(l.price >= 0 && l.min > 0, `bad leg numbers ${l.from}->${l.to}`);
}
console.log(`✓ dataset: ${ids.length} cities, ${new Set(dataset.cities.map((c) => c.country)).size} countries, ${dataset.legs.length} curated legs`);
console.log(`✓ air network: ${graph.syntheticCount} modelled legs from the hub-and-spoke model`);

// 1. Every city is reachable from every other — proven by a single traversal,
//    since the graph is undirected (each leg is inserted both ways).
const seen = new Set([ids[0]]);
const queue = [ids[0]];
while (queue.length) {
  const u = queue.shift();
  for (const leg of graph.adj.get(u) || []) {
    if (!seen.has(leg.to)) {
      seen.add(leg.to);
      queue.push(leg.to);
    }
  }
}
assert.strictEqual(seen.size, ids.length, `unreachable cities: ${ids.filter((i) => !seen.has(i)).join(', ')}`);
console.log(`✓ all ${ids.length} cities are mutually reachable`);

// 2. Sampled hops return sane numbers under every profile.
let sampled = 0;
for (let i = 0; i < ids.length; i += 17) {
  for (let j = 3; j < ids.length; j += 29) {
    if (ids[i] === ids[j]) continue;
    for (const profile of Object.keys(PROFILES)) {
      const hop = graph.hop(profile, ids[i], ids[j]);
      assert(hop, `no hop ${ids[i]} -> ${ids[j]} (${profile})`);
      assert(hop.price > 0 && hop.durationMin > 0, `bad hop numbers ${ids[i]} -> ${ids[j]}`);
      assert(hop.segments.length >= 1, 'hop with no segments');
      assert.strictEqual(hop.segments[0].from, ids[i], 'hop does not start at origin');
      assert.strictEqual(hop.segments[hop.segments.length - 1].to, ids[j], 'hop does not end at destination');
      sampled++;
    }
  }
}
console.log(`✓ ${sampled} sampled hops well-formed across all profiles`);

// 3. Basic plan: the brief's own example.
const itins = plan(
  graph,
  { cityIds: ['amsterdam', 'cologne', 'copenhagen', 'berlin', 'prague'], defaultNights: 2 },
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

// 4. Intercontinental trips route and stay plausible.
const world = plan(
  graph,
  { cityIds: ['london', 'tokyo', 'sydney', 'new_york'], defaultNights: 3 },
  dataset.railPasses
);
for (const it of world) {
  assert.strictEqual(it.order.length, 4);
  assert(it.totals.price > 500, 'a four-continent trip should not be cheap');
  assert(it.hops.every((h) => h.segments.every((s) => s.mode === 'flight')), 'oceans need flights');
}
console.log('✓ intercontinental routing works');

// 5. Long overland pairs get an air option (the ">8 hours" rule).
for (const [a, b] of [['london', 'istanbul'], ['delhi', 'bangkok'], ['lima', 'santiago'], ['cairo', 'nairobi']]) {
  const hop = graph.hop('fastest', a, b);
  assert(hop.segments.some((s) => s.mode === 'flight'), `${a} -> ${b} should offer a flight`);
  assert(hop.durationMin < 24 * 60, `${a} -> ${b} should be under a day by air`);
}
console.log('✓ long-haul pairs always offer a flight');

// 6. Mode filtering is respected, and excluding everything is caught.
const railOnly = plan(
  graph,
  { cityIds: ['paris', 'milan', 'vienna', 'berlin'], modes: ['train'], defaultNights: 2 },
  dataset.railPasses
);
for (const it of railOnly) {
  for (const hop of it.hops) {
    for (const seg of hop.segments) assert.strictEqual(seg.mode, 'train', 'rail-only leaked another mode');
  }
}
console.log('✓ rail-only routing uses rail only');

assert.throws(
  () => plan(graph, { cityIds: ['london', 'tokyo'], modes: ['train'] }, dataset.railPasses),
  /No route connects/,
  'rail-only London to Tokyo should fail loudly'
);
console.log('✓ impossible mode restrictions fail with a clear message');

// 7. Per-city nights feed the trip length.
const nightsPlan = plan(
  graph,
  {
    cityIds: ['rome', 'florence', 'venice'],
    nights: { rome: 4, florence: 1, venice: 2 },
    defaultNights: 2,
  },
  dataset.railPasses
);
for (const it of nightsPlan) {
  assert.strictEqual(it.nights.rome, 4);
  assert.strictEqual(it.nights.florence, 1);
  assert.strictEqual(it.nights.venice, 2);
  assert.strictEqual(it.totals.nights, 7);
  assert(it.totals.estDays >= 8, 'trip length should include the nights');
}
console.log('✓ per-city nights drive trip length');

// 8. Locks are respected.
const locked = plan(
  graph,
  { cityIds: ['lisbon', 'madrid', 'paris', 'london'], locks: { london: 0, lisbon: 3 }, defaultNights: 1 },
  dataset.railPasses
);
for (const it of locked) {
  assert.strictEqual(it.order[0], 'london', 'start lock violated');
  assert.strictEqual(it.order[3], 'lisbon', 'end lock violated');
}
console.log('✓ position locks respected');

// 9. Round trip closes the loop.
const round = plan(
  graph,
  { cityIds: ['paris', 'brussels', 'amsterdam'], roundTrip: true, defaultNights: 2 },
  dataset.railPasses
);
for (const it of round) assert.strictEqual(it.hops.length, 3, 'round trip should close the loop');
console.log('✓ round trip closes the loop');

// 10. Validation errors.
assert.throws(() => plan(graph, { cityIds: ['paris'] }, dataset.railPasses), /between 2 and 8/);
assert.throws(() => plan(graph, { cityIds: ['paris', 'narnia'] }, dataset.railPasses), /Unknown city/);
assert.throws(() => plan(graph, { cityIds: ['paris', 'paris', 'rome'] }, dataset.railPasses), /Duplicate/);
assert.throws(
  () => plan(graph, { cityIds: ids.slice(0, 9) }, dataset.railPasses),
  /between 2 and 8/,
  'nine destinations should be rejected'
);
console.log('✓ input validation');

// 11. Eight destinations still plan quickly (40,320 orderings per profile).
const t0 = Date.now();
plan(
  graph,
  {
    cityIds: ['london', 'paris', 'rome', 'cairo', 'dubai', 'delhi', 'bangkok', 'singapore'],
    defaultNights: 2,
  },
  dataset.railPasses
);
const ms = Date.now() - t0;
assert(ms < 15000, `eight-city plan took ${ms}ms`);
console.log(`✓ eight destinations planned in ${ms}ms`);

console.log('\nAll smoke tests passed.');
