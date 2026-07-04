import { osmRoads } from "@/app/data/osm-citywalk";

export const dynamic = "force-dynamic";

type FlowResult = {
  segmentId: string;
  currentSpeed: number;
  freeFlowSpeed: number;
  confidence: number;
  roadClosure: boolean;
  source: "tomtom" | "simulation";
};

function fallbackFlow(): FlowResult[] {
  const now = Date.now() / 1000;

  return osmRoads.map((segment, index) => {
    const freeFlowSpeed = Math.max(20, segment.maxspeed);
    const wave = Math.sin(now / 18 + index * 0.83);
    const corridorPenalty = segment.priority === "arterial" ? 0.2 : segment.priority === "collector" ? 0.12 : 0.04;
    const ratio = Math.max(0.32, Math.min(0.96, 0.72 + wave * 0.18 - corridorPenalty));

    return {
      segmentId: segment.id,
      currentSpeed: Math.round(freeFlowSpeed * ratio),
      freeFlowSpeed,
      confidence: 0.58,
      roadClosure: false,
      source: "simulation"
    };
  });
}

export async function GET() {
  const apiKey = process.env.TOMTOM_API_KEY;

  if (!apiKey) {
    return Response.json({
      mode: "simulation",
      updatedAt: new Date().toISOString(),
      flows: fallbackFlow()
    });
  }

  try {
    const sampleFlowPoints = osmRoads
      .filter((segment) => segment.priority === "arterial" || segment.priority === "collector")
      .slice(0, 80)
      .map((segment) => {
        const middle = segment.coordinates[Math.floor(segment.coordinates.length / 2)];
        return {
          id: segment.id,
          lat: middle[0],
          lon: middle[1]
        };
      });

    const flows = await Promise.all(
      sampleFlowPoints.map(async (point) => {
        const url = new URL("https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/18/json");
        url.searchParams.set("key", apiKey);
        url.searchParams.set("point", `${point.lat},${point.lon}`);
        url.searchParams.set("unit", "kmph");

        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`TomTom responded ${response.status}`);
        }

        const data = await response.json();
        const flow = data.flowSegmentData;

        return {
          segmentId: point.id,
          currentSpeed: Number(flow.currentSpeed),
          freeFlowSpeed: Number(flow.freeFlowSpeed),
          confidence: Number(flow.confidence ?? 0.75),
          roadClosure: Boolean(flow.roadClosure),
          source: "tomtom" as const
        };
      })
    );

    const byId = new Map(flows.map((flow) => [flow.segmentId, flow]));
    const merged = fallbackFlow().map((flow) => byId.get(flow.segmentId) ?? flow);

    return Response.json({
      mode: "tomtom",
      updatedAt: new Date().toISOString(),
      flows: merged
    });
  } catch (error) {
    return Response.json(
      {
        mode: "simulation",
        updatedAt: new Date().toISOString(),
        warning: error instanceof Error ? error.message : "Traffic provider failed",
        flows: fallbackFlow()
      },
      { status: 200 }
    );
  }
}
