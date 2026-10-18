"""Process-wide singletons (data, scorer, graph, case repository) plus per-batch overlays.

`get_services()` returns the base services, or the active upload batch's overlay when code runs inside
`use_batch(...)`. Tools, agents and the policy path call `get_services()` at call time, so the same
investigation code works for the base dataset and for uploaded batches without changes.
"""

from __future__ import annotations

import contextvars
import threading
from collections import OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache

from app.cases.repository import CaseRepository, make_case_repository
from app.data.repository import DataRepository
from app.graph.network import FraudGraph
from app.ml.score import Scorer


@dataclass
class Services:
    repo: DataRepository
    scorer: Scorer
    graph: FraudGraph
    cases: CaseRepository
    batch_id: str | None = None


@lru_cache
def get_base_services() -> Services:
    repo = DataRepository()
    return Services(repo=repo, scorer=Scorer(repo), graph=FraudGraph(repo), cases=make_case_repository())


_active: contextvars.ContextVar[Services | None] = contextvars.ContextVar("fraudlens_batch", default=None)
_cache: OrderedDict[str, tuple[Services, object, dict]] = OrderedDict()
_cache_lock = threading.Lock()
MAX_CACHED_BATCHES = 3


def get_services() -> Services:
    return _active.get() or get_base_services()


class BatchNotFound(LookupError):
    pass


def batch_overlay(batch_id: str) -> tuple[Services, object, dict]:
    """(services, scored DataFrame, summary) for a batch, rebuilt from the batch store on cache miss."""
    with _cache_lock:
        if batch_id in _cache:
            _cache.move_to_end(batch_id)
            return _cache[batch_id]
    from app.batches.overlay import build_overlay
    from app.batches.store import get_batch_store, is_expired

    loaded = get_batch_store().load(batch_id)
    if loaded is None or is_expired(loaded[0]):
        raise BatchNotFound(f"upload batch {batch_id} not found or expired")
    _meta, rows, labels = loaded
    base = get_base_services()
    repo, scorer, graph, scored, summary = build_overlay(base.repo, base.scorer, rows, labels)
    entry = (Services(repo=repo, scorer=scorer, graph=graph, cases=base.cases, batch_id=batch_id), scored, summary)
    with _cache_lock:
        _cache[batch_id] = entry
        while len(_cache) > MAX_CACHED_BATCHES:
            _cache.popitem(last=False)
    return entry


def cache_overlay(batch_id: str, entry: tuple[Services, object, dict]) -> None:
    with _cache_lock:
        _cache[batch_id] = entry
        while len(_cache) > MAX_CACHED_BATCHES:
            _cache.popitem(last=False)


@contextmanager
def use_batch(batch_id: str | None):
    if not batch_id:
        yield get_base_services()
        return
    svc = batch_overlay(batch_id)[0]
    token = _active.set(svc)
    try:
        yield svc
    finally:
        _active.reset(token)
