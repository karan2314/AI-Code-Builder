import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip, ErrorBox, Loading, RiskBar, TierBadge } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, formatINR, humanize } from "../lib/format";
import type { QueueItem } from "../types";

type SortKey = "timestamp" | "risk_score" | "amount_rupees";

export default function Queue() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["queue"], queryFn: () => api.queue(150), refetchInterval: 8000 });
  const codes = useQuery({ queryKey: ["reason-codes"], queryFn: api.reasonCodes, staleTime: Infinity });
  const [sort, setSort] = useState<SortKey>("timestamp");
  const open = useMutation({
    mutationFn: async (item: QueueItem) => item.case_id ?? (await api.createCase(item.transaction_id)).case_id,
    onSuccess: (id) => navigate(`/cases/${id}`),
  });

  const items = useMemo(() => {
    const list = [...(q.data?.items ?? [])];
    const demo = list.filter((i) => i.demo);
    const rest = list.filter((i) => !i.demo).sort((a, b) =>
      sort === "timestamp" ? b.timestamp.localeCompare(a.timestamp) : (b[sort] as number) - (a[sort] as number));
    return [...demo, ...rest];
  }, [q.data, sort]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Suspicious transaction queue</h1>
          <p className="text-sm text-slate-600">
            Candidates above the calibrated threshold ({q.data!.threshold.toFixed(3)}, model {q.data!.model_version}). Demo scenarios are pinned on top.
          </p>
        </div>
        <label className="text-sm">
          Sort by{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded border border-slate-300 bg-white px-2 py-1">
            <option value="timestamp">Most recent</option>
            <option value="risk_score">Risk score</option>
            <option value="amount_rupees">Amount</option>
          </select>
        </label>
      </div>
      {open.error && <ErrorBox error={open.error} />}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <caption className="sr-only">Suspicious transactions. Press Enter on a row to open the case.</caption>
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Time</th><th>Transaction</th><th>Customer</th><th className="text-right">Amount</th>
              <th className="px-3">Risk</th><th>Reasons</th><th>Case</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr
                key={i.transaction_id}
                tabIndex={0}
                onClick={() => open.mutate(i)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open.mutate(i); } }}
                className={`cursor-pointer border-t border-slate-100 hover:bg-teal-50 focus:bg-teal-50 ${i.demo ? "bg-amber-50/60" : ""}`}
                aria-label={`Open case for ${i.transaction_id}, ${formatINR(i.amount_rupees)}, risk ${i.risk_score.toFixed(2)}`}
              >
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{dateTime(i.timestamp)}</td>
                <td className="font-mono text-xs">
                  {i.transaction_id} {i.demo && <Chip tone="amber">demo</Chip>}
                  <div className="text-slate-500">{i.channel.toUpperCase()} → {i.counterparty_id}</div>
                </td>
                <td className="font-mono text-xs">{i.customer_id}</td>
                <td className="whitespace-nowrap text-right font-semibold">{formatINR(i.amount_rupees)}</td>
                <td className="px-3"><RiskBar value={i.risk_score} /></td>
                <td className="max-w-xs py-2">
                  <div className="flex flex-wrap gap-1">
                    {i.reason_codes.slice(0, 4).map((c) => (
                      <Chip key={c} tone="slate" title={codes.data?.[c]}>{humanize(c)}</Chip>
                    ))}
                    {i.reason_codes.length > 4 && <Chip>+{i.reason_codes.length - 4}</Chip>}
                  </div>
                </td>
                <td className="whitespace-nowrap pr-3">{i.tier ? <TierBadge tier={i.tier} /> : <span className="text-xs text-slate-500">{humanize(i.case_status)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
