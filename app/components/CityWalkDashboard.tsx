"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  mapBounds,
  osmIntersections,
  osmMeta,
  osmPedestrianWays,
  osmPolygons,
  osmRoads,
  osmSignals,
  osmTurnRestrictions,
  type LatLon,
  type OsmRoad,
  type OsmSignal
} from "@/app/data/osm-citywalk";

type Flow = {
  segmentId: string;
  currentSpeed: number;
  freeFlowSpeed: number;
  confidence: number;
  roadClosure: boolean;
  source: "tomtom" | "simulation";
};

type TrafficResponse = {
  mode: "tomtom" | "simulation";
  updatedAt: string;
  warning?: string;
  flows: Flow[];
};

type WorldPoint = {
  x: number;
  y: number;
};

type ViewTransform = {
  scale: number;
  tx: number;
  ty: number;
};

type CompiledRoad = {
  road: OsmRoad;
  points: WorldPoint[];
  lengths: number[];
  cumulative: number[];
  length: number;
  labelPoint: WorldPoint;
  labelAngle: number;
  stopControls: StopControl[];
};

type StopControl = {
  progress: number;
  signal: OsmSignal;
};

type Vehicle = {
  roadIndex: number;
  lane: number;
  progress: number;
  speedBias: number;
  queueOffset: number;
  color: string;
};

type MapSize = {
  width: number;
  height: number;
};

const navItems = [
  ["Network", "M4 4h16v16H4z"],
  ["Signals", "M6 3h12v6H6zM8 11h8v10H8z"],
  ["Flow", "M4 12h14m-5-5 5 5-5 5"],
  ["Data", "M5 5h14v14H5zM8 9h8M8 13h8M8 17h5"]
] as const;

const signalColor = {
  green: "#2EC4A0",
  amber: "#F59E0B",
  red: "#EF4444"
};

const roadRank: Record<string, number> = {
  service: 1,
  living_street: 1,
  residential: 2,
  unclassified: 2,
  tertiary_link: 3,
  tertiary: 3,
  secondary_link: 4,
  secondary: 4,
  primary_link: 5,
  primary: 5,
  trunk_link: 6,
  trunk: 6,
  motorway_link: 7,
  motorway: 7
};

const vehiclePalette = ["#2EC4A0", "#1A8A6E", "#F59E0B", "#5B8DEF", "#EF4444", "#334155"];
const originLat = (mapBounds.minLat + mapBounds.maxLat) / 2;
const originLon = (mapBounds.minLon + mapBounds.maxLon) / 2;
const metersPerLat = 111_320;
const metersPerLon = 111_320 * Math.cos((originLat * Math.PI) / 180);
const vehicleTarget = 1200;

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function worldFromLatLon(coord: LatLon | { lat: number; lon: number }): WorldPoint {
  const lat = Array.isArray(coord) ? coord[0] : coord.lat;
  const lon = Array.isArray(coord) ? coord[1] : coord.lon;

  return {
    x: (lon - originLon) * metersPerLon,
    y: (originLat - lat) * metersPerLat
  };
}

function screenFromWorld(point: WorldPoint, view: ViewTransform): WorldPoint {
  return {
    x: point.x * view.scale + view.tx,
    y: point.y * view.scale + view.ty
  };
}

function worldFromScreen(point: WorldPoint, view: ViewTransform): WorldPoint {
  return {
    x: (point.x - view.tx) / view.scale,
    y: (point.y - view.ty) / view.scale
  };
}

function distance(a: WorldPoint, b: WorldPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function seeded(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function phaseForSignal(signal: OsmSignal, seconds: number) {
  const cycle = 72 + (signal.osmId % 5) * 6;
  const offset = signal.osmId % cycle;
  const clock = (seconds + offset) % cycle;
  const green = Math.floor(cycle * 0.48);
  const amber = 5;

  if (clock < green) return { color: "green" as const, remaining: green - clock, label: "green" };
  if (clock < green + amber) return { color: "amber" as const, remaining: green + amber - clock, label: "amber" };
  return { color: "red" as const, remaining: cycle - clock, label: "red" };
}

function nearestProgress(points: WorldPoint[], lengths: number[], cumulative: number[], totalLength: number, point: WorldPoint) {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    const projected = { x: start.x + dx * t, y: start.y + dy * t };
    const candidateDistance = distance(point, projected);

    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestProgress = totalLength === 0 ? 0 : (cumulative[index] + lengths[index] * t) / totalLength;
    }
  }

  return { distance: bestDistance, progress: bestProgress };
}

