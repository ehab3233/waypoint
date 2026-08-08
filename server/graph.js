'use strict';

// Edge-cost layer. The optimizer stays fast and dumb; all multimodal
// complexity (mode blending, airport overhead, connections, pathfinding
// through intermediate cities) lives here.

const FLIGHT_OVERHEAD_MIN = 110; // airport transit + security + boarding, both ends combined
const CONNECTION_MIN = 60;       // buffer when chaining separate tickets through a city

// Scoring profiles. score = wPrice*€ + wTime*(hours) + pain terms.
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

class Graph {
  constructor(cities, legs) {
    this.cities = new Map(cities.map((c) => [c.id, c]));
    this.adj = new Map(cities.map((c) => [c.id, []]));
    let i = 0;
    for (const raw of legs) {
      const leg = {
        id: i++,
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
      };
      if (!this.adj.has(leg.from) || !this.adj.has(leg.to)) continue;
      this.adj.get(leg.from).push({ ...leg });
      this.adj.get(leg.to).push({ ...leg, from: leg.to, to: leg.from });
    }
    this._cache = new Map(); // `${profile}:${from}:${to}` -> hop
  }

  city(id) {
    return this.cities.get(id);
  }

  distanceKm(aId, bId) {
    return haversineKm(this.city(aId), this.city(bId));
  }

  // Best way to get from a to b under a profile: Dijkstra over legs,
  // allowing multi-leg chains through intermediate cities.
  hop(profile, from, to) {
    const key = `${profile}:${from}:${to}`;
    if (this._cache.has(key)) return this._cache.get(key);

    const weigh = PROFILES[profile].weigh;
    const dist = new Map([[from, 0]]);
    const prev = new Map(); // city -> leg used to arrive
    const done = new Set();

    while (true) {
      let u = null;
      let best = Infinity;
      for (const [node, d] of dist) {
        if (!done.has(node) && d < best) {
          best = d;
          u = node;
        }
      }
      if (u === null) break;
      if (u === to) break;
      done.add(u);
      for (const leg of this.adj.get(u) || []) {
        const connPenalty = u === from ? 0 : CONNECTION_MIN; // changing tickets mid-route costs time
        const w = best + weigh(leg) + (connPenalty / 60) * 4;
        if (w < (dist.get(leg.to) ?? Infinity)) {
          dist.set(leg.to, w);
          prev.set(leg.to, leg);
        }
      }
    }

    let hop = null;
    if (dist.has(to)) {
      const segments = [];
      let cur = to;
      while (cur !== from) {
        const leg = prev.get(cur);
        segments.unshift(leg);
        cur = leg.from;
      }
      const price = segments.reduce((s, l) => s + l.price, 0);
      const durationMin =
        segments.reduce((s, l) => s + l.effMin, 0) + (segments.length - 1) * CONNECTION_MIN;
      const transfers = segments.length - 1 + segments.reduce((s, l) => s + l.xfers, 0);
      hop = {
        from,
        to,
        score: dist.get(to),
        price: Math.round(price),
        durationMin: Math.round(durationMin),
        transfers,
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
        })),
      };
    }
    this._cache.set(key, hop);
    return hop;
  }
}

module.exports = { Graph, PROFILES, FLIGHT_OVERHEAD_MIN, CONNECTION_MIN };
