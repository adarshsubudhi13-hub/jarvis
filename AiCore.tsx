import type { JarvisState } from "@/lib/jarvis-types";
import { cn } from "@/lib/utils";

const LABEL: Record<JarvisState, string> = {
  IDLE: "Standing by",
  LISTENING: "Listening",
  THINKING: "Thinking",
  SPEAKING: "Speaking",
  EXECUTING: "Executing",
  ERROR: "Fault detected",
};

export function AiCore({ state, level }: { state: JarvisState; level: number }) {
  const active = state !== "IDLE";
  return (
    <div className="relative flex aspect-square w-full max-w-[22rem] items-center justify-center">
      <div
        className={cn(
          "absolute inset-0 rounded-full bg-primary/10 blur-3xl transition-opacity duration-700",
          active ? "opacity-90" : "opacity-40",
        )}
      />
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        <circle
          cx="100"
          cy="100"
          r="94"
          className="fill-none stroke-primary/25"
          strokeWidth="0.6"
          strokeDasharray="2 6"
        />
        <g className="origin-center animate-[spin_18s_linear_infinite]">
          <circle
            cx="100"
            cy="100"
            r="82"
            className="fill-none stroke-primary/70"
            strokeWidth="1.2"
            strokeDasharray="120 60 40 90"
            strokeLinecap="round"
          />
        </g>
        <g className="origin-center animate-[spin_11s_linear_infinite_reverse]">
          <circle
            cx="100"
            cy="100"
            r="68"
            className="fill-none stroke-accent/70"
            strokeWidth="0.9"
            strokeDasharray="30 18"
          />
        </g>
        <g className="origin-center animate-[spin_26s_linear_infinite]">
          <circle
            cx="100"
            cy="100"
            r="55"
            className="fill-none stroke-primary/40"
            strokeWidth="0.7"
            strokeDasharray="6 10"
          />
        </g>
      </svg>

      <div
        className="absolute h-40 w-40 rounded-full border border-primary/40 bg-[radial-gradient(circle_at_50%_45%,var(--core-hot),transparent_70%)] transition-transform duration-200"
        style={{ transform: `scale(${1 + level * 0.18})` }}
      />
      <div className="absolute flex h-28 w-28 items-center justify-center rounded-full border border-primary/50 bg-background/60 shadow-[0_0_60px_-10px_var(--glow)] backdrop-blur-sm">
        <div className="text-center">
          <p className="font-display text-[0.6rem] tracking-[0.42em] text-primary/80">JARVIS</p>
          <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground">
            {LABEL[state]}
          </p>
        </div>
      </div>
    </div>
  );
}
