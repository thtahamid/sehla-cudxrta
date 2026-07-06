"use client";

import { useState } from "react";
import type { Advisory } from "@/app/lib/advisory";

export type RailStatus = "idle" | "analyzing" | "advisory" | "applied" | "error" | "disabled";

export type AppliedResult = {
  queueBefore: number;
  queueAfter: number;
  delayBefore: number;
  delayAfter: number;
};

type Props = {
  status: RailStatus;
  advisory: Advisory | null;
  model: string | null;
  source: "agent" | "fallback" | null;
  reason: string | null;
  appliedResult: AppliedResult | null;
  errorMessage: string | null;
  onApprove: () => void;
  onDismiss: () => void;
  onAnalyze: () => void;
};

const severityLabel: Record<Advisory["severity"], string> = {
  info: "Info",
  watch: "Watch",
  act: "Act",
};

function actionLabel(advisory: Advisory): string {
  const { action, params } = advisory.recommendation;
  switch (action) {
    case "set_signal_strategy":
      return params.strategy === "green-wave" ? "Apply green-wave" : "Set standard timing";
    case "set_scenario":
      return params.scenario === "baseline" ? "Switch to baseline" : "Switch to congestion";
    case "focus_intersection":
      return "Focus corridor";
    default:
      return "Monitor";
  }
}

export default function AgentAdvisoryRail({
  status,
  advisory,
  model,
  source,
  reason,
  appliedResult,
  errorMessage,
  onApprove,
  onDismiss,
  onAnalyze,
}: Props) {
  const [traceOpen, setTraceOpen] = useState(true);

  return (
    <section className="agentRail reveal" aria-label="AI congestion agent" style={{ "--i": 0 } as React.CSSProperties}>
      <div className="agentRailHead">
        <div className="agentRailBrand">
          <span className={`agentDot ${status === "analyzing" ? "pulsing" : ""}`} aria-hidden="true" />
          <div>
            <strong>Twin Brain</strong>
            <span className="agentRailSub">
              Autonomous congestion agent
              {model ? ` · ${model}` : ""}
              {source === "fallback" ? " · fallback" : ""}
            </span>
          </div>
        </div>
        <button className="agentAnalyzeBtn" type="button" onClick={onAnalyze} disabled={status === "analyzing"}>
          {status === "analyzing" ? "Analyzing…" : "Analyze now"}
        </button>
      </div>

      {status === "disabled" && (
        <p className="agentRailNote">AI copilot not configured. Set MISTRAL_AI_API_KEY to enable advisories.</p>
      )}

      {status === "idle" && (
        <p className="agentRailNote">Monitoring the managed corridor. The agent will surface an advisory if it degrades.</p>
      )}

      {status === "analyzing" && (
        <p className="agentRailNote">
          <span className="agentSkeletonLine" />
          <span className="agentSkeletonLine short" />
          Reasoning over the live snapshot{reason ? ` · triggered by ${reason}` : ""}…
        </p>
      )}

      {status === "error" && (
        <p className="agentRailNote error">Couldn&apos;t analyze the corridor{errorMessage ? ` (${errorMessage})` : ""}. Retry when ready.</p>
      )}

      {status === "advisory" && advisory && (
        <article className={`advisoryCard sev-${advisory.severity}`}>
          <header className="advisoryTop">
            <span className={`sevChip sev-${advisory.severity}`}>{severityLabel[advisory.severity]}</span>
            <span className="advisoryCorridor">{advisory.corridor}</span>
            <span className="advisoryConf">confidence {advisory.confidence.toFixed(2)}</span>
          </header>

          <div className="advisoryBody">
            <p className="advisoryRationale">{advisory.rationale}</p>

            <button className="traceToggle" type="button" onClick={() => setTraceOpen((v) => !v)} aria-expanded={traceOpen}>
              {traceOpen ? "▾" : "▸"} Reasoning trace
            </button>
            {traceOpen && (
              <div className="advisoryTrace">
                <span className="traceLabel">Cause</span>
                {advisory.cause}
              </div>
            )}

            <div className="advisoryImpact">
              <div className="impactMetric">
                <span className={`impactValue ${advisory.expectedImpact.queueDeltaPct <= 0 ? "good" : "bad"}`}>
                  {advisory.expectedImpact.queueDeltaPct > 0 ? "+" : ""}
                  {advisory.expectedImpact.queueDeltaPct}%
                </span>
                <span className="impactLabel">queue</span>
              </div>
              <div className="impactMetric">
                <span className={`impactValue ${advisory.expectedImpact.delayDeltaSec <= 0 ? "good" : "bad"}`}>
                  {advisory.expectedImpact.delayDeltaSec > 0 ? "+" : ""}
                  {advisory.expectedImpact.delayDeltaSec}s
                </span>
                <span className="impactLabel">delay</span>
              </div>
              <div className="impactMetric">
                <span className="impactValue">{actionLabel(advisory)}</span>
                <span className="impactLabel">recommended action</span>
              </div>
            </div>
          </div>

          <footer className="advisoryActions">
            {advisory.recommendation.action === "monitor" ? (
              <button className="advisoryBtn ghost" type="button" onClick={onDismiss}>
                Acknowledge
              </button>
            ) : (
              <>
                <button className="advisoryBtn primary" type="button" onClick={onApprove}>
                  Approve &amp; apply
                </button>
                <button className="advisoryBtn ghost" type="button" onClick={onDismiss}>
                  Dismiss
                </button>
              </>
            )}
          </footer>
        </article>
      )}

      {status === "applied" && appliedResult && (
        <article className="advisoryCard applied">
          <header className="advisoryTop">
            <span className="sevChip applied">Applied</span>
            <span className="advisoryCorridor">{advisory?.corridor ?? "Corridor"}</span>
          </header>
          <div className="advisoryBody">
            <div className="advisoryImpact">
              <div className="impactMetric">
                <span className="impactValue">{Math.round(appliedResult.queueBefore)}m → <b>{Math.round(appliedResult.queueAfter)}m</b></span>
                <span className="impactLabel">queue before → after</span>
              </div>
              <div className="impactMetric">
                <span className="impactValue">{Math.round(appliedResult.delayBefore)}s → <b>{Math.round(appliedResult.delayAfter)}s</b></span>
                <span className="impactLabel">delay before → after</span>
              </div>
            </div>
          </div>
        </article>
      )}
    </section>
  );
}
