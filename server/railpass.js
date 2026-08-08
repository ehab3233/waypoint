'use strict';

// One question, one answer: does a rail pass beat point-to-point tickets
// for this specific itinerary?

function railPassVerdict(hops, passes) {
  let coveredCost = 0; // what you'd pay point-to-point for the pass-covered rail legs
  let reservations = 0; // seat fees you still pay on top of a pass
  let railDays = 0; // travel days the pass would need to cover

  for (const hop of hops) {
    const railSegs = hop.segments.filter((s) => s.pass);
    if (railSegs.length === 0) continue;
    railDays += 1; // each hop happens on its own travel day
    for (const s of railSegs) {
      coveredCost += s.price;
      reservations += s.res;
    }
  }

  if (railDays < 2 || coveredCost === 0) {
    return {
      applicable: false,
      verdict: 'A rail pass makes no sense here — this route barely touches the rails.',
    };
  }

  const candidates = passes.filter((p) => p.travelDays >= railDays);
  const pass = candidates.length
    ? candidates.reduce((a, b) => (a.price <= b.price ? a : b))
    : passes.reduce((a, b) => (a.travelDays >= b.travelDays ? a : b));

  const passTotal = pass.price + reservations;
  const delta = Math.round(coveredCost - passTotal);

  return {
    applicable: true,
    passName: pass.name,
    passPrice: pass.price,
    reservations: Math.round(reservations),
    pointToPoint: Math.round(coveredCost),
    passTotal: Math.round(passTotal),
    delta,
    railDays,
    verdict:
      delta > 0
        ? `${pass.name} (€${pass.price} + €${Math.round(reservations)} reservations) beats €${Math.round(coveredCost)} in point-to-point tickets — you save €${delta}.`
        : `Skip the pass: point-to-point tickets total €${Math.round(coveredCost)}, while ${pass.name} would cost €${Math.round(passTotal)} incl. reservations (€${-delta} more).`,
  };
}

module.exports = { railPassVerdict };
