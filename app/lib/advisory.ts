// Shared advisory contract between the client (CityWalkDashboard / AgentAdvisoryRail)
// and the server (app/lib/mistral/agent.ts, app/api/agent/advisory/route.ts).
//
// This is the exact shape the Mistral agent is forced to emit via the
// `emit_advisory` function tool. Keeping it in one place guarantees the schema
// the model is validated against matches the types the UI renders.

export type Severity = "info" | "watch" | "act";

export type AdvisoryAction =
  | "set_signal_strategy"
  | "set_scenario"
  | "focus_intersection"
  | "monitor";

export type SignalStrategy = "standard" | "green-wave";
export type ScenarioMode = "baseline" | "congestion";

export type Recommendation = {
  action: AdvisoryAction;
  params: {
    strategy?: SignalStrategy;
    scenario?: ScenarioMode;
    intersectionId?: string;
  };
};

export type Advisory = {
  severity: Severity;
  corridor: string;
  cause: string;
  recommendation: Recommendation;
  expectedImpact: {
    queueDeltaPct: number;
    delayDeltaSec: number;
  };
  confidence: number;
  rationale: string;
};

// Compact live-state snapshot the client sends to the agent each analysis pass.
// Every field already exists in the dashboard's managedPlan / commandMetrics.
export type SnapshotIntersection = {
  label: string;
  corridor: string;
  averageSpeed: number;
  queueMeters: number;
  delaySeconds: number;
  phase: string;
};

export type Snapshot = {
  scenarioMode: ScenarioMode;
  signalStrategy: SignalStrategy;
  commandMetrics: {
    totalQueue: number;
    averageDelay: number;
    corridorSpeed: number;
    throughput: number;
  };
  intersections: SnapshotIntersection[];
};

// What the operator did with the previous advisory. Sent on the next pass so the
// agent's conversation memory reflects the real outcome (function.result).
export type Decision = "approved" | "dismissed" | "superseded";

// Request body for POST /api/agent/advisory.
export type AdvisoryRequest = {
  snapshot: Snapshot;
  // Conversation continuity: returned by a prior response, echoed back here.
  conversationId?: string;
  pendingToolCallId?: string;
  lastDecision?: Decision;
  reason?: string; // why the client triggered (threshold text or "manual")
};

// Discriminated response from POST /api/agent/advisory.
export type AdvisoryResponse =
  | { mode: "disabled" }
  | { mode: "error"; message: string }
  | {
      mode: "active";
      advisory: Advisory;
      conversationId: string;
      toolCallId: string;
      model: string;
      source: "agent" | "fallback";
    };

// The JSON Schema handed to Mistral as the `emit_advisory` function tool.
// Strict enums are the guardrail: the model cannot invent an action or strategy
// the app can't execute.
export const EMIT_ADVISORY_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_advisory",
    description: "Emit exactly one structured traffic advisory for the operator.",
    parameters: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["info", "watch", "act"] },
        corridor: { type: "string", description: "The corridor or intersection label from the snapshot" },
        cause: { type: "string", description: "The reasoning: WHY it is degrading, grounded in the snapshot numbers" },
        recommendation: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["set_signal_strategy", "set_scenario", "focus_intersection", "monitor"] },
            params: {
              type: "object",
              properties: {
                strategy: { type: "string", enum: ["green-wave", "standard"] },
                scenario: { type: "string", enum: ["baseline", "congestion"] },
                intersectionId: { type: "string" },
              },
              additionalProperties: false,
            },
          },
          required: ["action", "params"],
          additionalProperties: false,
        },
        expectedImpact: {
          type: "object",
          properties: {
            queueDeltaPct: { type: "number" },
            delayDeltaSec: { type: "number" },
          },
          required: ["queueDeltaPct", "delayDeltaSec"],
          additionalProperties: false,
        },
        confidence: { type: "number" },
        rationale: { type: "string" },
      },
      required: ["severity", "corridor", "cause", "recommendation", "expectedImpact", "confidence", "rationale"],
      additionalProperties: false,
    },
  },
};

export const AGENT_INSTRUCTIONS =
  "You are the autonomous congestion agent for the SEHLI City Walk Dubai traffic command center. " +
  "On each turn you receive a JSON snapshot of the live managed corridor: scenario mode, the active signal strategy, " +
  "command metrics, and per-intersection queue (meters), delay (seconds), average speed (km/h) and signal phase. " +
  "Analyze it and call emit_advisory EXACTLY ONCE. Diagnose WHY a corridor is degrading using the numbers you were given " +
  "- name the mechanism (arterial spillback, fixed-time phasing under surge, downstream blocking). " +
  "Recommend at most one action the operator can execute. Only recommend action=set_signal_strategy with strategy=green-wave " +
  "when the active signalStrategy is 'standard' AND there is a clear queue-and-delay-backed win; otherwise recommend " +
  "action=monitor and explain what you are watching. Ground expectedImpact in the snapshot magnitudes, do not invent precision. " +
  "Keep rationale to 1-2 crisp operator-facing sentences. Do NOT repeat an advisory you already emitted earlier in this " +
  "conversation unless conditions have materially changed.";

// Runtime validator - the guardrail that survived the live probe (a model once
// returned strategy:"congestion", which is invalid). Returns a clean Advisory or
// null so the caller can retry / degrade.
export function validateAdvisory(raw: unknown): Advisory | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;

  const severity = a.severity;
  if (severity !== "info" && severity !== "watch" && severity !== "act") return null;

  const rec = a.recommendation as Record<string, unknown> | undefined;
  if (!rec || typeof rec !== "object") return null;
  const action = rec.action;
  const validActions: AdvisoryAction[] = ["set_signal_strategy", "set_scenario", "focus_intersection", "monitor"];
  if (typeof action !== "string" || !validActions.includes(action as AdvisoryAction)) return null;

  const params = (rec.params ?? {}) as Record<string, unknown>;
  const strategy = params.strategy;
  const scenario = params.scenario;
  if (strategy !== undefined && strategy !== "green-wave" && strategy !== "standard") return null;
  if (scenario !== undefined && scenario !== "baseline" && scenario !== "congestion") return null;

  const impact = a.expectedImpact as Record<string, unknown> | undefined;
  if (!impact || typeof impact.queueDeltaPct !== "number" || typeof impact.delayDeltaSec !== "number") return null;

  if (typeof a.corridor !== "string" || typeof a.cause !== "string" || typeof a.rationale !== "string") return null;
  const confidence = typeof a.confidence === "number" ? Math.max(0, Math.min(1, a.confidence)) : 0.5;

  return {
    severity,
    corridor: a.corridor,
    cause: a.cause,
    recommendation: {
      action: action as AdvisoryAction,
      params: {
        strategy: strategy as SignalStrategy | undefined,
        scenario: scenario as ScenarioMode | undefined,
        intersectionId: typeof params.intersectionId === "string" ? params.intersectionId : undefined,
      },
    },
    expectedImpact: {
      queueDeltaPct: impact.queueDeltaPct as number,
      delayDeltaSec: impact.delayDeltaSec as number,
    },
    confidence,
    rationale: a.rationale,
  };
}
