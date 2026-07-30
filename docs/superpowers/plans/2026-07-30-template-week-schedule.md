# Template Week Schedule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `customClasses` list with a template + weekly-overrides model so the teacher's recurring schedule repeats every week automatically, with explicit per-class per-week overrides.

**Architecture:** All logic lives in `app.js` (vanilla JS, no frameworks). Data is persisted in `localStorage` under two new keys: `sn_template_classes` (the recurring base schedule) and `sn_week_overrides` (a map of ISO-week → per-class override objects). On first load the existing `sn_custom_classes` data is migrated automatically. The schedule tab is rewritten to show a week-navigation bar, render the resolved class list for the selected week, and expose Override/Cancel/Restore actions per class. A template editor modal and a week-picker calendar modal are added. Styles for all new components are added to `style.css`.

**Tech Stack:** Vanilla HTML/CSS/JS, localStorage, no build step, no external libraries.

---

## File Map

| File | What changes |
|---|---|
| `app.js` | New LS keys, `isoWeekKey()`, migration in `seedLocalStorage()`, `getWeekClasses()`, `saveOverride()`, `removeOverride()`, `addAdhocClass()`, `deleteAdhocClass()`, rewritten `renderSchedule()`, new `renderWeekNav()`, new `openOverrideModal()`, new `openTemplateEditor()`, new `openWeekPicker()`, updated `setupModals()`, updated `renderAttendance()` |
| `style.css` | `.week-nav`, `.week-nav-btn`, `.week-nav-center`, `.class-status-*` card variants, `.override-modal`, `.template-editor`, `.week-picker`, `.wp-grid`, `.wp-cell` |
| `index.html` | Three new modal overlays: `modal-override`, `modal-template-editor`, `modal-week-picker` |

---

## Task 1: Add new localStorage keys and `isoWeekKey()` helper

**Files:**
- Modify: `app.js` lines 9–18 (the `LS` constant)
- Modify: `app.js` lines 58–82 (helpers section)

- [ ] **Step 1: Add `TEMPLATE_CLASSES` and `WEEK_OVERRIDES` to the `LS` constant**

  Find the `const LS = {` block (line 9) and replace it with:

  ```javascript
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
  ```

- [ ] **Step 2: Add `isoWeekKey()` and `weekRangeLabel()` helpers**

  After the `esc()` function (around line 82), add:

  ```javascript
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

  // Returns week number for display e.g. "31"
  function weekNumber(date) {
    return isoWeekKey(date).split('-W')[1];
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  cd /path/to/samavaya-niramaya-app
  git add app.js
  git commit -m "feat: add isoWeekKey, weekMonday, weekRangeLabel helpers and new LS keys"
  ```

---

## Task 2: Data layer — migration, getWeekClasses, saveOverride, removeOverride, addAdhocClass

**Files:**
- Modify: `app.js` — `seedLocalStorage()` function and new data functions after it

- [ ] **Step 1: Rewrite `seedLocalStorage()` to migrate `sn_custom_classes` → `sn_template_classes`**

  Replace the existing `seedLocalStorage` function (lines 107–120) with:

  ```javascript
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
  }
  ```

- [ ] **Step 2: Add `getWeekClasses(weekKey)` — resolves template + overrides for a week**

  Add after `seedLocalStorage`, before `fetchData`:

  ```javascript
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
  ```

- [ ] **Step 3: Add `saveOverride`, `removeOverride`, `addAdhocClass`, `deleteAdhocClass`**

  Add immediately after `getWeekClasses`:

  ```javascript
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
  ```

- [ ] **Step 4: Update `init()` to load template classes into state**

  In `init()` (around line 87), replace:
  ```javascript
  state.customClasses = lsGet(LS.CUSTOM_CLASSES, []);
  ```
  With:
  ```javascript
  state.templateClasses = lsGet(LS.TEMPLATE_CLASSES, []);
  ```

  Also add `templateClasses: []` to the `state` object (around line 37):
  ```javascript
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
  ```

