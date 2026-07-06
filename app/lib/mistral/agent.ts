// The ONLY module that talks to Mistral. Everything provider-specific lives here:
// the get-or-create agent lifecycle, the conversation (memory) flow, forced
// tool-call parsing, schema validation with one retry, and graceful degradation
// to a stateless chat-completions fallback. Server-only (reads MISTRAL_AI_API_KEY).

import {
  AGENT_INSTRUCTIONS,
  EMIT_ADVISORY_TOOL,
  validateAdvisory,
  type Advisory,
  type AdvisoryRequest,
  type Snapshot,
} from "@/app/lib/advisory";

const BASE = "https://api.mistral.ai/v1";
const PRIMARY_MODEL = process.env.MISTRAL_AGENT_MODEL || "mistral-medium-latest";
const FALLBACK_MODEL = "mistral-small-latest";
const TIMEOUT_MS = 12_000;

// In-memory cache so we don't recreate the agent on every request within a warm
// server instance. Seeded from env when present.
let cachedAgentId: string | null = process.env.MISTRAL_AGENT_ID || null;

export type AdvisoryResult =
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

export function isConfigured(): boolean {
  return Boolean(process.env.MISTRAL_AI_API_KEY);
}

function key(): string {
  return process.env.MISTRAL_AI_API_KEY as string;
}

async function mistralFetch(path: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Lazily ensure a persistent agent exists. Prefers MISTRAL_AGENT_ID; otherwise
// creates one and caches its id for the life of this server instance.
async function getOrCreateAgent(): Promise<string> {
  if (cachedAgentId) return cachedAgentId;
  const res = await mistralFetch("/agents", {
    model: PRIMARY_MODEL,
    name: "citywalk-congestion-agent",
    description: "Autonomous congestion agent for the SEHLI City Walk Dubai traffic command center.",
    instructions: AGENT_INSTRUCTIONS,
    tools: [EMIT_ADVISORY_TOOL],
  });
  if (!res.ok) throw new Error(`agent create failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedAgentId = data.id as string;
  return cachedAgentId;
}

type ConversationOutput = {
  conversation_id: string;
  outputs: Array<{ type?: string; name?: string; tool_call_id?: string; arguments?: string }>;
};

// Pull the emit_advisory function call out of a conversation response.
function extractToolCall(outputs: ConversationOutput["outputs"]) {
  const call = outputs.find((o) => o.type === "function.call" && o.name === "emit_advisory");
  if (!call || !call.arguments || !call.tool_call_id) return null;
  return { toolCallId: call.tool_call_id, args: call.arguments };
}

function snapshotMessage(snapshot: Snapshot): string {
  return "Analyze this live corridor snapshot and emit exactly one advisory.\n" + JSON.stringify(snapshot);
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Primary path: the persistent Agent + a durable Conversation (memory across
// advisories). Starts a new conversation or appends to an existing one, first
// closing out the previous advisory with the operator's decision as a
// function.result so the agent knows what actually happened.
async function runViaAgent(req: AdvisoryRequest): Promise<AdvisoryResult> {
  const agentId = await getOrCreateAgent();

  let res: Response;
  if (req.conversationId && req.pendingToolCallId) {
    const inputs = [
      {
        type: "function.result",
        tool_call_id: req.pendingToolCallId,
        result: JSON.stringify({ decision: req.lastDecision ?? "superseded" }),
      },
      { role: "user", content: snapshotMessage(req.snapshot) },
    ];
    res = await mistralFetch(`/conversations/${req.conversationId}`, { inputs });
  } else {
    res = await mistralFetch("/conversations", {
      agent_id: agentId,
      inputs: snapshotMessage(req.snapshot),
    });
  }

  if (!res.ok) throw new Error(`conversation failed: ${res.status}`);
  const data = (await res.json()) as ConversationOutput;
  const call = extractToolCall(data.outputs);
  if (!call) throw new Error("no emit_advisory tool call in response");

  const advisory = validateAdvisory(parseArgs(call.args));
  if (!advisory) throw new Error("advisory failed validation");

  return {
    mode: "active",
    advisory,
    conversationId: data.conversation_id,
    toolCallId: call.toolCallId,
    model: PRIMARY_MODEL,
    source: "agent",
  };
}

// Degradation path: a single stateless chat-completions call with the same forced
// tool, on a cheaper model. No conversation memory, but the operator still gets an
// advisory when the Agents API is unavailable (429/5xx/timeout).
async function runViaFallback(snapshot: Snapshot): Promise<AdvisoryResult> {
  const res = await mistralFetch("/chat/completions", {
    model: FALLBACK_MODEL,
    messages: [
      { role: "system", content: AGENT_INSTRUCTIONS },
      { role: "user", content: snapshotMessage(snapshot) },
    ],
    tools: [EMIT_ADVISORY_TOOL],
    tool_choice: { type: "function", function: { name: "emit_advisory" } },
  });
  if (!res.ok) throw new Error(`fallback failed: ${res.status}`);
  const data = await res.json();
  const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
  const advisory = validateAdvisory(parseArgs(toolCall?.function?.arguments ?? ""));
  if (!advisory) throw new Error("fallback advisory failed validation");

  return {
    mode: "active",
    advisory,
    conversationId: "",
    toolCallId: "",
    model: FALLBACK_MODEL,
    source: "fallback",
  };
}

export async function requestAdvisory(req: AdvisoryRequest): Promise<AdvisoryResult> {
  if (!isConfigured()) return { mode: "disabled" };

  // Try the agent path, retry once (covers a transient validation miss or blip),
  // then fall back to a stateless completion before giving up.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await runViaAgent(req);
    } catch {
      if (attempt === 1) {
        try {
          return await runViaFallback(req.snapshot);
        } catch (fallbackErr) {
          return {
            mode: "error",
            message: fallbackErr instanceof Error ? fallbackErr.message : "advisory failed",
          };
        }
      }
      // On the first failure that carried a conversation, retry as a fresh
      // conversation so a bad pending state can't wedge us.
      if (req.conversationId) {
        req = { ...req, conversationId: undefined, pendingToolCallId: undefined };
      }
    }
  }

  return { mode: "error", message: "advisory failed" };
}
