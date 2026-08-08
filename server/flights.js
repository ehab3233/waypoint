'use strict';

// Synthesised air network.
//
// Hand-curating every city pair is impossible (396 cities = 78,210 pairs), and
// the brief is explicit that pretending "any two airports connect" produces
// fiction. So the air network is generated from a hub-and-spoke model instead:
//
//   • spoke cities connect only to their nearest few hubs (short regional legs)
//   • hubs connect to each other up to medium haul
//   • only intercontinental gateways carry the very long haul
//
// Anything else is reached by connecting — which the router discovers itself,
// paying a real transfer in time and money each time. That is why a flight is
// always available for a journey that would take 8+ hours overland, without
// every pair being a fictional nonstop.

const SHORT_HAUL_KM = 1200;   // any hub pair, plus spoke→hub feeders
const MEDIUM_HAUL_KM = 5000;  // hub↔hub ceiling
const LONG_HAUL_KM = 16000;   // gateway↔gateway ceiling
const MIN_FLIGHT_KM = 350;    // below this, surface transport always wins
const SPOKE_HUBS = 4;         // hubs a non-hub city feeds into

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Typical advance-purchase economy fare, fitted to real quotes:
// ~€44/500km, ~€92/2000km, ~€284/6000km, ~€476/10000km.
function estimatePrice(km) {
  return km <= 2000 ? 28 + 0.032 * km : 92 + 0.048 * (km - 2000);
}

// Gate-to-gate: 40 min for taxi, climb and descent, then ~780 km/h effective.
function estimateMinutes(km) {
  return Math.round(40 + (km / 780) * 60);
}

function classify(a, b, km) {
  if (km < MIN_FLIGHT_KM) return null;
  if (km <= SHORT_HAUL_KM) {
    if (a.hub && b.hub) return 'hub';
    if (a.hub || b.hub) return 'feeder'; // regional airport into its hub
    return null;
  }
  if (km <= MEDIUM_HAUL_KM) return a.hub && b.hub ? 'hub' : null;
  if (km <= LONG_HAUL_KM) return a.gateway && b.gateway ? 'gateway' : null;
  return null;
}

/**
 * Build synthetic flight legs for the whole city set.
 * @param {Array} cities  dataset cities (with hub / gateway flags)
 * @param {Set<string>} curatedPairs  "a|b" keys already covered by a real flight leg
 */
function synthesiseFlights(cities, curatedPairs = new Set()) {
  const hubs = cities.filter((c) => c.hub);
  const legs = [];
  const seen = new Set();

  const add = (a, b, km, kind) => {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (seen.has(key) || curatedPairs.has(key)) return;
    seen.add(key);
    const price = estimatePrice(km);
    legs.push({
      from: a.id,
      to: b.id,
      mode: 'flight',
      price: Math.round(price),
      min: estimateMinutes(km),
      xfers: 0,
      // Feeders are the short regional runs; they price a little above the
      // curve because they are thin routes with less competition.
      op: kind === 'feeder' ? 'Regional flight' : 'Scheduled flight',
      pass: false,
      res: 0,
      estimated: true,
      km: Math.round(km),
    });
  };

  for (let i = 0; i < cities.length; i++) {
    const a = cities[i];

    if (!a.hub) {
      // Spoke: feed into the nearest few hubs only.
      const nearest = hubs
        .map((h) => ({ h, km: haversineKm(a, h) }))
        .filter((x) => x.km >= MIN_FLIGHT_KM && x.km <= SHORT_HAUL_KM * 1.6)
        .sort((x, y) => x.km - y.km)
        .slice(0, SPOKE_HUBS);
      for (const { h, km } of nearest) add(a, h, km, 'feeder');
      // A spoke with no hub in range (remote islands) still needs one link out.
      if (nearest.length === 0) {
        let best = null;
        for (const h of hubs) {
          const km = haversineKm(a, h);
          if (km >= MIN_FLIGHT_KM && (!best || km < best.km)) best = { h, km };
        }
        if (best) add(a, best.h, best.km, 'feeder');
      }
      continue;
    }

    for (let j = i + 1; j < cities.length; j++) {
      const b = cities[j];
      if (!b.hub) continue; // spoke links were handled from the spoke's own side
      const km = haversineKm(a, b);
      const kind = classify(a, b, km);
      if (kind) add(a, b, km, kind);
    }
  }

  return legs;
}

module.exports = {
  synthesiseFlights,
  haversineKm,
  estimatePrice,
  estimateMinutes,
  MIN_FLIGHT_KM,
};
