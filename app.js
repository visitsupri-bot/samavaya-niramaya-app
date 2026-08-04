// ═══════════════════════════════════════════════════════════
// Samavaya Niramaya — app.js
// Holistic Wellness Through Union
// ═══════════════════════════════════════════════════════════

// ── Config ───────────────────────────────────────────────
const GCS_BASE = 'https://storage.googleapis.com/samavaya-niramaya/daily';

const LS = {
  PARTICIPANTS:    'sn_participants',
  ATTENDANCE:      'sn_attendance',
  INVOICES:        'sn_invoices',
  VENUES:          'sn_venues',
  WISDOM_FAVS:     'sn_wisdom_favourites',
  ACTIVE_TAB:      'sn_active_tab',
  WISDOM_SOURCE:   'sn_wisdom_source',
  CUSTOM_CLASSES:  'sn_custom_classes',   // deprecated — kept for migration
  TEMPLATE_CLASSES:'sn_template_classes',
  WEEK_OVERRIDES:  'sn_week_overrides',
  VENUE_PIPELINE:  'sn_venue_pipeline',
};

// ── GitHub Sync Config ────────────────────────────────────
const GH_REPO   = 'visitsupri-bot/samavaya-niramaya-app';
const GH_BRANCH = 'main';
const GH_PATH   = 'sample-data/latest.json';
const GH_RAW    = `https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${GH_PATH}`;

// PAT stored in localStorage only — never in source code, never committed
const LS_PAT = 'sn_github_pat';

const DAYS_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

const CONDITION_KEYS = [
  'lower_back_pain','anxiety','insomnia','digestive_issues','migraine',
  'hypertension','fatigue','knee_pain','hormonal_balance','grief_loss',
  'sinusitis','eye_strain','frozen_shoulder','diabetes_management',
];

const WISDOM_SOURCES = [
  { key: 'yoga_sutras',           label: 'Yoga Sutras' },
  { key: 'bhagavad_gita',         label: 'Bhagavad Gita' },
  { key: 'upanishads',            label: 'Upanishads' },
  { key: 'hatha_yoga_pradipika',  label: 'Hatha Yoga Pradipika' },
];

// ── App State ─────────────────────────────────────────────
const state = {
  data:            null,
  activeTab:       'schedule',
  wisdomSource:    'yoga_sutras',
  currentClassId:  null,
  customClasses:   [],   // deprecated, kept for migration read
  templateClasses: [],
  customVenues:    [],
  activeCondition: null,
  selectedWeek:    null, // Date object for the Monday of the viewed week; null = current week
  billingMonth:    null, // "YYYY-MM" string; null = current month
  expandedPlaybooks: new Set(), // indices of currently expanded trend playbooks
};

// ── Helpers ───────────────────────────────────────────────
function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ── GitHub Sync ───────────────────────────────────────────

/**
 * Builds the full latest.json payload by merging the current state.data
 * (content sections: tip, wisdom, opportunity, class_plan) with all
 * user-edited localStorage keys.
 */
function serialiseToJson() {
  // Deep-clone current state.data as the base (preserves content sections)
  const payload = JSON.parse(JSON.stringify(state.data || { date: today(), sections: {} }));
  payload.date = today();
  const s = payload.sections;

  // Participants: flatten per-class map → unique list keyed by id
  const perClassMap = lsGet(LS.PARTICIPANTS, {});
  const seen = new Set();
  const flatParticipants = [];
  Object.values(perClassMap).forEach(arr => {
    if (!Array.isArray(arr)) return;
    arr.forEach(p => {
      if (!seen.has(p.id)) { seen.add(p.id); flatParticipants.push(p); }
    });
  });
  s.participants = flatParticipants;

  // Schedule classes (template)
  const templateClasses = lsGet(LS.TEMPLATE_CLASSES, []);
  if (!s.schedule) s.schedule = {};
  s.schedule.classes = templateClasses;

  // All other user-data keys stored as new top-level section keys
  s.attendance        = lsGet(LS.ATTENDANCE,      {});
  s.invoices          = lsGet(LS.INVOICES,         {});
  s.venues            = lsGet(LS.VENUES,           []);
  s.week_overrides    = lsGet(LS.WEEK_OVERRIDES,   {});
  s.venue_pipeline    = lsGet(LS.VENUE_PIPELINE,   []);
  s.wisdom_favourites = lsGet(LS.WISDOM_FAVS,      []);
  // Note: ACTIVE_TAB and WISDOM_SOURCE are intentionally omitted — UI preferences,
  // not user data, and should not be synced across devices.

  return payload;
}

let _saveResetTimer = null;

/**
 * Updates the Save button visual state.
 * @param {'idle'|'saving'|'saved'|'error'} status
 * @param {string} [label] optional override label
 */
function showSaveStatus(status, label) {
  const btn = document.getElementById('save-btn');
  if (!btn) return;
  btn.classList.remove('saving', 'saved', 'error');
  btn.disabled = false;
  const labels = { idle: '☁ Save', saving: '⏳ Saving…', saved: '✅ Saved', error: '❌ Error' };
  btn.textContent = label || labels[status] || '☁ Save';
  if (status === 'saving') { btn.classList.add('saving'); btn.disabled = true; }
  if (status === 'saved')  { btn.classList.add('saved');  clearTimeout(_saveResetTimer); _saveResetTimer = setTimeout(() => showSaveStatus('idle'), 3000); }
  if (status === 'error')  { clearTimeout(_saveResetTimer); btn.classList.add('error'); }
}

/**
 * Main entry point: called when the Save button is clicked.
 * Opens PAT modal if no token is stored, otherwise commits to GitHub.
 */
async function githubSyncSave() {
  const pat = localStorage.getItem(LS_PAT);
  if (!pat) {
    openPatModal(/* afterSave */ true);
    return;
  }
  await commitToGitHub(pat);
}

/**
 * Commits the serialised JSON to GitHub via the Contents API.
 * @param {string} pat GitHub Personal Access Token
 */
async function commitToGitHub(pat) {
  showSaveStatus('saving');
  try {
    const apiUrl = `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`;
    const headers = {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    // 1. Get current file SHA (required for updates)
    const shaRes = await fetch(apiUrl, { headers });
    if (!shaRes.ok) throw new Error(`GitHub GET failed: ${shaRes.status} ${shaRes.statusText}`);
    const shaData = await shaRes.json();
    const currentSha = shaData.sha;
    if (!currentSha) throw new Error('GitHub response missing sha — check GH_PATH constant');

    // 2. Serialise current state to JSON
    const payload = serialiseToJson();
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));

    // 3. PUT updated file
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `data: save app state ${today()}`,
        content,
        sha: currentSha,
        branch: GH_BRANCH,
      }),
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(`GitHub PUT failed: ${putRes.status} — ${err.message || putRes.statusText}`);
    }

    showSaveStatus('saved');
    console.info('[GitHubSync] ✅ Saved to GitHub successfully');
  } catch (err) {
    showSaveStatus('error', '❌ Error (see console)');
    console.error('[GitHubSync] Save failed:', err);
  }
}

/**
 * Opens the PAT setup modal.
 * @param {boolean} afterSave — if true, triggers a save after the token is stored
 */
function openPatModal(afterSave = false) {
  const modal    = document.getElementById('pat-modal');
  const input    = document.getElementById('pat-input');
  const saveBtn  = document.getElementById('pat-save-btn');
  const cancelBtn = document.getElementById('pat-cancel-btn');
  const forgetBtn = document.getElementById('pat-forget-btn');
  if (!modal) return;

  // Pre-fill if a token already exists (for editing/replacing)
  input.value = localStorage.getItem(LS_PAT) || '';
  modal.classList.remove('hidden');
  input.focus();

  saveBtn.onclick = () => {
    const val = input.value.trim();
    if (!val) { input.style.borderColor = 'var(--danger, #c0392b)'; return; }
    input.style.borderColor = '';
    localStorage.setItem(LS_PAT, val);
    closePatModal();
    if (afterSave) commitToGitHub(val);
  };

  cancelBtn.onclick = closePatModal;

  forgetBtn.onclick = () => {
    localStorage.removeItem(LS_PAT);
    input.value = '';
    input.placeholder = 'Token removed';
  };
}

function closePatModal() {
  const modal = document.getElementById('pat-modal');
  if (modal) modal.classList.add('hidden');
}

function today() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
}

function todayName() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

function formatDate(d) {
  return d.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

function venueBadgeClass(badge) {
  const map = {
    'High Value': 'badge--hv',
    'Corporate':  'badge--corp',
    'Govt':       'badge--govt',
    'Government': 'badge--govt',
    'Studio':     'badge--studio',
    'Growing':    'badge--growing',
  };
  return map[badge] || 'badge--hv';
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
}

// Returns "YYYY-Www" for the ISO week containing `date`
function isoWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // shift to nearest Thursday
  const yearStart = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((d - yearStart) / 86400000 - 3 + ((yearStart.getDay() + 6) % 7)) / 7
  ) + 1;
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// Returns the Monday of the ISO week that contains `date`
function weekMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

