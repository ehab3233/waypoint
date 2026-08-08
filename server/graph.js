'use strict';

// Edge-cost layer. The optimizer stays fast and dumb; all multimodal
// complexity (mode blending, airport overhead, connections, hub-and-spoke
// air routing, pathfinding through intermediate cities) lives here.

const { synthesiseFlights } = require('./flights');

const FLIGHT_OVERHEAD_MIN = 110; // airport transit + security + boarding, both ends combined
const CONNECTION_MIN = 60;       // buffer when chaining separate tickets through a city
const LAYOVER_MIN = 90;          // connecting between two flights costs more than a platform change

const ALL_MODES = ['train', 'bus', 'flight', 'ferry'];

// Scoring profiles. Each blends price, time and pain differently.
const PROFILES = {
  cheapest: {
    label: 'Cheapest',
    weigh: (leg) => leg.price + (leg.effMin / 60) * 2 + 2,
  },
  fastest: {
    label: 'Fastest',
    weigh: (leg) => leg.effMin + leg.price * 0.15 + 30,
  },
  comfy: {
    label: 'Least Painful',
    weigh: (leg) => {
      let pain = 35 + leg.xfers * 25;
      if (leg.mode === 'flight') pain += 25;          // airports are misery even when fast
      if (leg.effMin > 420) pain += 30;               // anything past 7h door-to-door hurts
      if (leg.mode === 'bus' && leg.effMin > 300) pain += 25;
      return leg.price * 0.45 + (leg.effMin / 60) * 18 + pain;
    },
  },
};

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Minimal binary min-heap — the network is large enough that a linear scan hurts. */
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function normaliseLeg(raw, id) {
  return {
    id,
    from: raw.from,
    to: raw.to,
    mode: raw.mode,
    price: Number(raw.price),
    min: Number(raw.min),
    effMin: Number(raw.min) + (raw.mode === 'flight' ? FLIGHT_OVERHEAD_MIN : 0),
    xfers: Number(raw.xfers) || 0,
    op: raw.op,
    pass: !!raw.pass,
    res: Number(raw.res) || 0,
    note: raw.note || null,
    estimated: !!raw.estimated,
  };
}

class Graph {
  /**
   * @param {Array} cities
   * @param {Array} legs   curated legs
   * @param {object} [opts] { synthesise?: boolean }
   */
  constructor(cities, legs, opts = {}) {
    const synthesise = opts.synthesise !== false;
    this.cities = new Map(cities.map((c) => [c.id, c]));
    this.adj = new Map(cities.map((c) => [c.id, []]));

    const curatedFlightPairs = new Set();
    for (const l of legs) {
      if (l.mode === 'flight') {
        curatedFlightPairs.add(l.from < l.to ? `${l.from}|${l.to}` : `${l.to}|${l.from}`);
      }
    }

    const synthetic = synthesise ? synthesiseFlights(cities, curatedFlightPairs) : [];
    this.curatedCount = legs.length;
    this.syntheticCount = synthetic.length;

    let i = 0;
    for (const raw of [...legs, ...synthetic]) {
      if (!this.adj.has(raw.from) || !this.adj.has(raw.to)) continue;
      const leg = normaliseLeg(raw, i++);
      this.adj.get(leg.from).push(leg);
      this.adj.get(leg.to).push({ ...leg, from: leg.to, to: leg.from });
    }

    this._cache = new Map(); // `${modeKey}:${profile}:${from}:${to}` -> hop
  }

  city(id) {
    return this.cities.get(id);
  }

  distanceKm(aId, bId) {
    return haversineKm(this.city(aId), this.city(bId));
  }

  static normaliseModes(modes) {
    if (!modes || !Array.isArray(modes) || modes.length === 0) return ALL_MODES.slice();
    const allowed = ALL_MODES.filter((m) => modes.includes(m));
    return allowed.length ? allowed : ALL_MODES.slice();
  }

  /**
   * Best way from `from` to `to` under a profile, restricted to `modes`.
   * Dijkstra over the multimodal leg graph, allowing multi-leg chains.
   */
  hop(profile, from, to, modes) {
    const allowed = Graph.normaliseModes(modes);
    const modeKey = allowed.join(',');
    const key = `${modeKey}:${profile}:${from}:${to}`;
    if (this._cache.has(key)) return this._cache.get(key);

    const allow = new Set(allowed);
    const weigh = PROFILES[profile].weigh;
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const done = new Set();
    const heap = new MinHeap();
    heap.push({ k: 0, v: from });

    while (heap.size) {
      const { k, v: u } = heap.pop();
      if (done.has(u)) continue;
      done.add(u);
      if (u === to) break;
      for (const leg of this.adj.get(u) || []) {
        if (!allow.has(leg.mode)) continue;
        if (done.has(leg.to)) continue;
        // Changing tickets mid-route costs real time; flight-to-flight costs more.
        let connMin = 0;
        if (u !== from) {
          const inbound = prev.get(u);
          connMin =
            inbound && inbound.mode === 'flight' && leg.mode === 'flight'
              ? LAYOVER_MIN
              : CONNECTION_MIN;
        }
        const w = k + weigh(leg) + (connMin / 60) * 4;
        if (w < (dist.get(leg.to) ?? Infinity)) {
          dist.set(leg.to, w);
          prev.set(leg.to, leg);
          heap.push({ k: w, v: leg.to });
        }
      }
    }

    let hop = null;
    if (dist.has(to) && (to === from || prev.has(to))) {
      const segments = [];
      let cur = to;
      let guard = 0;
      while (cur !== from && guard++ < 64) {
        const leg = prev.get(cur);
        if (!leg) break;
        segments.unshift(leg);
        cur = leg.from;
      }
      if (cur === from && segments.length) {
        let durationMin = 0;
        for (let s = 0; s < segments.length; s++) {
          durationMin += segments[s].effMin;
          if (s > 0) {
            durationMin +=
              segments[s - 1].mode === 'flight' && segments[s].mode === 'flight'
                ? LAYOVER_MIN
                : CONNECTION_MIN;
          }
        }
        const price = segments.reduce((s, l) => s + l.price, 0);
        const transfers = segments.length - 1 + segments.reduce((s, l) => s + l.xfers, 0);
        hop = {
          from,
          to,
          score: dist.get(to),
          price: Math.round(price),
          durationMin: Math.round(durationMin),
          transfers,
          estimated: segments.some((l) => l.estimated),
          segments: segments.map((l) => ({
            from: l.from,
            to: l.to,
            mode: l.mode,
            price: l.price,
            min: l.min,
            effMin: l.effMin,
            xfers: l.xfers,
            op: l.op,
            pass: l.pass,
            res: l.res,
            note: l.note,
            estimated: l.estimated,
          })),
        };
      }
    }
    this._cache.set(key, hop);
    return hop;
  }
}

module.exports = {
  Graph,
  PROFILES,
  ALL_MODES,
  FLIGHT_OVERHEAD_MIN,
  CONNECTION_MIN,
  LAYOVER_MIN,
};
