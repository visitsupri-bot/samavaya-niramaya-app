# Opportunity Tab Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Content Playbook (expandable captions, hashtags, DM scripts, post timing with copy buttons) to each trend card, and an Opportunity Pipeline (5-stage tappable status badge + LinkedIn/Instagram deep-link buttons) to each venue card in the Opportunity tab.

**Architecture:** Pure vanilla JS/CSS PWA — all changes are in `app.js`, `style.css`, and `sample-data/latest.json`. Pipeline state persists to `sn_venue_pipeline` in localStorage. No external APIs, no build step.

**Tech Stack:** Vanilla JS, CSS custom properties, localStorage, `navigator.clipboard` API

**Spec:** `docs/superpowers/specs/2026-07-31-opportunity-tab-design.md`

---

## File Map

| File | What changes |
|------|-------------|
| `sample-data/latest.json` | Add `playbook` object to each of the 3 trend objects |
| `app.js` | Add `sn_venue_pipeline` LS key; add `expandedPlaybooks` to state; update `renderOpportunity` for playbook expand/collapse + copy buttons + pipeline badge + deep-links |
| `style.css` | Playbook panel styles, pipeline badge colour variants, copy button flash |

---

## Task 1: Add `sn_venue_pipeline` to LS constants and state

**Files:**
- Modify: `app.js` (LS constants block ~L9, state object ~L38)

- [ ] **Step 1: Add the LS key**

In `app.js`, find the `const LS = { ... }` block and add:
```js
VENUE_PIPELINE:  'sn_venue_pipeline',
```

- [ ] **Step 2: Add `expandedPlaybooks` to state**

In `app.js`, find the `const state = { ... }` block and add:
```js
expandedPlaybooks: new Set(), // indices of currently expanded trend playbooks
```

