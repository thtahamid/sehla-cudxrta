"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  mapBounds,
  osmIntersections,
  osmPedestrianWays,
  osmPolygons,
  osmRoads,
  osmSignals,
  type LatLon,
  type OsmRoad,
  type OsmSignal
} from "@/app/data/osm-citywalk";
import AgentAdvisoryRail, { type AppliedResult, type RailStatus } from "@/app/components/AgentAdvisoryRail";
import { useCongestionWatcher } from "@/app/components/useCongestionWatcher";
import type { Advisory, AdvisoryResponse, Snapshot } from "@/app/lib/advisory";

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

type ScenarioMode = "baseline" | "congestion";
type SignalStrategy = "standard" | "green-wave";

type ManagedIntersection = {
  id: string;
  label: string;
  corridor: string;
  lat: number;
  lon: number;
  roadNames: string[];
  queueBaseline: number;
  queueCongested: number;
  queueOptimized: number;
  delayBaseline: number;
  delayCongested: number;
  delayOptimized: number;
  waveOrder: number;
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
  routeIndex: number;
  lane: number;
  progress: number;
  speedBias: number;
  queueOffset: number;
  color: string;
};

type RouteStep = {
  roadIndex: number;
  direction: 1 | -1;
  startKey: string;
  endKey: string;
  length: number;
};

type VehicleRoute = {
  id: string;
  steps: RouteStep[];
  cumulative: number[];
  length: number;
};

type RouteSample = {
  road: CompiledRoad;
  roadIndex: number;
  direction: 1 | -1;
  x: number;
  y: number;
  angle: number;
};

type MapSize = {
  width: number;
  height: number;
};

const signalColor = {
  green: "#2EC4A0",
  amber: "#F59E0B",
  red: "#EF4444"
};

// Dim (unlit) lamp colors for the inactive lenses in a signal head.
const signalLampDim = {
  green: "#123128",
  amber: "#3B2E0C",
  red: "#3A1616"
};

// Soft glow used behind the lit lamp.
const signalGlow = {
  green: "rgba(46, 196, 160, 0.55)",
  amber: "rgba(245, 158, 11, 0.55)",
  red: "rgba(239, 68, 68, 0.55)"
};

const signalLampOrder = ["red", "amber", "green"] as const;

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
const managedIntersections: ManagedIntersection[] = [
  {
    id: "al-dorar-al-safa",
    label: "Al Dorar / Al Safa",
    corridor: "City Walk southwest gateway",
    lat: 25.20782,
    lon: 55.26533,
    roadNames: ["Al Dorar Street", "Al Safa Street", "Happiness Street"],
    queueBaseline: 82,
    queueCongested: 430,
    queueOptimized: 54,
    delayBaseline: 18,
    delayCongested: 92,
    delayOptimized: 12,
    waveOrder: 0
  },
  {
    id: "al-dorar-83b",
    label: "Al Dorar / 83b",
    corridor: "City Walk north gate",
    lat: 25.21104,
    lon: 55.26758,
    roadNames: ["Al Dorar Street", "83b Street"],
    queueBaseline: 64,
    queueCongested: 340,
    queueOptimized: 42,
    delayBaseline: 14,
    delayCongested: 76,
    delayOptimized: 10,
    waveOrder: 1
  },
  {
    id: "al-badaa-83b",
    label: "Al Badaa / 83b",
    corridor: "City Walk east gate",
    lat: 25.20913,
    lon: 55.27116,
    roadNames: ["Al Badaa' Street", "83b Street"],
    queueBaseline: 58,
    queueCongested: 310,
    queueOptimized: 38,
    delayBaseline: 12,
    delayCongested: 69,
    delayOptimized: 9,
    waveOrder: 2
  }
];

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

function metersBetweenLatLon(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const latMeters = (a.lat - b.lat) * metersPerLat;
  const lonMeters = (a.lon - b.lon) * metersPerLon;
  return Math.hypot(latMeters, lonMeters);
}

function roadDistanceToIntersection(road: OsmRoad, intersection: ManagedIntersection) {
  return Math.min(
    ...road.coordinates.map((coordinate) =>
      metersBetweenLatLon({ lat: coordinate[0], lon: coordinate[1] }, intersection)
    )
  );
}

function managedIntersectionForRoad(road: OsmRoad, radiusMeters = 190) {
  return managedIntersections.find(
    (intersection) =>
      intersection.roadNames.includes(road.name) &&
      roadDistanceToIntersection(road, intersection) < radiusMeters
  );
}

function managedIntersectionForSignal(signal: OsmSignal) {
  return managedIntersections.find((intersection) => metersBetweenLatLon(signal, intersection) < 65);
}

