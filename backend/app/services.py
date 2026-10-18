"""Process-wide singletons (data, scorer, graph, case repository). Loaded once at startup."""

from __future__ import annotations

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


@lru_cache
def get_services() -> Services:
    repo = DataRepository()
    return Services(repo=repo, scorer=Scorer(repo), graph=FraudGraph(repo), cases=make_case_repository())