- [ ] **Step 3: Verify syntax**
```bash
cd /Users/in22911506/DOAPI/samavaya-niramaya-app
node -e "const fs=require('fs'); new Function(fs.readFileSync('app.js','utf8')); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 4: Commit**
```bash
git add app.js
git commit -m "feat(opp): add sn_venue_pipeline LS key and expandedPlaybooks state"
```

---

## Task 2: Author playbook content in `latest.json`

**Files:**
- Modify: `sample-data/latest.json` — `sections.opportunity.trends[]`

- [ ] **Step 1: Add playbook to trend 1 — Instagram India (Sound Bath)**

Find the trend object with `"platform": "Instagram India"` and add a `playbook` field:
```json
"playbook": {
  "instagram_caption": "Close your eyes. Let the crystal bowls find you. 🪷

A 60-minute Sound Bath is not just music — it's a full-body reset at 432Hz. Stress dissolves. The nervous system exhales.

Next session: Saturday 7pm, Mumbai. Spots are limited.

DM to reserve yours 🙏

#soundbath #nadayoga #432hz #crystalbowls #mumbai",
  "linkedin_caption": "Sound healing has crossed from alternative to mainstream — and the data backs it. #SoundBath content is generating 2.4M weekly impressions on Instagram India alone.

As a Nada Yoga specialist, I've been integrating sound frequencies into therapeutic yoga for years. The results — reduced cortisol, improved sleep, measurable reduction in anxiety — are consistent.

If your organisation is exploring employee wellness beyond the gym membership, I'd welcome a conversation about a corporate sound bath series.

What's your team's biggest wellness challenge right now?",
  "hashtag_wide": ["#soundbath", "#soundhealing", "#nadayoga", "#crystalbowls", "#432hz", "#wellness", "#yoga", "#meditation", "#holistichealth", "#india"],
  "hashtag_niche": ["#soundbathmumbai", "#nadayogaindia", "#soundhealingpune", "#crystalbowlindia", "#soundtherapyindia"],
  "dm_script": "Hi [Name] 🙏 I came across [Venue/Page] and love the wellness community you're building. I'm a Nada Yoga and Sound Bath facilitator based in Mumbai — specialising in 432Hz crystal bowl immersions. I'd love to explore if a monthly Sound Bath session would be a good fit for your space. Would you be open to a quick call this week?",
  "post_timing": "Instagram Reels & Stories: Tuesday & Thursday 7–9pm IST · LinkedIn: Tuesday & Wednesday 8–10am IST"
}
```

- [ ] **Step 2: Add playbook to trend 2 — Google Trends (Yoga for Anxiety)**

Find the trend object with `"platform": "Google Trends India"` and add:
```json
"playbook": {
  "instagram_caption": ""Yoga for anxiety" is being searched 180% more than last year.

But not all yoga is therapeutic. Jumping into fast Vinyasa when your nervous system is already overwhelmed can make anxiety worse.

Therapeutic yoga meets you where you are — slow, breath-led, condition-specific.

I work with anxiety, insomnia, burnout, and chronic stress — with sequences designed specifically for each.

Slide 2 → the 4 poses that calm the vagus nerve in under 10 minutes.

Save this 🙏",
  "linkedin_caption": ""Yoga for anxiety" searches in India are up 180% year-on-year. But the supply of genuinely therapeutic yoga — condition-specific, clinically informed, not just stretching — remains very thin.

I've been developing condition-specific yoga protocols for anxiety, insomnia, lower back pain, and hormonal imbalance. Each protocol pairs asana with Ayurvedic dietary guidance and pranayama — a truly integrated approach.

For HR leaders: this is not a generic wellness session. These are targeted interventions that employees actually use. Happy to share outcomes data from current corporate clients.

What does your organisation currently offer for stress and anxiety?",
  "hashtag_wide": ["#therapeuticyoga", "#yogaforanxiety", "#mentalhealth", "#wellness", "#yoga", "#breathwork", "#stressrelief", "#mindfulness", "#holistichealth", "#india"],
  "hashtag_niche": ["#therapeuticyogaindia", "#yogatherapyindia", "#yogaforanxietyrelief", "#conditionspecificyoga", "#ayurvedicyoga"],
  "dm_script": "Hi [Name] 🙏 I'm a therapeutic yoga specialist working with anxiety, stress, and burnout — and I noticed [Venue/Company] is focused on employee wellbeing. I offer condition-specific yoga programmes (not generic classes) with measurable outcomes. I'd love to share more if you're open to a brief conversation — would a 15-minute call work?",
  "post_timing": "Instagram Carousel: Monday & Wednesday 8–10am IST · LinkedIn Article/Post: Tuesday & Thursday 8–9am IST"
}
```

- [ ] **Step 3: Add playbook to trend 3 — YouTube Global (Dosha-based yoga)**

Find the trend object with `"platform": "YouTube Global"` and add:
```json
"playbook": {
  "instagram_caption": "Are you Vata, Pitta, or Kapha? 🌿

Your Ayurvedic dosha determines which yoga is right for your body — not just what's trending.

Vata types need grounding, slow flows, and warmth.
Pitta types need cooling, surrender, and less striving.
Kapha types need energising, heat, and movement.

I've built yoga sequences for each dosha — and the transformation in students who finally practice aligned with their nature is remarkable.

Comment your dosha below 👇 (or DM me if you're not sure!)",
  "linkedin_caption": "Dosha-based yoga is averaging 85K views per video globally on YouTube — yet no major Indian teacher has systematically claimed this space.

I've spent years developing Ayurvedic dosha-sequenced yoga protocols: each sequence is designed for a specific constitutional type, pairing asana, pranayama, and Nada Yoga in a single practice.

I'm exploring YouTube as a platform for this content — if you work in wellness media, health content partnerships, or corporate wellness and see a fit, I'd love to connect.",
  "hashtag_wide": ["#ayurvedicyoga", "#doshatype", "#vatapitta", "#kapha", "#ayurveda", "#yoga", "#holistichealth", "#wellness", "#yogalifestyle", "#india"],
  "hashtag_niche": ["#doshabasedyoga", "#ayurvedicwellness", "#vatayoga", "#pittayoga", "#kaphayoga"],
  "dm_script": "Hi [Name] 🙏 I'm developing a dosha-based yoga series — Ayurvedic constitution-specific sequences combining asana, pranayama, and Nada Yoga. I noticed [Channel/Page] covers holistic wellness and thought there might be an interesting collaboration or content partnership opportunity. Would you be open to a conversation?",
  "post_timing": "Instagram Reels: Monday & Friday 7–9pm IST · YouTube: Saturday 9–11am IST · LinkedIn: Wednesday 8–10am IST"
}
```

- [ ] **Step 4: Validate JSON**
```bash
cd /Users/in22911506/DOAPI/samavaya-niramaya-app
node -e "JSON.parse(require('fs').readFileSync('sample-data/latest.json','utf8')); console.log('JSON valid');"
```
Expected: `JSON valid`

- [ ] **Step 5: Commit**
```bash
git add sample-data/latest.json
git commit -m "feat(opp): add content playbook data to all 3 trend objects"
```

---

## Task 3: Add CSS for playbook panel and pipeline badges

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Add styles at the end of `style.css`**

Append the following block to the very end of `style.css`:
```css
/* ── Opportunity: Content Playbook ──────────────────────── */
.playbook-toggle {
  background: none;
  border: 1px solid var(--leaf);
  color: var(--leaf);
  border-radius: 20px;
  font-size: 0.72rem;
  padding: 3px 10px;
  cursor: pointer;
  margin-top: 8px;
  transition: background 0.15s, color 0.15s;
}
.playbook-toggle:hover, .playbook-toggle.open {
  background: var(--leaf);
  color: #fff;
}
.playbook-panel {
  margin-top: 10px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.playbook-row {
  background: var(--surface);
  border-radius: 8px;
  padding: 8px 10px;
}
.playbook-row-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.playbook-row-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.playbook-row-text {
  font-size: 0.82rem;
  color: var(--bark);
  white-space: pre-wrap;
  line-height: 1.5;
}
.playbook-hashtags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.playbook-timing {
  font-size: 0.82rem;
  color: var(--bark);
}
.btn-copy {
  background: none;
  border: 1px solid var(--muted);
  border-radius: 12px;
  font-size: 0.68rem;
  padding: 2px 8px;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-copy:hover { border-color: var(--leaf); color: var(--leaf); }
.btn-copy.copied { border-color: var(--leaf); color: var(--leaf); background: #e8f5e9; }

/* ── Opportunity: Venue Pipeline ────────────────────────── */
.venue-pipeline-badge {
  border: none;
  border-radius: 12px;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
}
.venue-pipeline-badge:hover { opacity: 0.8; }
.pipeline--spotted      { background: #e0e0e0; color: #555; }
.pipeline--reached_out  { background: #d0e8f8; color: #1a6fa8; }
.pipeline--talking      { background: #fef3cd; color: #a0720a; }
.pipeline--won          { background: #d4edda; color: #1a6e36; }
.pipeline--not_now      { background: #fce8e6; color: #a93226; }

.venue-deep-links {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}
.btn-deep-link {
  font-size: 0.7rem;
  padding: 3px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--bark);
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-deep-link:hover { background: var(--border); }
```

- [ ] **Step 2: Commit**
```bash
git add style.css
git commit -m "feat(opp): add CSS for playbook panel and pipeline badge variants"
```

---

## Task 4: Update `renderOpportunity` — Content Playbook

**Files:**
- Modify: `app.js` — `renderOpportunity` function (~L1334)

- [ ] **Step 1: Read the current `renderOpportunity` function**

Read `app.js` lines 1334–1420 to confirm exact current code before editing.

- [ ] **Step 2: Replace the trends rendering block**

Find this block inside `renderOpportunity`:
```js
  // Trending
  const trendsHtml = (oppData.trends || []).map(t => `
    <div class="trend-card">
      <div class="trend-platform">${esc(t.platform)}</div>
      <div class="trend-headline">${esc(t.headline)}</div>
      <div class="trend-hashtags">
        ${(t.hashtags || []).map(h => `<span class="hashtag">${esc(h)}</span>`).join('')}
      </div>
      <div class="trend-opportunity">💡 ${esc(t.opportunity)}</div>
    </div>`).join('');
```

Replace with:
```js
  // Trending — with expandable playbook
  const trendsHtml = (oppData.trends || []).map((t, idx) => {
    const pb = t.playbook || null;
    const isOpen = state.expandedPlaybooks.has(idx);

    const playbookPanel = pb && isOpen ? `
      <div class="playbook-panel">
        <div class="playbook-row">
          <div class="playbook-row-header">
            <span class="playbook-row-label">📸 Instagram Caption</span>
            <button class="btn-copy" data-copy="${esc(pb.instagram_caption)}" data-copyid="ig-${idx}">📋 Copy</button>
          </div>
          <div class="playbook-row-text">${esc(pb.instagram_caption)}</div>
        </div>
        <div class="playbook-row">
          <div class="playbook-row-header">
            <span class="playbook-row-label">💼 LinkedIn Caption</span>
            <button class="btn-copy" data-copy="${esc(pb.linkedin_caption)}" data-copyid="li-${idx}">📋 Copy</button>
          </div>
          <div class="playbook-row-text">${esc(pb.linkedin_caption)}</div>
        </div>
        <div class="playbook-row">
          <div class="playbook-row-header">
            <span class="playbook-row-label">#️⃣ Hashtags — Wide</span>
            <button class="btn-copy" data-copy="${esc((pb.hashtag_wide || []).join(' '))}" data-copyid="hw-${idx}">📋 Copy</button>
          </div>
          <div class="playbook-hashtags">${(pb.hashtag_wide || []).map(h => `<span class="hashtag">${esc(h)}</span>`).join('')}</div>
        </div>
        <div class="playbook-row">
          <div class="playbook-row-header">
            <span class="playbook-row-label">#️⃣ Hashtags — Niche</span>
            <button class="btn-copy" data-copy="${esc((pb.hashtag_niche || []).join(' '))}" data-copyid="hn-${idx}">📋 Copy</button>
          </div>
          <div class="playbook-hashtags">${(pb.hashtag_niche || []).map(h => `<span class="hashtag">${esc(h)}</span>`).join('')}</div>
        </div>
        <div class="playbook-row">
          <div class="playbook-row-header">
            <span class="playbook-row-label">📩 DM / Outreach Script</span>
            <button class="btn-copy" data-copy="${esc(pb.dm_script)}" data-copyid="dm-${idx}">📋 Copy</button>
          </div>
          <div class="playbook-row-text">${esc(pb.dm_script)}</div>
        </div>
        <div class="playbook-row">
          <span class="playbook-row-label">📅 Best Time to Post</span>
          <div class="playbook-timing">${esc(pb.post_timing)}</div>
        </div>
      </div>` : '';

    return `
    <div class="trend-card">
      <div class="trend-platform">${esc(t.platform)}</div>
      <div class="trend-headline">${esc(t.headline)}</div>
      <div class="trend-hashtags">
        ${(t.hashtags || []).map(h => `<span class="hashtag">${esc(h)}</span>`).join('')}
      </div>
      <div class="trend-opportunity">💡 ${esc(t.opportunity)}</div>
      ${pb ? `<button class="playbook-toggle${isOpen ? ' open' : ''}" data-pbidx="${idx}">📋 ${isOpen ? 'Hide' : 'Playbook'}</button>` : ''}
      ${playbookPanel}
    </div>`;
  }).join('');
```

- [ ] **Step 3: Add event listeners after `panel.innerHTML` is set**

Inside `renderOpportunity`, after the `panel.innerHTML = ...` assignment and after `drawSparkline(...)`, add:

```js
  // Playbook toggle buttons
  panel.querySelectorAll('.playbook-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.pbidx, 10);
      if (state.expandedPlaybooks.has(idx)) {
        state.expandedPlaybooks.delete(idx);
      } else {
        state.expandedPlaybooks.add(idx);
      }
      renderOpportunity(oppData);
    });
  });

  // Copy buttons
  panel.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✅ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '📋 Copy';
          btn.classList.remove('copied');
        }, 2000);
      });
    });
  });
