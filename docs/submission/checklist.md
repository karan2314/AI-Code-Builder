# Submission checklist · deadline 18 Oct 2026

Live URL: https://fraudlens-579191985047.us-central1.run.app

| # | Item | Status |
|---|---|---|
| 1 | Problem statement / category confirmed in Hack2skill | ☐ user |
| 2 | GCP project set up (APIs, least-privilege SAs, Firestore, ₹2,000 budget alert) | ✓ |
| 3 | Hero investigation verified with real Gemini (locally and on Cloud Run) | ✓ |
| 4 | Benchmarks: detection (A/B), agentic (D), Laya (C) → docs/metrics/*.json | ✓ |
| 5 | Cloud Run deploy (`fraudlens`, public demo; `fraudlens-laya`, private) + smoke test on the live URL | ✓ |
| 6 | README and deck updated with the live URL and measured numbers; deck.pdf exported | ✓ (add video and repo links) |
| 7 | Video ≤ 3:00 recorded on the live URL (`video-script.md`), public link tested logged-out | ☐ user |
| 8 | Public GitHub repo, no secrets in history | ☐ user |
| 9 | During judging: optionally `MIN_INSTANCES=1` to avoid cold starts; set back to 0 afterwards | optional |
| ✓ | 58 backend tests, lint, frontend build, Lighthouse accessibility 100 on 5 pages | done |
