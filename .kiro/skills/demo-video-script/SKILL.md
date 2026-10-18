---
name: demo-video-script
description: Produce a timed 3-minute demo video script and shot list that shows the deployed Gen AI prototype working end to end, plus recording, captioning, and upload instructions for YouTube, Vimeo, or Google Drive. Use when planning, scripting, or recording the submission video.
---

# Demo Video Script

## 1. Inputs

The hero flow (from the core spec), the live URL, persona story, architecture diagram, and 1–2
impact numbers.

## 2. Write `docs/submission/video-script.md`

Use a two-column table per segment: **Narration (spoken)** | **On screen (shot)**. Follow the
timing in `submission.md` (hook → solution → live demo → under the hood → impact → CTA).

Rules:
- ~140 spoken words per minute → max ~400 words total.
- Demo on the **deployed URL** with the address bar visible.
- Show the Gen AI doing something visibly smart: multimodal input, a tool call/agent trace,
  grounded citations, a personalized output, voice.
- Show accessibility in action (keyboard use, screen reader, voice, simplified language).
- Pre-load sample data; cut or speed up model waits; never show errors or secrets
  (hide `.env`, terminal history, browser bookmarks).
- End card: product name, category, live URL, repo URL.

## 3. Recording

- macOS: QuickTime or `Cmd+Shift+5` screen recording at 1080p; external mic if possible.
- Edit in iMovie/CapCut/Clipchamp: trim, add captions (YouTube auto-captions then correct).
- Final length ≤ 3:00 (aim for 2:45).

## 4. Upload & verify

- YouTube: visibility Public or Unlisted (not Private). Vimeo: Public. Drive: "Anyone with the
  link – Viewer".
- Open the link in a logged-out/incognito browser to confirm it plays.
- Put the link in README.md, the deck's last slide, and the submission form.