// Returns "28 Jul – 3 Aug 2026" for the week containing `date`
function weekRangeLabel(date) {
  const mon = weekMonday(date);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${fmt(mon)} – ${fmt(sun)} ${sun.getFullYear()}`;
}

// Returns week number string for display e.g. "31"
function weekNumber(date) {
  return isoWeekKey(date).split('-W')[1];
}

// ── Init ─────────────────────────────────────────────────
async function init() {
  // Restore persisted state
  state.activeTab     = lsGet(LS.ACTIVE_TAB, 'schedule');
  state.wisdomSource  = lsGet(LS.WISDOM_SOURCE, 'yoga_sutras');
  state.templateClasses = lsGet(LS.TEMPLATE_CLASSES, []);
  state.customVenues    = lsGet(LS.VENUES, []);

  // Set header date
  document.getElementById('app-date').textContent =
    new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short' });

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }

  // Wire Save button
  document.getElementById('save-btn')?.addEventListener('click', githubSyncSave);

  // Fetch data
  await fetchData();
}

// ── localStorage Seeding ──────────────────────────────────
function seedLocalStorage(sections) {
  // Migrate participants: flat array → per-class map (one-time)
  // Old format: sn_participants = [...]
  // New format: sn_participants = { "cls_001": [...], ... }
  const rawP = lsGet(LS.PARTICIPANTS, null);
  if (Array.isArray(rawP)) {
    // Old flat array — move it under the first class key so data isn't lost
    const firstClass = sections.schedule?.classes?.[0];
    const map = {};
    if (firstClass) map[firstClass.id] = rawP;
    lsSet(LS.PARTICIPANTS, map);
  } else {
    // On every load: only seed participants from JSON into classes that have
    // NO participants yet (brand-new class). Never touch a class that already
    // has participants — deleted participants must stay deleted.
    const map = rawP || {};
    if (sections.participants && sections.schedule?.classes) {
      sections.schedule.classes.forEach(cls => {
        const existing = Array.isArray(map[cls.id]) ? map[cls.id] : [];
        if (existing.length === 0) {
          // Truly empty class — seed from JSON as a starting point
          map[cls.id] = [...sections.participants];
        }
        // If the class already has participants (even one), leave it untouched.
      });
    }
    lsSet(LS.PARTICIPANTS, map);
  }

  // Migrate sn_custom_classes → sn_template_classes (one-time)
  if (!localStorage.getItem(LS.TEMPLATE_CLASSES)) {
    const legacy = lsGet(LS.CUSTOM_CLASSES, null);
    if (legacy && legacy.length > 0) {
      // Promote existing custom classes to be the template
      lsSet(LS.TEMPLATE_CLASSES, legacy);
    } else {
      // No legacy data — seed from the daily JSON
      const jsonClasses = sections.schedule?.classes || [];
      lsSet(LS.TEMPLATE_CLASSES, jsonClasses);
    }
    lsSet(LS.WEEK_OVERRIDES, {});
  }

  // Ensure WEEK_OVERRIDES always exists (in case it was cleared independently)
  if (!localStorage.getItem(LS.WEEK_OVERRIDES)) {
    lsSet(LS.WEEK_OVERRIDES, {});
  }

  // Restore user-data keys that were saved back to JSON via GitHubSync.
  // Only seed if localStorage is empty for that key (don't overwrite live edits).
  if (sections.attendance && !localStorage.getItem(LS.ATTENDANCE)) {
    lsSet(LS.ATTENDANCE, sections.attendance);
  }
  if (sections.invoices && !localStorage.getItem(LS.INVOICES)) {
    lsSet(LS.INVOICES, sections.invoices);
  }
  if (sections.venues && sections.venues.length > 0 && !localStorage.getItem(LS.VENUES)) {
    lsSet(LS.VENUES, sections.venues);
  }
  if (sections.week_overrides && !localStorage.getItem(LS.WEEK_OVERRIDES)) {
    lsSet(LS.WEEK_OVERRIDES, sections.week_overrides);
  }
  if (sections.venue_pipeline && sections.venue_pipeline.length > 0 && !localStorage.getItem(LS.VENUE_PIPELINE)) {
    lsSet(LS.VENUE_PIPELINE, sections.venue_pipeline);
  }
  if (sections.wisdom_favourites && sections.wisdom_favourites.length > 0 && !localStorage.getItem(LS.WISDOM_FAVS)) {
    lsSet(LS.WISDOM_FAVS, sections.wisdom_favourites);
  }
}

// ── Week Data Layer ───────────────────────────────────────

// ── Per-class participant helpers ─────────────────────────
function getClassParticipants(classId) {
  const map = lsGet(LS.PARTICIPANTS, {});
  return Array.isArray(map[classId]) ? map[classId] : [];
}

function setClassParticipants(classId, list) {
  const map = lsGet(LS.PARTICIPANTS, {});
  map[classId] = list;
  lsSet(LS.PARTICIPANTS, map);
}

// Returns the resolved class list for a given ISO week key.
// Each class has a `_status` field: 'template' | 'overridden' | 'cancelled' | 'adhoc'
function getWeekClasses(weekKey) {
  const templateClasses = lsGet(LS.TEMPLATE_CLASSES, []);
  const allOverrides    = lsGet(LS.WEEK_OVERRIDES, {});
  const weekOverrides   = allOverrides[weekKey] || {};
  const adhoc           = allOverrides[`${weekKey}-adhoc`] || [];

  const resolved = templateClasses.map(cls => {
    const ov = weekOverrides[cls.id];
    if (!ov) return { ...cls, _status: 'template' };
    if (ov.action === 'cancelled') return { ...cls, _status: 'cancelled' };
    // action === 'override': merge changed fields over template
    const { action: _action, ...ovFields } = ov;
    return { ...cls, ...ovFields, _status: 'overridden' };
  });

  adhoc.forEach(cls => resolved.push({ ...cls, _status: 'adhoc' }));
  return resolved;
}

// Returns the number of expected class occurrences for a given class in a billing month.
// Counts calendar weekdays matching the class's `day` field, minus any cancelled weeks.
function countExpectedSessions(classId, billingYYYYMM) {
  const templateClasses = lsGet(LS.TEMPLATE_CLASSES, []);
  const cls = templateClasses.find(c => c.id === classId);
  if (!cls || !cls.day) return 0;

  const [year, month] = billingYYYYMM.split('-').map(Number);
  const allOverrides = lsGet(LS.WEEK_OVERRIDES, {});
  let count = 0;

  // Iterate every day in the billing month
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getDay()];
    if (dayName !== cls.day) continue;

    // Check if this week has a cancellation override for this class
    const weekKey = isoWeekKey(date);
    const weekOv = allOverrides[weekKey] || {};
    const ov = weekOv[classId];
    if (ov && ov.action === 'cancelled') continue;

    count++;
  }
  return count;
}

// Returns the number of sessions a participant actually attended in a billing month for a class.
function countAttendedSessions(participantId, classId, billingYYYYMM) {
  const rec = lsGet(LS.ATTENDANCE, {});
  return Object.entries(rec).filter(([key, present]) => {
    if (!present) return false;
    // key: classId_YYYY-MM-DD_participantId
    const parts = key.split('_');
    if (parts.length < 3) return false;
    const pid = parts[parts.length - 1];
    const dateStr = parts[parts.length - 2];
    return pid === participantId && dateStr.startsWith(billingYYYYMM);
  }).length;
}

function saveOverride(weekKey, classId, overrideData) {
  const all = lsGet(LS.WEEK_OVERRIDES, {});
  if (!all[weekKey]) all[weekKey] = {};
  all[weekKey][classId] = overrideData;
  lsSet(LS.WEEK_OVERRIDES, all);
}

function removeOverride(weekKey, classId) {
  const all = lsGet(LS.WEEK_OVERRIDES, {});
  if (all[weekKey]) {
    delete all[weekKey][classId];
    if (Object.keys(all[weekKey]).length === 0) delete all[weekKey];
  }
  lsSet(LS.WEEK_OVERRIDES, all);
}

function addAdhocClass(weekKey, cls) {
  const all = lsGet(LS.WEEK_OVERRIDES, {});
  const key = `${weekKey}-adhoc`;
  if (!all[key]) all[key] = [];
  all[key].push(cls);
  lsSet(LS.WEEK_OVERRIDES, all);
}

function deleteAdhocClass(weekKey, classId) {
  const all = lsGet(LS.WEEK_OVERRIDES, {});
  const key = `${weekKey}-adhoc`;
  if (all[key]) {
    all[key] = all[key].filter(c => c.id !== classId);
    if (all[key].length === 0) delete all[key];
  }
  lsSet(LS.WEEK_OVERRIDES, all);
}

// ── Data Fetch ────────────────────────────────────────────
async function fetchData() {
  const dateStr = today();
  const skeleton = document.getElementById('skeleton');
  const offline  = document.getElementById('offline-screen');

  // Cache-bust GCS URLs once per day so stale browser cache is bypassed
  const bust = dateStr;

  // 5-URL fallback chain
  const urls = [
    `${GCS_BASE}/${dateStr}.json?v=${bust}`,   // 1. GCS dated
    `${GCS_BASE}/latest.json?v=${bust}`,       // 2. GCS latest
    `${GH_RAW}?v=${bust}`,                     // 3. GitHub raw (saved user data)
    `./sample-data/${dateStr}.json`,           // 4. Local dated
    `./sample-data/latest.json`,               // 5. Local latest
  ];

  let loaded = false;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      state.data = await res.json();
      loaded = true;
      break;
    } catch {
      // try next URL
    }
  }

  if (!loaded) {
    skeleton.classList.add('hidden');
    offline.classList.remove('hidden');
    return;
  }

  // Seed localStorage on first run, then reload into state
  if (state.data?.sections) {
    seedLocalStorage(state.data.sections);
    state.templateClasses = lsGet(LS.TEMPLATE_CLASSES, []);
  }

  skeleton.classList.add('hidden');
  renderAll();
  switchTab(state.activeTab);
}

// ── Render All Tabs ───────────────────────────────────────
function renderAll() {
  if (!state.data) return;
  const s = state.data.sections;
  renderSchedule();
  renderAttendance(s.participants);
  renderClassPlan(s.class_plan);
  renderTip(s.tip);
  state.expandedPlaybooks.clear();
  renderOpportunity(s.opportunity);
  renderWisdom(s.wisdom);
}

// ── Tab Switching ─────────────────────────────────────────
function switchTab(tabName) {
  state.activeTab = tabName;
  lsSet(LS.ACTIVE_TAB, tabName);

  document.querySelectorAll('.section-panel').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

  const panel = document.getElementById(`panel-${tabName}`);
  const navBtn = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);

  if (panel)  { panel.classList.remove('hidden'); panel.classList.add('active'); }
  if (navBtn)  navBtn.classList.add('active');

  window.scrollTo(0, 0);
}

// ═══════════════════════════════════════════════════════════
// TAB 1 — SCHEDULE
// ═══════════════════════════════════════════════════════════
function currentViewWeekMonday() {
  return state.selectedWeek ? new Date(state.selectedWeek) : weekMonday(new Date());
}

function renderSchedule() {
  const panel      = document.getElementById('panel-schedule');
  const viewMon    = currentViewWeekMonday();
  const weekKey    = isoWeekKey(viewMon);
  const todayKey   = isoWeekKey(new Date());
  const isThisWeek = weekKey === todayKey;
  const todayDay   = todayName();
  const classes    = getWeekClasses(weekKey);

  // Group by day
  const grouped = {};
  DAYS_ORDER.forEach(d => { grouped[d] = []; });
  classes.forEach(cls => { if (grouped[cls.day]) grouped[cls.day].push(cls); });

  // Week nav bar
  let html = `
    <div class="week-nav">
      <button class="week-nav-btn" id="btn-week-prev">‹</button>
      <div class="week-nav-center" id="btn-week-picker">
        <div class="week-nav-label">${weekRangeLabel(viewMon)}</div>
        <div class="week-nav-sub">Week ${weekNumber(viewMon)}${isThisWeek ? ' · <span class="week-current-badge">Current week</span>' : ''}</div>
      </div>
      <button class="week-nav-btn" id="btn-week-next">›</button>
    </div>
    <div class="schedule-toolbar">
      <button class="btn-edit-template" id="btn-open-template-editor">✏️ Edit Template</button>
    </div>
    <div class="legend">
      <span class="legend-item"><span class="class-dot dot--fixed"></span> Fixed</span>
      <span class="legend-item"><span class="class-dot dot--dropin"></span> Drop-in</span>
      <span class="legend-item"><span class="class-dot dot--event"></span> Event</span>
    </div>
  `;

  // Day groups
  DAYS_ORDER.forEach(day => {
    const dayCls = grouped[day];
    if (!dayCls.length) return;
    const isToday = isThisWeek && day === todayDay;
    const dayDate = new Date(viewMon);
    dayDate.setDate(viewMon.getDate() + DAYS_ORDER.indexOf(day));
    const dayLabel = dayDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    html += `<div class="day-group">
      <div class="day-label${isToday ? ' day-label--today' : ''}">${isToday ? '📍 Today — ' : ''}${day} · ${dayLabel}</div>`;

    dayCls.forEach(cls => {
      html += renderClassCard(cls);
    });

    html += `</div>`;
  });

  // Add one-off button
  html += `<button class="btn-add-adhoc" id="btn-open-add-adhoc">＋ Add one-off class this week</button>`;

  panel.innerHTML = html;

  // Wire navigation
  document.getElementById('btn-week-prev').addEventListener('click', () => {
    const m = currentViewWeekMonday();
    m.setDate(m.getDate() - 7);
    state.selectedWeek = m;
    renderSchedule();
  });
  document.getElementById('btn-week-next').addEventListener('click', () => {
    const m = currentViewWeekMonday();
    m.setDate(m.getDate() + 7);
    state.selectedWeek = m;
    renderSchedule();
  });
  document.getElementById('btn-week-picker').addEventListener('click', () => openWeekPicker());
  document.getElementById('btn-open-template-editor').addEventListener('click', () => openTemplateEditor());
  document.getElementById('btn-open-add-adhoc').addEventListener('click', () => {
    state._addingAdhocForWeek = weekKey;
    document.getElementById('modal-add-class').classList.remove('hidden');
  });

  // Override / restore / delete buttons
  panel.querySelectorAll('.btn-override').forEach(btn => {
    btn.addEventListener('click', () => openOverrideModal(btn.dataset.id, weekKey));
  });
  panel.querySelectorAll('.btn-restore').forEach(btn => {
    btn.addEventListener('click', () => {
      removeOverride(weekKey, btn.dataset.id);
      renderSchedule();
    });
  });
  panel.querySelectorAll('.btn-delete-adhoc').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Remove this one-off class?')) return;
      deleteAdhocClass(weekKey, btn.dataset.id);
      renderSchedule();
    });
  });
}

function renderClassCard(cls) {
  const isEvent = cls.type === 'event';
  const statusClass = {
    template:   '',
    overridden: ' class-row--overridden',
    cancelled:  ' class-row--cancelled',
    adhoc:      ' class-row--adhoc',
  }[cls._status] || '';

  const statusLabel = {
    template:   '🔁 From template',
    overridden: '⚡ Overridden this week',
    cancelled:  '❌ Cancelled this week',
    adhoc:      '➕ One-off',
  }[cls._status] || '';

  let actionBtn = '';
  if (cls._status === 'template') {
    actionBtn = `<button class="btn-class-action btn-override" data-id="${esc(cls.id)}">Override</button>`;
  } else if (cls._status === 'overridden') {
    actionBtn = `<button class="btn-class-action btn-restore btn-restore--remove" data-id="${esc(cls.id)}">Remove override</button>`;
  } else if (cls._status === 'cancelled') {
    actionBtn = `<button class="btn-class-action btn-restore" data-id="${esc(cls.id)}">Restore</button>`;
  } else if (cls._status === 'adhoc') {
    actionBtn = `<button class="btn-class-action btn-delete-adhoc" data-id="${esc(cls.id)}">Delete</button>`;
  }

  return `
    <div class="class-row${statusClass}${isEvent ? ' class-row--event' : ''}">
      <span class="class-dot dot--${esc(cls.type)}"></span>
      <div class="class-info">
        <div class="class-name${cls._status === 'cancelled' ? ' class-name--cancelled' : ''}">${esc(cls.name)}</div>
        <div class="class-meta">${esc(cls.time)} · ${esc(cls.venue)} · <span class="class-status-label">${statusLabel}</span></div>
      </div>
      ${actionBtn}
    </div>`;
}

function openEditClass(id) {
  const cls = state.templateClasses.find(c => c.id === id);
  if (!cls) return;
  const form = document.getElementById('form-edit-class');
  form.elements['id'].value    = cls.id;
  form.elements['name'].value  = cls.name;
  form.elements['day'].value   = cls.day;
  form.elements['time'].value  = cls.time;
  form.elements['venue'].value = cls.venue || '';
  form.elements['type'].value  = cls.type;
  form.elements['rate'].value  = cls.rate || '';
  form.elements['capacity'].value = cls.capacity || '';
  document.getElementById('modal-edit-class').classList.remove('hidden');
}

// ── Override Modal ────────────────────────────────────────
function openOverrideModal(classId, weekKey) {
  const classes = getWeekClasses(weekKey);
  const cls = classes.find(c => c.id === classId);
  if (!cls) return;
  const form = document.getElementById('form-override');
  form.elements['classId'].value = classId;
  form.elements['weekKey'].value = weekKey;
  form.elements['name'].value    = cls.name;
  form.elements['time'].value    = cls.time;
  form.elements['venue'].value   = cls.venue || '';
  form.elements['cancel_this_week'].checked = false;
  document.getElementById('modal-override').classList.remove('hidden');
}

// ── Template Editor Modal ─────────────────────────────────
function openTemplateEditor() {
  renderTemplateEditor();
  document.getElementById('modal-template-editor').classList.remove('hidden');
}

function renderTemplateEditor() {
  const template = lsGet(LS.TEMPLATE_CLASSES, []);
  const list = document.getElementById('template-editor-list');

  if (!template.length) {
    list.innerHTML = `<p class="empty-state">No recurring classes yet. Add one below.</p>`;
    return;
  }

  const grouped = {};
  DAYS_ORDER.forEach(d => { grouped[d] = []; });
  template.forEach(cls => { if (grouped[cls.day]) grouped[cls.day].push(cls); });

  let html = '';
  DAYS_ORDER.forEach(day => {
    if (!grouped[day].length) return;
    html += `<div class="te-day-group"><div class="te-day-label">${day}</div>`;
    grouped[day].forEach(cls => {
      html += `
        <div class="te-class-row" data-id="${esc(cls.id)}">
          <div class="te-class-info">
            <div class="te-class-name">${esc(cls.name)}</div>
            <div class="te-class-meta">${esc(cls.time)} · ${esc(cls.venue)}</div>
          </div>
          <div class="te-actions">
            <button class="btn-te-edit" data-id="${esc(cls.id)}">Edit</button>
            <button class="btn-te-remove" data-id="${esc(cls.id)}">Remove</button>
          </div>
        </div>`;
    });
    html += `</div>`;
  });
  list.innerHTML = html;

  list.querySelectorAll('.btn-te-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Remove this class from the recurring template?')) return;
      const tpl = lsGet(LS.TEMPLATE_CLASSES, []);
      lsSet(LS.TEMPLATE_CLASSES, tpl.filter(c => c.id !== btn.dataset.id));
      state.templateClasses = lsGet(LS.TEMPLATE_CLASSES, []);
      renderTemplateEditor();
      renderSchedule();
    });
  });

  list.querySelectorAll('.btn-te-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = lsGet(LS.TEMPLATE_CLASSES, []);
      const cls = tpl.find(c => c.id === btn.dataset.id);
      if (!cls) return;
      const form = document.getElementById('form-edit-class');
      form.elements['id'].value       = cls.id;
      form.elements['name'].value     = cls.name;
      form.elements['day'].value      = cls.day;
      form.elements['time'].value     = cls.time;
      form.elements['venue'].value    = cls.venue || '';
      form.elements['type'].value     = cls.type;
      form.elements['rate'].value     = cls.rate || '';
      form.elements['capacity'].value = cls.capacity || '';
      document.getElementById('modal-edit-class').classList.remove('hidden');
    });
  });
}

// ── Week Picker Modal ─────────────────────────────────────
let _wpMonth = null;

function openWeekPicker() {
  _wpMonth = new Date(currentViewWeekMonday());
  _wpMonth.setDate(1);
  renderWeekPicker();
  document.getElementById('modal-week-picker').classList.remove('hidden');
}

function renderWeekPicker() {
  const year  = _wpMonth.getFullYear();
  const month = _wpMonth.getMonth();
  document.getElementById('wp-month-label').textContent =
    _wpMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const selectedKey = isoWeekKey(currentViewWeekMonday());
  const todayKey    = isoWeekKey(new Date());

  const firstDow    = new Date(year, month, 1).getDay();
  const startOffset = (firstDow === 0) ? 6 : firstDow - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = '';
  for (let i = 0; i < startOffset; i++) html += `<span class="wp-cell wp-cell--empty"></span>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const date    = new Date(year, month, d);
    const wKey    = isoWeekKey(date);
    const isToday = wKey === todayKey;
    const isSel   = wKey === selectedKey;
    let cls = 'wp-cell';
    if (isSel)             cls += ' wp-cell--selected';
    if (isToday && !isSel) cls += ' wp-cell--today';
    html += `<span class="${cls}" data-date="${date.toLocaleDateString('en-CA')}">${d}</span>`;
  }

  const grid = document.getElementById('wp-grid');
  grid.innerHTML = html;

  grid.querySelectorAll('.wp-cell:not(.wp-cell--empty)').forEach(cell => {
    cell.addEventListener('click', () => {
      state.selectedWeek = weekMonday(new Date(cell.dataset.date));
      document.getElementById('modal-week-picker').classList.add('hidden');
      renderSchedule();
    });
  });
}

