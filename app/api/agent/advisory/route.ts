import { requestAdvisory } from "@/app/lib/mistral/agent";
import type { AdvisoryRequest } from "@/app/lib/advisory";

export const dynamic = "force-dynamic";

// Thin HTTP layer over the Mistral agent module. Validates the request shape,
// delegates all provider logic to lib/mistral/agent.ts, and always returns 200
// with a typed discriminated body so the dashboard never has to handle throws.
export async function POST(request: Request) {
  let body: Partial<AdvisoryRequest>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ mode: "error", message: "invalid JSON body" });
  }

  if (!body || typeof body !== "object" || !body.snapshot || !Array.isArray(body.snapshot.intersections)) {
    return Response.json({ mode: "error", message: "missing snapshot" });
  }

  const result = await requestAdvisory({
    snapshot: body.snapshot,
    conversationId: body.conversationId,
    pendingToolCallId: body.pendingToolCallId,
    lastDecision: body.lastDecision,
    reason: body.reason,
  });

  return Response.json(result);
}
