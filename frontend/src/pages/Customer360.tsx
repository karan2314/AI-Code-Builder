import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { Card, ErrorBox, Loading, Stat } from "../components/ui";
import { api } from "../lib/api";
import { formatINR, formatNum } from "../lib/format";

export default function Customer360() {
  const { customerId = "" } = useParams();
  const p = useQuery({ queryKey: ["customer", customerId], queryFn: () => api.customerProfile(customerId) });
  const h = useQuery({ queryKey: ["history", customerId], queryFn: () => api.customerHistory(customerId, 30) });
  if (p.isLoading) return <Loading />;
  if (p.error) return <ErrorBox error={p.error} />;
  const { profile, limits, baseline } = p.data!;
  const points = (h.data?.transactions ?? []).map((t) => ({ x: new Date(t.timestamp).getTime(), y: t.amount_rupees, id: t.transaction_id }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Segment" value={String(profile.segment)} />
        <Stat label="Account age" value={`${profile.account_age_days} d`} />
        <Stat label="Median amount" value={formatINR(baseline.median_rupees)} hint={`${formatNum(baseline.transactions)} txns`} />
        <Stat label="95th percentile" value={formatINR(baseline.p95_rupees)} />
        <Stat label="Limits" value={formatINR(limits.txn_limit_rupees)} hint={`daily ${formatINR(limits.daily_limit_rupees)}`} />
      </div>
      <Card title="Last 30 days (amount per transaction)">
        <div className="h-72" role="img" aria-label={`Scatter of ${points.length} transactions; median ${formatINR(baseline.median_rupees)}`}>
          <ResponsiveContainer>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="x" type="number" domain={["auto", "auto"]} tickFormatter={(v) => new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} />
              <YAxis dataKey="y" scale="log" domain={["auto", "auto"]} tickFormatter={(v) => `₹${formatNum(v)}`} width={80} />
              <Tooltip formatter={(v) => formatINR(Number(v))} labelFormatter={() => ""} />
              {baseline.median_rupees && <ReferenceLine y={baseline.median_rupees} stroke="#0f766e" strokeDasharray="4 4" label="median" />}
              <Scatter data={points} fill="#0369a1" isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Devices used"><ul className="text-sm">{Object.entries(baseline.devices).map(([d, n]) => <li key={d} className="flex justify-between font-mono"><span>{d}</span><span>{n}</span></li>)}</ul></Card>
        <Card title="Channels"><ul className="text-sm">{Object.entries(baseline.channels).map(([d, n]) => <li key={d} className="flex justify-between"><span>{d.toUpperCase()}</span><span>{n}</span></li>)}</ul></Card>
      </div>
    </div>
  );
}