// ═══════════════════════════════════════════════════════════
// TAB 2 — ATTENDANCE & INVOICING
// ═══════════════════════════════════════════════════════════
function renderAttendance(participantsData) {
  const panel = document.getElementById('panel-attend');
  const attendWeekKey = isoWeekKey(state.selectedWeek || new Date());
  const allClasses = getWeekClasses(attendWeekKey).filter(c => c._status !== 'cancelled');
  const todayStr = today();
  const attendanceRecord = lsGet(LS.ATTENDANCE, {});

  // Resolve billing month — default to NEXT calendar month so invoices are forward-looking
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const defaultBilling = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  const currentBilling = state.billingMonth || defaultBilling;
  const [billingYear, billingMonthNum] = currentBilling.split('-').map(Number);

  const currentId = state.currentClassId || (allClasses[0]?.id ?? '');

  // Load participants for the currently selected class only
  const participants = getClassParticipants(currentId);

  // Class selector options
  const classOptions = allClasses.map(c =>
    `<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.day)} ${esc(c.time)}</option>`
  ).join('');

  // Build attendance table
  let attendRows = '';
  participants.forEach(p => {
    const key = `${currentId}_${todayStr}_${p.id}`;
    const isPresent = attendanceRecord[key] === true;
    const sessLeft = p.sessions_total !== null
      ? (p.sessions_total - p.sessions_attended)
      : null;
    const warnClass = sessLeft !== null && sessLeft <= 1 ? ' sessions-warn' : '';
    const sessDisplay = sessLeft !== null ? sessLeft : '—';

    attendRows += `
      <tr>
        <td>${esc(p.name)}</td>
        <td><span class="badge badge--${esc(p.plan)}">${esc(p.plan)}</span></td>
        <td>
          <button class="attend-toggle ${isPresent ? 'present' : 'absent'}"
            data-pid="${esc(p.id)}" data-cid="${esc(currentId)}"></button>
        </td>
        <td><span class="sessions-left${warnClass}">${sessLeft !== null && sessLeft <= 1 ? '⚠️ ' : ''}${sessDisplay}</span></td>
        <td style="white-space:nowrap">
          <button class="btn-icon btn-edit-participant" data-id="${esc(p.id)}" title="Edit">✏️</button>
          <button class="btn-icon btn-icon--danger btn-delete-participant" data-id="${esc(p.id)}" title="Delete">🗑️</button>
        </td>
      </tr>`;
  });

  // Invoice list — all participants across ALL classes, deduplicated by participant ID
  const allParticipantsMap = lsGet(LS.PARTICIPANTS, {});
  const seenIds = new Set();
  const invoices = [];
  Object.entries(allParticipantsMap).forEach(([classId, pList]) => {
    (pList || []).forEach(p => {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        // Attach all enrolled class IDs so we can sum across them
        p._enrolledClassIds = Object.entries(allParticipantsMap)
          .filter(([, list]) => list.some(x => x.id === p.id))
          .map(([cid]) => cid);
        invoices.push(p);
      }
    });
  });

  let grandTotal = 0;
  let invoiceRows = invoices.map(p => {
    // Sum attended and expected sessions across all enrolled classes
    const enrolledIds = p._enrolledClassIds || [currentId];
    let totalAttended = 0;
    let totalExpected = 0;
    enrolledIds.forEach(cid => {
      totalAttended += countAttendedSessions(p.id, cid, currentBilling);
      if (p.plan === 'monthly') totalExpected += countExpectedSessions(cid, currentBilling);
    });

    let amount;
    if (p.plan === 'dropin') {
      amount = (p.rate || 0) * totalAttended;
    } else if (p.plan === 'monthly') {
      amount = totalExpected > 0
        ? Math.round(((p.rate || 0) * totalAttended) / totalExpected)
        : (p.rate || 0);
    } else {
      amount = p.rate || 0;
    }

    grandTotal += p.invoice_status !== 'paid' ? amount : 0;

    let subLabel;
    if (p.plan === 'dropin') {
      subLabel = `Drop-in · ${totalAttended} session${totalAttended !== 1 ? 's' : ''} this month · ₹${(p.rate || 0).toLocaleString('en-IN')}/session`;
    } else if (p.plan === 'monthly') {
      subLabel = `Monthly · ${totalAttended}/${totalExpected} sessions · pro-rated`;
    } else {
      subLabel = `${esc(p.plan)} · flat rate`;
    }
    return `
    <div class="invoice-row">
      <div>
        <div class="invoice-name">${esc(p.name)}</div>
        <div class="invoice-plan">${subLabel}</div>
      </div>
      <span class="invoice-amount">₹${amount.toLocaleString('en-IN')}</span>
      <span class="badge badge--${esc(p.invoice_status)}">${esc(p.invoice_status)}</span>
    </div>`;
  }).join('');

  const totalRow = invoices.length ? `
    <div class="invoice-total-summary">
      <span>Total Outstanding</span>
      <strong>₹${grandTotal.toLocaleString('en-IN')}</strong>
    </div>` : '';

  // Build billing month dropdown: 2 months ahead → 11 months back (14 options total)
  const monthOptions = (() => {
    const opts = [];
    const d = new Date();
    d.setMonth(d.getMonth() + 2); // start 2 months in the future
    for (let i = 0; i < 14; i++) {
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const lbl = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      opts.push(`<option value="${val}" ${val === currentBilling ? 'selected' : ''}>${lbl}</option>`);
      d.setMonth(d.getMonth() - 1);
    }
    return opts.join('');
  })();

  panel.innerHTML = `
    <h2 style="color:var(--bark);margin-bottom:12px">Attendance & Invoicing</h2>

    <div class="card card--green">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="card-title card-title--green" style="margin:0">✅ Mark Attendance</div>
        <button class="btn-add" id="btn-open-add-participant" style="font-size:0.78rem;padding:4px 10px">＋ Participant</button>
      </div>
      <div class="class-selector">
        <label>Select Class / Session</label>
        <select class="class-select" id="class-select">${classOptions}</select>
      </div>
      <div style="overflow-x:auto">
        <table class="attend-table">
          <thead>
            <tr>
              <th>Participant</th><th>Plan</th><th>Present</th><th>Sessions Left</th><th></th>
            </tr>
          </thead>
          <tbody id="attend-tbody">${attendRows}</tbody>
        </table>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;margin-bottom:8px">
      <span style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted)">💳 Invoices</span>
      <div style="display:flex;gap:6px;align-items:center">
        <label style="font-size:0.75rem;color:var(--muted)">Billing Month</label>
        <select id="billing-month-select" style="font-size:0.8rem;padding:3px 6px;border-radius:6px;border:1px solid var(--muted)">${monthOptions}</select>
      </div>
    </div>
    <div id="invoice-list">${invoiceRows}</div>
    ${totalRow}
    <button class="btn-generate" id="btn-generate-invoices">📄 Generate All Pending Invoices</button>
  `;

  // Restore selected class in dropdown after re-render
  const selectEl = document.getElementById('class-select');
  if (selectEl && currentId) selectEl.value = currentId;

  // Listeners
  selectEl?.addEventListener('change', e => {
    state.currentClassId = e.target.value;
    renderAttendance();
  });

  document.querySelectorAll('.attend-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.pid;
      const cid = btn.dataset.cid;
      toggleAttendance(pid, cid, todayStr);
      renderAttendance();
    });
  });

  document.getElementById('billing-month-select')?.addEventListener('change', e => {
    state.billingMonth = e.target.value;
    renderAttendance();
  });

  document.getElementById('btn-generate-invoices')?.addEventListener('click', () => {
    generateInvoices(invoices, currentId, currentBilling);
  });

  document.getElementById('btn-open-add-participant')?.addEventListener('click', () => {
    document.getElementById('form-add-participant')?.reset();
    renderEnrolList('enrol-class-list', []);
    document.getElementById('modal-add-participant').classList.remove('hidden');
  });

  panel.querySelectorAll('.btn-edit-participant').forEach(btn => {
    btn.addEventListener('click', () => openEditParticipant(btn.dataset.id));
  });
  panel.querySelectorAll('.btn-delete-participant').forEach(btn => {
    btn.addEventListener('click', () => deleteParticipant(btn.dataset.id));
  });
}

