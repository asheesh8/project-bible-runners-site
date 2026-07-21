# Site Assistant Chatbot — How It Works

A small, friendly chat helper on the public site that **knows everything** on the
VillageServer pages, the printable PDFs, and Eric's companion site — answers
visitors' questions, and gently acts as an intake person: when someone is a
missionary or field partner who wants equipment, it collects their details and
points them to the application (so no interested person slips away).

It runs on **Claude Haiku** with **your own Anthropic API key**, and every bit of
data stays in our Supabase — same as the rest of the system.

---

## The key insight: no vector database needed

Most "chatbot over my docs" tutorials reach for a retrieval pipeline (embeddings,
a vector DB, chunk search). **We don't need any of that**, because the whole
knowledge base is tiny:

- All 27 site pages, tags stripped, come to about **28,000 tokens** of text.
- The PDFs are auto-generated from those same pages (identical filenames), so they
  add nothing new — they're duplicates.
- Haiku's context window holds **200,000 tokens**. The entire knowledge base fits
  ~7× over with room to spare.

So instead of *searching* the docs per question, we just **hand Claude the entire
knowledge base every time** and let it answer. Simpler, no retrieval to get wrong,
no infrastructure — and with prompt caching it's nearly free.

```
                 build step (occasional)
 landing/*.html ─┐
 companion notes ├─► one knowledge-base string ─► api/_lib/knowledge-base.js
 (PDFs = dupes)  ┘                                        │
                                                          ▼
 visitor question ─► api/assistant.js ─► Claude Haiku (KB cached in system prompt)
                                                          │
                                   answer  ◄──────────────┘
                                   or, if they want equipment:
                                   capture_lead ─► Supabase assistant_leads
```

---

## The knowledge base

A build script (`scripts/build-knowledge-base.mjs`) gathers the text and writes it
into a module the API imports:

- **Site pages** — strips HTML from every `landing/*.html` (minus the admin panel),
  keeping the readable text under each page's name.
- **Companion site** — Eric's Google Site (`sites.google.com/view/villageserver-initiative`)
  is external, so its content is pasted into `landing/assistant/sources/companion.md`
  (or any `.md` in that folder). The script folds those in. That keeps a human in
  control of what the bot knows about the companion material, and updating it is
  just editing a text file.
- **PDFs** — skipped by default because they mirror the pages. If a PDF ever holds
  unique content, drop its extracted text into a source `.md` the same way.

Refresh = re-run the script, redeploy. The site's informational pages change
rarely, so this is infrequent. (A later enhancement could store the knowledge base
in Supabase and add a "Refresh assistant knowledge" button to the admin panel, so
non-technical edits don't need a deploy.)

---

## The model & the cost

- **Model:** `claude-haiku-4-5` — Anthropic's fast, cheap model. 200K context, and
  **$1 per million input tokens / $5 per million output**.
- **Prompt caching does the heavy lifting.** The knowledge base is the big, stable
  part of every request, so we mark it cached. A cache *read* costs ~0.1× — about
  **$0.0028 per question** for a 28K-token knowledge base — plus a few hundred
  tokens for the question and answer. Call it well under a cent per exchange.
- **Napkin math:** even 1,000 questions a month is a couple of dollars. This is a
  "leave it running and don't think about it" cost.
- Set `ANTHROPIC_API_KEY` in Vercel env vars. The API is called directly from our
  serverless function; Anthropic doesn't train on API traffic, and nothing about a
  conversation is stored on their side — we keep the transcript in Supabase if we
  want it.

---

## Two jobs: helper + intake person

**1. Answer questions (grounded).** The system prompt tells Haiku to answer *only*
from the knowledge base — what the kits are, how the reach ladder works, how
sharing/transfer works, power/satellite options, who the initiative is, etc. If a
question isn't covered, it says so plainly and points to the contact form or the
application, instead of inventing an answer. This grounding is the whole game: a
site helper that makes things up is worse than none.

**2. Light intake (the "receptionist" bit).** When the conversation shows the
visitor is a missionary/field partner who wants equipment, the assistant:

- gathers the basics conversationally (name, email, country, who they're trying to
  reach),
- calls a `capture_lead` tool → writes an **`assistant_leads`** row in Supabase (and
  optionally emails the team via Resend),
- then guides them to the full **Equipment & Funding Application** for the complete
  intake.

It captures the lead *and* routes them to the real form, so an interested person is
never lost even if they don't finish the application. It does **not** try to be the
whole application — the form is still where the structured intake happens.

---

## The widget

A small floating "Ask a question" bubble (`landing/js/assistant-widget.js`) added
to the site pages. Click it → a chat panel opens → messages POST to
`api/assistant.js`, which returns the reply. It reuses the site's fonts/colors so
it feels native, and it's self-contained (no external chat SDK).

---

## Guardrails (built in from day one)

- **Grounded only.** Answer from the knowledge base; if it's not there, say so and
  hand off to contact/application. No made-up prices, dates, or promises.
- **Never promises equipment or funding.** Same rule as the email receptionist —
  approvals are Eric's; the bot informs and routes.
- **No sensitive data in chat.** It won't ask for documents, IDs, or anything
  sensitive — those belong in the gated application, not a chat widget.
- **Spam & abuse control.** Honeypot on the widget, a per-visitor rate limit on the
  endpoint, and short message caps — the same posture as the public forms.
- **Everything logged in Supabase.** Leads (and, if we choose, transcripts) are rows
  you own and can export. The Anthropic API stores nothing.

---

## Build order

1. **Knowledge-base script** → generates the KB module from the pages + companion
   notes, and prints the token count so we can confirm it fits.
2. **`api/assistant.js`** → Haiku call with the cached KB, the `capture_lead` tool,
   the `assistant_leads` table, rate limiting.
3. **Widget** → the floating chat bubble, wired onto the site and verified in the
   browser.
4. **Turn it on** → set `ANTHROPIC_API_KEY` in Vercel; the bot goes live.

## Env vars this adds

- `ANTHROPIC_API_KEY` — required; the assistant's brain (Haiku).
- `RESEND_API_KEY` — already present; used to notify the team on a captured lead.
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — already present; stores leads.
