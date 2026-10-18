# FraudLens AI · Demo video script (target 2:45, hard limit 3:00)

Record on the **deployed Cloud Run URL** (address bar visible), 1440×900, browser zoom 110%. Before recording:
run the hero scenario once so the AI result is warm, close other tabs and hide bookmarks. Captions on.

| Time | Narration (spoken, ~380 words total) | On screen |
|---|---|---|
| 0:00–0:15 | "A ₹1,85,000 transfer. On amount alone, a bank's rules might let it through, or flag thousands of innocent customers. FraudLens AI turns that one suspicious payment into an evidence-backed case in seconds." | Title card → dashboard |
| 0:15–0:30 | "Built on Google Cloud: Gemini and the Agent Development Kit, deployed on Cloud Run. Our principle: ML handles scale, tools provide verified evidence, agents orchestrate, Gemini explains, and policy controls the action." | Dashboard KPIs: transactions screened, candidate rate |
| 0:30–0:50 | "Every transaction is screened first, with no LLM, using features that compare the payment with the customer's own history, device and network. Fewer than one percent become candidates, so Gemini is used only where it matters." | Suspicious queue, hover reason codes |
| 0:50–1:15 | "Here's our customer. Normally two to four payments a day, median around six thousand rupees. Then four rapid payments from a brand-new device, and a ₹1,85,000 IMPS transfer." | Click hero row → case header; Customer 360 chart briefly |
| 1:15–1:45 | "I start the investigation. The orchestrator agent plans it and calls three specialists: customer behaviour, transaction analysis and fraud network. Every tool result becomes evidence with an ID." | Run AI investigation → live progress → timeline |
| 1:45–2:05 | "Gemini writes the summary, and every claim links to evidence. Click one and it jumps to the proof. Missing or conflicting evidence is called out, and any claim without evidence is removed automatically." | Summary → click an evidence chip → highlighted evidence |
| 2:05–2:20 | "The network graph shows why: the recipient shares a device with confirmed mule accounts." | Network tab, red-outlined nodes |
| 2:20–2:35 | "Gemini only advises. A deterministic, versioned policy decides: Tier 3, Contain. The restriction is simulated, the analyst approves, and everything lands in an append-only audit trail." | Policy panel, SIMULATED actions, Approve, audit trail |
| 2:35–2:45 | "And it's not just a canned demo: upload your own transactions, and FraudLens screens them in under a second and lets you investigate any row." | Run new investigation → Upload & test → template → results table → Investigate |
| 2:45–2:50 | "On held-out data, the ML blend raises recall well above rules alone, and we publish every metric from our evaluation scripts. The architecture scales on Cloud Run, with LLM cost tied to candidates, not volume." | Evaluation page table |
| 2:50–3:00 | "FraudLens AI: explainable, auditable fraud investigation, built with Gemini on Google Cloud." | End card: URL, repo, "synthetic data, simulated actions" |

Do not state numbers that aren't on screen; read them from the Evaluation page.

Upload: YouTube (Public or Unlisted) or Drive ("Anyone with the link"), then test the link in a logged-out window.
