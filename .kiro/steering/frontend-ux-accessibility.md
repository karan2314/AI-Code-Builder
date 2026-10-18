---
inclusion: fileMatch
fileMatchPattern: "{frontend/**,**/*.tsx,**/*.jsx,**/*.html,**/*.css}"
---

# Frontend, UX & Accessibility Standards

UX is 10% directly, but a smooth demo lifts every other score. Target users of social-impact
products often have disabilities, older phones, slow networks, or limited literacy.

## Accessibility (aim for WCAG 2.2 AA; full compliance needs manual testing with assistive tech)

- Semantic HTML first (`<button>`, `<nav>`, `<main>`, `<label for>`); ARIA only to fill gaps.
- Every interactive element is keyboard reachable with a visible focus ring; logical tab order;
  "Skip to content" link.
- Text contrast ≥ 4.5:1 (≥ 3:1 for large text and UI components). Don't convey meaning by color
  alone.
- All images have `alt`; decorative images use `alt=""`. Icon-only buttons have `aria-label`.
- Form fields have labels, helpful error text tied with `aria-describedby`, and don't rely on
  placeholders.
- Streaming AI responses render into an `aria-live="polite"` region; loading states announce
  themselves (`role="status"`).
- Respect `prefers-reduced-motion` and `prefers-color-scheme`; support 200% zoom without
  horizontal scroll; touch targets ≥ 24×24 px (44×44 preferred).
- Set `lang="en"` on `<html>`; plain-language copy (aim for grade 6–8 reading level).
- Offer voice input / read-aloud where it helps the persona (Web Speech API or Gemini Live).

## AI-specific UX

- Show what the AI is doing ("Reading your document…", "Checking 3 sources…") instead of a bare
  spinner. Stream tokens when possible.
- Show citations/sources and an "AI-generated, verify important info" note where relevant.
- Let users correct, regenerate, or give feedback (thumbs up/down stored in Firestore = a
  scalability/learning story for the deck).
- Never dead-end: every error offers a retry or a non-AI fallback.
- Provide sample inputs / one-click demo data so judges can try it in seconds.

## Implementation

- React + Vite + TypeScript + Tailwind. Small, composable components; no heavy UI frameworks
  unless they're accessible by default (Radix/shadcn are fine).
- API base URL from `import.meta.env.VITE_API_BASE_URL`; with Firebase Hosting rewrites prefer
  same-origin `/api/...`.
- Mobile-first responsive layout; test at 360 px width.
- Performance: lazy-load routes, compress images, target Lighthouse ≥ 90 for Performance,
  Accessibility, Best Practices.
- Verify with the Chrome DevTools MCP (Lighthouse + accessibility tree) or Playwright MCP before
  calling a UI task done.

## FraudLens screens (BRD §18)

| Route | Screen | Must show |
|---|---|---|
| `/` | Operations Dashboard | Txns screened, candidate rate, open cases, tier distribution, Gemini escalation rate (from `/api/metrics`) |
| `/queue` | Suspicious Queue | Sortable table: txn, customer, amount ₹, ML score, reason-code chips, status; keyboard row navigation |
| `/cases/:id` | Case Workspace (hero screen) | Header (tier badge, status), AI summary with clickable `[EV-…]` chips that scroll to and highlight evidence, Evidence list, Investigation Timeline (agent/tool calls with latency), Network Graph tab, Tier & Action panel (policy tier vs Gemini recommendation, rule hits, SIMULATED action buttons), Audit Trail |
| `/customers/:id` | Customer 360 | Profile, limits, baseline stats, recent-history chart with the current txn marked |
| `/metrics` | Evaluation | Benchmark table A/B/C/D from `docs/metrics/*.json`, PR curve |
| Demo banner | Everywhere | "Synthetic data, simulated actions" + "Run hero scenario" button |

- Tier colors need text labels and icons too (not color alone): Tier 1 Monitor (blue), Tier 2 Verify (amber), Tier 3 Contain (red).
- Network graph: Cytoscape with a legend, node-type shapes, known-fraud nodes outlined, and an accessible
  table alternative ("View as list") for screen readers.
- The investigation runs ~5–20 s. Stream or poll progress steps ("Customer Behavior Agent: comparing to 90-day baseline…").
- Numbers: format ₹ with `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'})`.
