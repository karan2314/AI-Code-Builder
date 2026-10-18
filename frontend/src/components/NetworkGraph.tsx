import { useQuery } from "@tanstack/react-query";
import cytoscape from "cytoscape";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { ErrorBox, Loading } from "./ui";

const SHAPES: Record<string, string> = { customer: "ellipse", device: "round-rectangle", recipient: "diamond", merchant: "hexagon" };
const COLORS: Record<string, string> = { customer: "#0369a1", device: "#6d28d9", recipient: "#b45309", merchant: "#475569" };

export default function NetworkGraph({ entityId, transactionId, batchId }: { entityId: string; transactionId?: string; batchId?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [asList, setAsList] = useState(false);
  const q = useQuery({ queryKey: ["network", entityId, transactionId, batchId], queryFn: () => api.network(entityId, transactionId, batchId ?? undefined) });

  useEffect(() => {
    if (!q.data || !ref.current || asList) return;
    const cy = cytoscape({
      container: ref.current,
      elements: [...q.data.nodes, ...q.data.edges],
      layout: { name: "cose", animate: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 70 } as cytoscape.LayoutOptions,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)", "font-size": 8, "text-valign": "bottom", "text-margin-y": 3, color: "#0f172a",
            width: 18, height: 18,
            shape: ((n: cytoscape.NodeSingular) => SHAPES[n.data("type")] ?? "ellipse") as unknown as cytoscape.Css.NodeShape,
            "background-color": ((n: cytoscape.NodeSingular) => COLORS[n.data("type")] ?? "#64748b") as unknown as string,
          },
        },
        { selector: "node[fraud_status = 'confirmed']", style: { "border-width": 4, "border-color": "#dc2626", width: 24, height: 24 } },
        { selector: "node[fraud_status = 'stale']", style: { "border-width": 3, "border-style": "dashed", "border-color": "#f59e0b" } },
        { selector: "node[?seed]", style: { width: 30, height: 30, "border-width": 4, "border-color": "#0f766e", "font-weight": "bold" } },
        { selector: "edge", style: { width: 1.2, "line-color": "#cbd5e1" } },
        { selector: "edge[relation = 'account_uses_device'], edge[relation = 'used_device']", style: { "line-color": "#a78bfa", "line-style": "dashed" } },
      ],
    });
    return () => cy.destroy();
  }, [q.data, asList]);

  if (q.isLoading) return <Loading label="Loading relationship graph…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-slate-600">
          2-hop network around <span className="font-mono">{entityId}</span> as of the transaction time · {d.signals.node_count} nodes ·{" "}
          <span className="font-semibold text-red-700">{d.signals.known_fraud_nodes.length} known fraud</span>
        </p>
        <button type="button" onClick={() => setAsList((v) => !v)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
          {asList ? "Show graph" : "View as list"}
        </button>
      </div>
      {asList ? (
        <ul className="max-h-80 overflow-auto text-sm">
          {d.nodes.map((n) => (
            <li key={n.data.id} className="flex justify-between border-b border-slate-100 py-1">
              <span className="font-mono">{n.data.id}</span>
              <span>{n.data.type}{n.data.fraud_status ? ` · ${n.data.fraud_status} fraud` : ""}{n.data.seed ? " · focus" : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div ref={ref} className="h-80 w-full rounded border border-slate-200 bg-slate-50" role="img"
             aria-label={`Relationship graph with ${d.signals.node_count} nodes; known fraud nodes: ${d.signals.known_fraud_nodes.join(", ") || "none"}. Use "View as list" for an accessible list.`} />
      )}
      <ul className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-600" aria-label="Legend">
        {Object.entries(COLORS).map(([t, c]) => (
          <li key={t} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: c }} />{t}</li>
        ))}
        <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-red-600" />confirmed fraud</li>
        <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-amber-500" />stale link</li>
      </ul>
    </div>
  );
}