- [ ] **Step 5: Update `fetchData()` to reload template classes after seeding**

  Replace this block in `fetchData()`:
  ```javascript
  if (state.data?.sections) {
    seedLocalStorage(state.data.sections);
    state.customClasses = lsGet(LS.CUSTOM_CLASSES, []);
  }
  ```
  With:
  ```javascript
  if (state.data?.sections) {
    seedLocalStorage(state.data.sections);
    state.templateClasses = lsGet(LS.TEMPLATE_CLASSES, []);
  }
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add app.js
  git commit -m "feat: add data layer — migration, getWeekClasses, saveOverride, addAdhocClass"
  ```

---

## Task 3: Rewrite `renderSchedule()` with week navigation

**Files:**
- Modify: `app.js` — the `renderSchedule` function (lines 200–261)

- [ ] **Step 1: Replace `renderSchedule()` entirely**

  Delete everything from `// ═══ TAB 1 — SCHEDULE` down to (but not including) `// ── Mini Calendar`) and replace with:

  ```javascript
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
      // Date label for this day
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
    html += `
      <button class="btn-add-adhoc" id="btn-open-add-adhoc">＋ Add one-off class this week</button>
    `;

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
      // Reuse existing add-class modal but flag as adhoc for this week
      state._addingAdhocForWeek = weekKey;
      document.getElementById('modal-add-class').classList.remove('hidden');
    });

    // Override / restore / remove-override buttons
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
  ```

- [ ] **Step 2: Update all callers of `renderSchedule`**

  The old signature was `renderSchedule(schedData)`. Search `app.js` for all calls:

  - In `renderAll()`: change `renderSchedule(s.schedule, s.participants)` → `renderSchedule()`
  - In `deleteClass()` (if it still exists): remove or update to `renderSchedule()`
  - In `setupModals()` edit-class submit handler: change to `renderSchedule()`

- [ ] **Step 3: Commit**

  ```bash
  git add app.js
  git commit -m "feat: rewrite renderSchedule with week nav, template/override/cancelled card variants"
  ```

---

## Task 4: Override modal

**Files:**
- Modify: `index.html` — add modal markup
- Modify: `app.js` — `openOverrideModal()` and wire in `setupModals()`

- [ ] **Step 1: Add override modal HTML to `index.html`**

  Before the closing `</body>` tag, add:

  ```html
  <!-- ── Override Modal ──────────────────────────────── -->
  <div class="modal-overlay hidden" id="modal-override">
    <div class="modal-sheet">
      <div class="modal-header">
        <h3>Override Class This Week</h3>
        <button class="modal-close" id="close-override">✕</button>
      </div>
      <form id="form-override">
        <input type="hidden" name="classId">
        <input type="hidden" name="weekKey">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Time</label>
            <input type="time" name="time" required>
          </div>
          <div class="form-group">
            <label>Venue</label>
            <input type="text" name="venue">
          </div>
        </div>
        <label class="checkbox-label">
          <input type="checkbox" name="cancel_this_week">
          Cancel this class this week
        </label>
        <div class="form-actions">
          <button type="button" class="btn-secondary" id="cancel-override">Cancel</button>
          <button type="submit" class="btn-primary">Save override</button>
        </div>
      </form>
    </div>
  </div>
  ```

- [ ] **Step 2: Add `openOverrideModal()` to `app.js`**

  After the `renderClassCard` function, add:

  ```javascript
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
  ```

- [ ] **Step 3: Wire the override form in `setupModals()`**

  In the `setupModals()` function, add to the `closeIds` array:
  ```javascript
  ['close-override', 'modal-override'],
  ```

  Then add the form submit handler:
  ```javascript
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
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add index.html app.js
  git commit -m "feat: add override modal — override and cancel-this-week actions"
  ```

---

## Task 5: Template editor modal

**Files:**
- Modify: `index.html` — add modal markup
- Modify: `app.js` — `openTemplateEditor()`, `renderTemplateEditor()`, template CRUD handlers

- [ ] **Step 1: Add template editor modal HTML to `index.html`**

  Before `</body>`, add:

  ```html
  <!-- ── Template Editor Modal ──────────────────────── -->
  <div class="modal-overlay hidden" id="modal-template-editor">
    <div class="modal-sheet modal-sheet--full">
      <div class="modal-header">
        <div>
          <h3>Recurring Weekly Schedule</h3>
          <p class="modal-subtitle">Changes apply to all future weeks</p>
        </div>
        <button class="modal-close" id="close-template-editor">✕</button>
      </div>
      <div id="template-editor-list"></div>
      <button class="btn-add-template" id="btn-add-template-class">＋ Add recurring class</button>
    </div>
  </div>
  ```

