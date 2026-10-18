---
name: accessibility-audit
description: Audit the web app for accessibility and UX quality using the Chrome DevTools MCP (Lighthouse, accessibility tree, performance) or Playwright MCP, checking WCAG 2.2 AA basics, keyboard navigation, contrast, AI loading/error states, and mobile layout, then fix issues. Use before demos, after UI changes, or when asked about accessibility/UX.
---

# Accessibility & UX Audit

Note: automated checks catch only part of WCAG; full validation needs manual testing with
assistive technologies (VoiceOver: `Cmd+F5` on macOS) and expert review.

## 1. Automated pass

Using the `chrome-devtools` MCP (or `playwright` MCP):
1. Open the local dev URL or the deployed Hosting URL.
2. Run a Lighthouse audit (accessibility, performance, best practices, SEO); record scores.
3. Take an accessibility-tree snapshot of each hero-flow screen; check every control has a role
   and accessible name.
4. Emulate a 360×780 mobile viewport and slow 4G; screenshot each step.

## 2. Manual checklist

- [ ] Complete the hero flow with keyboard only (Tab/Shift+Tab/Enter/Space/Esc); focus visible
- [ ] VoiceOver reads headings, labels, buttons, errors, and streamed AI output (aria-live)
- [ ] Contrast ≥ 4.5:1 text, ≥ 3:1 UI; info not by color alone
- [ ] 200% zoom without horizontal scrolling; `prefers-reduced-motion` respected
- [ ] Loading, empty, error, and blocked-by-safety states are clear and recoverable
- [ ] Plain language; AI disclaimers/citations visible where relevant
- [ ] Guest/demo path works in ≤ 2 clicks

## 3. Report & fix

Write findings as a table (issue, WCAG criterion, severity, fix). Fix high-severity items
immediately, re-run Lighthouse, and record before/after scores (useful for the deck's UX slide).