// Populates a checklist of template classes into a container div.
// checkedIds: array of classIds that should be pre-ticked (for edit modal)
function renderEnrolList(containerId, checkedIds = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const template = lsGet(LS.TEMPLATE_CLASSES, []);
  if (!template.length) {
    container.innerHTML = `<p style="font-size:0.8rem;color:var(--muted)">No classes in template yet. Add classes first.</p>`;
    return;
  }
  container.innerHTML = template.map(cls => `
    <label class="enrol-item">
      <input type="checkbox" name="enrol_class" value="${esc(cls.id)}"
        ${checkedIds.includes(cls.id) ? 'checked' : ''}>
      <span>${esc(cls.name)} — ${esc(cls.day)} ${esc(cls.time)}</span>
    </label>`).join('');
}

function addParticipant() {
  const form = document.getElementById('form-add-participant');
  const fd = new FormData(form);
  const sessTotal = fd.get('sessions_total') ? parseInt(fd.get('sessions_total')) : null;

  // Collect checked class IDs
  const checkedIds = Array.from(
    form.querySelectorAll('input[name="enrol_class"]:checked')
  ).map(cb => cb.value);

  if (!checkedIds.length) {
    alert('Please select at least one class to enrol this participant in.');
    return;
  }

  const newP = {
    id:                crypto.randomUUID(),
    name:              fd.get('name'),
    plan:              fd.get('plan'),
    rate:              parseInt(fd.get('rate') || '0'),
    sessions_total:    sessTotal,
    sessions_attended: 0,
    invoice_status:    'pending',
  };

  // Add to every ticked class
  checkedIds.forEach(classId => {
    const list = getClassParticipants(classId);
    list.push(newP);
    setClassParticipants(classId, list);
  });

  document.getElementById('modal-add-participant').classList.add('hidden');
  form.reset();
  if (state.data) renderAttendance();
}