- [ ] **Step 2: Add `openTemplateEditor()` and `renderTemplateEditor()` to `app.js`**

  After `openOverrideModal`, add:

  ```javascript
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

    // Group by day
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
        // Reuse existing edit-class modal, flag as template edit
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
  ```

- [ ] **Step 3: Wire template editor close + "Add recurring class" button in `setupModals()`**

  Add to `closeIds`:
  ```javascript
  ['close-template-editor', 'modal-template-editor'],
  ```

  Add handler:
  ```javascript
  document.getElementById('btn-add-template-class')?.addEventListener('click', () => {
    state._addingAdhocForWeek = null; // null = adding to template
    document.getElementById('modal-add-class').classList.remove('hidden');
  });
  ```

- [ ] **Step 4: Update the add-class form submit handler to route to template or adhoc**

  In `setupModals()`, replace the existing `form-add-class` submit handler with:

  ```javascript
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
      // One-off: store in week overrides
      addAdhocClass(state._addingAdhocForWeek, newClass);
      state._addingAdhocForWeek = null;
    } else {
      // Recurring: add to template
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
  ```

- [ ] **Step 5: Update the edit-class form submit handler to save to template**

  Replace the existing `form-edit-class` submit handler with:

  ```javascript
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
    if (document.getElementById('modal-template-editor').classList.contains('hidden') === false) {
      renderTemplateEditor();
    }
    renderSchedule();
  });
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add index.html app.js
  git commit -m "feat: add template editor modal — view, edit, remove recurring classes"
  ```

---

## Task 6: Week picker modal

**Files:**
- Modify: `index.html` — add modal markup
- Modify: `app.js` — `openWeekPicker()`, `renderWeekPicker()`

- [ ] **Step 1: Add week picker modal HTML to `index.html`**

  Before `</body>`, add:

  ```html
  <!-- ── Week Picker Modal ────────────────────────────── -->
  <div class="modal-overlay hidden" id="modal-week-picker">
    <div class="modal-sheet modal-sheet--calendar">
      <div class="modal-header">
        <button class="week-nav-btn" id="btn-wp-prev-month">‹</button>
        <span id="wp-month-label" style="font-weight:700"></span>
        <button class="week-nav-btn" id="btn-wp-next-month">›</button>
        <button class="modal-close" id="close-week-picker">✕</button>
      </div>
      <div class="wp-grid-header">
        <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
      </div>
      <div id="wp-grid" class="wp-grid"></div>
      <div class="wp-footer">
        <button class="btn-secondary" id="btn-wp-today">Today</button>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 2: Add `openWeekPicker()` and `renderWeekPicker()` to `app.js`**

  After `renderTemplateEditor`, add:

  ```javascript
  // Picker state: which month is shown in the calendar
  let _wpMonth = null; // Date (first day of displayed month)

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

    const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
    // Shift so Mon=0
    const startOffset = (firstDow === 0) ? 6 : firstDow - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let html = '';
    // Leading blanks
    for (let i = 0; i < startOffset; i++) html += `<span class="wp-cell wp-cell--empty"></span>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const date    = new Date(year, month, d);
      const wKey    = isoWeekKey(date);
      const isToday = wKey === todayKey;
      const isSel   = wKey === selectedKey;
      let cls = 'wp-cell';
      if (isSel)   cls += ' wp-cell--selected';
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
  ```

- [ ] **Step 3: Wire week picker controls in `setupModals()`**

  Add to `closeIds`:
  ```javascript
  ['close-week-picker', 'modal-week-picker'],
  ```

  Add handlers:
  ```javascript
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
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add index.html app.js
  git commit -m "feat: add week picker calendar modal"
  ```

---

## Task 7: CSS — new styles for all new components

**Files:**
- Modify: `style.css` — append new rule blocks at the end

