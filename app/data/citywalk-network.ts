export type Coordinate = {
  lat: number;
  lon: number;
};

export type RoadSegment = {
  id: string;
  osmId: number;
  name: string;
  ref?: string;
  highway:
    | "motorway_link"
    | "primary"
    | "primary_link"
    | "secondary"
    | "tertiary"
    | "residential"
    | "service";
  lanes: number;
  maxspeed: number;
  oneway: boolean;
  turnLanes?: string;
  surface: "asphalt" | "paving_stones";
  bridge?: boolean;
  tunnel?: boolean;
  priority: "arterial" | "collector" | "access";
  coordinates: Coordinate[];
};

export type SignalController = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  cycleSeconds: number;
  offsetSeconds: number;
  phases: {
    label: string;
    color: "green" | "amber" | "red";
    start: number;
    duration: number;
    protectedTurns: string[];
  }[];
};

export const mapBounds = {
  minLat: 25.2024,
  maxLat: 25.2142,
  minLon: 55.253,
  maxLon: 55.2694
};

export const networkSources = [
  {
    label: "OpenStreetMap Overpass API",
    detail: "Road names, highway classes, lanes, speed tags, turn lanes, one-way, bridge/tunnel attributes; extract timestamp 2026-07-04 19:03 UTC."
  },
  {
    label: "City Walk / Al Wasl locality references",
    detail: "City Walk is in Al Wasl and close to Al Safa Road, Al Wasl Road, and Sheikh Zayed Road."
  },
  {
    label: "TomTom Traffic Flow API",
    detail: "Optional live currentSpeed/freeFlowSpeed/currentTravelTime integration via TOMTOM_API_KEY."
  }
];