function openEditParticipant(id) {
  // Find the participant — search current class first, then all classes
  let p = getClassParticipants(state.currentClassId).find(x => x.id === id);
  if (!p) {
    const map = lsGet(LS.PARTICIPANTS, {});
    for (const list of Object.values(map)) {
      p = list.find(x => x.id === id);
      if (p) break;
    }
  }
  if (!p) return;

  // Find all class IDs this participant is currently enrolled in
  const map = lsGet(LS.PARTICIPANTS, {});
  const enrolledIn = Object.entries(map)
    .filter(([, list]) => list.some(x => x.id === id))
    .map(([classId]) => classId);

  const form = document.getElementById('form-edit-participant');
  form.elements['id'].value                = p.id;
  form.elements['name'].value              = p.name;
  form.elements['plan'].value              = p.plan;
  form.elements['rate'].value              = p.rate || '';
  form.elements['sessions_total'].value    = p.sessions_total ?? '';
  form.elements['sessions_attended'].value = p.sessions_attended || 0;
  form.elements['invoice_status'].value    = p.invoice_status || 'pending';

  // Populate enrolment checklist with current classes pre-ticked
  renderEnrolList('edit-enrol-class-list', enrolledIn);

  document.getElementById('modal-edit-participant').classList.remove('hidden');
}

function saveEditParticipant() {
  const form = document.getElementById('form-edit-participant');
  const fd = new FormData(form);
  const id = fd.get('id');
  const sessTotal = fd.get('sessions_total') ? parseInt(fd.get('sessions_total')) : null;

  const updatedP = {
    id,
    name:              fd.get('name'),
    plan:              fd.get('plan'),
    rate:              parseInt(fd.get('rate') || '0'),
    sessions_total:    sessTotal,
    sessions_attended: parseInt(fd.get('sessions_attended') || '0'),
    invoice_status:    fd.get('invoice_status'),
  };

  // Collect newly checked class IDs
  const newEnrolment = Array.from(
    form.querySelectorAll('input[name="enrol_class"]:checked')
  ).map(cb => cb.value);

  // Update every template class: add/remove/update the participant
  const allTemplate = lsGet(LS.TEMPLATE_CLASSES, []);
  allTemplate.forEach(cls => {
    const list = getClassParticipants(cls.id);
    const idx = list.findIndex(p => p.id === id);
    if (newEnrolment.includes(cls.id)) {
      // Should be enrolled — add or update
      if (idx !== -1) list[idx] = { ...list[idx], ...updatedP };
      else list.push(updatedP);
      setClassParticipants(cls.id, list);
    } else {
      // Should not be enrolled — remove if present
      if (idx !== -1) {
        list.splice(idx, 1);
        setClassParticipants(cls.id, list);
      }
    }
  });

  document.getElementById('modal-edit-participant').classList.add('hidden');
  if (state.data) renderAttendance();
}

