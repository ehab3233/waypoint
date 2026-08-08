# 🧭 Waypoint

**Enter a list of destinations, get the optimal order — and the actual way to travel between them.**

Rome2Rio answers A→B. Waypoint answers *"here are five places, sort it out."* It treats a multi-city trip as a travelling-salesman problem weighted by **real multimodal cost and time**, not geographic distance, and returns three ranked itineraries: **Cheapest**, **Fastest**, and **Least Painful** — each with an explanation of *why* that order won.

![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20PostgreSQL-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **Optimal ordering** — brute-force over every permutation (≤8 stops → ≤40,320 orders, trivial) scored against a curated multimodal fare graph
- **Pin & lock** — fix cities to positions (flight already booked, wedding on the 14th); everything else reorders around them
- **Backtracking allowed** — if Belgium→Germany→Belgium genuinely beats the clean loop, Waypoint says so out loud
- **Open-jaw aware** — fly into Amsterdam, out of Munich; no silent return-trip inflation (and it tells you what a forced return would cost)
- **Rail pass math** — one line: does an Interrail Global pass beat point-to-point for *this* route, reservations included?
- **Budget carrier reality** — flights exist only where carriers actually fly; Ryanair's hub network is data, not an assumption
- **Minimum stay slider** — prevents the classic optimizer failure of "5 hours in Prague at 2am"

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
server/graph.js    edge-cost layer — Dijkstra over the multimodal leg graph,
                   per-style cost blends, airport overhead, connection buffers
server/optimizer.js brute-force permutation search + explanations ("fast and dumb")
server/railpass.js Interrail vs point-to-point comparison
server/seed.js     idempotent schema + dataset load into PostgreSQL
data/dataset.json  30 European cities, ~150 curated legs (rail/coach/flight/ferry)
scripts/           install.sh (bare-metal), update.sh (git-based updates)
```

The edge-cost lookup is deliberately separated from the optimizer: the optimizer is fast and dumb (pure permutation search over a pairwise matrix), while all multimodal complexity — mode blending, airport overhead, ticket-connection buffers, pathfinding through intermediate cities — lives in the cached graph layer. Swapping the static dataset for live aggregator APIs (Kiwi/Duffel for flights, per-operator rail feeds) only touches that layer.

### Data honesty

Fares and durations are **curated typical values** for concept validation (the "validation path" build), not live quotes. Budget-carrier legs mirror real hub networks; rail legs carry pass-coverage and seat-reservation metadata so the rail-pass verdict is honest.

## API

```
GET  /api/health           service + data-source status
GET  /api/cities           available destinations
POST /api/plan             { cities: [ids], locks: {id: slot}, roundTrip, minNights }
                           → { itineraries: [ {profile, order, hops, totals, railPass, notes} ] }
```

## License

MIT