export const roadSegments: RoadSegment[] = [
  {
    id: "d71-westbound",
    osmId: 10481964,
    name: "Al Safa Street",
    ref: "D71",
    highway: "primary",
    lanes: 5,
    maxspeed: 60,
    oneway: true,
    turnLanes: "slight_left|slight_left;through|through|through;right|right",
    surface: "asphalt",
    priority: "arterial",
    coordinates: [
      { lat: 25.20766, lon: 55.26507 },
      { lat: 25.20743, lon: 55.26443 },
      { lat: 25.20717, lon: 55.26366 },
      { lat: 25.20693, lon: 55.26291 },
      { lat: 25.20671, lon: 55.26219 },
      { lat: 25.20648, lon: 55.26143 },
      { lat: 25.20625, lon: 55.26068 },
      { lat: 25.20599, lon: 55.25991 }
    ]
  },
  {
    id: "d71-east-ramp",
    osmId: 10710679,
    name: "D71 East ramp to Downtown",
    ref: "D71 East",
    highway: "motorway_link",
    lanes: 2,
    maxspeed: 60,
    oneway: true,
    surface: "asphalt",
    priority: "arterial",
    coordinates: [
      { lat: 25.20625, lon: 55.27133 },
      { lat: 25.20693, lon: 55.27184 },
      { lat: 25.20752, lon: 55.27225 },
      { lat: 25.20825, lon: 55.2727 }
    ]
  },
  {
    id: "d71-west-ramp",
    osmId: 1530629906,
    name: "D71 West ramp to Jumeirah",
    ref: "D71 West",
    highway: "motorway_link",
    lanes: 1,
    maxspeed: 60,
    oneway: true,
    surface: "asphalt",
    priority: "arterial",
    coordinates: [
      { lat: 25.20599, lon: 55.26901 },
      { lat: 25.20609, lon: 55.26877 },
      { lat: 25.20643, lon: 55.26797 },
      { lat: 25.20655, lon: 55.26764 }
    ]
  },
  {
    id: "al-wasl-d92",
    osmId: 1530674392,
    name: "Al Wasl Road",
    ref: "D92",
    highway: "primary",
    lanes: 3,
    maxspeed: 70,
    oneway: true,
    turnLanes: "left|through|through",
    surface: "asphalt",
    priority: "arterial",
    coordinates: [
      { lat: 25.21331, lon: 55.258 },
      { lat: 25.21291, lon: 55.25773 },
      { lat: 25.21247, lon: 55.25743 },
      { lat: 25.21198, lon: 55.25708 },
      { lat: 25.21144, lon: 55.25669 },
      { lat: 25.2109, lon: 55.25631 },
      { lat: 25.21038, lon: 55.25594 },
      { lat: 25.20987, lon: 55.25558 }
    ]
  },
  {
    id: "al-urouba",
    osmId: 10600679,
    name: "Al Urouba Road",
    highway: "secondary",
    lanes: 2,
    maxspeed: 60,
    oneway: true,
    surface: "asphalt",
    priority: "collector",
    coordinates: [
      { lat: 25.20824, lon: 55.25104 },
      { lat: 25.20812, lon: 55.2512 },
      { lat: 25.20794, lon: 55.25157 },
      { lat: 25.20731, lon: 55.2529 },
      { lat: 25.20712, lon: 55.25326 },
      { lat: 25.20697, lon: 55.25355 }
    ]
  },
  {
    id: "al-satwa-d90",
    osmId: 12839830,
    name: "Al Satwa Road",
    ref: "D90",
    highway: "secondary",
    lanes: 2,
    maxspeed: 60,
    oneway: true,
    surface: "asphalt",
    priority: "collector",
    coordinates: [
      { lat: 25.21366, lon: 55.26364 },
      { lat: 25.21432, lon: 55.26413 },
      { lat: 25.21517, lon: 55.26475 },
      { lat: 25.21608, lon: 55.26544 },
      { lat: 25.21733, lon: 55.26637 }
    ]
  },
  {
    id: "al-badaa",
    osmId: 1530674390,
    name: "Al Badaa' Street",
    highway: "secondary",
    lanes: 2,
    maxspeed: 60,
    oneway: true,
    surface: "asphalt",
    priority: "collector",
    coordinates: [
      { lat: 25.20256, lon: 55.26682 },
      { lat: 25.20289, lon: 55.26705 },
      { lat: 25.20343, lon: 55.26742 },
      { lat: 25.20412, lon: 55.26789 },
      { lat: 25.20484, lon: 55.26839 },
      { lat: 25.20545, lon: 55.26882 }
    ]
  },
  {
    id: "citywalk-access-north",
    osmId: 1530592186,
    name: "City Walk internal access",
    highway: "service",
    lanes: 2,
    maxspeed: 30,
    oneway: false,
    surface: "paving_stones",
    priority: "access",
    coordinates: [
      { lat: 25.20754, lon: 55.26095 },
      { lat: 25.20772, lon: 55.26062 },
      { lat: 25.20797, lon: 55.26017 },
      { lat: 25.20837, lon: 55.25961 },
      { lat: 25.20883, lon: 55.25912 }
    ]
  },
  {
    id: "citywalk-loop-east",
    osmId: 1517871482,
    name: "City Walk east service loop",
    highway: "service",
    lanes: 1,
    maxspeed: 20,
    oneway: true,
    surface: "asphalt",
    priority: "access",
    coordinates: [
      { lat: 25.20836, lon: 55.26823 },
      { lat: 25.208, lon: 55.26795 },
      { lat: 25.20761, lon: 55.26765 },
      { lat: 25.20714, lon: 55.26733 },
      { lat: 25.20655, lon: 55.26764 }
    ]
  },
  {
    id: "77b-street",
    osmId: 10644953,
    name: "77b Street",
    highway: "tertiary",
    lanes: 1,
    maxspeed: 40,
    oneway: true,
    surface: "asphalt",
    priority: "access",
    coordinates: [
      { lat: 25.21128, lon: 55.25623 },
      { lat: 25.2112, lon: 55.25639 },
      { lat: 25.21112, lon: 55.25653 }
    ]
  },
  {
    id: "73b-street",
    osmId: 10645436,
    name: "73b Street",
    highway: "residential",
    lanes: 1,
    maxspeed: 30,
    oneway: false,
    surface: "asphalt",
    priority: "access",
    coordinates: [
      { lat: 25.21402, lon: 55.25541 },
      { lat: 25.21359, lon: 55.2561 },
      { lat: 25.21313, lon: 55.25682 },
      { lat: 25.21262, lon: 55.25753 }
    ]
  },
  {
    id: "al-ebdaa",
    osmId: 10646083,
    name: "Al Ebdaa' Street",
    highway: "secondary",
    lanes: 3,
    maxspeed: 60,
    oneway: true,
    turnLanes: "left|through|through",
    surface: "asphalt",
    priority: "collector",
    coordinates: [
      { lat: 25.21739, lon: 55.27242 },
      { lat: 25.21713, lon: 55.27282 },
      { lat: 25.2169, lon: 55.27314 },
      { lat: 25.21669, lon: 55.27337 },
      { lat: 25.21648, lon: 55.27353 }
    ]
  }
];

