import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip, ErrorBox, Loading, PriorityBadge, RiskBar, SlaChip, TierBadge, score1000 } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, formatINR, humanize, maskId, slaText } from "../lib/format";
import type { Priority, QueueItem } from "../types";

type SortKey = "priority" | "timestamp" | "risk_score" | "amount_rupees" | "sla";
const LABEL: Record<Priority, string> = { P1: "High", P2: "Medium", P3: "Low" };

export default function Queue() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["queue"], queryFn: () => api.queue(150), refetchInterval: 8000 });
  const codes = useQuery({ queryKey: ["reason-codes"], queryFn: api.reasonCodes, staleTime: Infinity });
  const [sort, setSort] = useState<SortKey>("priority");
  const [tab, setTab] = useState<"all" | Priority>("all");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const open = useMutation({
    mutationFn: async (item: QueueItem) => item.case_id ?? (await api.createCase(item.transaction_id)).case_id,
    onSuccess: (id) => navigate(`/cases/${id}`),
  });

  const all = q.data?.items ?? [];
  const items = useMemo(() => {
    const list = all.filter((i) => (tab === "all" || i.priority === tab) && (!onlyOpen || i.sla.state !== "resolved"));
    const slaKey = (i: QueueItem) => i.sla.remaining_minutes ?? Number.MAX_SAFE_INTEGER;
    return [...list].sort((a, b) => {
      switch (sort) {
        case "priority": return a.priority.localeCompare(b.priority) || b.risk_score - a.risk_score;
        case "timestamp": return b.timestamp.localeCompare(a.timestamp);
        case "sla": return slaKey(a) - slaKey(b);
        default: return (b[sort] as number) - (a[sort] as number);
      }
    });
  }, [all, sort, tab, onlyOpen]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const count = (p: Priority) => all.filter((i) => i.priority === p).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Alert queue</h1>
          <p className="text-sm text-slate-600">
            Transactions above the calibrated threshold ({score1000(q.data!.threshold)} / 1000, model {q.data!.model_version}). Priority comes from the policy tier once investigated, otherwise from the risk score.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Open only</label>
          <label>Sort by{" "}
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded border border-slate-300 bg-white px-2 py-1">
              <option value="priority">Priority</option>
              <option value="sla">SLA remaining</option>
              <option value="timestamp">Most recent</option>
              <option value="risk_score">Risk score</option>
              <option value="amount_rupees">Amount</option>
            </select>
          </label>
        </div>
      </div>
      <div role="tablist" aria-label="Filter by priority" className="flex flex-wrap gap-1">
        {(["all", "P1", "P2", "P3"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-slate-900 text-white" : "bg-white text-slate-700 shadow-sm hover:bg-slate-100"}`}>
            {k === "all" ? `All (${all.length})` : `${LABEL[k]} (${count(k)})`}
          </button>
        ))}
      </div>
      {open.error && <ErrorBox error={open.error} />}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <caption className="sr-only">Alerts. Press Enter on a row to open the case.</caption>
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Priority</th><th>Time</th><th>Transaction</th><th>Customer</th><th className="text-right">Amount</th>
              <th className="px-3">Risk</th><th>Signals</th><th>SLA</th><th>Assigned</th><th className="pr-3">Case</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.transaction_id} tabIndex={0} onClick={() => open.mutate(i)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open.mutate(i); } }}
                className="cursor-pointer border-t border-slate-100 hover:bg-teal-50 focus:bg-teal-50"
                aria-label={`Open case for ${i.transaction_id}, priority ${i.priority}, ${formatINR(i.amount_rupees)}, risk ${score1000(i.risk_score)} out of 1000`}>
                <td className="px-3 py-2"><PriorityBadge p={i.priority} /></td>
                <td className="whitespace-nowrap text-xs text-slate-600">{dateTime(i.timestamp)}</td>
                <td className="font-mono text-xs">{i.transaction_id}<div className="text-slate-500">{i.channel.toUpperCase()} → {i.counterparty_id}</div></td>
                <td className="font-mono text-xs">{maskId(i.customer_id)}</td>
                <td className="whitespace-nowrap text-right font-semibold">{formatINR(i.amount_rupees)}</td>
                <td className="px-3"><RiskBar value={i.risk_score} /></td>
                <td className="max-w-xs py-2">
                  <div className="flex flex-wrap gap-1">
                    {i.reason_codes.slice(0, 3).map((c) => <Chip key={c} title={codes.data?.[c]}>{humanize(c)}</Chip>)}
                    {i.reason_codes.length > 3 && <Chip>+{i.reason_codes.length - 3}</Chip>}
                  </div>
                </td>
                <td><SlaChip sla={i.sla} text={slaText(i.sla)} /></td>
                <td className="whitespace-nowrap text-xs">{i.assignee ?? <span className="text-slate-500">Unassigned</span>}</td>
                <td className="whitespace-nowrap pr-3">{i.tier ? <TierBadge tier={i.tier} /> : <span className="text-xs text-slate-500">{humanize(i.case_status)}</span>}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-slate-500">No alerts match the filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">SLA targets P1 12h · P2 24h · P3 48h, measured on the dataset clock. Customer IDs are masked in list views.</p>
    </div>
  );
}
