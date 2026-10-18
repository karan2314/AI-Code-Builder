const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN");

export const formatINR = (v: number | null | undefined) => (v == null ? "—" : inr.format(v));
export const formatNum = (v: number | null | undefined) => (v == null ? "—" : num.format(v));
export const pct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
/** Compact Indian notation for KPI cards: ₹48.6L, ₹1.2Cr. */
export const formatINRCompact = (v: number | null | undefined) => {
  if (v == null) return "—";
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  return inr.format(v);
};
/** Mask an identifier for list views (privacy by default): CUST-000123 → CUST-****23. */
export const maskId = (id: string) => {
  const i = id.indexOf("-");
  const body = id.slice(i + 1);
  return body.length <= 2 ? id : `${id.slice(0, i + 1)}****${body.slice(-2)}`;
};
export const slaText = (s: { remaining_minutes: number | null; state: string }) => {
  if (s.state === "resolved" || s.remaining_minutes == null) return "Resolved";
  const m = Math.abs(s.remaining_minutes);
  const t = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  return s.remaining_minutes < 0 ? `${t} over` : `${t} left`;
};
export const humanize = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
