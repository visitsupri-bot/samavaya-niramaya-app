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
};

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

  // Fetch data
  await fetchData();
}

// ── localStorage Seeding ──────────────────────────────────
function seedLocalStorage(sections) {
  // Seed participants only on first load
  if (!localStorage.getItem(LS.PARTICIPANTS) && sections.participants) {
    lsSet(LS.PARTICIPANTS, sections.participants);
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
}

// ── Week Data Layer ───────────────────────────────────────

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
    return { ...cls, ...ov, action: undefined, _status: 'overridden' };
  });

  adhoc.forEach(cls => resolved.push({ ...cls, _status: 'adhoc' }));
  return resolved;
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

  // 4-URL fallback chain
  const urls = [
    `${GCS_BASE}/${dateStr}.json`,          // 1. GCS dated
    `${GCS_BASE}/latest.json`,              // 2. GCS latest
    `./sample-data/${dateStr}.json`,        // 3. Local dated
    `./sample-data/latest.json`,            // 4. Local latest
  ];

  let loaded = false;
  for (const url of urls) {
    try {
      const res = await fetch(url);
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
      html += renderClassCard(cls, weekKey);
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

function renderClassCard(cls, weekKey) {
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

  const nameStyle = cls._status === 'cancelled' ? ' style="text-decoration:line-through;color:var(--muted)"' : '';

  return `
    <div class="class-row${statusClass}${isEvent ? ' class-row--event' : ''}">
      <span class="class-dot dot--${esc(cls.type)}"></span>
      <div class="class-info">
        <div class="class-name"${nameStyle}>${esc(cls.name)}</div>
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

function deleteClass(id) {
  if (!confirm('Delete this class?')) return;
  state.templateClasses = state.templateClasses.filter(c => c.id !== id);
  lsSet(LS.TEMPLATE_CLASSES, state.templateClasses);
  if (state.data) renderSchedule();
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
      state._editingTemplateClassId = cls.id;
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
  const participants = lsGet(LS.PARTICIPANTS, participantsData || []);
  const attendWeekKey = isoWeekKey(state.selectedWeek || new Date());
  const allClasses = getWeekClasses(attendWeekKey).filter(c => c._status !== 'cancelled');
  const todayStr = today();
  const attendanceRecord = lsGet(LS.ATTENDANCE, {});

  // Class selector options
  const classOptions = allClasses.map(c =>
    `<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.day)} ${esc(c.time)}</option>`
  ).join('');

  const currentId = state.currentClassId || (allClasses[0]?.id ?? '');

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

  // Invoice list
  const invoices = lsGet(LS.INVOICES, participants);
  let invoiceRows = invoices.map(p => `
    <div class="invoice-row">
      <div>
        <div class="invoice-name">${esc(p.name)}</div>
        <div class="invoice-plan">${esc(p.plan)} · ${p.sessions_attended} sessions</div>
      </div>
      <span class="invoice-amount">₹${(p.rate || 0).toLocaleString('en-IN')}</span>
      <span class="badge badge--${esc(p.invoice_status)}">${esc(p.invoice_status)}</span>
    </div>`).join('');

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

    <div class="section-label">💳 Invoices</div>
    <div id="invoice-list">${invoiceRows}</div>
    <button class="btn-generate" id="btn-generate-invoices">📄 Generate All Pending Invoices</button>
  `;

  // Listeners
  document.getElementById('class-select')?.addEventListener('change', e => {
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

  document.getElementById('btn-generate-invoices')?.addEventListener('click', () => {
    generateInvoices(invoices);
  });

  document.getElementById('btn-open-add-participant')?.addEventListener('click', () => {
    document.getElementById('form-add-participant')?.reset();
    document.getElementById('modal-add-participant').classList.remove('hidden');
  });

  panel.querySelectorAll('.btn-edit-participant').forEach(btn => {
    btn.addEventListener('click', () => openEditParticipant(btn.dataset.id));
  });
  panel.querySelectorAll('.btn-delete-participant').forEach(btn => {
    btn.addEventListener('click', () => deleteParticipant(btn.dataset.id));
  });
}

function addParticipant() {
  const form = document.getElementById('form-add-participant');
  const fd = new FormData(form);
  const sessTotal = fd.get('sessions_total') ? parseInt(fd.get('sessions_total')) : null;
  const newP = {
    id:               `par_custom_${Date.now()}`,
    name:             fd.get('name'),
    plan:             fd.get('plan'),
    rate:             parseInt(fd.get('rate') || '0'),
    sessions_total:   sessTotal,
    sessions_attended: 0,
    invoice_status:   'pending',
  };
  const participants = lsGet(LS.PARTICIPANTS, []);
  participants.push(newP);
  lsSet(LS.PARTICIPANTS, participants);
  document.getElementById('modal-add-participant').classList.add('hidden');
  form.reset();
  if (state.data) renderAttendance();
}

function openEditParticipant(id) {
  const participants = lsGet(LS.PARTICIPANTS, []);
  const p = participants.find(x => x.id === id);
  if (!p) return;
  const form = document.getElementById('form-edit-participant');
  form.elements['id'].value                = p.id;
  form.elements['name'].value              = p.name;
  form.elements['plan'].value              = p.plan;
  form.elements['rate'].value              = p.rate || '';
  form.elements['sessions_total'].value    = p.sessions_total ?? '';
  form.elements['sessions_attended'].value = p.sessions_attended || 0;
  form.elements['invoice_status'].value    = p.invoice_status || 'pending';
  document.getElementById('modal-edit-participant').classList.remove('hidden');
}

function saveEditParticipant() {
  const form = document.getElementById('form-edit-participant');
  const fd = new FormData(form);
  const id = fd.get('id');
  const participants = lsGet(LS.PARTICIPANTS, []);
  const idx = participants.findIndex(p => p.id === id);
  if (idx === -1) return;
  const sessTotal = fd.get('sessions_total') ? parseInt(fd.get('sessions_total')) : null;
  participants[idx] = {
    ...participants[idx],
    name:              fd.get('name'),
    plan:              fd.get('plan'),
    rate:              parseInt(fd.get('rate') || '0'),
    sessions_total:    sessTotal,
    sessions_attended: parseInt(fd.get('sessions_attended') || '0'),
    invoice_status:    fd.get('invoice_status'),
  };
  lsSet(LS.PARTICIPANTS, participants);
  document.getElementById('modal-edit-participant').classList.add('hidden');
  if (state.data) renderAttendance();
}

function deleteParticipant(id) {
  if (!confirm('Remove this participant?')) return;
  const participants = lsGet(LS.PARTICIPANTS, []);
  lsSet(LS.PARTICIPANTS, participants.filter(p => p.id !== id));
  if (state.data) renderAttendance();
}

function toggleAttendance(participantId, classId, dateStr) {
  const rec = lsGet(LS.ATTENDANCE, {});
  const key = `${classId}_${dateStr}_${participantId}`;
  rec[key] = !rec[key];
  lsSet(LS.ATTENDANCE, rec);
}

function generateInvoices(participants) {
  const printArea = document.getElementById('invoice-print-area');
  const pending = participants.filter(p => p.invoice_status !== 'paid');

  if (!pending.length) {
    alert('No pending or draft invoices to generate.');
    return;
  }

  printArea.innerHTML = pending.map((p, i) => `
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
      <div class="invoice-row-print"><span>Plan</span><span>${esc(p.plan)} package</span></div>
      <div class="invoice-row-print"><span>Sessions Attended</span><span>${p.sessions_attended}</span></div>
      ${p.sessions_total ? `<div class="invoice-row-print"><span>Total Sessions</span><span>${p.sessions_total}</span></div>` : ''}
      <div class="invoice-row-print invoice-total-row"><span>Amount Due</span><strong>₹${(p.rate || 0).toLocaleString('en-IN')}</strong></div>
      <div class="upi-placeholder">
        💳 Scan UPI QR to pay · samavayaniramaya@upi<br>
        <small>Please quote invoice SN-${String(i + 1).padStart(3, '0')} in payment reference</small>
      </div>
    </div>`).join('');

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

  document.getElementById('btn-open-add-venue')?.addEventListener('click', () => {
    document.getElementById('modal-add-venue').classList.remove('hidden');
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
    ['close-add-class',        'modal-add-class'],
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

  // Close on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // Override form
  document.getElementById('form-override')?.addEventListener('submit', e => {
    e.preventDefault();
    const fd      = new FormData(e.target);
    const classId = fd.get('classId');
    const weekKey = fd.get('weekKey');
    const cancel  = fd.get('cancel_this_week') === 'on';

    if (cancel) {
      saveOverride(weekKey, classId, { action: 'cancelled' });
    } else {
      saveOverride(weekKey, classId, {
        action: 'override',
        name:   fd.get('name'),
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
    _wpMonth.setMonth(_wpMonth.getMonth() - 1);
    renderWeekPicker();
  });
  document.getElementById('btn-wp-next-month')?.addEventListener('click', () => {
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
      id:       `cls_${Date.now()}`,
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
    state._editingTemplateClassId = null;
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
