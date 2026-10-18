import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip, ErrorBox, Loading, PriorityBadge, RiskBar, SlaChip, TierBadge, score1000 } from "../components/ui";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, TableScrollBox, stickyHeader } from "../components/ui/table";
import { api } from "../lib/api";
import { dateTime, formatINR, humanize, maskId, slaText } from "../lib/format";
import type { Priority, QueueItem } from "../types";

type SortKey = "priority" | "timestamp" | "risk_score" | "amount_rupees" | "sla";
const LABEL: Record<Priority, string> = { P1: "High", P2: "Medium", P3: "Low" };
const selectCls = "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900";

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
      <p className="text-sm text-slate-600">
        Transactions above the calibrated threshold ({score1000(q.data!.threshold)} / 1000, model {q.data!.model_version}). Priority comes from the policy tier once investigated, otherwise from the risk score.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter by priority" className="flex flex-wrap gap-1">
          {(["all", "P1", "P2", "P3"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === k ? "bg-slate-900 text-white" : "bg-white text-slate-700 shadow-xs hover:bg-slate-100"}`}>
              {k === "all" ? `All (${all.length})` : `${LABEL[k]} (${count(k)})`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2 text-slate-600">Status
            <select value={onlyOpen ? "open" : "all"} onChange={(e) => setOnlyOpen(e.target.value === "open")} className={selectCls}>
              <option value="open">Open only</option>
              <option value="all">All statuses</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-slate-600">Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectCls}>
              <option value="priority">Priority</option>
              <option value="sla">SLA remaining</option>
              <option value="timestamp">Most recent</option>
              <option value="risk_score">Risk score</option>
              <option value="amount_rupees">Amount</option>
            </select>
          </label>
        </div>
      </div>
      {open.error && <ErrorBox error={open.error} />}
      <TableScrollBox rows={5}>
        <Table>
          <TableCaption className="sr-only">Alerts. Press Enter on a row to open the case.</TableCaption>
          <TableHeader className={stickyHeader}>
            <TableRow className="hover:bg-transparent">
              {["Priority", "Time", "Transaction", "Customer", "Amount", "Risk", "Signals", "SLA", "Assigned", "Case"].map((h) => (
                <TableHead key={h} className={h === "Amount" ? "h-11 text-right" : "h-11"}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.transaction_id} tabIndex={0} onClick={() => open.mutate(i)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open.mutate(i); } }}
                className="cursor-pointer focus:bg-muted"
                aria-label={`Open case for ${i.transaction_id}, priority ${i.priority}, ${formatINR(i.amount_rupees)}, risk ${score1000(i.risk_score)} out of 1000`}>
                <TableCell><PriorityBadge p={i.priority} /></TableCell>
                <TableCell className="whitespace-nowrap text-xs text-slate-600">{dateTime(i.timestamp)}</TableCell>
                <TableCell className="font-mono text-xs">{i.transaction_id}<div className="text-slate-500">{i.channel.toUpperCase()} → {i.counterparty_id}</div></TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs">{maskId(i.customer_id)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{formatINR(i.amount_rupees)}</TableCell>
                <TableCell><RiskBar value={i.risk_score} /></TableCell>
                <TableCell className="max-w-xs">
                  <div className="flex flex-wrap gap-1">
                    {i.reason_codes.slice(0, 3).map((c) => <Chip key={c} title={codes.data?.[c]}>{humanize(c)}</Chip>)}
                    {i.reason_codes.length > 3 && <Chip>+{i.reason_codes.length - 3}</Chip>}
                  </div>
                </TableCell>
                <TableCell><SlaChip sla={i.sla} text={slaText(i.sla)} /></TableCell>
                <TableCell className="whitespace-nowrap text-xs">{i.assignee ?? <span className="text-slate-500">Unassigned</span>}</TableCell>
                <TableCell className="whitespace-nowrap">{i.tier ? <TierBadge tier={i.tier} /> : <span className="text-xs text-slate-500">{humanize(i.case_status)}</span>}</TableCell>
              </TableRow>
            ))}
            {items.length === 0 && <TableRow><TableCell colSpan={10} className="h-24 text-center text-muted-foreground">No alerts match the filters.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableScrollBox>
      <p className="text-xs text-slate-500">SLA targets P1 12h · P2 24h · P3 48h, measured on the dataset clock. Customer IDs are masked in list views.</p>
    </div>
  );
}
