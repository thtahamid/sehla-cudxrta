import fs from "node:fs";

const inputPath = process.argv[2] ?? "/private/tmp/citywalk-osm-full.json";
const outputPath = process.argv[3] ?? "app/data/osm-citywalk.ts";
const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const bounds = {
  minLat: 25.198,
  maxLat: 25.216,
  minLon: 55.252,
  maxLon: 55.273
};

const drivableHighways = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service"
]);

const contextHighways = new Set(["footway", "cycleway", "steps"]);

function asciiName(value) {
  return typeof value === "string" && /^[\x20-\x7E]+$/.test(value) ? value : "";
}

function englishName(tags = {}) {
  return (
    asciiName(tags["name:en"]) ||
    asciiName(tags["alt_name:en"]) ||
    asciiName(tags["official_name:en"]) ||
    asciiName(tags.int_name) ||
    asciiName(tags.ref) ||
    asciiName(tags.name) ||
    ""
  );
}

function roadName(tags = {}, highway) {
  return englishName(tags) || `${highway.replaceAll("_", " ")} ${tags.service ? `(${tags.service})` : "link"}`;
}

function parseNumber(value, fallback) {
  if (typeof value !== "string") return fallback;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

function defaultLanes(highway) {
  if (highway === "motorway" || highway === "trunk") return 4;
  if (highway === "primary") return 3;
  if (highway.includes("_link")) return 1;
  if (highway === "secondary") return 2;
  if (highway === "tertiary") return 2;
  if (highway === "service" || highway === "living_street") return 1;
  return 2;
}

function defaultSpeed(highway) {
  if (highway === "motorway" || highway === "trunk") return 80;
  if (highway === "primary") return 60;
  if (highway === "secondary" || highway === "tertiary") return 50;
  if (highway.includes("_link")) return 40;
  if (highway === "service" || highway === "living_street") return 20;
  return 30;
}

function priority(highway) {
  if (highway === "motorway" || highway === "trunk" || highway === "primary" || highway.includes("_link")) {
    return "arterial";
  }
  if (highway === "secondary" || highway === "tertiary" || highway === "unclassified") {
    return "collector";
  }
  if (contextHighways.has(highway)) return "pedestrian";
  return "access";
}

function coords(geometry = []) {
  return geometry
    .filter((point) => typeof point.lat === "number" && typeof point.lon === "number")
    .map((point) => [Number(point.lat.toFixed(7)), Number(point.lon.toFixed(7))]);
}

function roughArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[1] * next[0] - next[1] * current[0];
  }
  return Math.abs(area);
}

const roads = [];
const pedestrianWays = [];
const polygons = [];
const signals = [];
const pointRoads = new Map();
const restrictions = [];

for (const element of raw.elements) {
  const tags = element.tags ?? {};

  if (element.type === "node" && (tags.highway === "traffic_signals" || tags.crossing === "traffic_signals")) {
    signals.push({
      id: `signal-${element.id}`,
      osmId: element.id,
      lat: Number(element.lat.toFixed(7)),
      lon: Number(element.lon.toFixed(7)),
      name: englishName(tags) || (tags.crossing === "traffic_signals" ? "Signalized crossing" : "Traffic signal")
    });
  }

  if (element.type === "relation" && tags.type === "restriction") {
    restrictions.push({
      id: `restriction-${element.id}`,
      osmId: element.id,
      restriction: asciiName(tags.restriction) || "turn restriction",
      except: asciiName(tags.except),
      members: Array.isArray(element.members)
        ? element.members.map((member) => ({
            type: member.type,
            ref: member.ref,
            role: member.role
          }))
        : []
    });
  }

  if (element.type !== "way" || !Array.isArray(element.geometry)) continue;

  const highway = tags.highway;
  if (drivableHighways.has(highway) || contextHighways.has(highway)) {
    const coordinates = coords(element.geometry);
    if (coordinates.length < 2) continue;
    const directedCoordinates = tags.oneway === "-1" ? coordinates.reverse() : coordinates;

    const road = {
      id: `osm-${element.id}`,
      osmId: element.id,
      name: roadName(tags, highway),
      label: englishName(tags) || asciiName(tags.ref),
      ref: asciiName(tags.ref),
      highway,
      lanes: parseNumber(tags.lanes, defaultLanes(highway)),
      maxspeed: parseNumber(tags.maxspeed, defaultSpeed(highway)),
      oneway: tags.oneway === "yes" || tags.oneway === "-1" || tags.junction === "roundabout" || highway.includes("_link"),
      onewayDirection: tags.oneway === "-1" ? "reverse" : tags.oneway === "yes" || highway.includes("_link") ? "forward" : "both",
      turnLanes: asciiName(tags["turn:lanes"]),
      surface: asciiName(tags.surface) || "asphalt",
      bridge: tags.bridge === "yes",
      tunnel: tags.tunnel === "yes",
      service: asciiName(tags.service),
      priority: priority(highway),
      coordinates: directedCoordinates
    };

    if (contextHighways.has(highway)) {
      pedestrianWays.push(road);
    } else {
      roads.push(road);
      for (const coordinate of directedCoordinates) {
        const key = `${coordinate[0].toFixed(5)},${coordinate[1].toFixed(5)}`;
        const bucket = pointRoads.get(key) ?? new Map();
        bucket.set(road.id, road.label || road.name);
        pointRoads.set(key, bucket);
      }
    }
  }

  if (tags.building || tags.amenity === "parking" || tags.landuse) {
    const coordinates = coords(element.geometry);
    if (coordinates.length < 4) continue;
    const kind = tags.amenity === "parking" ? "parking" : tags.building ? "building" : `landuse-${tags.landuse}`;
    polygons.push({
      id: `poly-${element.id}`,
      osmId: element.id,
      kind,
      name: englishName(tags),
      area: roughArea(coordinates),
      coordinates
    });
  }
}

