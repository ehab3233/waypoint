'use strict';

// The optimizer is deliberately fast and dumb: brute-force permutations
// over the pairwise cost matrix from the graph layer. 8! = 40,320 — trivial.

const { PROFILES, ALL_MODES, Graph } = require('./graph');
const { railPassVerdict } = require('./railpass');

const MODE_LABEL = { train: 'rail', bus: 'coach', flight: 'flights', ferry: 'ferries' };

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

function routeScore(graph, profile, order, roundTrip, modes) {
  let score = 0;
  const seq = roundTrip ? [...order, order[0]] : order;
  for (let i = 0; i < seq.length - 1; i++) {
    const hop = graph.hop(profile, seq[i], seq[i + 1], modes);
    if (!hop) return Infinity;
    score += hop.score;
  }
  return score;
}

function buildHops(graph, profile, order, roundTrip, modes) {
  const seq = roundTrip ? [...order, order[0]] : order;
  const hops = [];
  for (let i = 0; i < seq.length - 1; i++) hops.push(graph.hop(profile, seq[i], seq[i + 1], modes));
  return hops;
}

// Nearest-neighbour by geography from the same starting city — the order a
// human eyeballing a map would pick. The baseline for "why this won".
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

function explain(graph, order, hops, naive, roundTrip, modes, nightsFor) {
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

  // Long overland journeys that a flight rescued.
  for (const hop of hops) {
    const flightSeg = hop.segments.find((s) => s.mode === 'flight');
    if (flightSeg && hop.durationMin > 240) {
      notes.push(
        `${name(hop.from)} → ${name(hop.to)} is a ${flightSeg.estimated ? 'flight' : `€${flightSeg.price} ${flightSeg.op} flight`} for a reason — overland this pair is a multi-day slog, and the air network only connects it through ${hop.segments.length > 1 ? 'a hub' : 'a direct service'}.`
      );
      break;
    }
  }

  for (const hop of hops) {
    const cheapFlight = hop.segments.find((s) => s.mode === 'flight' && !s.estimated && s.price <= 45);
    if (cheapFlight) {
      notes.push(
        `The €${cheapFlight.price} ${cheapFlight.op} hop ${name(cheapFlight.from)}→${name(cheapFlight.to)} is doing heavy lifting — these two are not surface-transport neighbours, and budget carriers only fly where their hubs are.`
      );
      break;
    }
  }

  if (!roundTrip && order.length > 1) {
    const ret = graph.hop('cheapest', order[order.length - 1], order[0], modes);
    if (ret) {
      notes.push(
        `Open-jaw: arrive in ${name(order[0])}, leave from ${name(order[order.length - 1])}. Forcing a return to ${name(order[0])} would add ~€${ret.price} and ${fmtDur(ret.durationMin)}.`
      );
    }
  }

  const zeroNight = order.filter((id) => nightsFor(id) === 0);
  if (zeroNight.length) {
    notes.push(
      `${zeroNight.map(name).join(' and ')} ${zeroNight.length === 1 ? 'is' : 'are'} set to zero nights — that is a drive-by, not a visit. Raise the per-city stay if you actually want to see ${zeroNight.length === 1 ? 'it' : 'them'}.`
    );
  }

  if (modes.length < ALL_MODES.length) {
    notes.push(
      `Limited to ${modes.map((m) => MODE_LABEL[m]).join(', ')} — excluding the other modes may be what makes this order win.`
    );
  }

  return notes.slice(0, 6);
}

function plan(graph, opts, passes) {
  const {
    cityIds,
    locks = {},
    roundTrip = false,
    nights = {},
    defaultNights = 2,
    modes: rawModes,
  } = opts || {};

  if (!Array.isArray(cityIds) || cityIds.length < 2 || cityIds.length > 8) {
    throw Object.assign(new Error('Pick between 2 and 8 destinations.'), { status: 400 });
  }
  for (const id of cityIds) {
    if (!graph.city(id)) throw Object.assign(new Error(`Unknown city: ${id}`), { status: 400 });
  }
  if (new Set(cityIds).size !== cityIds.length) {
    throw Object.assign(new Error('Duplicate destinations in the list.'), { status: 400 });
  }

  const modes = Graph.normaliseModes(rawModes);
  const clampNights = (v) => Math.max(0, Math.min(30, Math.round(Number(v) || 0)));
  const baseNights = clampNights(defaultNights);
  const nightsFor = (id) =>
    Object.prototype.hasOwnProperty.call(nights, id) ? clampNights(nights[id]) : baseNights;

  const itineraries = [];
  for (const profile of Object.keys(PROFILES)) {
    let bestOrder = null;
    let bestScore = Infinity;
    for (const order of orderings(cityIds, locks)) {
      const s = routeScore(graph, profile, order, roundTrip, modes);
      if (s < bestScore) {
        bestScore = s;
        bestOrder = order;
      }
    }
    if (!bestOrder || bestScore === Infinity) {
      throw Object.assign(
        new Error(
          modes.length < ALL_MODES.length
            ? `No route connects these destinations using only ${modes.map((m) => MODE_LABEL[m]).join(', ')}. Try allowing more transport modes.`
            : 'No feasible route connects these destinations.'
        ),
        { status: 422 }
      );
    }

    const hops = buildHops(graph, profile, bestOrder, roundTrip, modes);
    const t = totals(hops);
    const naiveOrder = geographicOrder(graph, cityIds, bestOrder[0]);
    const naiveHops = buildHops(graph, profile, naiveOrder, roundTrip, modes);
    const naive = naiveHops.every(Boolean)
      ? { order: naiveOrder, totals: totals(naiveHops) }
      : null;

    const nightsTotal = bestOrder.reduce((s, id) => s + nightsFor(id), 0);
    const longHaulDays = hops.filter((h) => h.durationMin > 720).length;
    const estDays = nightsTotal + 1 + longHaulDays;

    itineraries.push({
      profile,
      label: PROFILES[profile].label,
      order: bestOrder,
      roundTrip,
      modes,
      nights: Object.fromEntries(bestOrder.map((id) => [id, nightsFor(id)])),
      totals: { ...t, estDays, nights: nightsTotal, estimated: hops.some((h) => h.estimated) },
      hops,
      railPass: railPassVerdict(hops, passes),
      notes: explain(graph, bestOrder, hops, naive, roundTrip, modes, nightsFor),
      naive,
    });
  }
  return itineraries;
}

module.exports = { plan, geographicOrder, fmtDur };
