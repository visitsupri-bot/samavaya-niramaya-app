# Template Week Schedule — Design Spec
**Date:** 2026-07-30  
**App:** Samavaya Niramaya  
**Status:** Approved

---

## 1. Overview

Replace the current flat `customClasses` list (which acts as a single global schedule) with a **template + weekly overrides** model. The teacher defines a recurring base schedule once (the template). Each week starts from that template. One-off changes — edits, cancellations, extra classes — are stored as week-specific overrides and do not affect the template or any other week.

---

## 2. User Stories

| # | As a teacher I want to… | So that… |
|---|---|---|
| 1 | Define a recurring weekly schedule once | I don't re-enter the same classes every week |
| 2 | Navigate to any specific week | I can plan ahead or review past weeks |
| 3 | Override a class for a specific week | I can handle one-off changes without breaking the template |
| 4 | Cancel a class for a specific week | It shows as cancelled (not silently missing) |
| 5 | Add a one-off class to a specific week | I can handle extra sessions without polluting the template |
| 6 | Restore a cancelled or overridden class | I can revert a mistake easily |

---

## 3. Data Model

### 3.1 localStorage Keys

| Key | Purpose |
|---|---|
| `sn_template_classes` | The recurring base schedule (array of class objects) |
| `sn_week_overrides` | Week-specific overrides keyed by ISO week string (e.g. `"2026-W31"`) |
| `sn_custom_classes` | **Deprecated** — migrated to `sn_template_classes` on first load |

### 3.2 Template Class Object

```json
{
  "id": "cls_001",
  "name": "Morning Yoga Flow",
  "day": "Monday",
  "time": "07:00",
  "venue": "Zen Studio",
  "type": "monthly",
  "rate": 0,
  "enrolled": 0
}
```

Same shape as the existing class object. No week-specific fields.

### 3.3 Week Overrides Object

Stored under `sn_week_overrides` as a map keyed by ISO week string:

```json
{
  "2026-W31": {
    "cls_001": {
      "action": "override",
      "name": "Morning Yoga Flow (Outdoor)",
      "time": "08:00",
      "venue": "Park"
    },
    "cls_002": {
      "action": "cancelled"
    }
  },
  "2026-W31-adhoc": [
    {
      "id": "adhoc_1722300000000",
      "name": "Special Sound Bath",
      "day": "Wednesday",
      "time": "19:00",
      "venue": "Home Studio",
      "type": "dropin",
      "rate": 15
    }
  ]
}
```

**Override actions:**
- `"override"` — partial update merged over the template class (only changed fields stored)
- `"cancelled"` — class hidden from the week view with a strikethrough placeholder shown

**Ad-hoc classes** (one-off additions) are stored per week under `"<weekKey>-adhoc"` as an array of full class objects.

### 3.4 ISO Week Key

Format: `YYYY-Www` (e.g. `2026-W31`). Computed from the Monday of the selected week using the existing `today()` helper.

---

## 4. Migration

On first load after the update, if `sn_template_classes` is absent but `sn_custom_classes` exists, the app migrates automatically:

```
sn_template_classes ← sn_custom_classes
sn_week_overrides   ← {} (empty — start fresh)
sn_custom_classes   ← deleted (or left, ignored)
```

The user sees no interruption; their existing classes become the template.

---

## 5. UI Components

### 5.1 Schedule Tab — Week View

**Week navigation bar** (top of schedule panel):
- Back arrow `‹` / forward arrow `›` to step one week at a time
- Centre shows date range (e.g. `28 Jul – 3 Aug 2026`) and week number
- Tapping the date range opens the **Week Picker**
- A "Current week" badge shown when viewing the current week
- "Edit Template" button (top-right of panel, below nav bar)

**Class cards** — one per template class + one per ad-hoc class for the selected week:
- **Template class, no override:** shows `🔁 From template` label + orange **Override** button
- **Template class, overridden:** amber card border, shows `⚡ Overridden this week` label + **Remove override** button
- **Template class, cancelled:** greyed-out card, strikethrough name, `❌ Cancelled this week` label + **Restore** button
- **Ad-hoc class:** shows `➕ One-off` label + **Delete** button (removes only from this week)

**Override modal** (opens on tapping Override):
- Pre-filled form with current class values
- Fields: Name, Time, Venue
- Option: "Cancel this class this week" (sets action = `cancelled`)
- Save / Cancel buttons

