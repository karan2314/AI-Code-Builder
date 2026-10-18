import { AlertOctagon, Eye, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Tier } from "../types";

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const TIER_STYLE: Record<Tier, { cls: string; label: string; Icon: typeof Eye }> = {
  1: { cls: "bg-sky-100 text-sky-900 border-sky-300", label: "Tier 1 · Monitor", Icon: Eye },
  2: { cls: "bg-amber-100 text-amber-900 border-amber-300", label: "Tier 2 · Verify", Icon: ShieldAlert },
  3: { cls: "bg-red-100 text-red-900 border-red-300", label: "Tier 3 · Contain", Icon: AlertOctagon },
};

export function TierBadge({ tier, size = "sm" }: { tier: Tier | null | undefined; size?: "sm" | "lg" }) {
  if (!tier) return <span className="text-xs text-slate-500">Not assessed</span>;
  const { cls, label, Icon } = TIER_STYLE[tier];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold ${cls} ${size === "lg" ? "px-3 py-1 text-base" : "px-2 py-0.5 text-xs"}`}>
      <Icon className={size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} aria-hidden />
      {label}
    </span>
  );
}

/** Display scale: the 0–1 blended risk score shown as 0–1000 (bank-familiar, display only; the model is unchanged). */
export const score1000 = (value: number) => Math.round(value * 1000);

export function RiskBar({ value }: { value: number }) {
  const color = value >= 0.85 ? "bg-red-600" : value >= 0.6 ? "bg-amber-500" : "bg-sky-500";
  return (
    <div className="flex items-center gap-2" title={`Risk ${score1000(value)} / 1000 (raw ${value.toFixed(3)})`}>
      <div className="h-2 w-16 rounded bg-slate-200" aria-hidden>
        <div className={`h-2 rounded ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="font-mono text-xs">{score1000(value)}<span className="text-slate-500">/1000</span></span>
    </div>
  );
}

const AUTONOMY_TEXT: Record<number, string> = {
  1: "Manual: analyst investigates",
  2: "AI investigates, human decides",
  3: "AI recommends, sampled human review",
  4: "Auto-close within guardrails",
};

export function AutonomyBadge({ level, ceiling }: { level: number | undefined; ceiling?: number }) {
  if (!level) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-900"
      title={`Autonomy ladder: L1 manual · L2 AI investigates, human decides · L3 AI recommends, sampled review · L4 auto-close within guardrails.${ceiling ? ` This tier can be promoted up to L${ceiling} after validation.` : ""}`}
    >
      Autonomy L{level} · {AUTONOMY_TEXT[level]}
    </span>
  );
}

export function Chip({ children, tone = "slate", title }: { children: ReactNode; tone?: "slate" | "red" | "amber" | "teal" | "sky"; title?: string }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    red: "bg-red-50 text-red-800 border-red-200",
    amber: "bg-amber-50 text-amber-900 border-amber-200",
    teal: "bg-teal-50 text-teal-800 border-teal-200",
    sky: "bg-sky-50 text-sky-800 border-sky-200",
  };
  return (
    <span title={title} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="py-8 text-center text-sm text-slate-500">
      {label}
    </p>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

const PRIORITY_STYLE: Record<string, string> = {
  P1: "bg-red-600 text-white",
  P2: "bg-amber-500 text-white",
  P3: "bg-sky-600 text-white",
};

export function PriorityBadge({ p, size = "sm" }: { p: string; size?: "sm" | "lg" }) {
  return (
    <span className={`inline-flex items-center justify-center rounded font-bold ${PRIORITY_STYLE[p] ?? "bg-slate-500 text-white"} ${size === "lg" ? "px-2 py-1 text-sm" : "px-1.5 py-0.5 text-[11px]"}`}
          title={{ P1: "Priority 1 (highest)", P2: "Priority 2", P3: "Priority 3" }[p]}>
      {p}
    </span>
  );
}

const SLA_STYLE: Record<string, string> = {
  on_track: "text-teal-800 bg-teal-50 border-teal-200",
  at_risk: "text-amber-900 bg-amber-50 border-amber-300",
  breached: "text-red-800 bg-red-50 border-red-200",
  resolved: "text-slate-600 bg-slate-50 border-slate-200",
};

export function SlaChip({ sla, text }: { sla: { state: string }; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${SLA_STYLE[sla.state]}`}
          title={`SLA ${sla.state.replace("_", " ")} (prototype SLA targets, dataset clock)`}>
      <span className={`h-1.5 w-1.5 rounded-full ${sla.state === "on_track" ? "bg-teal-600" : sla.state === "at_risk" ? "bg-amber-500" : sla.state === "breached" ? "bg-red-600" : "bg-slate-400"}`} aria-hidden />
      {text}
    </span>
  );
}

export function Delta({ delta, goodWhenDown = true, suffix = "vs prev 24h", format = (n: number) => String(n) }:
  { delta: number; goodWhenDown?: boolean; suffix?: string; format?: (n: number) => string }) {
  if (delta === 0) return <span className="text-xs text-slate-500">no change {suffix}</span>;
  const up = delta > 0;
  const good = up !== goodWhenDown;
  return (
    <span className={`text-xs font-medium ${good ? "text-teal-700" : "text-red-700"}`}>
      {up ? "▲" : "▼"} {format(Math.abs(delta))} <span className="font-normal text-slate-500">{suffix}</span>
    </span>
  );
}
