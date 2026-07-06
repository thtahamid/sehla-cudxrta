import { useCallback, useEffect, useRef } from "react";
import type { SignalStrategy } from "@/app/lib/advisory";

// Edge-triggered congestion watcher. Fires onFire(reason) once when the corridor
// enters a state worth an advisory, re-arms when it clears, and debounces so a
// standing condition can't spam the agent. A manual "Analyze now" bypasses all of
// this by calling the fetch directly in the dashboard.
//
// Thresholds calibrated to the app's own metrics: congestion totalQueue ~1080 and
// avg delay ~79s, versus baseline ~204 / ~15s - so 600m / 50s cleanly separates a
// real congestion episode from nominal flow.
//
// The queue/delay metrics are static per (scenario, strategy), so a dep-only
// effect would evaluate once during the initial-settle window and never again. A
// mount timer re-runs the check after that window so a standing congestion state
// still surfaces an advisory.
const QUEUE_LIMIT = 600;
const DELAY_LIMIT = 50;
const DEBOUNCE_MS = 30_000;
const INITIAL_DELAY_MS = 2_500;

type WatcherArgs = {
  totalQueue: number;
  averageDelay: number;
  signalStrategy: SignalStrategy;
  enabled: boolean;
  onFire: (reason: string) => void;
};

export function useCongestionWatcher({ totalQueue, averageDelay, signalStrategy, enabled, onFire }: WatcherArgs) {
  const armedRef = useRef(true);
  const lastFireRef = useRef(0);
  const mountedAtRef = useRef(0);
  const onFireRef = useRef(onFire);
  const stateRef = useRef({ totalQueue, averageDelay, signalStrategy, enabled });

  useEffect(() => {
    onFireRef.current = onFire;
  }, [onFire]);

  useEffect(() => {
    stateRef.current = { totalQueue, averageDelay, signalStrategy, enabled };
  }, [totalQueue, averageDelay, signalStrategy, enabled]);

  const check = useCallback(() => {
    const s = stateRef.current;
    if (!s.enabled) return;

    // There is only an actionable win when signals are still on the standard plan.
    const problem =
      s.signalStrategy === "standard" && (s.totalQueue >= QUEUE_LIMIT || s.averageDelay >= DELAY_LIMIT);

    if (!problem) {
      armedRef.current = true; // condition cleared - re-arm for the next episode
      return;
    }

    const now = Date.now();
    if (!armedRef.current) return;
    if (mountedAtRef.current && now - mountedAtRef.current < INITIAL_DELAY_MS) return;
    if (now - lastFireRef.current < DEBOUNCE_MS) return;

    armedRef.current = false;
    lastFireRef.current = now;

    const reason =
      s.totalQueue >= QUEUE_LIMIT
        ? `queue ${Math.round(s.totalQueue)}m across managed corridor`
        : `avg delay ${Math.round(s.averageDelay)}s`;
    onFireRef.current(reason);
  }, []);

  // First evaluation after the settle window (metrics are static, so a dep effect
  // alone would miss a standing congestion state).
  useEffect(() => {
    mountedAtRef.current = Date.now();
    const timer = setTimeout(check, INITIAL_DELAY_MS + 50);
    return () => clearTimeout(timer);
  }, [check]);

  // Re-evaluate whenever the inputs change (e.g. operator toggles back to standard).
  useEffect(() => {
    check();
  }, [totalQueue, averageDelay, signalStrategy, enabled, check]);
}