**"＋ Add one-off class this week" button** at the bottom — opens existing add-class form, saves to the current week's ad-hoc list.

### 5.2 Template Editor (modal)

Opened via "✏️ Edit Template" button. Full-screen modal with:
- Header: "Recurring Weekly Schedule" + subtitle "Changes apply to all future weeks"
- List of all template classes grouped by day
- Per-class: **Edit** and **Remove** buttons
- **"＋ Add recurring class"** button at the bottom — opens existing add-class form, saves to template
- Close button (top-right)

Editing/removing a template class does **not** modify any existing week overrides.

### 5.3 Week Picker (calendar popup)

Opens as a bottom-sheet modal on tapping the week date range:
- Month/year header with `‹` / `›` month navigation
- 7-column calendar grid (Mon–Sun)
- Current week highlighted in green
- Selected week highlighted (all 7 days of the selected week highlighted)
- Past weeks shown in grey (still selectable — teacher may want to review)
- Tapping any date selects the full week (Mon–Sun) containing that date
- "Today" button to jump back to current week

---

## 6. Logic

### 6.1 Rendering a Week

```
function getWeekClasses(weekKey):
  templateClasses = lsGet('sn_template_classes', [])
  overrides       = lsGet('sn_week_overrides', {})[weekKey] || {}
  adhoc           = lsGet('sn_week_overrides', {})[weekKey + '-adhoc'] || []

  rendered = []
  for each cls in templateClasses:
    override = overrides[cls.id]
    if override.action == 'cancelled':
      rendered.push({ ...cls, _status: 'cancelled' })
    else if override.action == 'override':
      rendered.push({ ...cls, ...override, _status: 'overridden' })
    else:
      rendered.push({ ...cls, _status: 'template' })

  for each adhocCls in adhoc:
    rendered.push({ ...adhocCls, _status: 'adhoc' })

  return rendered grouped by day
```

### 6.2 Saving an Override

```
function saveOverride(weekKey, classId, overrideData):
  allOverrides = lsGet('sn_week_overrides', {})
  allOverrides[weekKey] = allOverrides[weekKey] || {}
  allOverrides[weekKey][classId] = overrideData
  lsSet('sn_week_overrides', allOverrides)
```

### 6.3 Removing an Override

```
function removeOverride(weekKey, classId):
  allOverrides = lsGet('sn_week_overrides', {})
  delete allOverrides[weekKey]?.[classId]
  lsSet('sn_week_overrides', allOverrides)
```

### 6.4 ISO Week Key Computation

```javascript
function isoWeekKey(date) {
  // Returns "YYYY-Www" for the week containing `date`
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // nearest Thursday
  const yearStart = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(((d - yearStart) / 86400000 - 3 + ((yearStart.getDay() + 6) % 7)) / 7) + 1;
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
```

---

## 7. Impact on Attendance Tab

The Attendance tab currently builds its class selector from `[...schedData.classes, ...state.customClasses]`. After this change it should use `getWeekClasses(currentWeekKey)` to show the correct classes (including overrides and ad-hocs) for the attendance date being recorded.

---

## 8. Out of Scope (v1)

- Cloud sync across devices (localStorage only)
- Bulk copy of one week's overrides to another
- Recurring exceptions (e.g. "cancel every first Monday of the month")
- Push notifications for upcoming classes

---

## 9. File Changes

All changes are confined to `app.js` and `style.css`. No new files required.

| File | Changes |
|---|---|
| `app.js` | Migration logic, new `sn_template_classes` / `sn_week_overrides` data layer, week navigation state, `getWeekClasses()`, `renderSchedule()` rewrite, override modal, template editor modal, week picker modal |
| `style.css` | Styles for week nav bar, override/cancelled/adhoc card variants, week picker calendar, template editor modal |

---

## 10. Success Criteria

- [ ] Existing `sn_custom_classes` migrates to `sn_template_classes` automatically on first load
- [ ] Schedule tab shows the correct week's classes (template + overrides + ad-hocs)
- [ ] Week navigation (arrows + picker) works correctly
- [ ] Overriding a class saves only to that week; template and other weeks unaffected
- [ ] Cancelling a class shows strikethrough placeholder with Restore option
- [ ] Template edits propagate to all weeks that have no override for that class
- [ ] Attendance tab class selector reflects the current week's resolved classes