```

- [ ] **Step 4: Verify syntax**
```bash
cd /Users/in22911506/DOAPI/samavaya-niramaya-app
node -e "const fs=require('fs'); new Function(fs.readFileSync('app.js','utf8')); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 5: Commit**
```bash
git add app.js
git commit -m "feat(opp): expandable content playbook on each trend card with copy buttons"
```

---

## Task 5: Update `renderOpportunity` — Venue Pipeline + Deep Links

**Files:**
- Modify: `app.js` — `renderOpportunity` function, venues section

- [ ] **Step 1: Add pipeline stage helpers before `renderOpportunity`**

Add the following two helpers immediately before `function renderOpportunity(oppData) {`:

```js
const PIPELINE_STAGES = ['spotted', 'reached_out', 'talking', 'won', 'not_now'];
const PIPELINE_LABELS = {
  spotted:     '🔍 Spotted',
  reached_out: '📤 Reached Out',
  talking:     '💬 Talking',
  won:         '🏆 Won',
  not_now:     '⏸ Not Now',
};

function getVenuePipeline() {
  return lsGet(LS.VENUE_PIPELINE, {});
}

function setVenueStage(venueName, stage) {
  const pipeline = getVenuePipeline();
  pipeline[venueName] = stage;
  lsSet(LS.VENUE_PIPELINE, pipeline);
}

function nextPipelineStage(current) {
  const idx = PIPELINE_STAGES.indexOf(current);
  return PIPELINE_STAGES[(idx + 1) % PIPELINE_STAGES.length];
}
```