function deleteParticipant(id) {
  if (!confirm('Remove this participant?')) return;
  const classId = state.currentClassId;
  const participants = getClassParticipants(classId);
  setClassParticipants(classId, participants.filter(p => p.id !== id));
  if (state.data) renderAttendance();
}

function toggleAttendance(participantId, classId, dateStr) {
  const rec = lsGet(LS.ATTENDANCE, {});
  const key = `${classId}_${dateStr}_${participantId}`;
  rec[key] = !rec[key];
  lsSet(LS.ATTENDANCE, rec);
}

// Calculates the amount due for a participant based on their plan type and billing month.
// dropin   → rate × sessions actually attended in billing month
// monthly  → pro-rated: (attended / expected) × flat rate (min ₹0)
// event/trial → flat rate always
function calcAmount(participant, classId, billingYYYYMM) {
  const plan = participant.plan || '';
  const billing = billingYYYYMM || (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();

  if (plan === 'dropin') {
    const attended = countAttendedSessions(participant.id, classId, billing);
    return (participant.rate || 0) * attended;
  }

  if (plan === 'monthly') {
    const attended = countAttendedSessions(participant.id, classId, billing);
    const expected = countExpectedSessions(classId, billing);
    if (!expected) return participant.rate || 0; // avoid divide-by-zero; return full rate
    const proRated = Math.round(((participant.rate || 0) * attended) / expected);
    return proRated;
  }

  // event, trial: flat rate
  return participant.rate || 0;
}

function generateInvoices(participants, classId, billingYYYYMM) {
  const billing = billingYYYYMM || (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();

  const printArea = document.getElementById('invoice-print-area');
  const pending = participants.filter(p => p.invoice_status !== 'paid');

  if (!pending.length) {
    alert('No pending or draft invoices to generate.');
    return;
  }

  // Persist invoices to localStorage
  const savedInvoices = lsGet(LS.INVOICES, {});
  const [yr, mo] = billing.split('-').map(Number);
  const monthLabel = new Date(yr, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  pending.forEach((p, i) => {
    const enrolledIds = p._enrolledClassIds || [classId];
    let attended = 0, expected = 0;
    enrolledIds.forEach(cid => {
      attended += countAttendedSessions(p.id, cid, billing);
      if (p.plan === 'monthly') expected += countExpectedSessions(cid, billing);
    });
    let amount;
    if (p.plan === 'dropin') amount = (p.rate || 0) * attended;
    else if (p.plan === 'monthly') amount = expected > 0 ? Math.round(((p.rate || 0) * attended) / expected) : (p.rate || 0);
    else amount = p.rate || 0;
    const invId = `inv_${billing}_${p.id}`;
    savedInvoices[invId] = {
      id: invId,
      invoiceNumber: `SN-${String(Object.keys(savedInvoices).length + 1).padStart(3, '0')}`,
      participantId: p.id,
      participantName: p.name,
      enrolledClassIds: enrolledIds,
      billingMonth: billing,
      amount,
      sessionsAttended: attended,
      sessionsExpected: p.plan === 'monthly' ? expected : null,
      plan: p.plan,
      rate: p.rate,
      status: p.invoice_status,
      generatedAt: new Date().toISOString(),
    };
  });
  lsSet(LS.INVOICES, savedInvoices);

  printArea.innerHTML = pending.map((p, i) => {
    const enrolledIds = p._enrolledClassIds || [classId];
    let attended = 0, expected = 0;
    enrolledIds.forEach(cid => {
      attended += countAttendedSessions(p.id, cid, billing);
      if (p.plan === 'monthly') expected += countExpectedSessions(cid, billing);
    });
    let amount;
    if (p.plan === 'dropin') amount = (p.rate || 0) * attended;
    else if (p.plan === 'monthly') amount = expected > 0 ? Math.round(((p.rate || 0) * attended) / expected) : (p.rate || 0);
    else amount = p.rate || 0;
    const rateDetail = p.plan === 'dropin'
      ? `Drop-in · ₹${(p.rate || 0).toLocaleString('en-IN')} per session`
      : p.plan === 'monthly'
        ? `Monthly · ₹${(p.rate || 0).toLocaleString('en-IN')} (pro-rated ${attended}/${expected} sessions)`
        : `${esc(p.plan)} · flat rate`;
    return `
    <div class="invoice-card-print">
      <div class="invoice-print-header">
        <div>
          <div class="invoice-logo">🪷 Samavaya Niramaya</div>
          <div class="invoice-subtitle">समवाय निरामय · Holistic Wellness</div>
        </div>
        <div class="invoice-num">
          Invoice
          <strong>SN-${String(i + 1).padStart(3, '0')}</strong>
          <span>${new Date().toLocaleDateString('en-IN')}</span>
        </div>
      </div>
      <div class="invoice-row-print"><span>Participant</span><strong>${esc(p.name)}</strong></div>
      <div class="invoice-row-print"><span>Plan</span><span>${rateDetail}</span></div>
      <div class="invoice-row-print"><span>Billing Period</span><span>${monthLabel}</span></div>
      <div class="invoice-row-print"><span>Sessions Attended</span><span>${attended}</span></div>
      ${expected !== null ? `<div class="invoice-row-print"><span>Sessions Expected</span><span>${expected}</span></div>` : ''}
      ${p.sessions_total ? `<div class="invoice-row-print"><span>Total Sessions (Package)</span><span>${p.sessions_total}</span></div>` : ''}
      <div class="invoice-row-print invoice-total-row"><span>Amount Due</span><strong>₹${amount.toLocaleString('en-IN')}</strong></div>
      <div class="upi-placeholder">
        💳 Scan UPI QR to pay · samavayaniramaya@upi<br>
        <small>Please quote invoice SN-${String(i + 1).padStart(3, '0')} in payment reference</small>
      </div>
    </div>`;
  }).join('');

  printArea.classList.remove('hidden');
  setTimeout(() => {
    window.print();
    printArea.classList.add('hidden');
  }, 100);
}

// ═══════════════════════════════════════════════════════════
// TAB 3 — CLASS PLAN
// ═══════════════════════════════════════════════════════════
function renderClassPlan(planData) {
  const panel = document.getElementById('panel-plan');
  if (!planData) { panel.innerHTML = '<p>No class plan data available.</p>'; return; }

  const todayDay = todayName();

  // Week theme card
  const themeHtml = `
    <div class="theme-card">
      <div class="theme-label">🌼 This Week's Theme</div>
      <div class="theme-title">${esc(planData.week_theme)}</div>
      <div class="theme-ref"><em>${esc(planData.week_ref)}</em></div>
      <div class="theme-tags">
        <span class="theme-tag">🫁 ${esc(planData.pranayama)}</span>
        <span class="theme-tag">🔔 ${esc(planData.sound_frequency)}</span>
        <span class="theme-tag">💚 ${esc(planData.chakra)}</span>
      </div>
    </div>`;

  // Day grid (2-col)
  const dayGridHtml = (planData.days || []).map(d => {
    const isToday = d.day === todayDay;
    return `
      <div class="day-card${isToday ? ' day-card--today' : ''}">
        <div class="day-card-day">${isToday ? '📍 ' : ''}${esc(d.day)}</div>
        <div class="day-card-class">${esc(d.class)}</div>
        <div class="day-card-focus">${esc(d.focus)}</div>
        <div class="day-card-dur">${esc(d.duration)}</div>
      </div>`;
  }).join('');

  // Today's sequence
  const seq = planData.today_sequence || {};
  const warmupChips  = (seq.warmup || []).map(p => `<span class="sequence-chip sequence-chip--warm">${esc(p)}</span>`).join('');
  const mainChips    = (seq.main   || []).map(p => `<span class="sequence-chip">${esc(p)}</span>`).join('');
  const counterChips = (seq.counter|| []).map(p => `<span class="sequence-chip">${esc(p)}</span>`).join('');
  const pranChips    = (seq.pranayama || []).map(p => `<span class="sequence-chip sequence-chip--pranayama">${esc(p)}</span>`).join('');

  const sequenceHtml = `
    <div class="card card--green">
      <div class="card-title card-title--green">🧘 Today's Sequence — ${esc(todayDay)}</div>
      <div class="section-label" style="margin-top:6px">Warm-up</div>
      <div>${warmupChips}</div>
      <div class="section-label">Peak Poses</div>
      <div>${mainChips}</div>
      <div class="section-label">Counter Poses</div>
      <div>${counterChips}</div>
      <div class="section-label">Pranayama</div>
      <div>${pranChips}</div>
      <div class="section-label">Savasana</div>
      <div><span class="sequence-chip">${esc(seq.savasana_duration || '10 min')}</span></div>
    </div>`;

  // Sound layer card
  const soundHtml = `
    <div class="card card--bark">
      <div class="card-title card-title--bark">🔔 Sound Layer</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
        <span class="chip active">${esc(planData.sound_frequency)}</span>
        <span class="chip active">${esc(planData.chakra)}</span>
        <span class="chip active">${esc(planData.instrument)}</span>
        <span class="chip active">${esc(planData.sound_duration)}</span>
      </div>
    </div>`;

  panel.innerHTML = `
    <h2 style="color:var(--bark);margin-bottom:12px">Class Plan</h2>
    ${themeHtml}
    <div class="section-label">📅 This Week</div>
    <div class="week-grid">${dayGridHtml}</div>
    ${sequenceHtml}
    ${soundHtml}`;
}

// ═══════════════════════════════════════════════════════════
// TAB 4 — TIP OF THE DAY
// ═══════════════════════════════════════════════════════════
function renderTip(tipData) {
  const panel = document.getElementById('panel-tip');
  if (!tipData) { panel.innerHTML = '<p>No tip data available.</p>'; return; }

  const featured = tipData.featured_condition || CONDITION_KEYS[0];
  if (!state.activeCondition) state.activeCondition = featured;

  const conditions = tipData.conditions || {};

  // Hero
  const featuredLabel = conditions[featured]?.label || featured;
  const heroHtml = `
    <div class="hero-card">
      <div class="hero-label">🌿 Tip of the Day</div>
      <h2>Today's focus: ${esc(featuredLabel)}</h2>
      <p>Yoga, Ayurveda & Sattvic diet recommendations for your students and your own practice.</p>
    </div>`;

  // Condition chips
  const chipHtml = CONDITION_KEYS.map(key => {
    const cond = conditions[key];
    if (!cond) return '';
    const active = key === state.activeCondition ? ' active' : '';
    return `<button class="condition-chip${active}" data-condition="${esc(key)}">${esc(cond.label)}</button>`;
  }).join('');

  panel.innerHTML = `
    ${heroHtml}
    <div class="condition-chips" id="condition-chips">${chipHtml}</div>
    <div id="condition-cards"></div>`;

  renderConditionCards(conditions, state.activeCondition);

  panel.querySelectorAll('.condition-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeCondition = btn.dataset.condition;
      panel.querySelectorAll('.condition-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderConditionCards(conditions, state.activeCondition);
    });
  });
}

function renderConditionCards(conditions, key) {
  const cond = conditions[key];
  if (!cond) return;
  const container = document.getElementById('condition-cards');
  if (!container) return;

  const yoga = cond.yoga_rx || {};
  const ayur = cond.ayurveda_rx || {};
  const diet = cond.sattvic_diet || {};

  const yogaAsanas   = (yoga.asanas   || []).map(a => `<li>${esc(a)}</li>`).join('');
  const yogaCautions = (yoga.cautions || []).map(c => `<li>${esc(c)}</li>`).join('');
  const dietFavour   = (diet.favour   || []).map(f => `<li>${esc(f)}</li>`).join('');
  const dietAvoid    = (diet.avoid    || []).map(a => `<li>${esc(a)}</li>`).join('');

  container.innerHTML = `
    <div class="card card--saffron">
      <div class="card-title card-title--saffron">🧘 Yoga Rx</div>
      <ul class="rx-list">${yogaAsanas}</ul>
      ${yogaCautions ? `<ul class="caution-list">${yogaCautions}</ul>` : ''}
      <div style="display:flex;gap:10px;margin-top:8px">
        <span class="chip">${esc(yoga.duration || '')}</span>
        <span class="chip">${esc(yoga.frequency || '')}</span>
      </div>
    </div>

    <div class="card card--green">
      <div class="card-title card-title--green">🌿 Ayurvedic Rx</div>
      <ul class="rx-list">
        ${ayur.therapy ? `<li><strong>Therapy:</strong> ${esc(ayur.therapy)}</li>` : ''}
        ${ayur.herb    ? `<li><strong>Herbs:</strong> ${esc(ayur.herb)}</li>`    : ''}
        ${ayur.oil     ? `<li><strong>Oil:</strong> ${esc(ayur.oil)}</li>`       : ''}
      </ul>
      ${ayur.timing ? `<div class="recipe-box">⏰ ${esc(ayur.timing)}</div>` : ''}
    </div>

    <div class="card card--gold">
      <div class="card-title card-title--gold">🌾 Sattvic Diet</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <div class="section-label" style="margin-top:0;color:var(--moss)">✅ Favour</div>
          <ul class="rx-list">${dietFavour}</ul>
        </div>
        <div>
          <div class="section-label" style="margin-top:0;color:var(--red)">✗ Avoid</div>
          <ul class="rx-list">${dietAvoid}</ul>
        </div>
      </div>
      ${diet.recipe ? `<div class="recipe-box">🍲 ${esc(diet.recipe)}</div>` : ''}
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// TAB 5 — OPPORTUNITY
// ═══════════════════════════════════════════════════════════
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

function renderOpportunity(oppData) {
  const panel = document.getElementById('panel-opp');
  if (!oppData) { panel.innerHTML = '<p>No opportunity data available.</p>'; return; }

  // Hero with sparkline
  const heroHtml = `
    <div class="hero-card hero-card--dark">
      <div class="hero-label">📡 Market Radar</div>
      <h2>${esc(oppData.market_headline)}</h2>
      <div class="sparkline-wrap">
        <div class="sparkline-bars" id="sparkline-bars"></div>
        <div class="sparkline-label">Interest over 12 months ↑</div>
      </div>
    </div>`;

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

  // Venues (JSON + custom) with pipeline status + deep links
  const allVenues = [...(oppData.venues || []), ...state.customVenues];
  const venuePipeline = getVenuePipeline();
  const venuesHtml = allVenues.map(v => {
    const rawStage = venuePipeline[v.name];
    const stage = PIPELINE_STAGES.includes(rawStage) ? rawStage : 'spotted';
    const stageLabel = PIPELINE_LABELS[stage] || stage;
    const liQuery = encodeURIComponent(`${v.name} wellness`);
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

  // Differentiation
  const diffHtml = (oppData.differentiation || []).map(d => `
    <div class="diff-card">
      <div class="diff-tag">✨ ${esc(d.tag)}</div>
      <div class="diff-insight">${esc(d.insight)}</div>
    </div>`).join('');

  panel.innerHTML = `
    ${heroHtml}
    <div class="section-label">🔥 Trending Right Now</div>
    ${trendsHtml}
    <div class="section-header" style="margin-top:16px">
      <div class="section-label" style="margin-top:0">📍 Venues to Approach</div>
      <button class="btn-add" id="btn-open-add-venue">＋ Add</button>
    </div>
    ${venuesHtml}
    <div class="section-label" style="margin-top:16px">✨ Your Differentiation Edge</div>
    ${diffHtml}`;

  drawSparkline(oppData.trend_data || [], 'sparkline-bars');

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
      }).catch(() => {
        btn.textContent = '❌ Failed';
        setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
      });
    });
  });

  document.getElementById('btn-open-add-venue')?.addEventListener('click', () => {
    document.getElementById('modal-add-venue').classList.remove('hidden');
  });

  // Venue pipeline badge — tap to cycle stage
  panel.querySelectorAll('.venue-pipeline-badge').forEach(btn => {
    btn.addEventListener('click', () => {
      const venueName = btn.dataset.venue;
      const current = getVenuePipeline()[venueName] || 'spotted';
      setVenueStage(venueName, nextPipelineStage(current));
      renderOpportunity(oppData);
    });
  });
}

function drawSparkline(data, containerId) {
  const container = document.getElementById(containerId);
  if (!container || !data.length) return;
  const max = Math.max(...data);
  container.innerHTML = data.map(v => {
    const pct = Math.round((v / max) * 100);
    return `<div class="sparkline-bar" style="height:${pct}%"></div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
// TAB 6 — WISDOM
// ═══════════════════════════════════════════════════════════
function renderWisdom(wisdomData) {
  const panel = document.getElementById('panel-wisdom');
  if (!wisdomData) { panel.innerHTML = '<p>No wisdom data available.</p>'; return; }

  const favs = lsGet(LS.WISDOM_FAVS, []);

  // Source nav pills
  const navHtml = WISDOM_SOURCES.map(s => `
    <button class="source-pill${s.key === state.wisdomSource ? ' active' : ''}"
      data-source="${esc(s.key)}">${esc(s.label)}</button>`
  ).join('');

  const verses = wisdomData[state.wisdomSource] || [];
  const versesHtml = verses.map(v => {
    const isFav = favs.includes(v.ref);
    const commentaryHtml = (v.commentary || []).map(c => `
      <div class="commentary-block">
        <div class="commentary-teacher">${esc(c.teacher)}</div>
        <div class="commentary-text">${esc(c.text)}</div>
      </div>`).join('');

    return `
      <div class="card card--bark verse-card" data-ref="${esc(v.ref)}">
        <div class="verse-ref">${esc(state.wisdomSource.replace(/_/g,' '))} · ${esc(v.ref)}</div>
        <div class="verse-devanagari">${esc(v.devanagari)}</div>
        <div class="verse-transliteration">${esc(v.transliteration)}</div>
        <div class="verse-translation">"${esc(v.translation)}"</div>
        ${commentaryHtml}
        <button class="fav-btn${isFav ? ' active' : ''}" data-ref="${esc(v.ref)}">
          ${isFav ? '🔖 Saved' : '🔖 Save to Favourites'}
        </button>
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="section-header">
      <h2 style="color:var(--bark)">Wisdom</h2>
    </div>
    <div class="text-source-nav" id="source-nav">${navHtml}</div>
    <div id="verse-list">${versesHtml || '<p>No verses for this source yet.</p>'}</div>`;

  panel.querySelectorAll('.source-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      state.wisdomSource = btn.dataset.source;
      lsSet(LS.WISDOM_SOURCE, state.wisdomSource);
      renderWisdom(wisdomData);
    });
  });

  panel.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ref = btn.dataset.ref;
      const favs = lsGet(LS.WISDOM_FAVS, []);
      const idx = favs.indexOf(ref);
      if (idx > -1) favs.splice(idx, 1);
      else favs.push(ref);
      lsSet(LS.WISDOM_FAVS, favs);
      btn.classList.toggle('active');
      btn.textContent = favs.includes(ref) ? '🔖 Saved' : '🔖 Save to Favourites';
    });
  });
}