const signalProximityMeters = 18;
function distanceMeters(a, b) {
  const latMeters = (a.lat - b.lat) * 111_320;
  const lonMeters = (a.lon - b.lon) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(latMeters, lonMeters);
}

const intersections = [];
for (const [key, roadMap] of pointRoads.entries()) {
  if (roadMap.size < 3) continue;
  const [lat, lon] = key.split(",").map(Number);
  const signalized = signals.some((signal) => distanceMeters({ lat, lon }, signal) < signalProximityMeters);
  intersections.push({
    id: `ix-${key}`,
    lat,
    lon,
    roadCount: roadMap.size,
    signalized,
    roads: [...new Set([...roadMap.values()].filter(Boolean))].slice(0, 5)
  });
}

for (const signal of signals) {
  const nearRoads = roads
    .map((road) => {
      const nearest = road.coordinates.reduce((best, coordinate) => {
        const distance = distanceMeters(signal, { lat: coordinate[0], lon: coordinate[1] });
        return Math.min(best, distance);
      }, Number.POSITIVE_INFINITY);
      return { road, nearest };
    })
    .filter((entry) => entry.nearest < signalProximityMeters)
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, 4);

  if (nearRoads.length >= 2 && !intersections.some((intersection) => distanceMeters(intersection, signal) < 12)) {
    intersections.push({
      id: `ix-${signal.id}`,
      lat: signal.lat,
      lon: signal.lon,
      roadCount: nearRoads.length,
      signalized: true,
      roads: nearRoads.map((entry) => entry.road.label || entry.road.name).filter(Boolean)
    });
  }
}

const polygonLimit = 1000;
const contextPolygons = polygons
  .sort((a, b) => b.area - a.area)
  .slice(0, polygonLimit)
  .map((polygon) => ({
    id: polygon.id,
    osmId: polygon.osmId,
    kind: polygon.kind,
    name: polygon.name,
    coordinates: polygon.coordinates
  }));

const moduleText = `// Generated from OpenStreetMap Overpass data by scripts/build-osm-data.mjs.
// Source: OpenStreetMap contributors, ODbL. Extract timestamp: ${raw.osm3s?.timestamp_osm_base ?? "unknown"}.

export type LatLon = [number, number];

export type OsmRoad = {
  id: string;
  osmId: number;
  name: string;
  label: string;
  ref: string;
  highway: string;
  lanes: number;
  maxspeed: number;
  oneway: boolean;
  onewayDirection: "forward" | "reverse" | "both";
  turnLanes: string;
  surface: string;
  bridge: boolean;
  tunnel: boolean;
  service: string;
  priority: "arterial" | "collector" | "access" | "pedestrian";
  coordinates: LatLon[];
};

export type OsmSignal = {
  id: string;
  osmId: number;
  lat: number;
  lon: number;
  name: string;
};

export type OsmIntersection = {
  id: string;
  lat: number;
  lon: number;
  roadCount: number;
  signalized: boolean;
  roads: string[];
};

export type OsmPolygon = {
  id: string;
  osmId: number;
  kind: string;
  name: string;
  coordinates: LatLon[];
};

export const osmMeta = ${JSON.stringify({
  bounds,
  generatedAt: new Date().toISOString(),
  sourceTimestamp: raw.osm3s?.timestamp_osm_base ?? null,
  roadCount: roads.length,
  pedestrianWayCount: pedestrianWays.length,
  signalCount: signals.length,
  intersectionCount: intersections.length,
  restrictionCount: restrictions.length,
  polygonCount: contextPolygons.length
}, null, 2)} as const;

export const mapBounds = ${JSON.stringify(bounds, null, 2)} as const;

export const osmRoads: OsmRoad[] = ${JSON.stringify(roads, null, 2)};

export const osmPedestrianWays: OsmRoad[] = ${JSON.stringify(pedestrianWays, null, 2)};

export const osmSignals: OsmSignal[] = ${JSON.stringify(signals, null, 2)};

export const osmIntersections: OsmIntersection[] = ${JSON.stringify(intersections, null, 2)};

export const osmTurnRestrictions = ${JSON.stringify(restrictions, null, 2)} as const;

export const osmPolygons: OsmPolygon[] = ${JSON.stringify(contextPolygons, null, 2)};
`;

fs.writeFileSync(outputPath, moduleText);
console.log(`Wrote ${outputPath}: ${roads.length} roads, ${signals.length} signals, ${intersections.length} intersections, ${restrictions.length} restrictions, ${contextPolygons.length} polygons.`);
