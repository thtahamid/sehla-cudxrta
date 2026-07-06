# SEHLA RTA Traffic Digital Twin

This is a Next.js command-center prototype for traffic operations around  Dubai. It renders an OpenStreetMap-derived road network on a canvas map, overlays simulated vehicles and signal states, and can optionally merge TomTom Traffic Flow API data when a `TOMTOM_API_KEY` is available.

## What It Does

- Displays the City Walk road network from a local OpenStreetMap Overpass extract.
- Shows road classes, lane counts, turn-lane tags, one-way direction, bridges, tunnels, and signalized nodes.
- Animates modeled vehicles along OSM way geometry with lane offsets and signal-aware stopping.
- Stitches vehicles across adjacent OSM way segments so journeys continue through intersections.
- Simulates a congestion drill at Al Dorar / Al Safa, Al Dorar / 83b, and Al Badaa / 83b.
- Provides a proactive green-wave signal toggle that opens consecutive managed intersections and reduces modeled queue and delay.
- Provides road search, network filtering, pan, zoom, and click-to-inspect behavior.
- Falls back to deterministic simulated flow when live TomTom data is not configured.
- Keeps source and confidence information visible for operational review.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Canvas rendering for the map and moving traffic layer
- ESLint

## Getting Started

Install dependencies:

```bash
npm install
```

Run the local development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

Run checks:

```bash
npm run lint
npm run build
```

## Optional Live Traffic

The app works without external services. To enable TomTom flow data, create a local `.env` file:

```bash
TOMTOM_API_KEY=your_api_key_here
```

When the key is missing or the provider request fails, `/api/traffic` returns simulated flow with a 200 response so the dashboard remains usable.

## Data Pipeline

The generated network lives in `app/data/osm-citywalk.ts`. It was produced from OpenStreetMap Overpass data by `scripts/build-osm-data.mjs`.

The committed extract includes:

- Road, pedestrian way, polygon, intersection, signal, and turn-restriction data.
- OSM metadata including extract timestamp and record counts.
- Conservative defaults for missing lane and speed tags.

## Project Structure

```text
app/
  api/traffic/route.ts           Traffic flow API with TomTom or simulation fallback
  components/CityWalkDashboard.tsx
  data/osm-citywalk.ts           Generated OSM network extract
  globals.css                    Command-center layout and map styling
  icon.svg                       App icon
scripts/
  build-osm-data.mjs             OSM extraction/generation script
```

## Attribution

Map and road-network data: OpenStreetMap contributors, available under the Open Database License.