// ═══════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════
function setupModals() {
  // Close buttons
  const closeIds = [
    ['close-add-venue',        'modal-add-venue'],
    ['close-edit-class',       'modal-edit-class'],
    ['close-add-participant',  'modal-add-participant'],
    ['close-edit-participant', 'modal-edit-participant'],
    ['close-override',         'modal-override'],
    ['close-template-editor',  'modal-template-editor'],
    ['close-week-picker',      'modal-week-picker'],
  ];
  closeIds.forEach(([btnId, modalId]) => {
    document.getElementById(btnId)?.addEventListener('click', () => {
      document.getElementById(modalId)?.classList.add('hidden');
    });
  });

  // Dedicated close handler for add-class modal — must also clear the adhoc flag
  document.getElementById('close-add-class')?.addEventListener('click', () => {
    state._addingAdhocForWeek = null;
    document.getElementById('modal-add-class')?.classList.add('hidden');
  });

  // Close on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        if (overlay.id === 'modal-add-class') state._addingAdhocForWeek = null;
        overlay.classList.add('hidden');
      }
    });
  });

  // Override form
  document.getElementById('form-override')?.addEventListener('submit', e => {
    e.preventDefault();
    const fd      = new FormData(e.target);
    const classId = fd.get('classId');
    const weekKey = fd.get('weekKey');
    const cancel  = fd.get('cancel_this_week') === 'on';

    if (!cancel) {
      if (!fd.get('name')?.trim()) {
        const nameInput = e.target.elements['name'];
        nameInput.setCustomValidity('Please enter a class name');
        nameInput.reportValidity();
        nameInput.setCustomValidity('');
        return;
      }
    }

    if (cancel) {
      saveOverride(weekKey, classId, { action: 'cancelled' });
    } else {
      saveOverride(weekKey, classId, {
        action: 'override',
        name:   fd.get('name').trim(),
        time:   fd.get('time'),
        venue:  fd.get('venue') || 'TBD',
      });
    }
    document.getElementById('modal-override').classList.add('hidden');
    renderSchedule();
  });

  document.getElementById('cancel-override')?.addEventListener('click', () => {
    document.getElementById('modal-override').classList.add('hidden');
  });

  // Template editor — add recurring class button
  document.getElementById('btn-add-template-class')?.addEventListener('click', () => {
    state._addingAdhocForWeek = null; // null = adding to template
    document.getElementById('modal-add-class').classList.remove('hidden');
  });

  // Week picker navigation
  document.getElementById('btn-wp-prev-month')?.addEventListener('click', () => {
    if (!_wpMonth) return;
    _wpMonth.setMonth(_wpMonth.getMonth() - 1);
    renderWeekPicker();
  });
  document.getElementById('btn-wp-next-month')?.addEventListener('click', () => {
    if (!_wpMonth) return;
    _wpMonth.setMonth(_wpMonth.getMonth() + 1);
    renderWeekPicker();
  });
  document.getElementById('btn-wp-today')?.addEventListener('click', () => {
    state.selectedWeek = null;
    document.getElementById('modal-week-picker').classList.add('hidden');
    renderSchedule();
  });

  // Add Class form (supports both adhoc-for-week and adding to template)
  document.getElementById('form-add-class')?.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const newClass = {
      id:       crypto.randomUUID(),
      name:     fd.get('name'),
      type:     fd.get('type'),
      day:      fd.get('day'),
      time:     fd.get('time'),
      venue:    fd.get('venue') || 'TBD',
      capacity: parseInt(fd.get('capacity') || '10'),
      enrolled: 0,
      rate_type: fd.get('type') === 'dropin' ? 'dropin' : fd.get('type') === 'event' ? 'flat_event' : 'monthly',
      rate:     parseInt(fd.get('rate') || '0'),
    };

    if (state._addingAdhocForWeek) {
      addAdhocClass(state._addingAdhocForWeek, newClass);
      state._addingAdhocForWeek = null;
    } else {
      const tpl = lsGet(LS.TEMPLATE_CLASSES, []);
      tpl.push(newClass);
      lsSet(LS.TEMPLATE_CLASSES, tpl);
      state.templateClasses = tpl;
    }

    document.getElementById('modal-add-class').classList.add('hidden');
    document.getElementById('modal-template-editor').classList.add('hidden');
    e.target.reset();
    renderSchedule();
  });

  // Add Venue form
  document.getElementById('form-add-venue')?.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const newVenue = {
      icon:   '🏢',
      name:   fd.get('name'),
      city:   fd.get('city'),
      badge:  fd.get('badge'),
      note:   fd.get('note') || '',
      status: fd.get('status'),
    };
    state.customVenues.push(newVenue);
    lsSet(LS.VENUES, state.customVenues);
    document.getElementById('modal-add-venue').classList.add('hidden');
    e.target.reset();
    if (state.data) {
      renderOpportunity(state.data.sections.opportunity);
    }
  });

  // Edit Class form (works from both schedule view and template editor)
  document.getElementById('form-edit-class')?.addEventListener('submit', e => {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const id  = fd.get('id');
    const tpl = lsGet(LS.TEMPLATE_CLASSES, []);
    const idx = tpl.findIndex(c => c.id === id);
    if (idx !== -1) {
      tpl[idx] = {
        ...tpl[idx],
        name:     fd.get('name'),
        day:      fd.get('day'),
        time:     fd.get('time'),
        venue:    fd.get('venue') || 'TBD',
        type:     fd.get('type'),
        rate:     parseInt(fd.get('rate') || '0'),
        capacity: parseInt(fd.get('capacity') || '10'),
      };
      lsSet(LS.TEMPLATE_CLASSES, tpl);
      state.templateClasses = tpl;
    }
    document.getElementById('modal-edit-class').classList.add('hidden');
    if (!document.getElementById('modal-template-editor').classList.contains('hidden')) {
      renderTemplateEditor();
    }
    renderSchedule();
  });

  // Add Participant form
  document.getElementById('form-add-participant')?.addEventListener('submit', e => {
    e.preventDefault();
    addParticipant();
  });

  // Edit Participant form
  document.getElementById('form-edit-participant')?.addEventListener('submit', e => {
    e.preventDefault();
    saveEditParticipant();
  });
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION EVENTS
// ═══════════════════════════════════════════════════════════
function setupNav() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// ═══════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupModals();
  init();
});
