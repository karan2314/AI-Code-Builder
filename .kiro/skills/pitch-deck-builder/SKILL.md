---
name: pitch-deck-builder
description: Write the hackathon proposal deck (problem, impact, solution, Gen AI architecture, innovation, feasibility, scalability, roadmap) and export it to PDF using Google Slides or a Markdown-to-PDF tool like Marp. Use when creating or improving the submission deck/PPT/PDF.
---

# Pitch Deck Builder

## 1. Source material

Read README.md, docs/DECISIONS.md, docs/ARCHITECTURE.md, docs/PROMPTS.md, eval results, and the
specs' requirements (persona, metric). Ask the user for team names and any real statistics or
partner quotes. Never invent statistics: mark unknowns as `[CITE: ...]` for the user to fill.

## 2. Write `docs/submission/deck.md` (Marp format)

```markdown
---
marp: true
theme: default
paginate: true
---
# <Product> — <one-line value prop>
**Category:** <Healthcare|Education|Sustainability|Accessibility|Social Good>
Team: …
---
```

Follow the 12-slide structure in `submission.md`. Rules:
- One idea per slide, ≤ 30 words of body text, large fonts, high contrast.
- Slide 6 (How Gen AI makes it possible) and slide 8 (Architecture) must name the models and GCP
  services concretely and show the agent/data flow (Mermaid → image).
- Include a comparison table vs 2–3 existing solutions (innovation).
- Feasibility: what's built and live today vs. roadmap; cost per 1,000 users estimate from
  token counts and Cloud Run pricing; scaling story (autoscaling, stateless, Firestore).
- Impact: persona, metric, target number of beneficiaries, pilot path (NGO/school/clinic).
- Last slide: live URL, video URL, repo URL (as text and QR code).

## 3. Export to PDF

- Marp: `npx @marp-team/marp-cli@4 docs/submission/deck.md --pdf --allow-local-files -o docs/submission/deck.pdf`
- Or paste into Google Slides → File → Download → PDF.

## 4. Verify

Open the PDF, check every slide renders, links are correct, file size < 20 MB, and run the
`rubric-self-review` skill against the deck content.