export const signalControllers: SignalController[] = [
  {
    id: "sig-d71-citywalk",
    label: "D71 / City Walk Access",
    lat: 25.20754,
    lon: 55.26095,
    cycleSeconds: 90,
    offsetSeconds: 0,
    phases: [
      { label: "D71 through", color: "green", start: 0, duration: 34, protectedTurns: ["through", "right"] },
      { label: "D71 clearance", color: "amber", start: 34, duration: 5, protectedTurns: ["through"] },
      { label: "Access protected", color: "green", start: 39, duration: 28, protectedTurns: ["left", "through"] },
      { label: "Access clearance", color: "amber", start: 67, duration: 5, protectedTurns: ["left"] },
      { label: "All red", color: "red", start: 72, duration: 18, protectedTurns: [] }
    ]
  },
  {
    id: "sig-alwasl-77b",
    label: "Al Wasl / 77b Street",
    lat: 25.2112,
    lon: 55.25639,
    cycleSeconds: 84,
    offsetSeconds: 17,
    phases: [
      { label: "D92 mainline", color: "green", start: 0, duration: 36, protectedTurns: ["through"] },
      { label: "D92 amber", color: "amber", start: 36, duration: 5, protectedTurns: ["through"] },
      { label: "77b protected", color: "green", start: 41, duration: 24, protectedTurns: ["left", "right"] },
      { label: "77b amber", color: "amber", start: 65, duration: 5, protectedTurns: ["right"] },
      { label: "All red", color: "red", start: 70, duration: 14, protectedTurns: [] }
    ]
  },
  {
    id: "sig-d90-access",
    label: "Al Satwa / Service Loop",
    lat: 25.21432,
    lon: 55.26413,
    cycleSeconds: 78,
    offsetSeconds: 31,
    phases: [
      { label: "D90 corridor", color: "green", start: 0, duration: 32, protectedTurns: ["through"] },
      { label: "D90 clearance", color: "amber", start: 32, duration: 5, protectedTurns: ["through"] },
      { label: "Loop entry", color: "green", start: 37, duration: 22, protectedTurns: ["left", "right"] },
      { label: "Loop clearance", color: "amber", start: 59, duration: 5, protectedTurns: ["left"] },
      { label: "All red", color: "red", start: 64, duration: 14, protectedTurns: [] }
    ]
  },
  {
    id: "sig-albadaa-ramp",
    label: "Al Badaa' / D71 West Ramp",
    lat: 25.20599,
    lon: 55.26901,
    cycleSeconds: 96,
    offsetSeconds: 44,
    phases: [
      { label: "Ramp discharge", color: "green", start: 0, duration: 30, protectedTurns: ["through", "right"] },
      { label: "Ramp amber", color: "amber", start: 30, duration: 5, protectedTurns: ["right"] },
      { label: "Al Badaa' progression", color: "green", start: 35, duration: 38, protectedTurns: ["through"] },
      { label: "Al Badaa' amber", color: "amber", start: 73, duration: 5, protectedTurns: ["through"] },
      { label: "All red", color: "red", start: 78, duration: 18, protectedTurns: [] }
    ]
  }
];

export const sampleFlowPoints = roadSegments
  .filter((segment) => segment.priority !== "access")
  .map((segment) => ({
    id: segment.id,
    lat: segment.coordinates[Math.floor(segment.coordinates.length / 2)].lat,
    lon: segment.coordinates[Math.floor(segment.coordinates.length / 2)].lon
  }));