- [ ] **Step 1: Append styles to `style.css`**

  Add the following block at the very end of `style.css`:

  ```css
  /* ── Week Navigation Bar ─────────────────────────────── */
  .week-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cream);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 10px 14px;
    margin-bottom: 12px;
    gap: 8px;
  }

  .week-nav-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 36px;
    height: 36px;
    font-size: 1.2rem;
    cursor: pointer;
    color: var(--forest);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .week-nav-center {
    flex: 1;
    text-align: center;
    cursor: pointer;
  }

  .week-nav-label {
    font-weight: 700;
    font-size: 0.95rem;
    color: #2d1f0e;
  }

  .week-nav-sub {
    font-size: 0.75rem;
    color: var(--muted);
    margin-top: 2px;
  }

  .week-current-badge {
    color: var(--moss);
    font-weight: 600;
  }

  /* ── Schedule Toolbar ────────────────────────────────── */
  .schedule-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
  }

  .btn-edit-template {
    background: #e8f0e8;
    border: 1px solid #a0c0a0;
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 0.8rem;
    color: var(--forest);
    cursor: pointer;
    font-weight: 600;
  }

  /* ── Class card status variants ──────────────────────── */
  .class-row--overridden {
    background: #fff8f0;
    border-color: #ffb74d;
  }

  .class-row--cancelled {
    background: #f5f5f5;
    border: 1px dashed #bbb;
    opacity: 0.75;
  }

  .class-row--adhoc {
    background: #f0f7ff;
    border-color: #90caf9;
  }

  .class-status-label {
    font-size: 0.7rem;
    color: var(--muted);
  }

  /* ── Class action buttons ────────────────────────────── */
  .btn-class-action {
    flex-shrink: 0;
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 0.75rem;
    cursor: pointer;
    font-weight: 600;
    border: 1px solid;
  }

  .btn-override {
    background: #fff3e0;
    border-color: #ffb74d;
    color: #e65100;
  }

  .btn-restore {
    background: #e8f5e9;
    border-color: #a5d6a7;
    color: #2e7d32;
  }

  .btn-restore--remove {
    background: #fce4ec;
    border-color: #ef9a9a;
    color: #b71c1c;
  }

  .btn-delete-adhoc {
    background: #fce4ec;
    border-color: #ef9a9a;
    color: #b71c1c;
  }

  .btn-add-adhoc {
    width: 100%;
    background: #f0f7f0;
    border: 2px dashed #a0c0a0;
    border-radius: var(--radius-card);
    padding: 12px;
    font-size: 0.875rem;
    color: var(--moss);
    cursor: pointer;
    margin-top: 8px;
    font-weight: 600;
  }

  /* ── Template Editor Modal ───────────────────────────── */
  .modal-sheet--full {
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-subtitle {
    font-size: 0.75rem;
    color: var(--muted);
    margin-top: 2px;
  }

  .te-day-group { margin-bottom: 12px; }

  .te-day-label {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }

  .te-class-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 6px;
  }

  .te-class-name { font-weight: 600; font-size: 0.9rem; }
  .te-class-meta { font-size: 0.75rem; color: var(--muted); }

  .te-actions { display: flex; gap: 6px; }

  .btn-te-edit {
    background: #e8f0ff;
    border: 1px solid #90b0ff;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.75rem;
    cursor: pointer;
    color: #1a3a9a;
  }

  .btn-te-remove {
    background: #fce4ec;
    border: 1px solid #ef9a9a;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.75rem;
    cursor: pointer;
    color: #b71c1c;
  }

  .btn-add-template {
    width: 100%;
    background: #f0f7f0;
    border: 2px dashed #a0c0a0;
    border-radius: var(--radius-card);
    padding: 12px;
    font-size: 0.875rem;
    color: var(--moss);
    cursor: pointer;
    margin-top: 8px;
    font-weight: 600;
  }

  /* ── Week Picker Calendar ────────────────────────────── */
  .modal-sheet--calendar {
    max-width: 340px;
  }

  .wp-grid-header {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    text-align: center;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--muted);
    margin-bottom: 4px;
    padding: 0 4px;
  }

  .wp-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    padding: 0 4px;
  }

  .wp-cell {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    font-size: 0.85rem;
    cursor: pointer;
    color: #2d1f0e;
  }

  .wp-cell:hover { background: #e8f5e8; }
  .wp-cell--empty { cursor: default; }
  .wp-cell--empty:hover { background: none; }

  .wp-cell--today {
    background: #e8f5e8;
    color: var(--forest);
    font-weight: 700;
  }

  .wp-cell--selected {
    background: var(--forest);
    color: var(--cream);
    font-weight: 700;
  }

  .wp-footer {
    display: flex;
    justify-content: center;
    padding-top: 12px;
  }

  /* ── Override Modal extras ───────────────────────────── */
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
    margin: 12px 0;
    cursor: pointer;
    color: var(--bark);
    font-weight: 600;
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add style.css
  git commit -m "feat: add CSS for week nav, class card variants, override/template/week-picker modals"
  ```

