# Opportunity Tab Enhancement — Design Spec
**Date:** 2026-07-31  
**Feature:** Content Playbook + Opportunity Pipeline  
**Scope:** `app.js`, `style.css`, `sample-data/latest.json` only — no new files, no external APIs

---

## 1. Overview

The Opportunity tab currently shows market trends, venue prospects, and differentiation insights. This enhancement adds two actionable layers:

1. **Content Playbook** — each trend card gets an expandable section with ready-to-use Instagram/LinkedIn captions, hashtag sets, a DM outreach script, and posting schedule guidance. All items have a one-tap copy-to-clipboard button.
2. **Opportunity Pipeline** — each venue card gets a tappable status badge that cycles through 5 stages, persisted to localStorage. Deep-link buttons open LinkedIn and Instagram searches for each venue so the user can find the right contact directly on the platform.

No external API calls. No OAuth. No user credentials stored. All content is copy-paste ready.

---

## 2. Content Playbook

### 2.1 Data Shape
Each object in `opportunity.trends[]` gains a `playbook` field in `latest.json`:

```json
{
  "platform": "Instagram India",
  "headline": "...",
  "hashtags": ["#soundbath", "..."],
  "opportunity": "...",
  "playbook": {
    "instagram_caption": "Your 60-min Sound Bath journey starts with one breath 🌿 ...",
    "linkedin_caption": "Sound healing is no longer fringe — it is the fastest-growing ...",
    "hashtag_wide": ["#soundbath", "#soundhealing", "#wellness", "#yoga", "#meditation", "#crystalbowls", "#432hz", "#nadayoga", "#holistic", "#india"],
    "hashtag_niche": ["#nadayogaindia", "#soundbathmumbai", "#therapeuticyoga", "#yogaforwellness", "#soundhealingpune"],
    "dm_script": "Hi [Name], I came across [Venue/Page] and love what you're doing in the wellness space. I'm a Nada Yoga and therapeutic yoga specialist based in Mumbai — I'd love to explore if there's a fit for a sound bath session or wellness series with your community. Would you be open to a quick call?",
    "post_timing": "Instagram Reels: Tuesday & Thursday 7–9pm IST · LinkedIn: Tuesday & Wednesday 8–10am IST"
  }
}
```

Playbook content is authored in `latest.json` — one playbook per trend. The app renders it; it does not generate it dynamically.

### 2.2 UI — Trend Card Changes

**Before:** Trend card shows platform, headline, hashtag chips, opportunity text.

**After:** Same, plus a **"📋 Playbook"** toggle button at the bottom right of the card. Tapping expands an inline section below the card (no modal) showing:

```
┌─────────────────────────────────────────────┐
│ 📸 Instagram Caption          [📋 Copy]      │
│ "Your 60-min Sound Bath..."                  │
├─────────────────────────────────────────────┤
│ 💼 LinkedIn Caption           [📋 Copy]      │
│ "Sound healing is no longer fringe..."       │
├─────────────────────────────────────────────┤
│ #️⃣ Hashtags — Wide (10)      [📋 Copy]      │
│ #soundbath #soundhealing ...                 │
│ Hashtags — Niche (5)          [📋 Copy]      │
│ #nadayogaindia #soundbathmumbai ...          │
├─────────────────────────────────────────────┤
│ 📩 DM / Outreach Script       [📋 Copy]      │
│ "Hi [Name], I came across..."               │
├─────────────────────────────────────────────┤
│ 📅 Best Time to Post                         │
│ Instagram: Tue & Thu 7–9pm IST               │
│ LinkedIn: Tue & Wed 8–10am IST               │
└─────────────────────────────────────────────┘
```

- Tap **"📋 Playbook"** again to collapse
- Each row's **[📋 Copy]** button calls `navigator.clipboard.writeText()` and briefly changes to **✅ Copied!**
- Expanded state is local (in-memory, not persisted) — collapses on re-render

### 2.3 State
Add `expandedPlaybooks: Set` to app state — tracks which trend indices are currently expanded. Cleared on tab switch.

---

## 3. Opportunity Pipeline

### 3.1 Pipeline Stages
```
Spotted → Reached Out → Talking → Won → Not Now
```

| Stage | Badge colour |
|-------|-------------|
| Spotted | Grey (`--muted`) |
| Reached Out | Blue (`#4A90D9`) |
| Talking | Amber (`#F5A623`) |
| Won | Green (`--leaf`) |
| Not Now | Muted red (`#C0392B`, low opacity) |

### 3.2 Data Shape
Venue pipeline status stored in `sn_venues` localStorage alongside existing custom venues. For seed venues (from JSON), status is stored keyed by venue name since they have no ID:

```json
// sn_venue_pipeline (new LS key)
{
  "ITC Maratha": "reached_out",
  "The Leela Palace": "spotted",
  "TCS Innovation Campus": "talking"
}
```

New LS key: `sn_venue_pipeline`. Default for any venue not in the map: `"spotted"`.

### 3.3 UI — Venue Card Changes

**Before:** Venue card shows icon, name, city, note, static badge (High Value / Corporate / Govt).

**After:** Same layout, but:
- The existing static badge becomes a **tappable pipeline status badge** — tapping cycles to next stage (wraps: Not Now → Spotted)
- Two new icon buttons appear on the right side of the card:
  - **🔗 LinkedIn** — opens `https://www.linkedin.com/search/results/all/?keywords=<venue+name>+wellness` in a new tab
  - **📸 Instagram** — opens `https://www.instagram.com/explore/search?q=<venue+name>` in a new tab
- The existing value badge (High Value / Corporate / Govt) moves to sit next to the venue name as a small secondary label, so the pipeline badge takes its place

### 3.4 Deep-Link Button Behaviour
- Venue name is URL-encoded for the search query
- Opens in `target="_blank"` with `rel="noopener noreferrer"`
- No authentication, no API — just a search URL

---

## 4. Data — Playbook Content to Author

Three playbooks to write (one per existing trend in `latest.json`):

| Trend | Platform focus |
|-------|---------------|
| Sound Bath — Instagram India | Instagram Reels + Stories |
| Yoga for anxiety — Google Trends | LinkedIn articles + Instagram carousel |
| Dosha-based yoga — YouTube Global | YouTube community post + LinkedIn thought leadership |

Content is curated, yoga-authentic, and written in the teacher's voice — not generic marketing copy.

---

## 5. Implementation Scope

| File | Changes |
|------|---------|
| `sample-data/latest.json` | Add `playbook` object to each trend |
| `app.js` | Update `renderOpportunity`: trend card expand/collapse, copy buttons, venue pipeline badge tap, deep-link buttons |
| `style.css` | Playbook expand panel styles, pipeline badge colour variants, copy button flash animation |

**No changes to:** `index.html`, any modal, attendance/invoice logic.

---

## 6. Out of Scope
- Direct posting to Instagram/LinkedIn (requires OAuth — not suitable for a PWA)
- AI-generated captions (no backend)
- Personal contact details / "from" context in DM scripts
- Email tracking or outreach history beyond the simple status badge

---

## 7. Success Criteria
- Tapping "📋 Playbook" on any trend card shows all four playbook sections
- Every copy button writes to clipboard and confirms with "✅ Copied!"
- Every venue card has a tappable pipeline badge that cycles through 5 stages and persists on refresh
- LinkedIn and Instagram deep-link buttons open correct search URLs in a new tab
- No regression in existing Opportunity tab functionality (venues, sparkline, differentiation cards)