- [ ] **Step 2: Replace the venues rendering block**

Find this block inside `renderOpportunity`:
```js
  // Venues (JSON + custom)
  const allVenues = [...(oppData.venues || []), ...state.customVenues];
  const venuesHtml = allVenues.map(v => `
    <div class="venue-row">
      <div class="venue-icon">${v.icon || '🏢'}</div>
      <div class="venue-info">
        <div class="venue-name">${esc(v.name)}</div>
        <div class="venue-city">${esc(v.city)}${v.status ? ` · <em>${esc(v.status)}</em>` : ''}</div>
        <div class="venue-note">${esc(v.note)}</div>
      </div>
      <span class="badge ${venueBadgeClass(v.badge)}">${esc(v.badge)}</span>
    </div>`).join('');
```

Replace with:
```js
  // Venues (JSON + custom) with pipeline status + deep links
  const allVenues = [...(oppData.venues || []), ...state.customVenues];
  const venuePipeline = getVenuePipeline();
  const venuesHtml = allVenues.map(v => {
    const stage = venuePipeline[v.name] || 'spotted';
    const stageLabel = PIPELINE_LABELS[stage] || stage;
    const liQuery = encodeURIComponent(`${v.name} wellness`);
    const igQuery = encodeURIComponent(v.name);
    return `
    <div class="venue-row">
      <div class="venue-icon">${v.icon || '🏢'}</div>
      <div class="venue-info">
        <div class="venue-name">
          ${esc(v.name)}
          <span class="badge ${venueBadgeClass(v.badge)}" style="font-size:0.6rem;margin-left:4px">${esc(v.badge)}</span>
        </div>
        <div class="venue-city">${esc(v.city)}${v.status ? ` · <em>${esc(v.status)}</em>` : ''}</div>
        <div class="venue-note">${esc(v.note)}</div>
        <div class="venue-deep-links">
          <a class="btn-deep-link" href="https://www.linkedin.com/search/results/all/?keywords=${liQuery}" target="_blank" rel="noopener noreferrer">🔗 LinkedIn</a>
          <a class="btn-deep-link" href="https://www.instagram.com/explore/tags/${encodeURIComponent(v.name.replace(/\s+/g,'').toLowerCase())}" target="_blank" rel="noopener noreferrer">📸 Instagram</a>
        </div>
      </div>
      <button class="venue-pipeline-badge pipeline--${stage}" data-venue="${esc(v.name)}">${stageLabel}</button>
    </div>`;
  }).join('');
```

