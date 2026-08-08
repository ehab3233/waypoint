'use strict';

// The optimizer is deliberately fast and dumb: brute-force permutations
// over the pairwise cost matrix from the graph layer. 8! = 40,320 — trivial.

const { PROFILES } = require('./graph');
const { railPassVerdict } = require('./railpass');

function fmtDur(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function* permutations(arr) {
  if (arr.length <= 1) {
    yield arr.slice();
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

// locks: { cityId: slotIndex } — 0-based fixed positions. Free cities are
// permuted into the remaining slots around them.
function* orderings(cityIds, locks) {
  const n = cityIds.length;
  const slots = new Array(n).fill(null);
  const freeSlots = [];
  for (const [id, pos] of Object.entries(locks)) {
    if (pos >= 0 && pos < n && cityIds.includes(id)) slots[pos] = id;
  }
  const lockedIds = new Set(slots.filter(Boolean));
  const free = cityIds.filter((id) => !lockedIds.has(id));
  for (let i = 0; i < n; i++) if (slots[i] === null) freeSlots.push(i);

  for (const perm of permutations(free)) {
    const order = slots.slice();
    freeSlots.forEach((slot, i) => (order[slot] = perm[i]));
    yield order;
  }
}

function routeScore(graph, profile, order, roundTrip) {
  let score = 0;
  const seq = roundTrip ? [...order, order[0]] : order;
  for (let i = 0; i < seq.length - 1; i++) {
    const hop = graph.hop(profile, seq[i], seq[i + 1]);
    if (!hop) return Infinity;
    score += hop.score;
  }
  return score;
}

function buildHops(graph, profile, order, roundTrip) {
  const seq = roundTrip ? [...order, order[0]] : order;
  const hops = [];
  for (let i = 0; i < seq.length - 1; i++) hops.push(graph.hop(profile, seq[i], seq[i + 1]));
  return hops;
}

// Nearest-neighbour by geography from the same starting city — the order a
// human eyeballing a map would pick. Used as the baseline for "why this won".
function geographicOrder(graph, cityIds, startId) {
  const remaining = new Set(cityIds);
  const order = [startId];
  remaining.delete(startId);
  let cur = startId;
  while (remaining.size) {
    let best = null;
    let bestD = Infinity;
    for (const id of remaining) {
      const d = graph.distanceKm(cur, id);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    order.push(best);
    remaining.delete(best);
    cur = best;
  }
  return order;
}

function totals(hops) {
  return {
    price: hops.reduce((s, h) => s + h.price, 0),
    durationMin: hops.reduce((s, h) => s + h.durationMin, 0),
    transfers: hops.reduce((s, h) => s + h.transfers, 0),
    hops: hops.length,
  };
}

function detectBacktrack(graph, order) {
  const seq = order.map((id) => graph.city(id).country);
  const seen = new Set();
  let prev = null;
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i];
    if (c !== prev && seen.has(c)) return { country: c, position: i };
    seen.add(c);
    prev = c;
  }
  return null;
}

function explain(graph, profile, order, hops, naive, roundTrip) {
  const notes = [];
  const name = (id) => graph.city(id).name;

  if (naive && naive.order.join() !== order.join()) {
    const dPrice = naive.totals.price - totals(hops).price;
    const dTime = naive.totals.durationMin - totals(hops).durationMin;
    const parts = [];
    if (Math.round(dPrice) > 0) parts.push(`€${Math.round(dPrice)} cheaper`);
    if (dTime > 30) parts.push(`${fmtDur(dTime)} faster`);
    if (parts.length) {
      notes.push(
        `This order is ${parts.join(' and ')} than the geographically obvious route (${naive.order.map(name).join(' → ')}). Proximity on a map says little about price or speed.`
      );
    }
  } else if (naive) {
    notes.push('For once, the geographically obvious order is also the optimal one.');
  }

  const back = detectBacktrack(graph, order);
  if (back) {
    const hop = hops[back.position - 1];
    const seg = hop && hop.segments[0];
    notes.push(
      `Yes, this route re-enters ${back.country} — it looks wrong on a map, but ${seg ? `the €${seg.price} ${seg.op} ${name(seg.from)}→${name(seg.to)} leg` : 'the connection pricing'} makes the "messy" order genuinely better than a clean loop. Backtracking is allowed here on purpose.`
    );
  }

  for (const hop of hops) {
    for (const seg of hop.segments) {
      if (seg.mode === 'flight' && seg.price <= 45) {
        notes.push(
          `The €${seg.price} ${seg.op} hop ${name(seg.from)}→${name(seg.to)} is doing heavy lifting — these two are not surface-transport neighbours, and budget carriers only fly where their hubs are.`
        );
        break; // one flight callout per hop is enough
      }
    }
  }

  if (!roundTrip && order.length > 1) {
    const ret = graph.hop('cheapest', order[order.length - 1], order[0]);
    if (ret) {
      notes.push(
        `Open-jaw: arrive in ${name(order[0])}, leave from ${name(order[order.length - 1])}. Forcing a return to ${name(order[0])} would add ~€${ret.price} and ${fmtDur(ret.durationMin)}.`
      );
    }
  }

  return notes.slice(0, 5);
}

function plan(graph, { cityIds, locks = {}, roundTrip = false, minNights = 2 }, passes) {
  if (!Array.isArray(cityIds) || cityIds.length < 2 || cityIds.length > 8) {
    throw Object.assign(new Error('Pick between 2 and 8 destinations.'), { status: 400 });
  }
  for (const id of cityIds) {
    if (!graph.city(id)) throw Object.assign(new Error(`Unknown city: ${id}`), { status: 400 });
  }
  if (new Set(cityIds).size !== cityIds.length) {
    throw Object.assign(new Error('Duplicate destinations in the list.'), { status: 400 });
  }

  const itineraries = [];
  for (const profile of Object.keys(PROFILES)) {
    let bestOrder = null;
    let bestScore = Infinity;
    for (const order of orderings(cityIds, locks)) {
      const s = routeScore(graph, profile, order, roundTrip);
      if (s < bestScore) {
        bestScore = s;
        bestOrder = order;
      }
    }
    if (!bestOrder) {
      throw Object.assign(new Error('No feasible route connects these destinations.'), { status: 422 });
    }

    const hops = buildHops(graph, profile, bestOrder, roundTrip);
    const t = totals(hops);
    const naiveOrder = geographicOrder(graph, cityIds, bestOrder[0]);
    const naiveHops = buildHops(graph, profile, naiveOrder, roundTrip);
    const naive = naiveHops.every(Boolean)
      ? { order: naiveOrder, totals: totals(naiveHops) }
      : null;

    const nights = minNights * (bestOrder.length - (roundTrip ? 0 : 1));
    const estDays = Math.max(t.hops, Math.round(nights + t.durationMin / 60 / 12));

    const notes = explain(graph, profile, bestOrder, hops, naive, roundTrip);
    if (minNights === 0) {
      notes.push(
        'Minimum stay is 0 nights — some stops may turn into drive-by visits. Raise the slider if you actually want to see the cities.'
      );
    }

    itineraries.push({
      profile,
      label: PROFILES[profile].label,
      order: bestOrder,
      roundTrip,
      totals: { ...t, estDays, nights },
      hops,
      railPass: railPassVerdict(hops, passes),
      notes,
      naive,
    });
  }
  return itineraries;
}

module.exports = { plan, geographicOrder, fmtDur };
