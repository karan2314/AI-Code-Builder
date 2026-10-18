"""Entity relationship graph (NetworkX) for fraud-network intelligence.

Nodes: customer, device, counterparty (merchant / recipient). Edges: customer-used-device,
customer-paid-counterparty (aggregated), counterparty-shares-device. Relationships are evidence,
not proof of fraud.
"""

from __future__ import annotations

from datetime import datetime

import networkx as nx
import pandas as pd

from app.data.repository import DataRepository

MAX_NODES = 150


class FraudGraph:
    def __init__(self, repo: DataRepository) -> None:
        self.repo = repo
        g = nx.Graph()
        tx = repo.transactions
        for cust in repo.customers.index:
            g.add_node(cust, type="customer")
        for cp, row in repo.counterparties.iterrows():
            g.add_node(cp, type=row["kind"], created_day=int(row["created_day"]))
        paid = tx.groupby(["customer_id", "counterparty_id"]).agg(
            n=("transaction_id", "size"), first=("timestamp", "min"), total=("amount_paise", "sum")).reset_index()
        for r in paid.itertuples(index=False):
            g.add_edge(r.customer_id, r.counterparty_id, relation="paid", n=int(r.n), first=r.first,
                       total_paise=int(r.total))
        used = tx.groupby(["customer_id", "device_id"]).agg(n=("transaction_id", "size"),
                                                            first=("timestamp", "min")).reset_index()
        for r in used.itertuples(index=False):
            g.add_node(r.device_id, type="device")
            g.add_edge(r.customer_id, r.device_id, relation="used_device", n=int(r.n), first=r.first)
        for r in repo.entity_links.itertuples(index=False):
            g.add_node(r.entity_b, type="device")
            g.add_edge(r.entity_a, r.entity_b, relation="account_uses_device", n=1, first=pd.Timestamp(repo.start))
        self.g = g

    def fraud_confirmed_before(self, entity: str, at: datetime) -> bool:
        day = self.repo.confirmed_fraud.get(entity)
        if day is None:
            return False
        return 0 < self.repo.day_of(at) - int(day)

    def fraud_status(self, entity: str, at: datetime, recency_days: int = 180) -> str | None:
        day = self.repo.confirmed_fraud.get(entity)
        if day is None:
            return None
        age = self.repo.day_of(at) - int(day)
        if age <= 0:
            return None
        return "confirmed" if age <= recency_days else "stale"

    def _edge_ok(self, a: str, b: str, at: datetime | None) -> bool:
        if at is None:
            return True
        first = self.g.edges[a, b].get("first")
        return first is None or pd.Timestamp(first) < pd.Timestamp(at)

    def neighbours(self, entity: str, at: datetime | None = None, skip_merchants: bool = True) -> list[str]:
        if entity not in self.g:
            return []
        out = []
        for n in self.g.neighbors(entity):
            if skip_merchants and self.g.nodes[n].get("type") == "merchant":
                continue
            if self._edge_ok(entity, n, at):
                out.append(n)
        return out

    def ego(self, entity: str, at: datetime | None = None, hops: int = 2) -> tuple[list[str], list[tuple[str, str]]]:
        """BFS ego network (merchants excluded beyond the seed to keep it readable)."""
        if entity not in self.g:
            return [], []
        seen, frontier, edges = {entity}, [entity], []
        for _ in range(hops):
            nxt = []
            for node in frontier:
                for n in self.neighbours(node, at):
                    edges.append((node, n))
                    if n not in seen and len(seen) < MAX_NODES:
                        seen.add(n)
                        nxt.append(n)
            frontier = nxt
        edges = [(a, b) for a, b in edges if a in seen and b in seen]
        return list(seen), list({tuple(sorted(e)) for e in edges})

    def nearest_fraud_path(self, entity: str, at: datetime | None = None, cutoff: int = 3,
                           via_types: tuple[str, ...] = ("device",), exclude: tuple[str, ...] = ()) -> list[str] | None:
        """Shortest path from `entity` to a confirmed-fraud node, where intermediate nodes must be of
        `via_types` (e.g. shared devices). Paths through popular merchants or through the investigated
        customer are excluded because they are not meaningful fraud links."""
        if entity not in self.g:
            return None
        frontier, parent, seen = [entity], {entity: None}, {entity}
        for _ in range(cutoff):
            nxt = []
            for node in frontier:
                for n in self.neighbours(node, at):
                    if n in seen or n in exclude:
                        continue
                    seen.add(n)
                    parent[n] = node
                    is_fraud = (self.fraud_status(n, at) == "confirmed") if at else (self.repo.confirmed_fraud.get(n) is not None)
                    if is_fraud:
                        path = [n]
                        while parent[path[-1]] is not None:
                            path.append(parent[path[-1]])
                        return list(reversed(path))
                    if self.g.nodes[n].get("type") in via_types:
                        nxt.append(n)
            frontier = nxt
        return None

    def cytoscape(self, entity: str, at: datetime | None = None) -> dict:
        nodes, edges = self.ego(entity, at)
        out_nodes = []
        for n in nodes:
            attrs = self.g.nodes[n]
            status = self.fraud_status(n, at) if at else ("confirmed" if self.repo.confirmed_fraud.get(n) is not None else None)
            out_nodes.append({"data": {"id": n, "label": n, "type": attrs.get("type", "unknown"),
                                       "fraud_status": status, "seed": n == entity}})
        out_edges = [{"data": {"id": f"{a}__{b}", "source": a, "target": b,
                               "relation": self.g.edges[a, b].get("relation"), "n": self.g.edges[a, b].get("n", 1)}}
                     for a, b in edges]
        known = [n["data"]["id"] for n in out_nodes if n["data"]["fraud_status"]]
        return {"nodes": out_nodes, "edges": out_edges,
                "signals": {"node_count": len(out_nodes), "edge_count": len(out_edges), "known_fraud_nodes": known}}
