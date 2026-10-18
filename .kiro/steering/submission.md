---
inclusion: manual
---

# Submission Playbook: FraudLens AI (deadline 18 Oct 2026)

## Readiness checklist

- [ ] Problem statement / category confirmed in the Hack2skill dashboard and stated in deck slide 1, README, and video intro
- [ ] Live Cloud Run URL works in incognito (desktop + mobile width); hero scenario runs in one click
- [ ] `--min-instances 1` during judging; Gemini quota OK; budget alert set
- [ ] Gemini + ADK visibly used (Investigation Timeline shows agent/tool calls)
- [ ] All metrics come from `docs/metrics/*.json` (rules vs ML vs agentic); no invented numbers
- [ ] "Synthetic data / simulated actions" disclaimer is visible in the UI, deck, and video
- [ ] Deck exported to **PDF** (≤ 12 slides)
- [ ] Video **≤ 3:00**, public (YouTube public/unlisted, Vimeo, or Drive "anyone with link"), tested logged-out
- [ ] Public GitHub repo: README with live URL, video, architecture, metrics, setup; no secrets in history
- [ ] Everything in English

## Deck (12 slides)

1. FraudLens AI: "suspicious transaction → evidence-backed case in seconds" · category · team
2. Problem: volume vs investigation quality; false positives; black-box scores; unsafe automation
3. Persona: a fraud analyst's day today (alert overload, context switching)
4. Solution: layered pipeline (screen → investigate → decide) + design principle
5. Demo walkthrough: hero ₹185,000 ATO case screenshots (queue → case → graph → tier)
6. Agentic architecture: Orchestrator + 3 specialist agents + tools + Gemini synthesis (diagram)
7. Grounding & safety: evidence IDs, validity rate, missing/conflicting evidence, policy engine, human-in-the-loop
8. Google Cloud architecture: Cloud Run, Gemini on Agent Platform, ADK, Firestore, GCS, BigQuery, Logging
9. Results (measured): rules vs ML vs agentic. Precision, recall, PR-AUC, FP/10k, candidate rate, Gemini escalation rate, P95 latency, cost per 1k txns
10. Innovation vs existing tools (comparison table: rules engines, ML-only scoring, LLM chatbots)
11. Scalability & roadmap: BigQuery and streaming (Pub/Sub), Spanner Graph, IAP/RBAC, real-bank pilot path
12. Links + QR: live URL, video, repo

## Video (≤ 3:00)

| Time | Content |
|---|---|
| 0:00–0:15 | Hook: "A ₹185,000 transfer looks fine on amount alone…" + category |
| 0:15–0:30 | What FraudLens is + design principle |
| 0:30–0:50 | Dashboard: thousands screened, small candidate rate (live URL visible) |
| 0:50–1:55 | Hero case: run investigation → timeline of agent/tool calls → evidence → network graph → Gemini summary with evidence chips → Tier 3 Contain (SIMULATED) → analyst approves → audit trail |
| 1:55–2:25 | Architecture on Google Cloud + guardrails |
| 2:25–2:50 | Measured results + scalability |
| 2:50–3:00 | Close + links |