function sampleRoad(road: CompiledRoad, progress: number) {
  const target = ((progress % 1) + 1) % 1 * road.length;

  for (let index = 0; index < road.lengths.length; index += 1) {
    const startDistance = road.cumulative[index];
    const segmentLength = road.lengths[index];
    if (target <= startDistance + segmentLength || index === road.lengths.length - 1) {
      const start = road.points[index];
      const end = road.points[index + 1];
      const ratio = segmentLength === 0 ? 0 : (target - startDistance) / segmentLength;
      const x = start.x + (end.x - start.x) * ratio;
      const y = start.y + (end.y - start.y) * ratio;
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      return { x, y, angle };
    }
  }

  const last = road.points[road.points.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
}

function compileRoads(roads: OsmRoad[], signals: OsmSignal[]) {
  const signalPoints = signals.map((signal) => ({ signal, point: worldFromLatLon(signal) }));

  return roads.map((road): CompiledRoad => {
    const points = road.coordinates.map(worldFromLatLon);
    const lengths: number[] = [];
    const cumulative = [0];

    for (let index = 0; index < points.length - 1; index += 1) {
      const length = distance(points[index], points[index + 1]);
      lengths.push(length);
      cumulative.push(cumulative[index] + length);
    }

    const totalLength = cumulative[cumulative.length - 1] || 1;
    const labelSample = sampleRoad(
      {
        road,
        points,
        lengths,
        cumulative,
        length: totalLength,
        labelPoint: points[0],
        labelAngle: 0,
        stopControls: []
      },
      0.5
    );

    const stopControls = signalPoints
      .map(({ signal, point }) => ({ signal, ...nearestProgress(points, lengths, cumulative, totalLength, point) }))
      .filter((stop) => stop.distance < 18 && stop.progress > 0.03 && stop.progress < 0.97)
      .sort((a, b) => a.progress - b.progress)
      .filter((stop, index, list) => index === 0 || Math.abs(stop.progress - list[index - 1].progress) > 0.025)
      .map(({ signal, progress }) => ({ signal, progress }));

    return {
      road,
      points,
      lengths,
      cumulative,
      length: totalLength,
      labelPoint: { x: labelSample.x, y: labelSample.y },
      labelAngle: labelSample.angle,
      stopControls
    };
  });
}

function worldBounds(compiledRoads: CompiledRoad[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const road of compiledRoads) {
    for (const point of road.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  return { minX, minY, maxX, maxY };
}

function fitView(size: MapSize, bounds: ReturnType<typeof worldBounds>): ViewTransform {
  const padding = 46;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((size.width - padding * 2) / width, (size.height - padding * 2) / height);

  return {
    scale,
    tx: size.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    ty: size.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale
  };
}

function roadWidthMeters(road: OsmRoad) {
  if (road.highway.includes("motorway") || road.highway.includes("trunk")) return road.lanes * 3.7 + 4;
  if (road.highway.includes("primary")) return road.lanes * 3.6 + 3;
  if (road.highway.includes("secondary")) return road.lanes * 3.4 + 2;
  if (road.highway.includes("tertiary")) return road.lanes * 3.2 + 1.5;
  if (road.highway === "service") return Math.max(4.2, road.lanes * 2.8);
  return Math.max(5, road.lanes * 3);
}

function roadFill(road: OsmRoad) {
  if (road.tunnel) return "#c6cbd1";
  if (road.highway.includes("motorway") || road.highway.includes("trunk")) return "#F3A74E";
  if (road.highway.includes("primary")) return "#F7C66A";
  if (road.highway.includes("secondary")) return "#F9DE8B";
  if (road.highway.includes("tertiary")) return "#FFF2BC";
  if (road.highway === "service") return road.service === "parking_aisle" ? "#E6EDF3" : "#F7F8FA";
  return "#FFFFFF";
}

function flowForRoad(road: OsmRoad, flowById: Map<string, Flow>) {
  return (
    flowById.get(road.id) ?? {
      segmentId: road.id,
      currentSpeed: Math.round(road.maxspeed * 0.64),
      freeFlowSpeed: road.maxspeed,
      confidence: 0.52,
      roadClosure: false,
      source: "simulation" as const
    }
  );
}

function congestionRatio(flow: Flow) {
  if (flow.roadClosure) return 1;
  return 1 - Math.min(1, flow.currentSpeed / Math.max(flow.freeFlowSpeed, 1));
}

function drawPath(ctx: CanvasRenderingContext2D, points: WorldPoint[], view: ViewTransform) {
  points.forEach((point, index) => {
    const screen = screenFromWorld(point, view);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
}

function drawPolygon(ctx: CanvasRenderingContext2D, coordinates: LatLon[], view: ViewTransform) {
  coordinates.forEach((coordinate, index) => {
    const screen = screenFromWorld(worldFromLatLon(coordinate), view);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.closePath();
}

function polygonFill(kind: string) {
  if (kind === "parking") return "#DCE8F1";
  if (kind === "building") return "#E9E0D4";
  if (kind.includes("grass") || kind.includes("meadow") || kind.includes("leisure")) return "#CFE6C6";
  if (kind.includes("retail") || kind.includes("commercial")) return "#F4E6C8";
  return "#DDECCF";
}

function drawOffsetLane(ctx: CanvasRenderingContext2D, road: CompiledRoad, view: ViewTransform, offsetMeters: number) {
  ctx.beginPath();
  road.points.forEach((point, index) => {
    const previous = road.points[Math.max(0, index - 1)];
    const next = road.points[Math.min(road.points.length - 1, index + 1)];
    const angle = Math.atan2(next.y - previous.y, next.x - previous.x);
    const offsetPoint = {
      x: point.x + Math.cos(angle + Math.PI / 2) * offsetMeters,
      y: point.y + Math.sin(angle + Math.PI / 2) * offsetMeters
    };
    const screen = screenFromWorld(offsetPoint, view);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.stroke();
}

function isMainFilterMatch(road: CompiledRoad, filter: MapFilter) {
  if (filter === "arterial") return road.road.priority === "arterial" || road.road.priority === "collector";
  if (filter === "signals") return road.stopControls.length > 0 || road.road.priority === "arterial";
  return true;
}

function drawStaticMap(
  ctx: CanvasRenderingContext2D,
  size: MapSize,
  view: ViewTransform,
  compiledRoads: CompiledRoad[],
  pedestrianWays: CompiledRoad[],
  selectedId: string,
  filter: MapFilter
) {
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.fillStyle = "#DCE9D9";
  ctx.fillRect(0, 0, size.width, size.height);

  for (const polygon of osmPolygons) {
    ctx.beginPath();
    drawPolygon(ctx, polygon.coordinates, view);
    ctx.fillStyle = polygonFill(polygon.kind);
    ctx.fill();
    if (view.scale > 0.45 && polygon.kind === "building") {
      ctx.strokeStyle = "rgba(122, 112, 98, 0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  if (view.scale > 0.25) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(126, 139, 117, 0.55)";
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.4;
    for (const way of pedestrianWays) {
      ctx.beginPath();
      drawPath(ctx, way.points, view);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  const sortedRoads = [...compiledRoads].sort((a, b) => (roadRank[a.road.highway] ?? 1) - (roadRank[b.road.highway] ?? 1));

  for (const road of sortedRoads) {
    const visible = isMainFilterMatch(road, filter);
    const width = Math.max(2, roadWidthMeters(road.road) * view.scale);
    ctx.globalAlpha = visible ? 1 : 0.18;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = road.road.bridge ? "#9CA3AF" : "#B8C1CB";
    ctx.lineWidth = width + Math.max(2, 4 * view.scale);
    ctx.beginPath();
    drawPath(ctx, road.points, view);
    ctx.stroke();
  }

  for (const road of sortedRoads) {
    const visible = isMainFilterMatch(road, filter);
    const width = Math.max(2, roadWidthMeters(road.road) * view.scale);
    ctx.globalAlpha = visible ? 1 : 0.18;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = road.road.id === selectedId ? "#2EC4A0" : roadFill(road.road);
    ctx.lineWidth = road.road.id === selectedId ? width + 2 : width;
    ctx.beginPath();
    drawPath(ctx, road.points, view);
    ctx.stroke();

    if (visible && road.road.lanes > 1 && width > 9) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
      ctx.lineWidth = Math.max(0.8, Math.min(1.6, view.scale * 2.2));
      ctx.setLineDash([8, 10]);
      for (let boundary = 1; boundary < Math.min(road.road.lanes, 7); boundary += 1) {
        drawOffsetLane(ctx, road, view, (boundary - road.road.lanes / 2) * 3.35);
      }
      ctx.setLineDash([]);
    }
  }

  ctx.globalAlpha = 1;

  if (view.scale > 0.38) {
    for (const intersection of osmIntersections) {
      const point = screenFromWorld(worldFromLatLon(intersection), view);
      if (point.x < -20 || point.y < -20 || point.x > size.width + 20 || point.y > size.height + 20) continue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, intersection.signalized ? 4.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = intersection.signalized ? "#1A2332" : "rgba(107, 114, 128, 0.45)";
      ctx.fill();
    }
  }

  if (view.scale > 0.24) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = view.scale > 0.7 ? "600 12px Helvetica Neue, sans-serif" : "600 10px Helvetica Neue, sans-serif";

    for (const road of sortedRoads) {
      if (!road.road.label || !isMainFilterMatch(road, filter)) continue;
      const rank = roadRank[road.road.highway] ?? 1;
      if (rank < 3 && road.road.id !== selectedId && view.scale < 0.82) continue;
      const point = screenFromWorld(road.labelPoint, view);
      if (point.x < 40 || point.y < 20 || point.x > size.width - 40 || point.y > size.height - 20) continue;
      let angle = road.labelAngle;
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(angle);
      const label = road.road.ref || road.road.label;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = road.road.id === selectedId ? "#0F766E" : "#334155";
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
}

function drawVehicle(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string, scale: number) {
  if (scale < 0.24) {
    ctx.beginPath();
    ctx.arc(x, y, 2.3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }

  const length = Math.min(18, Math.max(9, scale * 18));
  const width = Math.min(9, Math.max(5, scale * 9));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-length / 2, -width / 2, length, width, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
  ctx.fillRect(length * 0.02, -width * 0.32, length * 0.24, width * 0.64);
  ctx.restore();
}

function createVehicles(roads: CompiledRoad[], count: number) {
  const eligible = roads.filter((road) => road.length > 18 && road.road.priority !== "pedestrian");
  const weights: number[] = [];
  let totalWeight = 0;

  for (const road of eligible) {
    const priorityFactor = road.road.priority === "arterial" ? 2.7 : road.road.priority === "collector" ? 1.6 : 0.85;
    totalWeight += Math.max(1, road.length * Math.max(1, road.road.lanes) * priorityFactor);
    weights.push(totalWeight);
  }

  const roadIndexById = new Map(roads.map((road, index) => [road.road.id, index]));
  const random = seeded("citywalk-osm-vehicles-v2");
  const vehicles: Vehicle[] = [];

  for (let index = 0; index < count; index += 1) {
    const target = random() * totalWeight;
    const eligibleIndex = weights.findIndex((weight) => weight >= target);
    const compiled = eligible[Math.max(0, eligibleIndex)];
    vehicles.push({
      roadIndex: roadIndexById.get(compiled.road.id) ?? 0,
      lane: Math.floor(random() * Math.max(1, compiled.road.lanes)),
      progress: random(),
      speedBias: 0.72 + random() * 0.62,
      queueOffset: 4 + random() * 18,
      color: vehiclePalette[Math.floor(random() * vehiclePalette.length)]
    });
  }

  return vehicles;
}

function nearestRoadAt(compiledRoads: CompiledRoad[], point: WorldPoint, view: ViewTransform, filter: MapFilter) {
  let selected: CompiledRoad | null = null;
  let best = Math.max(9 / view.scale, 6);

  for (const road of compiledRoads) {
    if (!isMainFilterMatch(road, filter)) continue;
    const width = roadWidthMeters(road.road) / 2 + Math.max(8 / view.scale, 2);
    const candidate = nearestProgress(road.points, road.lengths, road.cumulative, road.length, point);
    const threshold = Math.max(best, width);
    if (candidate.distance < threshold && candidate.distance < best) {
      selected = road;
      best = candidate.distance;
    }
  }

  return selected;
}

type MapFilter = "all" | "arterial" | "signals";

function TrafficMap({
  compiledRoads,
  pedestrianWays,
  flowById,
  selectedId,
  filter,
  running,
  reducedMotion,
  onSelect
}: {
  compiledRoads: CompiledRoad[];
  pedestrianWays: CompiledRoad[];
  flowById: Map<string, Flow>;
  selectedId: string;
  filter: MapFilter;
  running: boolean;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
}) {
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dynamicCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<HTMLDivElement | null>(null);
  const vehiclesRef = useRef<Vehicle[]>([]);
  const viewRef = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const flowRef = useRef(flowById);
  const runningRef = useRef(running);
  const filterRef = useRef(filter);
  const reducedMotionRef = useRef(reducedMotion);
  const [size, setSize] = useState<MapSize>({ width: 960, height: 620 });
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const bounds = useMemo(() => worldBounds(compiledRoads), [compiledRoads]);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  useEffect(() => {
    flowRef.current = flowById;
    runningRef.current = running;
    filterRef.current = filter;
    reducedMotionRef.current = reducedMotion;
  }, [filter, flowById, reducedMotion, running]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const resize = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setSize({
        width: Math.max(360, rect.width),
        height: Math.max(430, rect.height)
      });
    });
    resize.observe(wrapper);
    return () => resize.disconnect();
  }, []);

  useEffect(() => {
    const nextView = fitView(size, bounds);
    viewRef.current = nextView;
    vehiclesRef.current = createVehicles(compiledRoads, vehicleTarget);
    const frame = window.requestAnimationFrame(() => setView(nextView));
    return () => window.cancelAnimationFrame(frame);
  }, [bounds, compiledRoads, size]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const resetView = useCallback(() => {
    setView(fitView(size, bounds));
  }, [bounds, size]);

  const zoomAt = useCallback((screen: WorldPoint, factor: number) => {
    setView((current) => {
      const before = worldFromScreen(screen, current);
      const scale = Math.max(0.08, Math.min(4.8, current.scale * factor));
      return {
        scale,
        tx: screen.x - before.x * scale,
        ty: screen.y - before.y * scale
      };
    });
  }, []);

  useEffect(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStaticMap(ctx, size, view, compiledRoads, pedestrianWays, selectedId, filter);
  }, [compiledRoads, filter, pedestrianWays, selectedId, size, view]);

  useEffect(() => {
    const canvas = dynamicCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const context = ctx;

    let raf = 0;
    let last = performance.now();
    let seconds = 0;

    function draw(now: number) {
      const nextDpr = window.devicePixelRatio || 1;
      context.setTransform(nextDpr, 0, 0, nextDpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (runningRef.current && !reducedMotionRef.current) seconds += dt;

      const currentView = viewRef.current;
      const flows = flowRef.current;

      if (runningRef.current && !reducedMotionRef.current) {
        for (const vehicle of vehiclesRef.current) {
          const road = compiledRoads[vehicle.roadIndex];
          const flow = flowForRoad(road.road, flows);
          const speedMps = Math.max(1.3, (flow.currentSpeed / 3.6) * vehicle.speedBias);
          const currentDistance = vehicle.progress * road.length;
          let nextDistance = currentDistance + speedMps * dt;

          for (const stop of road.stopControls) {
            const stopDistance = stop.progress * road.length;
            const gap = stopDistance - currentDistance;
            const phase = phaseForSignal(stop.signal, seconds);
            if (gap > 0 && gap < 42 && phase.color !== "green") {
              nextDistance = Math.min(nextDistance, Math.max(currentDistance, stopDistance - vehicle.queueOffset));
              break;
            }
          }

          vehicle.progress = road.length === 0 ? 0 : (nextDistance % road.length) / road.length;
        }
      }

      for (const vehicle of vehiclesRef.current) {
        const road = compiledRoads[vehicle.roadIndex];
        if (!isMainFilterMatch(road, filterRef.current)) continue;
        const sampled = sampleRoad(road, vehicle.progress);
        const laneOffset = (vehicle.lane - (Math.max(1, road.road.lanes) - 1) / 2) * 3.25;
        const normal = sampled.angle + Math.PI / 2;
        const point = {
          x: sampled.x + Math.cos(normal) * laneOffset,
          y: sampled.y + Math.sin(normal) * laneOffset
        };
        const screen = screenFromWorld(point, currentView);
        if (screen.x < -20 || screen.y < -20 || screen.x > size.width + 20 || screen.y > size.height + 20) continue;
        drawVehicle(context, screen.x, screen.y, sampled.angle, vehicle.color, currentView.scale);
      }

      for (const signal of osmSignals) {
        const point = screenFromWorld(worldFromLatLon(signal), currentView);
        if (point.x < -18 || point.y < -18 || point.x > size.width + 18 || point.y > size.height + 18) continue;
        const phase = phaseForSignal(signal, seconds);
        context.beginPath();
        context.arc(point.x, point.y, currentView.scale > 0.45 ? 5.5 : 3.6, 0, Math.PI * 2);
        context.fillStyle = "#1A2332";
        context.fill();
        context.beginPath();
        context.arc(point.x, point.y, currentView.scale > 0.45 ? 3.2 : 2.1, 0, Math.PI * 2);
        context.fillStyle = signalColor[phase.color];
        context.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [compiledRoads, size]);

  const handleWheel = useCallback((event: WheelEvent, element: HTMLDivElement) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
      setView((current) => ({
        ...current,
        tx: current.tx - event.deltaX,
        ty: current.ty - event.deltaY
      }));
      return;
    }

    const factor = Math.exp(-event.deltaY * 0.0014);
    zoomAt(point, factor);
  }, [zoomAt]);

  useEffect(() => {
    const element = interactionRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => handleWheel(event, element);
    element.addEventListener("wheel", onWheel, { passive: false });

    return () => element.removeEventListener("wheel", onWheel);
  }, [handleWheel]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      tx: viewRef.current.tx,
      ty: viewRef.current.ty,
      moved: false
    };
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    setView((current) => ({
      ...current,
      tx: drag.tx + dx,
      ty: drag.ty + dy
    }));
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const world = worldFromScreen({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewRef.current);
    const match = nearestRoadAt(compiledRoads, world, viewRef.current, filterRef.current);
    if (match) onSelect(match.road.id);
  }, [compiledRoads, onSelect]);

  return (
    <div className="mapViewport" ref={wrapperRef}>
      <canvas className="mapCanvas staticLayer" ref={staticCanvasRef} aria-hidden="true" />
      <canvas className="mapCanvas dynamicLayer" ref={dynamicCanvasRef} aria-label="Navigable OSM traffic simulation map" />
      <div
        className="mapInteraction"
        ref={interactionRef}
        role="application"
        aria-label="Interactive City Walk traffic map. Drag to pan, use wheel or trackpad to zoom, click a road to inspect it."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          zoomAt({ x: event.clientX - rect.left, y: event.clientY - rect.top }, 1.6);
        }}
      />
      <div className="mapControls" aria-label="Map controls">
        <button type="button" onClick={() => zoomAt({ x: size.width / 2, y: size.height / 2 }, 1.28)}>+</button>
        <button type="button" onClick={() => zoomAt({ x: size.width / 2, y: size.height / 2 }, 0.78)}>-</button>
        <button type="button" onClick={resetView}>Fit</button>
      </div>
      <div className="mapScale">
        <span>{Math.round(100 / Math.max(view.scale, 0.01))} m</span>
      </div>
    </div>
  );
}

function laneSummary(road: OsmRoad) {
  const turns = road.turnLanes ? road.turnLanes.replaceAll("|", " / ").replaceAll(";", " + ") : "not tagged";
  return `${road.lanes} lane${road.lanes === 1 ? "" : "s"}; ${road.oneway ? `one-way ${road.onewayDirection}` : "two-way"}; turns: ${turns}`;
}

export default function CityWalkDashboard() {
  const compiledRoads = useMemo(() => compileRoads(osmRoads, osmSignals), []);
  const pedestrianWays = useMemo(() => compileRoads(osmPedestrianWays, osmSignals), []);
  const [selectedId, setSelectedId] = useState(() => osmRoads.find((road) => road.priority === "arterial")?.id ?? osmRoads[0].id);
  const [traffic, setTraffic] = useState<TrafficResponse | null>(null);
  const [filter, setFilter] = useState<MapFilter>("all");
  const [running, setRunning] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [phaseClock, setPhaseClock] = useState(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadTraffic() {
      const response = await fetch("/api/traffic", { cache: "no-store" });
      const payload = (await response.json()) as TrafficResponse;
      if (active) setTraffic(payload);
    }

    loadTraffic();
    const refresh = window.setInterval(loadTraffic, 20000);
    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setPhaseClock(Date.now() / 1000), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const flows = useMemo(() => traffic?.flows ?? [], [traffic?.flows]);
  const flowById = useMemo(() => new Map(flows.map((flow) => [flow.segmentId, flow])), [flows]);
  const selected = osmRoads.find((road) => road.id === selectedId) ?? osmRoads[0];
  const selectedFlow = flowForRoad(selected, flowById);
  const selectedCompiled = compiledRoads.find((road) => road.road.id === selected.id);
  const filteredRoadRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return osmRoads
      .filter((road) => !term || road.name.toLowerCase().includes(term) || road.ref.toLowerCase().includes(term) || road.highway.includes(term))
      .sort((a, b) => (roadRank[b.highway] ?? 0) - (roadRank[a.highway] ?? 0) || b.lanes - a.lanes)
      .slice(0, 48);
  }, [searchTerm]);

  const metrics = useMemo(() => {
    const modeledLanes = osmRoads.reduce((sum, road) => sum + road.lanes, 0);
    const activeFlows = osmRoads.map((road) => flowForRoad(road, flowById));
    const averageSpeed = Math.round(
      activeFlows.reduce((sum, flow) => sum + flow.currentSpeed, 0) / Math.max(activeFlows.length, 1)
    );
    const congestion = Math.round(
      (activeFlows.reduce((sum, flow) => sum + congestionRatio(flow), 0) / Math.max(activeFlows.length, 1)) * 100
    );

    return {
      modeledLanes,
      averageSpeed,
      congestion,
      flowSource: traffic?.mode ?? "simulation"
    };
  }, [flowById, traffic?.mode]);

  function selectSearchMatch() {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return;
    const match = osmRoads.find((road) => road.name.toLowerCase().includes(term) || road.ref.toLowerCase().includes(term));
    if (match) setSelectedId(match.id);
  }

  return (
    <div className="appShell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebarHeader">
          <button className="panelToggle" type="button" aria-label="Toggle navigation panel">
            <Icon path="M4 5h16v14H4zM9 5v14M14 9l3 3-3 3" />
          </button>
        </div>

        <nav className="navList">
          {navItems.map(([label, path], index) => (
            <a className={index === 0 ? "navItem active" : "navItem"} href={`#${label.toLowerCase()}`} key={label}>
              <span className="navIcon">
                <Icon path={path} />
              </span>
              <span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebarFooter">
          <div className="avatar">
            <Icon path="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />
          </div>
          <div>
            <strong>Mobility Desk</strong>
            <span>citywalk.ops</span>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="pageHeader">
          <div className="brand">
            <div className="brandMark">
              <Icon path="M4 16l4-8 4 5 4-7 4 10M5 19h14" />
            </div>
            <div>
              <h1>CityWalk Traffic Twin</h1>
              <p>OSM snapshot {osmMeta.sourceTimestamp?.slice(0, 10)}; English labels</p>
            </div>
          </div>

          <div className="headerActions">
            <label className="searchBox">
              <span>Search</span>
              <input
                aria-label="Search road segment"
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") selectSearchMatch();
                }}
                placeholder="Al Safa, D71, Al Wasl"
                value={searchTerm}
              />
            </label>
            <select aria-label="Network filter" value={filter} onChange={(event) => setFilter(event.target.value as MapFilter)}>
              <option value="all">Full OSM network</option>
              <option value="arterial">Main roads</option>
              <option value="signals">Signal corridors</option>
            </select>
            <button className="secondaryButton" type="button" onClick={selectSearchMatch}>Find</button>
          </div>
        </header>

        <section className="heroCard reveal" style={{ "--i": 0 } as React.CSSProperties}>
          <div className="heroIcon">
            <Icon path="M4 13h3l2-5 4 10 2-5h5M5 20h14M5 4h14" />
          </div>
          <div className="heroMetric">
            <span>Network pressure</span>
            <strong>{metrics.congestion}<em>%</em></strong>
            <small>{metrics.flowSource === "tomtom" ? "TomTom live flow" : "simulated flow; API-ready"}</small>
          </div>
          <div className="heroMeta">
            <span>Updated {traffic ? new Date(traffic.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "loading"}</span>
            <span>{vehicleTarget.toLocaleString()} vehicles; {osmSignals.length} OSM signal/crossing nodes; {osmTurnRestrictions.length} turn restrictions</span>
          </div>
          <div className="heroActions">
            <button className="primaryButton" type="button" onClick={() => setRunning(true)}>Run</button>
            <button className="secondaryButton" type="button" onClick={() => setRunning(false)}>Freeze</button>
          </div>
        </section>

        <section className="statGrid" aria-label="Network metrics">
          {[
            ["OSM roads", osmMeta.roadCount.toLocaleString(), "Drivable ways inside the City Walk extract"],
            ["Modeled lanes", metrics.modeledLanes.toLocaleString(), "Explicit OSM lane tags plus conservative defaults"],
            ["Signals", osmSignals.length.toLocaleString(), "Traffic signal and signalized crossing nodes"],
            ["Average speed", `${metrics.averageSpeed} km/h`, "Current simulated/provider segment average"]
          ].map(([label, value, meta], index) => (
            <article className="statCard reveal" key={label} style={{ "--i": index + 1 } as React.CSSProperties}>
              <div className="statLabel">
                <span className="statIcon"><Icon path="M5 12h14M12 5v14" /></span>
                {label}
              </div>
              <strong>{value}</strong>
              <span>{meta}</span>
            </article>
          ))}
        </section>

        <section className="mainGrid">
          <article className="mapCard reveal" id="network" style={{ "--i": 5 } as React.CSSProperties}>
            <div className="cardHeader mapHeader">
              <div>
                <h2>OSM Network Map</h2>
                <p>Drag to pan; wheel or trackpad to zoom; click any road to inspect lane and tag data</p>
              </div>
              <div className="legend">
                <span><i className="legendMotorway" /> arterial</span>
                <span><i className="legendSecondary" /> collector</span>
                <span><i className="legendAccess" /> access</span>
                <span><i className="legendSignal" /> signal</span>
              </div>
            </div>
            <TrafficMap
              compiledRoads={compiledRoads}
              pedestrianWays={pedestrianWays}
              filter={filter}
              flowById={flowById}
              onSelect={setSelectedId}
              reducedMotion={reducedMotion}
              running={running}
              selectedId={selectedId}
            />
          </article>

          <aside className="detailColumn">
            <article className="detailCard reveal" style={{ "--i": 6 } as React.CSSProperties}>
              <div className="cardHeader compact">
                <h2>Selected Link</h2>
                <span className="statusBadge">{selectedFlow.source}</span>
              </div>
              <div className="selectedTitle">
                <strong>{selected.name}</strong>
                <span>{selected.ref || selected.highway}</span>
              </div>
              <dl className="detailList">
                <div><dt>OSM way</dt><dd>{selected.osmId}</dd></div>
                <div><dt>Class</dt><dd>{selected.highway}{selected.bridge ? "; bridge" : ""}{selected.tunnel ? "; tunnel" : ""}</dd></div>
                <div><dt>Lane model</dt><dd>{laneSummary(selected)}</dd></div>
                <div><dt>Speed</dt><dd>{selectedFlow.currentSpeed} / {selectedFlow.freeFlowSpeed} km/h</dd></div>
                <div><dt>Signals on link</dt><dd>{selectedCompiled?.stopControls.length ?? 0}</dd></div>
                <div><dt>Surface</dt><dd>{selected.surface}</dd></div>
              </dl>
            </article>

            <article className="detailCard darkCard reveal" id="signals" style={{ "--i": 7 } as React.CSSProperties}>
              <div className="cardHeader compact">
                <h2>Signal Model</h2>
                <span>{running ? "running" : "frozen"}</span>
              </div>
              <div className="signalList">
                {osmSignals.slice(0, 8).map((signal) => {
                  const phase = phaseForSignal(signal, phaseClock);
                  return (
                    <div className="signalRow" key={signal.id}>
                      <span className="signalLamp" style={{ background: signalColor[phase.color] }} />
                      <div>
                        <strong>{signal.name}</strong>
                        <span>OSM node {signal.osmId}; cycle generated from node id</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </aside>
        </section>

        <section className="bottomGrid">
          <article className="tableCard reveal" style={{ "--i": 8 } as React.CSSProperties}>
            <div className="cardHeader">
              <div>
                <h2>Road Tags</h2>
                <p>English OSM labels, lane tags, and current flow state</p>
              </div>
              <button className="secondaryButton small" type="button" onClick={() => setSearchTerm("")}>Clear search</button>
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Road</th>
                    <th>Class</th>
                    <th>Lanes</th>
                    <th>Speed</th>
                    <th>Turns</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoadRows.map((road) => {
                    const flow = flowForRoad(road, flowById);
                    const load = congestionRatio(flow);
                    return (
                      <tr key={road.id} onClick={() => setSelectedId(road.id)}>
                        <td>{road.name}<span>{road.ref || `OSM ${road.osmId}`}</span></td>
                        <td>{road.highway}</td>
                        <td>{road.lanes}</td>
                        <td>{flow.currentSpeed} km/h</td>
                        <td>{road.turnLanes || "not tagged"}</td>
                        <td><span className={load > 0.48 ? "statusBadge warning" : "statusBadge"}>{load > 0.48 ? "Loaded" : "Moving"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <article className="sourceCard reveal" id="data" style={{ "--i": 9 } as React.CSSProperties}>
            <div className="cardHeader compact">
              <h2>OSM Data</h2>
              <span>ODbL attribution required</span>
            </div>
            <div className="sourceList">
              <div>
                <strong>Snapshot</strong>
                <p>Bounding box {mapBounds.minLat}, {mapBounds.minLon} to {mapBounds.maxLat}, {mapBounds.maxLon}; source base {osmMeta.sourceTimestamp}.</p>
              </div>
              <div>
                <strong>Lane accuracy</strong>
                <p>Lane count, turn lanes, one-way, bridges, tunnels, and English road names are read from OSM where tagged. Missing lane tags use conservative highway-class defaults and remain lower confidence.</p>
              </div>
              <div>
                <strong>Simulation</strong>
                <p>Vehicles follow OSM way direction, use lane offsets, slow by segment flow, and stop at nearby OSM traffic signal nodes on generated red/amber phases.</p>
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
