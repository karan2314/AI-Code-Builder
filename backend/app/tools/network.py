"""Fraud Network tools: related entities, known-fraud lookup, graph analysis around a transaction."""

from __future__ import annotations

from app.services import get_services
from app.tools.common import ok, txn_or_raise


def get_related_accounts(entity_id: str, transaction_id: str) -> dict:
    """List entities directly connected to an entity (customers, devices, recipients; merchants excluded),
    using only relationships that existed BEFORE the transaction."""
    t = txn_or_raise(transaction_id)
    g = get_services().graph
    nbrs = g.neighbours(entity_id, at=t["timestamp"])
    by_type: dict[str, list[str]] = {}
    for n in nbrs:
        by_type.setdefault(g.g.nodes[n].get("type", "unknown"), []).append(n)
    result = {"entity_id": entity_id, "related_count": len(nbrs),
              "related_by_type": {k: sorted(v)[:15] for k, v in by_type.items()}}
    return ok(result, [{"kind": "relationships", "indicator_family": "network",
                        "summary": f"{entity_id} has {len(nbrs)} related entities: "
                                   + ", ".join(f"{len(v)} {k}" for k, v in by_type.items()),
                        "observed": {"related_count": len(nbrs), **{f"{k}_count": len(v) for k, v in by_type.items()}}}])


def search_known_fraud_cases(entity_ids: list[str], transaction_id: str) -> dict:
    """Check entities against confirmed fraud cases known BEFORE the transaction. Links older than 180 days
    are reported as 'stale' and need validation."""
    t = txn_or_raise(transaction_id)
    g = get_services().graph
    repo = get_services().repo
    direct_ids = {t["counterparty_id"], t["device_id"], t["customer_id"]}
    matches = []
    for e in entity_ids:
        status = g.fraud_status(e, t["timestamp"])
        if status:
            day = int(repo.confirmed_fraud[e])
            matches.append({"entity_id": e, "status": status, "days_since_confirmed": repo.day_of(t["timestamp"]) - day,
                            "direct": e in direct_ids})
    evidence = [{"kind": "known_fraud_link", "indicator_family": "network",
                 "summary": (f"{'Transaction party' if m['direct'] else 'Linked entity'} {m['entity_id']} is a "
                             f"{m['status']} fraud entity (confirmed {m['days_since_confirmed']} days earlier)"),
                 "observed": m, "status": "stale" if m["status"] == "stale" else "ok"}
                for m in matches]
    if not matches:
        evidence = [{"kind": "known_fraud_link", "indicator_family": "network",
                     "summary": f"No known fraud cases for {len(entity_ids)} checked entities",
                     "observed": {"checked": entity_ids, "matches": 0, "direct": True}}]
    return ok({"checked": entity_ids, "matches": matches}, evidence)


def analyze_fraud_network(transaction_id: str) -> dict:
    """Analyse the relationship network around the transaction's counterparty and device: shortest path to
    confirmed fraud, shared-device clusters and confirmed-fraud neighbours (as of the transaction time)."""
    t = txn_or_raise(transaction_id)
    g = get_services().graph
    at = t["timestamp"]
    cp, dev = t["counterparty_id"], t["device_id"]
    own = (t["customer_id"],)
    # counterparty: links via shared devices only; device: via other customers or devices (never the investigated customer)
    path_cp = g.nearest_fraud_path(cp, at, via_types=("device",), exclude=own)
    path_dev = g.nearest_fraud_path(dev, at, via_types=("customer", "device"), exclude=own)
    fraud_nbrs = sorted({n for p in (path_cp, path_dev) if p for n in p if g.fraud_status(n, at) == "confirmed"}
                        | {n for d in g.neighbours(cp, at) if g.g.nodes[d].get("type") == "device"
                           for n in g.neighbours(d, at) if n != cp and g.fraud_status(n, at) == "confirmed"})
    shared_devices = [n for n in g.neighbours(cp, at) if g.g.nodes[n].get("type") == "device"]
    result = {
        "counterparty_id": cp, "device_id": dev,
        "counterparty_path_to_fraud": path_cp, "counterparty_hops_to_fraud": (len(path_cp) - 1) if path_cp else None,
        "device_path_to_fraud": path_dev, "device_hops_to_fraud": (len(path_dev) - 1) if path_dev else None,
        "linked_confirmed_fraud": fraud_nbrs[:10], "linked_confirmed_fraud_count": len(fraud_nbrs),
        "counterparty_shared_devices": shared_devices,
    }
    hops = [h for h in (result["counterparty_hops_to_fraud"], result["device_hops_to_fraud"]) if h is not None]
    def _hops(h):
        return f"{h} hop(s) from confirmed fraud" if h is not None else "not linked to confirmed fraud"

    summary = (f"Counterparty {cp} is {_hops(result['counterparty_hops_to_fraud'])} (via shared devices); "
               f"device {dev} is {_hops(result['device_hops_to_fraud'])}; {len(fraud_nbrs)} linked confirmed-fraud entities")
    return ok(result, [{"kind": "network_metrics", "indicator_family": "network", "summary": summary,
                        "observed": {"min_hops_to_fraud": min(hops) if hops else None,
                                     "counterparty_hops_to_fraud": result["counterparty_hops_to_fraud"],
                                     "device_hops_to_fraud": result["device_hops_to_fraud"],
                                     "linked_confirmed_fraud": len(fraud_nbrs),
                                     "counterparty_shared_devices": len(shared_devices),
                                     "path": path_cp or path_dev}}])