- [ ] **Step 3: Add venue pipeline badge click listeners**

Inside `renderOpportunity`, after the existing `document.getElementById('btn-open-add-venue')` listener, add:

```js
  // Venue pipeline badge — tap to cycle stage
  panel.querySelectorAll('.venue-pipeline-badge').forEach(btn => {
    btn.addEventListener('click', () => {
      const venueName = btn.dataset.venue;
      const current = getVenuePipeline()[venueName] || 'spotted';
      setVenueStage(venueName, nextPipelineStage(current));
      renderOpportunity(oppData);
    });
  });
```

- [ ] **Step 4: Verify syntax**
```bash
cd /Users/in22911506/DOAPI/samavaya-niramaya-app
node -e "const fs=require('fs'); new Function(fs.readFileSync('app.js','utf8')); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 5: Commit**
```bash
git add app.js
git commit -m "feat(opp): venue pipeline badge (5 stages) + LinkedIn/Instagram deep-link buttons"
```

---

## Task 6: Manual verification

- [ ] **Step 1: Open the app in a browser**

Open `index.html` directly in Chrome/Safari (no server needed — it's a PWA using localStorage).

- [ ] **Step 2: Verify Content Playbook**
  - Go to Opportunity tab
  - Confirm each trend card has a **"📋 Playbook"** button
  - Tap it — confirm all 6 sections expand (Instagram caption, LinkedIn caption, Wide hashtags, Niche hashtags, DM script, Post timing)
  - Tap **📋 Copy** on each — confirm "✅ Copied!" flash appears and text is in clipboard (paste into Notes to verify)
  - Tap **"📋 Hide"** — confirm playbook collapses
  - Tap another trend's Playbook — confirm it expands independently

- [ ] **Step 3: Verify Venue Pipeline**
  - Confirm each venue card has a pipeline badge (default: "🔍 Spotted")
  - Tap the badge — confirm it cycles: Spotted → Reached Out → Talking → Won → Not Now → Spotted
  - Confirm badge colour changes at each stage
  - Refresh the page — confirm stage persists (localStorage)

- [ ] **Step 4: Verify Deep Links**
  - Tap **🔗 LinkedIn** on ITC Maratha — confirm opens `linkedin.com/search/results/all/?keywords=ITC+Maratha+wellness` in new tab
  - Tap **📸 Instagram** on ITC Maratha — confirm opens Instagram in new tab
  - Confirm no console errors

- [ ] **Step 5: Final commit and push**
```bash
git push
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 7 success criteria from spec are covered across tasks 1–6
- [x] **No placeholders:** All code blocks are complete and literal
- [x] **Type consistency:** `PIPELINE_STAGES`, `PIPELINE_LABELS`, `getVenuePipeline`, `setVenueStage`, `nextPipelineStage` defined in Task 5 Step 1 before they are used in Steps 2–3
- [x] **LS.VENUE_PIPELINE** added in Task 1 Step 1 before it is used in Task 5
- [x] **state.expandedPlaybooks** added in Task 1 Step 2 before it is used in Task 4
- [x] **`oppData` passed correctly** — `renderOpportunity(oppData)` is called recursively in event listeners; `oppData` is in scope as the function parameter