---

## Task 8: Update Attendance tab class selector

**Files:**
- Modify: `app.js` — `renderAttendance()` function

- [ ] **Step 1: Update class source in `renderAttendance()`**

  In `renderAttendance()` (around line 349), replace:
  ```javascript
  const allClasses = [...(schedData?.classes || []), ...state.customClasses];
  ```
  With:
  ```javascript
  // Use the resolved classes for the currently viewed week (or today if no week selected)
  const attendWeekKey = isoWeekKey(state.selectedWeek || new Date());
  const allClasses = getWeekClasses(attendWeekKey);
  ```

  Also update the `renderAttendance` call signature in `renderAll()`. Change:
  ```javascript
  renderAttendance(s.schedule, s.participants);
  ```
  To:
  ```javascript
  renderAttendance(s.participants);
  ```

  And update the function signature from `renderAttendance(schedData, participantsData)` to `renderAttendance(participantsData)`.

- [ ] **Step 2: Commit**

  ```bash
  git add app.js
  git commit -m "feat: attendance tab now uses resolved week classes including overrides and adhoc"
  ```

---

## Task 9: Smoke test — verify in browser

- [ ] **Step 1: Open the app**

  Open `index.html` in a browser (or serve via `python3 -m http.server 8080` and visit `http://localhost:8080`).

- [ ] **Step 2: Verify migration**

  - Open DevTools → Application → localStorage
  - Confirm `sn_template_classes` exists and contains the previously seeded classes
  - Confirm `sn_week_overrides` is `{}`

- [ ] **Step 3: Verify week navigation**

  - Schedule tab shows current week with date range header
  - Pressing `‹` moves back one week; `›` moves forward
  - Tapping the date range opens the week picker calendar
  - Clicking a date in the picker navigates to that week and closes the picker
  - "Today" button in picker resets to current week

- [ ] **Step 4: Verify class card states**

  - All classes show `🔁 From template` label and orange **Override** button
  - Tapping Override opens the override modal pre-filled with class details
  - Saving an override changes the card to amber with `⚡ Overridden this week` and a **Remove override** button
  - Checking "Cancel this class this week" and saving shows the class as struck-through with `❌ Cancelled this week` and a **Restore** button
  - Tapping Restore removes the override and card returns to template state

- [ ] **Step 5: Verify template editor**

  - Tapping "✏️ Edit Template" opens the template editor modal
  - Editing a class name in the template editor and saving updates all weeks with no override for that class
  - Removing a class from the template removes it from the schedule view (for weeks with no override)
  - "＋ Add recurring class" adds a class to the template, visible every week

- [ ] **Step 6: Verify one-off classes**

  - "＋ Add one-off class this week" opens the add-class form
  - Adding a class creates it only for the current week (not visible on other weeks)
  - Delete button removes the one-off from that week only

- [ ] **Step 7: Verify Attendance tab**

  - Attendance class selector shows the same classes as the schedule for the current week
  - If a class is cancelled this week, it should not appear in the attendance selector

- [ ] **Step 8: Final commit**

  ```bash
  git add .
  git commit -m "feat: complete template week schedule feature"
  ```

---

## Success Criteria Checklist

- [ ] Existing `sn_custom_classes` migrates to `sn_template_classes` automatically on first load
- [ ] Schedule tab shows the correct week's classes (template + overrides + ad-hocs)
- [ ] Week navigation (arrows + picker) works correctly
- [ ] Overriding a class saves only to that week; template and other weeks unaffected
- [ ] Cancelling a class shows strikethrough placeholder with Restore option
- [ ] Template edits propagate to all weeks that have no override for that class
- [ ] Attendance tab class selector reflects the current week's resolved classes