function signalForManagedIntersection(intersection: ManagedIntersection) {
  return osmSignals
    .map((signal) => ({ signal, distance: metersBetweenLatLon(signal, intersection) }))
    .sort((a, b) => a.distance - b.distance)[0]?.signal;
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

function coordinateKey(coordinate: LatLon) {
  return `${coordinate[0].toFixed(5)},${coordinate[1].toFixed(5)}`;
}

function normalizeAngle(angle: number) {
  let next = angle;
  while (next <= -Math.PI) next += Math.PI * 2;
  while (next > Math.PI) next -= Math.PI * 2;
  return next;
}

function angleDifference(a: number, b: number) {
  return Math.abs(normalizeAngle(a - b));
}

function signalApproachGroup(signal: OsmSignal, intersection: ManagedIntersection) {
  const angle = Math.atan2(signal.lat - intersection.lat, signal.lon - intersection.lon);
  const degrees = ((angle * 180) / Math.PI + 360) % 360;
  const normalizedDegrees = degrees >= 180 ? degrees - 180 : degrees;
  return normalizedDegrees < 90 ? 0 : 1;
}

function phaseForSignal(signal: OsmSignal, seconds: number, scenarioMode: ScenarioMode = "baseline", signalStrategy: SignalStrategy = "standard") {
  const managedIntersection = managedIntersectionForSignal(signal);

  if (managedIntersection && scenarioMode === "congestion" && signalStrategy === "green-wave") {
    const remaining = 44 - ((seconds + managedIntersection.waveOrder * 2) % 44);
    return { color: "green" as const, remaining, label: "green wave" };
  }

  if (managedIntersection && scenarioMode === "congestion") {
    const cycle = 108;
    const clock = (seconds + managedIntersection.waveOrder * 13) % cycle;
    const green = 16;
    const amber = 5;

    if (clock < green) return { color: "green" as const, remaining: green - clock, label: "short green" };
    if (clock < green + amber) return { color: "amber" as const, remaining: green + amber - clock, label: "amber" };
    return { color: "red" as const, remaining: cycle - clock, label: "held red" };
  }

  const cycle = managedIntersection ? 84 + managedIntersection.waveOrder * 6 : 72 + (signal.osmId % 5) * 6;
  const approachGroup = managedIntersection ? signalApproachGroup(signal, managedIntersection) : 0;
  const halfCycle = Math.floor(cycle / 2);
  const offset = managedIntersection ? approachGroup * halfCycle : signal.osmId % cycle;
  const clock = (seconds + offset) % cycle;
  const green = Math.floor(cycle * 0.45);
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
      .filter((stop) => stop.distance < 24 && stop.progress > 0.005 && stop.progress < 0.995)
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

function stepAngle(road: CompiledRoad, direction: 1 | -1) {
  const points = direction === 1 ? road.points : [...road.points].reverse();
  const start = points[0];
  const end = points[Math.min(points.length - 1, 1)];
  return Math.atan2(end.y - start.y, end.x - start.x);
}

function candidateDirections(road: OsmRoad): Array<1 | -1> {
  if (!road.oneway || road.onewayDirection === "both") return [1, -1];
  return road.onewayDirection === "reverse" ? [-1] : [1];
}

function routeStepForRoad(road: CompiledRoad, roadIndex: number, direction: 1 | -1): RouteStep {
  const first = road.road.coordinates[0];
  const last = road.road.coordinates[road.road.coordinates.length - 1];

  return {
    roadIndex,
    direction,
    startKey: direction === 1 ? coordinateKey(first) : coordinateKey(last),
    endKey: direction === 1 ? coordinateKey(last) : coordinateKey(first),
    length: road.length
  };
}

function routeStepExitAngle(road: CompiledRoad, direction: 1 | -1) {
  const points = direction === 1 ? road.points : [...road.points].reverse();
  const end = points[points.length - 1];
  const before = points[Math.max(0, points.length - 2)];
  return Math.atan2(end.y - before.y, end.x - before.x);
}

function chooseNextStep(
  current: RouteStep,
  options: RouteStep[],
  compiledRoads: CompiledRoad[],
  visited: Set<string>,
  random: () => number
) {
  const currentRoad = compiledRoads[current.roadIndex].road;
  const exitAngle = routeStepExitAngle(compiledRoads[current.roadIndex], current.direction);

  return options
    .filter((option) => !(option.roadIndex === current.roadIndex && option.direction === -current.direction))
    .filter((option) => !visited.has(`${option.roadIndex}:${option.direction}`))
    .map((option) => {
      const nextRoad = compiledRoads[option.roadIndex].road;
      const entryAngle = stepAngle(compiledRoads[option.roadIndex], option.direction);
      const sameNamedCorridor = nextRoad.name === currentRoad.name || (!!nextRoad.ref && nextRoad.ref === currentRoad.ref);
      const priorityMatch = nextRoad.priority === currentRoad.priority;
      const rankPenalty = Math.abs((roadRank[nextRoad.highway] ?? 1) - (roadRank[currentRoad.highway] ?? 1)) * 0.08;
      const score = angleDifference(exitAngle, entryAngle) + rankPenalty - (sameNamedCorridor ? 0.7 : 0) - (priorityMatch ? 0.12 : 0) + random() * 0.04;
      return { option, score };
    })
    .sort((a, b) => a.score - b.score)[0]?.option;
}

function buildVehicleRoutes(compiledRoads: CompiledRoad[]) {
  const steps: RouteStep[] = [];
  const adjacency = new Map<string, RouteStep[]>();

  compiledRoads.forEach((road, roadIndex) => {
    if (road.length < 18 || road.road.priority === "pedestrian") return;
    for (const direction of candidateDirections(road.road)) {
      const step = routeStepForRoad(road, roadIndex, direction);
      steps.push(step);
      adjacency.set(step.startKey, [...(adjacency.get(step.startKey) ?? []), step]);
    }
  });

  const random = seeded("citywalk-continuous-route-builder-v1");

  const routes = steps.map((seedStep, routeIndex): VehicleRoute => {
    const routeSteps = [seedStep];
    const visited = new Set([`${seedStep.roadIndex}:${seedStep.direction}`]);
    let current = seedStep;
    let length = seedStep.length;

    for (let index = 0; index < 16 && length < 1200; index += 1) {
      const next = chooseNextStep(current, adjacency.get(current.endKey) ?? [], compiledRoads, visited, random);
      if (!next) break;
      routeSteps.push(next);
      visited.add(`${next.roadIndex}:${next.direction}`);
      length += next.length;
      current = next;
      if (current.endKey === seedStep.startKey && length > 220) break;
    }

    const cumulative = [0];
    for (const step of routeSteps) {
      cumulative.push(cumulative[cumulative.length - 1] + step.length);
    }

    return {
      id: `route-${routeIndex}-${seedStep.roadIndex}-${seedStep.direction}`,
      steps: routeSteps,
      cumulative,
      length: cumulative[cumulative.length - 1] || seedStep.length
    };
  });

  return routes.length > 0 ? routes : compiledRoads.map((road, index) => {
    const step = routeStepForRoad(road, index, 1);
    return {
      id: `route-fallback-${road.road.id}`,
      steps: [step],
      cumulative: [0, step.length],
      length: step.length
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

function queueForIntersection(intersection: ManagedIntersection, scenarioMode: ScenarioMode, signalStrategy: SignalStrategy) {
  if (scenarioMode === "baseline") return intersection.queueBaseline;
  if (signalStrategy === "green-wave") return intersection.queueOptimized;
  return intersection.queueCongested;
}

function delayForIntersection(intersection: ManagedIntersection, scenarioMode: ScenarioMode, signalStrategy: SignalStrategy) {
  if (scenarioMode === "baseline") return intersection.delayBaseline;
  if (signalStrategy === "green-wave") return intersection.delayOptimized;
  return intersection.delayCongested;
}

function scenarioFlowForRoad(road: OsmRoad, flowById: Map<string, Flow>, scenarioMode: ScenarioMode, signalStrategy: SignalStrategy): Flow {
  const baseFlow = flowForRoad(road, flowById);
  const managedIntersection = managedIntersectionForRoad(road);

  if (!managedIntersection || scenarioMode === "baseline") return baseFlow;

  const freeFlowSpeed = Math.max(baseFlow.freeFlowSpeed, road.maxspeed, 1);

  if (signalStrategy === "green-wave") {
    return {
      ...baseFlow,
      currentSpeed: Math.min(freeFlowSpeed, Math.max(baseFlow.currentSpeed, Math.round(freeFlowSpeed * 0.84))),
      confidence: Math.max(baseFlow.confidence, 0.74),
      source: "simulation"
    };
  }

  const distancePenalty = Math.max(0.2, 1 - roadDistanceToIntersection(road, managedIntersection) / 220);
  const targetRatio = Math.max(0.12, 0.32 - distancePenalty * 0.16);

  return {
    ...baseFlow,
    currentSpeed: Math.max(4, Math.min(baseFlow.currentSpeed, Math.round(freeFlowSpeed * targetRatio))),
    confidence: Math.max(baseFlow.confidence, 0.7),
    source: "simulation"
  };
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

// Draws an identifiable traffic-signal head. When zoomed out it degrades to a
// single glowing lamp so the map stays readable; when zoomed in it renders a
// proper three-lens housing with the active phase lit and the others dimmed.
function drawSignalHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  active: "green" | "amber" | "red",
  scale: number
) {
  // Low-detail: a single lit lamp with a soft halo.
  if (scale <= 0.55) {
    const r = scale > 0.36 ? 3 : 2.2;
    ctx.beginPath();
    ctx.arc(x, y, r + 2.4, 0, Math.PI * 2);
    ctx.fillStyle = signalGlow[active];
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = signalColor[active];
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(15, 23, 42, 0.5)";
    ctx.stroke();
    return;
  }

  // Full signal head.
  const lampR = Math.min(4.4, Math.max(2.7, scale * 3.3));
  const gap = lampR * 0.85;
  const padX = lampR * 0.75;
  const padY = lampR * 0.7;
  const w = lampR * 2 + padX * 2;
  const h = lampR * 6 + gap * 2 + padY * 2;
  const left = x - w / 2;
  const top = y - h / 2;
  const radius = w * 0.42;

  // Translucent housing with a subtle lift shadow, so the map reads through it.
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.22)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, radius);
  ctx.fillStyle = "rgba(22, 28, 40, 0.5)";
  ctx.fill();
  ctx.restore();

  // Housing edge for definition against the map.
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(15, 23, 42, 0.28)";
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, radius);
  ctx.stroke();

  const firstY = top + padY + lampR;
  const step = lampR * 2 + gap;

  signalLampOrder.forEach((lamp, index) => {
    const cy = firstY + step * index;
    const isActive = lamp === active;

    if (isActive) {
      const halo = ctx.createRadialGradient(x, cy, lampR * 0.3, x, cy, lampR * 2.5);
      halo.addColorStop(0, signalGlow[lamp]);
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.beginPath();
      ctx.arc(x, cy, lampR * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, cy, lampR, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? signalColor[lamp] : signalLampDim[lamp];
    ctx.fill();

    if (isActive) {
      // Bright specular highlight on the lit lens.
      ctx.beginPath();
      ctx.arc(x - lampR * 0.28, cy - lampR * 0.28, lampR * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.fill();
    }
  });
}

function sampleRoute(route: VehicleRoute, compiledRoads: CompiledRoad[], progress: number): RouteSample {
  const target = ((progress % 1) + 1) % 1 * route.length;

  for (let index = 0; index < route.steps.length; index += 1) {
    const startDistance = route.cumulative[index];
    const endDistance = route.cumulative[index + 1];
    if (target <= endDistance || index === route.steps.length - 1) {
      const step = route.steps[index];
      const road = compiledRoads[step.roadIndex];
      const ratio = step.length === 0 ? 0 : (target - startDistance) / step.length;
      const localProgress = step.direction === 1 ? ratio : 1 - ratio;
      const sampled = sampleRoad(road, localProgress);

      return {
        road,
        roadIndex: step.roadIndex,
        direction: step.direction,
        x: sampled.x,
        y: sampled.y,
        angle: normalizeAngle(sampled.angle + (step.direction === -1 ? Math.PI : 0))
      };
    }
  }

  const fallback = route.steps[0];
  const road = compiledRoads[fallback.roadIndex];
  const sampled = sampleRoad(road, fallback.direction === 1 ? 0 : 1);
  return {
    road,
    roadIndex: fallback.roadIndex,
    direction: fallback.direction,
    x: sampled.x,
    y: sampled.y,
    angle: sampled.angle
  };
}

function laneOffsetForVehicle(road: OsmRoad, lane: number, direction: 1 | -1) {
  const lanes = Math.max(1, road.lanes);
  const halfRoadWidth = Math.max(2, roadWidthMeters(road) / 2 - 1.3);
  let offset = 0;

  if (road.oneway) {
    offset = ((lane % lanes) - (lanes - 1) / 2) * 3.25;
  } else {
    const lanesPerDirection = Math.max(1, Math.ceil(lanes / 2));
    offset = direction * (1.75 + (lane % lanesPerDirection) * 3.05);
  }

  return Math.max(-halfRoadWidth, Math.min(halfRoadWidth, offset));
}

function routeMaxLanes(route: VehicleRoute, compiledRoads: CompiledRoad[]) {
  return Math.max(1, ...route.steps.map((step) => compiledRoads[step.roadIndex].road.lanes));
}

function routeWeight(route: VehicleRoute, compiledRoads: CompiledRoad[]) {
  const priorityFactor = Math.max(
    ...route.steps.map((step) => {
      const priority = compiledRoads[step.roadIndex].road.priority;
      if (priority === "arterial") return 2.8;
      if (priority === "collector") return 1.7;
      return 0.85;
    })
  );

  return Math.max(1, route.length * routeMaxLanes(route, compiledRoads) * priorityFactor);
}

function limitDistanceForSignals(
  route: VehicleRoute,
  compiledRoads: CompiledRoad[],
  currentDistance: number,
  proposedDistance: number,
  seconds: number,
  queueOffset: number,
  scenarioMode: ScenarioMode,
  signalStrategy: SignalStrategy
) {
  const routeLength = Math.max(1, route.length);
  const normalizedCurrent = ((currentDistance % routeLength) + routeLength) % routeLength;
  let limitedDistance = proposedDistance;

  route.steps.forEach((step, stepIndex) => {
    const road = compiledRoads[step.roadIndex];
    for (const stop of road.stopControls) {
      const stopDistanceOnRoad = stop.progress * road.length;
      const stopDistanceOnStep = step.direction === 1 ? stopDistanceOnRoad : road.length - stopDistanceOnRoad;
      const stopDistanceOnRoute = route.cumulative[stepIndex] + stopDistanceOnStep;
      let gap = stopDistanceOnRoute - normalizedCurrent;
      if (gap < 0) gap += routeLength;
      if (gap <= 0 || gap > 54) continue;

      const phase = phaseForSignal(stop.signal, seconds, scenarioMode, signalStrategy);
      if (phase.color === "green") continue;

      const stopTarget = currentDistance + gap - queueOffset;
      limitedDistance = Math.min(limitedDistance, Math.max(currentDistance, stopTarget));
    }
  });

  return limitedDistance;
}

function createVehicles(routes: VehicleRoute[], compiledRoads: CompiledRoad[], count: number) {
  const eligible = routes.filter((route) => route.length > 18);
  const weights: number[] = [];
  let totalWeight = 0;

  for (const route of eligible) {
    totalWeight += routeWeight(route, compiledRoads);
    weights.push(totalWeight);
  }

  const random = seeded("citywalk-osm-vehicles-v2");
  const vehicles: Vehicle[] = [];

  for (let index = 0; index < count; index += 1) {
    const target = random() * totalWeight;
    const eligibleIndex = weights.findIndex((weight) => weight >= target);
    const route = eligible[Math.max(0, eligibleIndex)];
    vehicles.push({
      routeIndex: Math.max(0, routes.findIndex((candidate) => candidate.id === route.id)),
      lane: Math.floor(random() * routeMaxLanes(route, compiledRoads)),
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
  scenarioMode,
  signalStrategy,
  onSelect
}: {
  compiledRoads: CompiledRoad[];
  pedestrianWays: CompiledRoad[];
  flowById: Map<string, Flow>;
  selectedId: string;
  filter: MapFilter;
  running: boolean;
  reducedMotion: boolean;
  scenarioMode: ScenarioMode;
  signalStrategy: SignalStrategy;
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
  const scenarioModeRef = useRef(scenarioMode);
  const signalStrategyRef = useRef(signalStrategy);
  const [size, setSize] = useState<MapSize>({ width: 960, height: 620 });
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const bounds = useMemo(() => worldBounds(compiledRoads), [compiledRoads]);
  const vehicleRoutes = useMemo(() => buildVehicleRoutes(compiledRoads), [compiledRoads]);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  useEffect(() => {
    flowRef.current = flowById;
    runningRef.current = running;
    filterRef.current = filter;
    reducedMotionRef.current = reducedMotion;
    scenarioModeRef.current = scenarioMode;
    signalStrategyRef.current = signalStrategy;
  }, [filter, flowById, reducedMotion, running, scenarioMode, signalStrategy]);

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
    const frame = window.requestAnimationFrame(() => setView(nextView));
    return () => window.cancelAnimationFrame(frame);
  }, [bounds, size]);

  useEffect(() => {
    vehiclesRef.current = createVehicles(vehicleRoutes, compiledRoads, vehicleTarget);
  }, [compiledRoads, vehicleRoutes]);

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
          const route = vehicleRoutes[vehicle.routeIndex];
          if (!route) continue;
          const sampled = sampleRoute(route, compiledRoads, vehicle.progress);
          const flow = flowForRoad(sampled.road.road, flows);
          const speedMps = Math.max(1.3, (flow.currentSpeed / 3.6) * vehicle.speedBias);
          const currentDistance = vehicle.progress * route.length;
          let nextDistance = currentDistance + speedMps * dt;

          nextDistance = limitDistanceForSignals(
            route,
            compiledRoads,
            currentDistance,
            nextDistance,
            seconds,
            vehicle.queueOffset,
            scenarioModeRef.current,
            signalStrategyRef.current
          );

          vehicle.progress = route.length === 0 ? 0 : (nextDistance % route.length) / route.length;
        }
      }

      for (const vehicle of vehiclesRef.current) {
        const route = vehicleRoutes[vehicle.routeIndex];
        if (!route) continue;
        const sampled = sampleRoute(route, compiledRoads, vehicle.progress);
        if (!isMainFilterMatch(sampled.road, filterRef.current)) continue;
        const laneOffset = laneOffsetForVehicle(sampled.road.road, vehicle.lane, sampled.direction);
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
        if (point.x < -28 || point.y < -34 || point.x > size.width + 28 || point.y > size.height + 34) continue;
        const phase = phaseForSignal(signal, seconds, scenarioModeRef.current, signalStrategyRef.current);
        drawSignalHead(context, point.x, point.y, phase.color, currentView.scale);
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [compiledRoads, size, vehicleRoutes]);

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
      <div className="mapLegend">
        <span><i className="legendMotorway" /> arterial</span>
        <span><i className="legendSecondary" /> collector</span>
        <span><i className="legendAccess" /> access</span>
        <span><i className="legendSignal" /> signal</span>
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
  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>("congestion");
  const [signalStrategy, setSignalStrategy] = useState<SignalStrategy>("standard");
  const [activeTab, setActiveTab] = useState<"map" | "signals" | "data">("map");

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
  const effectiveFlowById = useMemo(
    () => new Map(osmRoads.map((road) => [road.id, scenarioFlowForRoad(road, flowById, scenarioMode, signalStrategy)])),
    [flowById, scenarioMode, signalStrategy]
  );
  const selected = osmRoads.find((road) => road.id === selectedId) ?? osmRoads[0];
  const selectedFlow = flowForRoad(selected, effectiveFlowById);
  const selectedCompiled = compiledRoads.find((road) => road.road.id === selected.id);
  const managedPlan = useMemo(
    () =>
      managedIntersections.map((intersection) => {
        const roads = osmRoads.filter((road) => intersection.roadNames.includes(road.name) && roadDistanceToIntersection(road, intersection) < 220);
        const averageSpeed = Math.round(
          roads.reduce((sum, road) => sum + flowForRoad(road, effectiveFlowById).currentSpeed, 0) / Math.max(roads.length, 1)
        );
        const signal = signalForManagedIntersection(intersection);
        const phase = signal ? phaseForSignal(signal, phaseClock, scenarioMode, signalStrategy) : { color: "red" as const, remaining: 0, label: "unmapped" };

        return {
          ...intersection,
          roads,
          averageSpeed,
          phase,
          queueMeters: queueForIntersection(intersection, scenarioMode, signalStrategy),
          delaySeconds: delayForIntersection(intersection, scenarioMode, signalStrategy)
        };
      }),
    [effectiveFlowById, phaseClock, scenarioMode, signalStrategy]
  );
  const filteredRoadRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return osmRoads
      .filter((road) => !term || road.name.toLowerCase().includes(term) || road.ref.toLowerCase().includes(term) || road.highway.includes(term))
      .sort((a, b) => (roadRank[b.highway] ?? 0) - (roadRank[a.highway] ?? 0) || b.lanes - a.lanes)
      .slice(0, 48);
  }, [searchTerm]);

  const commandMetrics = useMemo(() => {
    const totalQueue = managedPlan.reduce((sum, intersection) => sum + intersection.queueMeters, 0);
    const averageDelay = Math.round(managedPlan.reduce((sum, intersection) => sum + intersection.delaySeconds, 0) / Math.max(managedPlan.length, 1));
    const corridorSpeed = Math.round(managedPlan.reduce((sum, intersection) => sum + intersection.averageSpeed, 0) / Math.max(managedPlan.length, 1));
    const throughput = scenarioMode === "baseline" ? 820 : signalStrategy === "green-wave" ? 1080 : 430;

    return {
      totalQueue,
      averageDelay,
      corridorSpeed,
      throughput
    };
  }, [managedPlan, scenarioMode, signalStrategy]);

  function selectSearchMatch() {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return;
    const match = osmRoads.find((road) => road.name.toLowerCase().includes(term) || road.ref.toLowerCase().includes(term));
    if (match) setSelectedId(match.id);
  }

  function selectManagedIntersection(intersection: ManagedIntersection) {
    const match = osmRoads.find((road) => intersection.roadNames.includes(road.name) && roadDistanceToIntersection(road, intersection) < 220);
    if (match) {
      setSelectedId(match.id);
      setFilter("signals");
    }
  }

  // --- Twin Brain: autonomous congestion agent (Mistral) ---
  const [railStatus, setRailStatus] = useState<RailStatus>("idle");
  const [advisory, setAdvisory] = useState<Advisory | null>(null);
  const [advisoryModel, setAdvisoryModel] = useState<string | null>(null);
  const [advisorySource, setAdvisorySource] = useState<"agent" | "fallback" | null>(null);
  const [advisoryReason, setAdvisoryReason] = useState<string | null>(null);
  const [advisoryError, setAdvisoryError] = useState<string | null>(null);
  const [appliedResult, setAppliedResult] = useState<AppliedResult | null>(null);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const toolCallIdRef = useRef<string | undefined>(undefined);
  const pendingDecisionRef = useRef<"approved" | "dismissed" | "superseded" | undefined>(undefined);
  const analyzingRef = useRef(false);
  const commandMetricsRef = useRef(commandMetrics);
  const managedPlanRef = useRef(managedPlan);
  useEffect(() => {
    commandMetricsRef.current = commandMetrics;
    managedPlanRef.current = managedPlan;
  }, [commandMetrics, managedPlan]);

  const runAdvisory = useCallback(
    async (reason: string) => {
      if (analyzingRef.current) return;
      analyzingRef.current = true;
      setAdvisoryReason(reason);
      setRailStatus("analyzing");

      const plan = managedPlanRef.current;
      const metrics = commandMetricsRef.current;
      const snapshot: Snapshot = {
        scenarioMode,
        signalStrategy,
        commandMetrics: {
          totalQueue: Math.round(metrics.totalQueue),
          averageDelay: metrics.averageDelay,
          corridorSpeed: metrics.corridorSpeed,
          throughput: metrics.throughput
        },
        intersections: plan.map((i) => ({
          label: i.label,
          corridor: i.corridor,
          averageSpeed: i.averageSpeed,
          queueMeters: Math.round(i.queueMeters),
          delaySeconds: Math.round(i.delaySeconds),
          phase: i.phase.color
        }))
      };

      try {
        const res = await fetch("/api/agent/advisory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            snapshot,
            conversationId: conversationIdRef.current,
            pendingToolCallId: toolCallIdRef.current,
            lastDecision: pendingDecisionRef.current,
            reason
          })
        });
        const data: AdvisoryResponse = await res.json();
        if (data.mode === "disabled") {
          setRailStatus("disabled");
        } else if (data.mode === "error") {
          setAdvisoryError(data.message);
          setRailStatus("error");
        } else {
          setAdvisory(data.advisory);
          setAdvisoryModel(data.model);
          setAdvisorySource(data.source);
          conversationIdRef.current = data.conversationId || undefined;
          toolCallIdRef.current = data.toolCallId || undefined;
          pendingDecisionRef.current = undefined;
          setRailStatus("advisory");
        }
      } catch (error) {
        setAdvisoryError(error instanceof Error ? error.message : "network error");
        setRailStatus("error");
      } finally {
        analyzingRef.current = false;
      }
    },
    [scenarioMode, signalStrategy]
  );

  useCongestionWatcher({
    totalQueue: commandMetrics.totalQueue,
    averageDelay: commandMetrics.averageDelay,
    signalStrategy,
    enabled: railStatus !== "disabled",
    onFire: runAdvisory
  });

  // Queue/delay are deterministic functions of (scenario, strategy), so we can
  // project the post-action totals directly - no waiting on a re-render.
  function projectTotals(scenario: ScenarioMode, strategy: SignalStrategy) {
    const totalQueue = managedIntersections.reduce((sum, i) => sum + queueForIntersection(i, scenario, strategy), 0);
    const averageDelay = Math.round(
      managedIntersections.reduce((sum, i) => sum + delayForIntersection(i, scenario, strategy), 0) /
        Math.max(managedIntersections.length, 1)
    );
    return { totalQueue, averageDelay };
  }

  function applyAdvisory() {
    if (!advisory) return;
    const rec = advisory.recommendation;
    const before = { totalQueue: commandMetrics.totalQueue, averageDelay: commandMetrics.averageDelay };
    let after = before;

    if (rec.action === "set_signal_strategy" && rec.params.strategy) {
      after = projectTotals(scenarioMode, rec.params.strategy);
      setSignalStrategy(rec.params.strategy);
    } else if (rec.action === "set_scenario" && rec.params.scenario) {
      after = projectTotals(rec.params.scenario, signalStrategy);
      setScenarioMode(rec.params.scenario);
    } else if (rec.action === "focus_intersection") {
      const target = managedPlanRef.current.find(
        (i) => i.label === advisory.corridor || i.corridor === advisory.corridor || i.id === rec.params.intersectionId
      );
      if (target) selectManagedIntersection(target);
    }

    pendingDecisionRef.current = "approved";
    setAppliedResult({
      queueBefore: before.totalQueue,
      queueAfter: after.totalQueue,
      delayBefore: before.averageDelay,
      delayAfter: after.averageDelay
    });
    setRailStatus("applied");
  }

  function dismissAdvisory() {
    pendingDecisionRef.current = "dismissed";
    setAdvisory(null);
    setRailStatus("idle");
  }

  return (
    <div className="appShell">
      <header className="pageHeader">
        <div className="brand">
          <div className="brandMark">
            <Icon path="M4 16l4-8 4 5 4-7 4 10M5 19h14" />
          </div>
          <div>
            <h1>SEHLI</h1>
            <p>City Walk traffic command center</p>
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

      <main className="content">
        <AgentAdvisoryRail
          status={railStatus}
          advisory={advisory}
          model={advisoryModel}
          source={advisorySource}
          reason={advisoryReason}
          appliedResult={appliedResult}
          errorMessage={advisoryError}
          onApprove={applyAdvisory}
          onDismiss={dismissAdvisory}
          onAnalyze={() => runAdvisory("manual")}
        />
        <section className="commandCenter reveal" style={{ "--i": 0 } as React.CSSProperties}>
          <div className="commandTabs" role="tablist">
            <button
              className={`commandTab ${activeTab === "map" ? "active" : ""}`}
              role="tab"
              aria-selected={activeTab === "map"}
              type="button"
              onClick={() => setActiveTab("map")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4z" /></svg>
              Network Map
            </button>
            <button
              className={`commandTab ${activeTab === "signals" ? "active" : ""}`}
              role="tab"
              aria-selected={activeTab === "signals"}
              type="button"
              onClick={() => setActiveTab("signals")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v6H6zM8 11h8v10H8z" /></svg>
              Signals
            </button>
            <button
              className={`commandTab ${activeTab === "data" ? "active" : ""}`}
              role="tab"
              aria-selected={activeTab === "data"}
              type="button"
              onClick={() => setActiveTab("data")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5zM8 9h8M8 13h8M8 17h5" /></svg>
              Data
            </button>
          </div>

          <div className={`tabPanel ${activeTab === "map" ? "active" : ""}`}>
            <div className="commandControls">
              <div className="segmentedControl" role="group" aria-label="Scenario mode">
                <button
                  className={scenarioMode === "congestion" ? "active" : ""}
                  type="button"
                  onClick={() => setScenarioMode("congestion")}
                >
                  Congestion drill
                </button>
                <button
                  className={scenarioMode === "baseline" ? "active" : ""}
                  type="button"
                  onClick={() => {
                    setScenarioMode("baseline");
                    setSignalStrategy("standard");
                  }}
                >
                  Baseline
                </button>
              </div>

              <label className="switchControl">
                <input
                  type="checkbox"
                  checked={signalStrategy === "green-wave"}
                  onChange={(event) => {
                    setScenarioMode("congestion");
                    setSignalStrategy(event.target.checked ? "green-wave" : "standard");
                  }}
                />
                <span />
                <strong>Proactive green wave</strong>
              </label>

              <div className="runControls">
                <button className="primaryButton" type="button" onClick={() => setRunning(true)}>Run</button>
                <button className="secondaryButton" type="button" onClick={() => setRunning(false)}>Freeze</button>
              </div>
            </div>

            <TrafficMap
              compiledRoads={compiledRoads}
              pedestrianWays={pedestrianWays}
              filter={filter}
              flowById={effectiveFlowById}
              onSelect={setSelectedId}
              reducedMotion={reducedMotion}
              running={running}
              scenarioMode={scenarioMode}
              selectedId={selectedId}
              signalStrategy={signalStrategy}
            />

            <div className="detailPanel">
              <div className="detailSection">
                <h3>Selected Link</h3>
                <div className="selectedTitle">
                  <strong>{selected.name}</strong>
                  <span>{selected.ref || selected.highway} &middot; <span className="statusBadge">{selectedFlow.source}</span></span>
                </div>
                <dl className="detailList">
                  <div><dt>OSM way</dt><dd>{selected.osmId}</dd></div>
                  <div><dt>Class</dt><dd>{selected.highway}{selected.bridge ? "; bridge" : ""}{selected.tunnel ? "; tunnel" : ""}</dd></div>
                  <div><dt>Lane model</dt><dd>{laneSummary(selected)}</dd></div>
                  <div><dt>Speed</dt><dd>{selectedFlow.currentSpeed} / {selectedFlow.freeFlowSpeed} km/h</dd></div>
                  <div><dt>Signals on link</dt><dd>{selectedCompiled?.stopControls.length ?? 0}</dd></div>
                  <div><dt>Surface</dt><dd>{selected.surface}</dd></div>
                </dl>
              </div>

              <div className="detailSection">
                <h3>Signal Strategy &middot; {signalStrategy === "green-wave" ? "green wave" : scenarioMode === "congestion" ? "congestion drill" : "baseline"}</h3>
                <div className="managedList">
                  {managedPlan.map((intersection) => (
                    <button className="managedRow" key={intersection.id} type="button" onClick={() => selectManagedIntersection(intersection)}>
                      <span className="signalLamp" style={{ background: signalColor[intersection.phase.color] }} />
                      <div className="managedText">
                        <strong>{intersection.label}</strong>
                        <span>{intersection.corridor}; {intersection.phase.label}</span>
                      </div>
                      <div className="managedStats">
                        <span>{intersection.queueMeters} m</span>
                        <span>{intersection.delaySeconds} s</span>
                        <span>{intersection.averageSpeed} km/h</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="commandMetrics" aria-label="Managed corridor metrics">
              {[
                ["Queue", `${commandMetrics.totalQueue} m`, "managed approaches"],
                ["Delay", `${commandMetrics.averageDelay} s`, "average per vehicle"],
                ["Corridor speed", `${commandMetrics.corridorSpeed} km/h`, "Al Dorar to City Walk"],
                ["Throughput", `${commandMetrics.throughput} veh/h`, signalStrategy === "green-wave" ? "protected progression" : "current plan"]
              ].map(([label, value, meta]) => (
                <div className="commandMetric" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{meta}</small>
                </div>
              ))}
            </div>
          </div>

          <div className={`tabPanel ${activeTab === "signals" ? "active" : ""}`}>
            <div className="commandControls">
              <div className="segmentedControl" role="group" aria-label="Scenario mode">
                <button
                  className={scenarioMode === "congestion" ? "active" : ""}
                  type="button"
                  onClick={() => setScenarioMode("congestion")}
                >
                  Congestion drill
                </button>
                <button
                  className={scenarioMode === "baseline" ? "active" : ""}
                  type="button"
                  onClick={() => {
                    setScenarioMode("baseline");
                    setSignalStrategy("standard");
                  }}
                >
                  Baseline
                </button>
              </div>

              <label className="switchControl">
                <input
                  type="checkbox"
                  checked={signalStrategy === "green-wave"}
                  onChange={(event) => {
                    setScenarioMode("congestion");
                    setSignalStrategy(event.target.checked ? "green-wave" : "standard");
                  }}
                />
                <span />
                <strong>Proactive green wave</strong>
              </label>
            </div>

            <div style={{ padding: "20px 18px" }}>
              <div className="managedList">
                {managedPlan.map((intersection) => (
                  <button className="managedRow" key={intersection.id} type="button" onClick={() => selectManagedIntersection(intersection)}>
                    <span className="signalLamp" style={{ background: signalColor[intersection.phase.color] }} />
                    <div className="managedText">
                      <strong>{intersection.label}</strong>
                      <span>{intersection.corridor}; {intersection.phase.label}</span>
                    </div>
                    <div className="managedStats">
                      <span>{intersection.queueMeters} m</span>
                      <span>{intersection.delaySeconds} s</span>
                      <span>{intersection.averageSpeed} km/h</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={`tabPanel ${activeTab === "data" ? "active" : ""}`}>
            <div className="tableSection">
              <h3>Road Tags &middot; English OSM labels, lane tags, and current flow state</h3>
              <div style={{ marginBottom: 10 }}>
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
                      const flow = flowForRoad(road, effectiveFlowById);
                      const load = congestionRatio(flow);
                      return (
                        <tr key={road.id} onClick={() => { setSelectedId(road.id); setActiveTab("map"); }}>
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
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
