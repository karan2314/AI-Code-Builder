import { AlertOctagon, Eye, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Tier } from "../types";

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</h2>}
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
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
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

export function RiskBar({ value }: { value: number }) {
  const color = value >= 0.85 ? "bg-red-600" : value >= 0.6 ? "bg-amber-500" : "bg-sky-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 rounded bg-slate-200" aria-hidden>
        <div className={`h-2 rounded ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="font-mono text-xs">{value.toFixed(2)}</span>
    </div>
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
