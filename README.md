# 🧭 Waypoint

**Enter a list of destinations, get the optimal order — and the actual way to travel between them.**

Rome2Rio answers A→B. Waypoint answers *"here are five places, sort it out."* It treats a multi-city trip as a travelling-salesman problem weighted by **real multimodal cost and time**, not geographic distance, and returns three ranked itineraries: **Cheapest**, **Fastest**, and **Least Painful** — each with an explanation of *why* that order won.

Worldwide: **396 cities across 126 countries**, routed over rail, coach, ferry and air.

![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20PostgreSQL-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **Optimal ordering** — brute-force over every permutation (≤8 stops → ≤40,320 orders, trivial) scored against a multimodal fare graph
- **Worldwide** — 396 cities, 126 countries, seven regions; curated rail/coach/ferry corridors plus a modelled global air network
- **Pick your transport** — include or exclude rail, coach, flights and ferries; anything over ~8 hours overland routes by air unless you turn flights off
- **Per-city nights** — set the stay for each destination independently (4 nights in Kyoto, 1 in Florence), not one global slider
- **Pin & lock** — fix cities to positions (flight already booked, wedding on the 14th); everything else reorders around them
- **Backtracking allowed** — if Belgium→Germany→Belgium genuinely beats the clean loop, Waypoint says so out loud
- **Open-jaw aware** — fly into Amsterdam, out of Munich; no silent return-trip inflation (and it tells you what a forced return would cost)
- **Rail pass math** — one line: does an Interrail Global pass beat point-to-point for *this* route, reservations included?
- **Hub-and-spoke reality** — spokes feed their nearest hubs, hubs connect regionally, only intercontinental gateways carry long haul; a connection costs real time and money rather than appearing as a fictional nonstop
- **Backspace protection** — the first backspace only *arms* the last destination; it takes a second press to remove it

## Install (bare-metal Linux VM)

One command on a fresh Debian/Ubuntu VM — fully hands-off. The script installs Node.js and PostgreSQL, **generates database credentials itself**, seeds the transport dataset, and registers a systemd service:

```bash
curl -fsSL https://raw.githubusercontent.com/ehab3233/waypoint/main/scripts/install.sh | sudo bash
```

Or from a clone:

```bash
git clone https://github.com/ehab3233/waypoint.git
cd waypoint
sudo ./scripts/install.sh
```

When it finishes, the app is live at `http://<vm-ip>:8080`. Options via environment variables: `WAYPOINT_PORT`, `WAYPOINT_REPO`, `WAYPOINT_BRANCH`.

## Update

```bash
sudo /opt/waypoint/scripts/update.sh
```

Pulls the latest code from git, reinstalls dependencies, re-seeds the dataset (search history and credentials are preserved), restarts the service, and health-checks the result. Re-running `install.sh` is also safe and idempotent.

## Development

No database needed — with `DATABASE_URL` unset, the server reads `data/dataset.json` directly:

```bash
npm install
npm start        # http://localhost:8080
npm test         # optimizer smoke tests, no DB required
```

## Architecture

```
public/            single-page frontend (vanilla JS + Leaflet)
server/index.js    Express API: /api/cities, /api/plan, /api/health
server/graph.js    edge-cost layer — binary-heap Dijkstra over the multimodal leg
                   graph, per-style cost blends, mode filtering, airport overhead,
                   connection and layover buffers
server/flights.js  hub-and-spoke air-network model (spoke feeders, hub pairs,
                   gateway long haul) with distance-fitted fares and durations
server/optimizer.js brute-force permutation search + explanations ("fast and dumb")
server/railpass.js Interrail vs point-to-point comparison
server/seed.js     idempotent schema + dataset load into PostgreSQL
data/dataset.json  396 cities / 126 countries, 201 curated legs; ~8,450 further
                   air legs are generated at load time from the hub model
public/vendor/ds/  the Modernist design system (tokens + components) and Archivo,
                   both vendored so the VM needs no outbound network to render
scripts/           install.sh (bare-metal), update.sh (git-based updates)
```

The edge-cost lookup is deliberately separated from the optimizer: the optimizer is fast and dumb (pure permutation search over a pairwise matrix), while all multimodal complexity — mode blending, airport overhead, ticket-connection buffers, pathfinding through intermediate cities — lives in the cached graph layer. Swapping the static dataset for live aggregator APIs (Kiwi/Duffel for flights, per-operator rail feeds) only touches that layer.

### Data honesty

Surface corridors (rail, coach, ferry) and budget-carrier flights are **curated typical values** for concept validation, not live quotes. Rail legs carry pass-coverage and seat-reservation metadata so the rail-pass verdict is honest.

Longer air legs are **modelled, not curated**, and are always marked `EST` in the UI. The model is deliberately conservative about what connects to what:

| Distance | Who gets a direct flight |
|---|---|
| under 350 km | nobody — surface transport always wins |
| up to 1,200 km | any two hubs, plus a spoke into its nearest hubs |
| up to 5,000 km | hub to hub |
| up to 16,000 km | intercontinental gateway to gateway only |

Everything else has to connect, and each connection costs a real transfer in time and money. Fares are fitted to typical advance-purchase economy quotes (~€44 at 500 km, ~€284 at 6,000 km); durations assume 40 minutes on the ground plus 780 km/h.

### The map

The itinerary map uses CARTO basemap tiles, the only outbound network call the app makes. On a VM without internet access the map degrades to routes and numbered stops on a plain ground — everything else keeps working.

## API

```
GET  /api/health           service status, data source, curated + modelled leg counts
GET  /api/cities           available destinations (id, name, country, region, coords)
POST /api/plan             { cities: [ids],            // 2-8 city ids, any order
                             locks:  {id: slot},       // optional fixed positions
                             nights: {id: n},          // optional per-city nights
                             defaultNights: 2,         // fallback for unlisted cities
                             modes:  ["train","bus","flight","ferry"],
                             roundTrip: false }
                           → { itineraries: [ {profile, order, hops, totals,
                                               nights, railPass, notes} ] }
```

## License

MIT
