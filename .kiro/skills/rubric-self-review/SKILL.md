---
name: rubric-self-review
description: Act as a strict hackathon judge and score the current project against the official rubric (Technical Merit & Gen AI 40%, Problem Alignment & Impact 25%, Innovation & Creativity 25%, UX & Solution Design 10%) plus mandatory submission requirements, then produce a prioritized fix list. Use before milestones, before recording the demo, and before submitting.
---

# Rubric Self-Review

## Gather evidence (read, don't assume)

- README.md, docs/ (DECISIONS, ARCHITECTURE, PROMPTS, submission/*), `.kiro/specs/*`
- `backend/app/ai/`, `backend/app/agents/`, evals results
- Deployed URL: is it live? (`curl -fsS <url>/healthz`); Cloud Run config
  (`gcloud run services describe`), recent errors in logs
- Frontend: run the hero flow via Chrome DevTools/Playwright MCP; Lighthouse accessibility score

State explicitly what could not be verified.

## Score (1–5 per sub-criterion, with one-line evidence each)

| Criterion | Sub-criterion | Score | Evidence | Gap |
|---|---|---|---|---|
| Tech 40% | Meaningful use of Gen AI | | | |
| | Technical implementation (works, sound) | | | |
| | Scalability & sustainability | | | |
| Impact 25% | Problem alignment with category | | | |
| | Potential impact for users | | | |
| Innovation 25% | Originality & differentiation | | | |
| | Innovation in Gen AI use | | | |
| UX 10% | Usability & accessibility | | | |
| | Experience & integration (cohesive) | | | |

Weighted score = Σ(criterion avg × weight) / 5 × 100.

## Mandatory gates (any "no" = submission at risk)

- Uses Gemini/Gemma or a Google agentic platform? Deployed on Cloud Run/Firebase? Live?
- Deck PDF exists? Video ≤ 3 min and publicly accessible? Category declared? All English?
- No AWS/other-cloud services or non-Google models in the product?

## Output

1. Score table + weighted total.
2. Top 5 fixes ranked by (score gain × weight) / effort, each with a concrete task.
3. "Judge's first impression" paragraph: what a judge would think in the first 30 seconds of the
   video and the live URL.
