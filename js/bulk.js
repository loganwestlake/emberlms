// Ember bulk tools: update student information for many students at once (busing, homeroom, grade,
// meal status, graduation checks, test scores, health screenings…) and the Bus routes overview.
import {
  doc, getDoc, setDoc, addDoc, updateDoc, collection, getDocs, writeBatch, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
const {
  db, $, $$, ico, refreshIcons, escapeHtml, plural, displayNameOf, toDateInput, render, setTitle, showError, iconTile, badge, avatar,
  skeletonRows, emptyState, errorBox, toast, withBusy, confirmDialog, buildUrl, navigate, live, pageHeader, tenantPage, routeTokenNow, friendlyError
} = globalThis.__ember;
const BUILD = new URL(import.meta.url).search;
const forms = () => import('./staff.js' + BUILD);
const sis = () => import('./sis.js' + BUILD);

const todayISO = () => toDateInput(new Date());
const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const gradeLabel = g => g === undefined || g === null || g === '' ? '—' : g === 'K' ? 'K' : `Gr ${g}`;
const fmtHM = hm => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const TRANSPORT = ['Bus rider', 'Car rider', 'Walker', 'Bike rider', 'Daycare / van', 'Student driver', 'After-school program'];
const TESTS = ['FAST ELA Reading', 'FAST Mathematics', 'B.E.S.T. Writing', 'Statewide Science (SSA)', 'Algebra 1 EOC', 'Geometry EOC', 'Biology 1 EOC', 'U.S. History EOC', 'Civics EOC', 'PSAT 8/9', 'PSAT/NMSQT', 'SAT', 'ACT', 'CLT', 'AP Exam', 'PERT', 'ASVAB', 'WIDA ACCESS', 'i-Ready Reading', 'i-Ready Math', 'Industry certification', 'Other'];
const LEVELS = ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Passed', 'Not passed', 'Concordant score met', 'AP 1', 'AP 2', 'AP 3', 'AP 4', 'AP 5', 'Certified', 'Not certified'];

async function loadStudents(ctx) {
  const snap = await getDocs(collection(db, 'tenants', ctx.slug, 'students'));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(s => s.status !== 'pending' && s.status !== 'rejected').sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
}
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

// ═══════════════════════════════════════════════════════════════
// WHAT CAN BE UPDATED IN BULK
// Each group: fields for "same value for everyone", optional table columns for per-student editing,
// and apply(student, values) → { students: patch } | { health } | { testScore } | { activity }.
// Blank values in "same for everyone" mode leave that field unchanged.
// ═══════════════════════════════════════════════════════════════
const GROUPS = [
  { key: 'bus', label: 'Busing', icon: 'bus', cap: 'records', blurb: 'Assign a bus, route, stop and times.',
    fields: [
      { id: 'transport', type: 'select', label: 'Transportation', options: TRANSPORT },
      { id: 'legs', type: 'chips', label: 'Which trips', required: true, options: ['Morning and afternoon', 'Morning only', 'Afternoon only'] },
      { id: 'bus', type: 'text', label: 'Bus #', placeholder: 'e.g. 42' }, { id: 'route', type: 'text', label: 'Route' },
      { id: 'stop', type: 'text', label: 'Stop', span: 'sm:col-span-2', hint: 'Leave blank to keep each student’s current stop.' },
      { id: 'amTime', type: 'time', label: 'Morning pick-up' }, { id: 'pmTime', type: 'time', label: 'Afternoon drop-off' },
      { id: 'driver', type: 'text', label: 'Driver' }, { id: 'phone', type: 'phone', label: 'Transportation office phone' },
    ],
    defaults: { legs: 'Morning and afternoon', transport: 'Bus rider' },
    columns: [['bus.transport', 'Transportation', 'select', TRANSPORT], ['bus.am.bus', 'AM bus', 'text'], ['bus.am.stop', 'AM stop', 'text'], ['bus.am.time', 'AM time', 'time'], ['bus.pm.bus', 'PM bus', 'text'], ['bus.pm.stop', 'PM stop', 'text'], ['bus.pm.time', 'PM time', 'time']],
    apply: (s, v) => {
      const p = {}, am = v.legs !== 'Afternoon only', pm = v.legs !== 'Morning only';
      if (v.transport) p['bus.transport'] = v.transport;
      for (const [leg, on] of [['am', am], ['pm', pm]]) {
        if (!on) continue;
        if (v.bus) p[`bus.${leg}.bus`] = v.bus; if (v.route) p[`bus.${leg}.route`] = v.route; if (v.stop) p[`bus.${leg}.stop`] = v.stop;
      }
      if (am && v.amTime) p['bus.am.time'] = v.amTime; if (pm && v.pmTime) p['bus.pm.time'] = v.pmTime;
      if (v.driver) p['bus.driver'] = v.driver; if (v.phone) p['bus.phone'] = v.phone;
      return { students: p };
    } },
  { key: 'homeroom', label: 'Homeroom & counselor', icon: 'door-open', cap: 'records', blurb: 'Homeroom/advisory, counselor and locker.',
    fields: [{ id: 'homeroom', type: 'text', label: 'Homeroom / advisory' }, { id: 'counselor', type: 'text', label: 'Counselor' }],
    columns: [['homeroom', 'Homeroom', 'text'], ['counselor', 'Counselor', 'text'], ['locker', 'Locker', 'text']],
    apply: (s, v) => ({ students: Object.fromEntries(Object.entries(v).filter(([, x]) => x)) }) },
  { key: 'grade', label: 'Grade level', icon: 'graduation-cap', cap: 'records', blurb: 'Set a grade or promote everyone one grade.',
    fields: [{ id: 'action', type: 'radio', label: 'Change', required: true, cols: 1, options: ['Promote to the next grade', 'Set a specific grade'] }, { id: 'gradeLevel', type: 'select', label: 'Grade', required: true, options: GRADES, showIf: { id: 'action', eq: 'Set a specific grade' } }],
    defaults: { action: 'Promote to the next grade' },
    columns: [['gradeLevel', 'Grade', 'select', GRADES]],
    apply: (s, v) => { if (v.action === 'Set a specific grade') return { students: { gradeLevel: v.gradeLevel } }; const i = GRADES.indexOf(String(s.gradeLevel)); return i < 0 || i === GRADES.length - 1 ? null : { students: { gradeLevel: GRADES[i + 1] } }; } },
  { key: 'meal', label: 'Meal status', icon: 'utensils', cap: 'records', blurb: 'Paid, reduced, free or universal.',
    fields: [{ id: 'lunch', type: 'select', label: 'Meal status', required: true, options: ['Paid', 'Reduced', 'Free', 'Universal / CEP'] }],
    columns: [['lunch', 'Meal status', 'select', ['Paid', 'Reduced', 'Free', 'Universal / CEP']]],
    apply: (s, v) => ({ students: { lunch: v.lunch } }) },
  { key: 'gradcheck', label: 'Graduation requirement', icon: 'list-checks', cap: 'records', blurb: 'Mark a requirement as met (e.g. online course).',
    fields: [{ id: 'check', type: 'select', label: 'Requirement', required: true, options: [] }, { id: 'met', type: 'chips', label: 'Status', required: true, options: ['Met', 'Not met'] }],
    defaults: { met: 'Met' },
    apply: (s, v) => ({ students: { [`gradChecks.${v.check}`]: v.met === 'Met' } }) },
  { key: 'test', label: 'Test scores', icon: 'chart-column', cap: 'records', blurb: 'Enter one test for a whole group, score by score.', tableOnly: true,
    fields: [{ id: 'test', type: 'select', label: 'Test', required: true, options: TESTS }, { id: 'subject', type: 'text', label: 'Subject / part' }, { id: 'date', type: 'date', label: 'Date taken', required: true, maxToday: true }],
    defaults: { date: todayISO() },
    columns: [['score', 'Score', 'text'], ['level', 'Result / level', 'select', LEVELS], ['percentile', 'Percentile', 'number']],
    blankColumns: true,
    apply: (s, v, row) => row && (row.score || row.level) ? { testScore: { test: v.test, subject: v.subject || '', date: v.date, score: row.score || '', level: row.level || '', percentile: row.percentile || '', gradeAtTest: s.gradeLevel ?? '' } } : null },
  { key: 'screening', label: 'Health screening', icon: 'eye', cap: 'health', blurb: 'Record vision, hearing or other screenings.',
    fields: [{ id: 'name', type: 'select', label: 'Screening', required: true, options: ['Vision', 'Hearing', 'Scoliosis', 'Dental', 'BMI', 'Physical (sports)'] }, { id: 'date', type: 'date', label: 'Date', required: true, maxToday: true }, { id: 'result', type: 'select', label: 'Result (for everyone)', options: ['Passed', 'Referred for follow-up', 'Follow-up completed', 'Cleared'] }],
    defaults: { date: todayISO(), result: 'Passed' }, keepInTable: ['name', 'date'],
    columns: [['result', 'Result', 'select', ['Passed', 'Referred for follow-up', 'Follow-up completed', 'Cleared']], ['notes', 'Notes', 'text']],
    blankColumns: true,
    apply: (s, v, row) => ({ screening: { name: v.name, date: v.date, result: row?.result || v.result || '', notes: row?.notes || '' } }) },
  { key: 'immunization', label: 'Immunization status', icon: 'syringe', cap: 'health', blurb: 'Complete, incomplete or exempt.',
    fields: [{ id: 'immStatus', type: 'select', label: 'Immunization status', required: true, options: ['Complete', 'Incomplete', 'Temporary exemption', 'Religious exemption', 'Medical exemption'] }],
    columns: [['immStatus', 'Status', 'select', ['Complete', 'Incomplete', 'Temporary exemption', 'Religious exemption', 'Medical exemption']]],
    apply: (s, v) => ({ health: { immStatus: v.immStatus } }) },
  { key: 'activity', label: 'Activity / club', icon: 'trophy', cap: 'admin', blurb: 'Add students to a club or team roster.',
    fields: [{ id: 'activity', type: 'select', label: 'Activity', required: true, options: [] }],
    apply: (s, v) => ({ activity: v.activity }) },
];

// ═══════════════════════════════════════════════════════════════
// BULK PAGE
// ═══════════════════════════════════════════════════════════════
export async function viewBulk(ctx) {
  const t = routeTokenNow();
  setTitle('Bulk student updates', ctx.tenant.name);
  const allowed = GROUPS.filter(g => g.cap === 'admin' ? ctx.isAdmin : ctx.can(g.cap));
  const params = new URLSearchParams(location.search);
  let group = allowed.find(g => g.key === params.get('group')) || allowed[0];
  let mode = group.tableOnly ? 'table' : 'same';
  let students = [], selected = new Set(), filters = { q: '', grade: '', homeroom: '', bus: params.get('bus') ? '__bus:' + params.get('bus') : '', transport: '' };
  let preset = params.get('bus') ? { bus: params.get('bus') } : {};
  let lastUndo = null, settings = null, activities = [];
  render(tenantPage(ctx, 'sis-bulk', pageHeader({ eyebrow: 'People', title: 'Bulk student updates', subtitle: 'Pick what to change, set the value, choose the students, and apply — no clicking through records one by one.' }) + `
    <div class="max-w-6xl space-y-6">
      <section><h2 class="label">1 · What do you want to update?</h2><div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" id="bk-groups">${allowed.map(g => `<button type="button" data-group="${g.key}" class="bk-group card p-4 text-left flex items-start gap-3">${iconTile(g.icon, 'amber')}<span class="min-w-0"><span class="block text-sm text-white">${escapeHtml(g.label)}</span><span class="block text-xs text-gray-500 mt-0.5">${escapeHtml(g.blurb)}</span></span></button>`).join('')}</div></section>
      <section class="card p-5 sm:p-6"><div class="flex flex-wrap items-center justify-between gap-3 mb-4"><h2 class="text-white font-medium">2 · Set the value</h2><div id="bk-mode"></div></div><form id="bk-form" novalidate></form></section>
      <section class="card overflow-hidden"><div class="p-5 sm:p-6 border-b border-white/[0.06]"><div class="flex flex-wrap items-center justify-between gap-3 mb-4"><h2 class="text-white font-medium">3 · Choose students</h2><span id="bk-count" class="text-sm text-gray-400"></span></div><div id="bk-filters" class="flex flex-wrap items-center gap-2"></div></div><div id="bk-list">${skeletonRows(6)}</div></section>
      <div class="sticky bottom-0 z-10 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 bg-[#0A0A0A]/90 backdrop-blur flex flex-wrap items-center gap-3 border-t border-white/[0.06]">
        <button id="bk-apply" class="btn btn-primary" disabled>${ico('check-check', 'w-4 h-4')} <span>Choose students</span></button><span id="bk-hint" class="text-xs text-gray-500"></span><span id="bk-undo" class="ml-auto"></span>
        <p id="bk-err" class="form-error w-full hidden" role="alert"></p></div>
    </div>`));
  const F = await forms();
  try {
    [students, settings, activities] = await Promise.all([
      loadStudents(ctx), (await sis()).getSettings(ctx).catch(() => null),
      ctx.isAdmin ? getDocs(collection(db, 'tenants', ctx.slug, 'activities')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []) : [],
    ]);
  } catch (e) { if (live(t)) { $('#bk-list').innerHTML = errorBox(e); refreshIcons(); } return; }
  if (!live(t)) return;
  const fieldsFor = g => g.fields.map(f => f.id === 'check' ? { ...f, options: (settings?.graduation?.checks || ['Grade 10 ELA (FAST) — passing score or concordant', 'Algebra 1 EOC — passing score or comparative', 'One online course', 'Personal financial literacy (0.5 credit)']) }
    : f.id === 'activity' ? { ...f, options: activities.map(a => ({ v: a.id, l: a.name || 'Activity' })) } : f);
  // In table mode only the "context" fields stay on top (e.g. which screening, which test); the rest is per student.
  const formOf = g => ({ sections: [{ fields: fieldsFor(g).filter(f => mode !== 'table' || !g.columns || g.tableOnly || (g.keepInTable || []).includes(f.id)) }] });

  const drawForm = () => {
    $$('[data-group]').forEach(b => b.classList.toggle('is-active', b.dataset.group === group.key));
    $('#bk-mode').innerHTML = group.columns && !group.tableOnly ? `<div class="segmented" role="tablist"><button type="button" data-mode="same" aria-pressed="${mode === 'same'}">Same for everyone</button><button type="button" data-mode="table" aria-pressed="${mode === 'table'}">Edit as a table</button></div>` : group.tableOnly ? `<span class="text-xs text-gray-500">${ico('table', 'w-3.5 h-3.5 inline -mt-0.5')} Enter each student’s result in the table below</span>` : '';
    const root = $('#bk-form');
    const form = formOf(group);
    root.innerHTML = form.sections[0].fields.length ? `<div class="grid sm:grid-cols-2 gap-x-5 gap-y-5">${form.sections[0].fields.map(f => F.fieldHTML(f, { ...(group.defaults || {}), ...preset }, {})).join('')}</div>`
      : `<p class="text-sm text-gray-400">${ico('table', 'w-4 h-4 inline -mt-0.5')} Edit each selected student’s values directly in the table below. Only changed cells are saved.</p>`;
    F.bindForm(root, form, {});
    refreshIcons();
    drawList();
  };
  const busOptions = () => [...new Set(students.flatMap(s => [s.bus?.am?.bus, s.bus?.pm?.bus]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const drawFilters = () => {
    const homerooms = [...new Set(students.map(s => s.homeroom).filter(Boolean))].sort();
    $('#bk-filters').innerHTML = `<div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">${ico('search', 'w-3.5 h-3.5')}</span><input id="bkf-q" type="search" placeholder="Name or ID…" class="input !py-2 pl-9 w-48" aria-label="Search students" value="${escapeHtml(filters.q)}"></div>
      <select id="bkf-grade" class="input !py-2 !w-auto" aria-label="Grade"><option value="">All grades</option>${GRADES.map(g => `<option value="${g}" ${filters.grade === g ? 'selected' : ''}>${g === 'K' ? 'Kindergarten' : 'Grade ' + g}</option>`).join('')}</select>
      ${homerooms.length ? `<select id="bkf-homeroom" class="input !py-2 !w-auto" aria-label="Homeroom"><option value="">All homerooms</option>${homerooms.map(h => `<option ${filters.homeroom === h ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}</select>` : ''}
      <select id="bkf-bus" class="input !py-2 !w-auto" aria-label="Bus"><option value="">Any bus</option><option value="__none" ${filters.bus === '__none' ? 'selected' : ''}>No bus assigned</option>${busOptions().map(b => `<option value="__bus:${escapeHtml(b)}" ${filters.bus === '__bus:' + b ? 'selected' : ''}>Bus ${escapeHtml(b)}</option>`).join('')}</select>
      <select id="bkf-transport" class="input !py-2 !w-auto" aria-label="Transportation"><option value="">Any transportation</option>${TRANSPORT.map(x => `<option ${filters.transport === x ? 'selected' : ''}>${x}</option>`).join('')}<option value="__unset" ${filters.transport === '__unset' ? 'selected' : ''}>Not set</option></select>`;
    refreshIcons();
  };
  const visible = () => {
    const q = filters.q.toLowerCase();
    return students.filter(s => (!q || `${displayNameOf(s)} ${s.studentNumber || ''} ${s.username || ''}`.toLowerCase().includes(q))
      && (!filters.grade || String(s.gradeLevel) === filters.grade) && (!filters.homeroom || s.homeroom === filters.homeroom)
      && (!filters.bus || (filters.bus === '__none' ? !s.bus?.am?.bus && !s.bus?.pm?.bus : [s.bus?.am?.bus, s.bus?.pm?.bus].includes(filters.bus.slice(6))))
      && (!filters.transport || (filters.transport === '__unset' ? !s.bus?.transport : s.bus?.transport === filters.transport)));
  };
  const currentSummary = s => {
    switch (group.key) {
      case 'bus': return s.bus?.transport ? `${s.bus.transport}${s.bus.am?.bus ? ` · AM ${s.bus.am.bus}` : ''}${s.bus.pm?.bus ? ` · PM ${s.bus.pm.bus}` : ''}` : 'Not set';
      case 'homeroom': return [s.homeroom && `HR ${s.homeroom}`, s.counselor].filter(Boolean).join(' · ') || 'Not set';
      case 'grade': return s.gradeLevel ? (s.gradeLevel === 'K' ? 'Kindergarten' : `Grade ${s.gradeLevel}`) : 'Not set';
      case 'meal': return s.lunch || 'Not set';
      case 'gradcheck': return `${Object.values(s.gradChecks || {}).filter(Boolean).length} requirements met`;
      default: return s.studentNumber ? `ID ${s.studentNumber}` : '';
    }
  };
  const cell = (s, [path, label, type, opts]) => {
    const v = group.blankColumns ? '' : (get(s, path) ?? '');
    const a = `data-cell="${escapeHtml(path)}" data-uid="${escapeHtml(s.uid)}" data-orig="${escapeHtml(v)}" aria-label="${escapeHtml(label)} for ${escapeHtml(displayNameOf(s))}"`;
    if (type === 'select') return `<select ${a} class="input !py-1.5 !text-sm"><option value=""></option>${opts.map(o => `<option ${String(v) === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`;
    return `<input ${a} type="${type}" class="input !py-1.5 !text-sm" value="${escapeHtml(v)}">`;
  };
  const drawList = () => {
    const list = visible();
    const tableMode = mode === 'table' && group.columns;
    const shown = tableMode ? list.filter(s => selected.has(s.uid)) : list;
    $('#bk-count').innerHTML = `<span class="text-white">${selected.size}</span> selected · ${list.length} shown`;
    const selBar = `<div class="flex flex-wrap items-center gap-2 px-5 sm:px-6 py-3 border-b border-white/[0.06] bg-white/[0.015]"><button type="button" class="btn btn-ghost btn-sm" data-sel="all">${ico('check-square', 'w-3.5 h-3.5')} Select all ${list.length}</button><button type="button" class="btn btn-ghost btn-sm" data-sel="none">Clear</button>${tableMode ? `<span class="text-xs text-gray-500 ml-auto">Table shows the ${selected.size} selected students. Select students in “List” view or with the filters + Select all.</span>` : ''}${tableMode ? `<button type="button" class="btn btn-ghost btn-sm" data-sel="list">${ico('list', 'w-3.5 h-3.5')} Back to list</button>` : ''}</div>`;
    if (tableMode) {
      $('#bk-list').innerHTML = selBar + (shown.length ? `<div class="overflow-x-auto"><table class="w-full text-sm bk-table"><thead><tr><th class="text-left">Student</th>${group.columns.map(c => `<th class="text-left">${escapeHtml(c[1])}</th>`).join('')}</tr></thead><tbody>${shown.map(s => `<tr><td><div class="flex items-center gap-2 min-w-[160px]">${avatar(displayNameOf(s), null, 'w-7 h-7', 'text-[10px]')}<span class="min-w-0"><span class="block text-white truncate">${escapeHtml(displayNameOf(s))}</span><span class="block text-[11px] text-gray-500">${escapeHtml(gradeLabel(s.gradeLevel))}</span></span></div></td>${group.columns.map(c => `<td>${cell(s, c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        : `<div class="p-8">${emptyState({ icon: 'table', title: 'No students selected', text: 'Use the filters and “Select all”, or switch to the list to pick students.' })}</div>`);
    } else {
      $('#bk-list').innerHTML = selBar + (list.length ? `<div class="divide-y divide-white/[0.04] max-h-[520px] overflow-y-auto">${list.map(s => `<label class="flex items-center gap-3 px-5 sm:px-6 py-2.5 hover:bg-white/[0.02] cursor-pointer"><input type="checkbox" data-pick="${escapeHtml(s.uid)}" ${selected.has(s.uid) ? 'checked' : ''} class="w-4 h-4 accent-[#F59E0B]">${avatar(displayNameOf(s), null, 'w-7 h-7', 'text-[10px]')}<span class="flex-1 min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(displayNameOf(s))}</span><span class="block text-[11px] text-gray-500">${escapeHtml([gradeLabel(s.gradeLevel), s.homeroom && 'HR ' + s.homeroom].filter(Boolean).join(' · '))}</span></span><span class="text-xs text-gray-400 text-right">${escapeHtml(currentSummary(s))}</span></label>`).join('')}</div>`
        : `<p class="text-sm text-gray-500 p-8 text-center">No students match these filters.</p>`);
    }
    const n = selected.size;
    const ab = $('#bk-apply');
    if (!ab.dataset.busy) { ab.disabled = !n; ab.innerHTML = `${ico('check-check', 'w-4 h-4')} <span>${n ? (tableMode ? `Save changes for ${plural(n, 'student')}` : `Update ${plural(n, 'student')}`) : 'Choose students'}</span>`; }
    $('#bk-hint').textContent = n && !tableMode ? `“${group.label}” will change for the ${plural(n, 'selected student')}.` : '';
    refreshIcons();
  };
  const drawUndo = () => {
    $('#bk-undo').innerHTML = lastUndo ? `<button class="btn btn-ghost btn-sm" data-undo>${ico('undo-2', 'w-3.5 h-3.5')} Undo last update (${plural(lastUndo.length, 'student')})</button>` : '';
    refreshIcons();
  };

  // Writes in chunks of 400 (Firestore batches max out at 500 operations).
  const commit = async ops => { for (let i = 0; i < ops.length; i += 400) { const b = writeBatch(db); ops.slice(i, i + 400).forEach(o => o(b)); await b.commit(); } };
  const apply = async () => {
    const err = $('#bk-err'); showError(err, '');
    const tableMode = mode === 'table' && group.columns;
    const form = formOf(group);
    const values = F.collect($('#bk-form'), form);
    const errs = F.validate(form, values); F.showErrors($('#bk-form'), errs);
    if (errs.length) return showError(err, 'Fill in the highlighted fields first.');
    const targets = students.filter(s => selected.has(s.uid));
    // Per-student table rows (only changed cells).
    const rows = {};
    if (tableMode) $$('#bk-list [data-cell]').forEach(inp => { const v = inp.value.trim(); if (v !== inp.dataset.orig) (rows[inp.dataset.uid] ||= {})[inp.dataset.cell] = v; });
    const changes = [];
    for (const s of targets) {
      if (tableMode && !group.blankColumns) { const r = rows[s.uid]; if (r) changes.push({ s, out: { students: r } }); continue; }
      const out = group.apply(s, values, tableMode ? rows[s.uid] : null);
      if (out && (!out.students || Object.keys(out.students).length)) changes.push({ s, out });
    }
    if (!changes.length) return showError(err, tableMode ? 'Nothing changed in the table yet.' : 'Nothing to change — fill in at least one value.');
    if (!tableMode && !await confirmDialog({ title: `Update ${plural(changes.length, 'student')}?`, message: `${group.label} will be changed for ${changes.slice(0, 4).map(c => displayNameOf(c.s)).join(', ')}${changes.length > 4 ? ` and ${changes.length - 4} more` : ''}. You can undo this right after.`, confirmLabel: 'Update' })) return;
    await withBusy($('#bk-apply'), 'Saving…', async () => {
      try {
        const undo = [], ops = [];
        for (const { s, out } of changes) {
          if (out.students) {
            const prev = Object.fromEntries(Object.keys(out.students).map(k => [k, get(s, k) ?? null]));
            undo.push({ uid: s.uid, prev });
            ops.push(b => b.update(doc(db, 'tenants', ctx.slug, 'students', s.uid), { ...out.students, updatedAt: serverTimestamp() }));
          }
          if (out.testScore) ops.push(b => b.set(doc(collection(db, 'tenants', ctx.slug, 'testScores')), { ...out.testScore, studentUid: s.uid, studentName: displayNameOf(s), addedBy: ctx.me.uid, addedByName: ctx.me.name, createdAt: serverTimestamp() }));
          if (out.health?.immStatus) ops.push(b => b.set(doc(db, 'tenants', ctx.slug, 'health', s.uid), { immStatus: out.health.immStatus, studentUid: s.uid, updatedAt: serverTimestamp(), updatedBy: ctx.me.uid }, { merge: true }));
          if (out.screening) ops.push(b => b.set(doc(db, 'tenants', ctx.slug, 'health', s.uid), { screenings: arrayUnion(out.screening), studentUid: s.uid, updatedAt: serverTimestamp(), updatedBy: ctx.me.uid }, { merge: true }));
          if (out.activity) ops.push(b => b.update(doc(db, 'tenants', ctx.slug, 'activities', out.activity), { members: arrayUnion(s.uid), [`memberNames.${s.uid}`]: displayNameOf(s) }));
        }
        await commit(ops);
        // Keep the in-memory list current so the summaries and the next update are accurate.
        changes.forEach(({ s, out }) => Object.entries(out.students || {}).forEach(([k, v]) => { const parts = k.split('.'); let o = s; parts.slice(0, -1).forEach(p => { o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {}; o = o[p]; }); o[parts.at(-1)] = v; }));
        lastUndo = undo.length ? undo : null;
        toast(`${group.label} updated for ${plural(changes.length, 'student')}`);
      } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
    });
    drawUndo(); drawFilters(); drawList(); // after withBusy has restored the button
  };
  const undoLast = async () => {
    if (!lastUndo) return;
    const items = lastUndo; lastUndo = null; drawUndo();
    try {
      await commit(items.map(u => b => b.update(doc(db, 'tenants', ctx.slug, 'students', u.uid), { ...u.prev, updatedAt: serverTimestamp() })));
      items.forEach(u => { const s = students.find(x => x.uid === u.uid); if (s) Object.entries(u.prev).forEach(([k, v]) => { const parts = k.split('.'); let o = s; parts.slice(0, -1).forEach(p => { o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {}; o = o[p]; }); o[parts.at(-1)] = v; }); });
      drawFilters(); drawList(); toast('Undone', 'info');
    } catch (ex) { toast(friendlyError(ex), 'error'); }
  };

  $('#main').addEventListener('click', e => {
    const g = e.target.closest('[data-group]'); if (g) { group = allowed.find(x => x.key === g.dataset.group); mode = group.tableOnly ? 'table' : 'same'; preset = {}; return drawForm(); }
    const m = e.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; return drawForm(); }
    const sb = e.target.closest('[data-sel]');
    if (sb) { if (sb.dataset.sel === 'all') visible().forEach(s => selected.add(s.uid)); else if (sb.dataset.sel === 'none') selected.clear(); else if (sb.dataset.sel === 'list') { mode = 'same'; return drawForm(); } return drawList(); }
    if (e.target.closest('[data-undo]')) return undoLast();
  });
  $('#main').addEventListener('change', e => {
    const p = e.target.closest('[data-pick]'); if (p) { p.checked ? selected.add(p.dataset.pick) : selected.delete(p.dataset.pick); return drawList(); }
    const k = { 'bkf-grade': 'grade', 'bkf-homeroom': 'homeroom', 'bkf-bus': 'bus', 'bkf-transport': 'transport' }[e.target.id];
    if (k) { filters[k] = e.target.value; drawList(); }
  });
  const markChanged = e => { const c = e.target.closest('[data-cell]'); if (c) c.classList.toggle('is-changed', c.value.trim() !== c.dataset.orig); };
  $('#main').addEventListener('input', e => { markChanged(e); if (e.target.id === 'bkf-q') { filters.q = e.target.value.trim(); drawList(); } });
  $('#main').addEventListener('change', markChanged);
  $('#bk-apply').addEventListener('click', apply);
  if (filters.bus) visible().forEach(s => selected.add(s.uid));
  drawFilters(); drawForm(); drawUndo();
}

// ═══════════════════════════════════════════════════════════════
// BUS ROUTES
// ═══════════════════════════════════════════════════════════════
export async function viewBusRoutes(ctx) {
  const t = routeTokenNow();
  setTitle('Bus routes', ctx.tenant.name);
  render(tenantPage(ctx, 'sis-busing', pageHeader({ eyebrow: 'Transportation', title: 'Bus routes', subtitle: 'Every bus, its stops and riders. Click a bus for its roster.',
    actions: `<div class="flex gap-2"><button id="br-csv" class="btn btn-secondary">${ico('download', 'w-4 h-4')} Export CSV</button><a href="${buildUrl(`/${ctx.slug}/office/bulk?group=bus`)}" class="btn btn-primary">${ico('list-checks', 'w-4 h-4')} Assign students</a></div>` })
    + `<div class="max-w-6xl"><div id="br-kpis" class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">${Array.from({ length: 4 }, () => '<div class="skeleton h-24"></div>').join('')}</div><div id="br-list">${skeletonRows(5)}</div></div>`));
  let students;
  try { students = await loadStudents(ctx); } catch (e) { if (live(t)) { $('#br-list').innerHTML = errorBox(e); refreshIcons(); } return; }
  if (!live(t)) return;
  const buses = new Map();
  students.forEach(s => ['am', 'pm'].forEach(leg => { const b = s.bus?.[leg]?.bus; if (!b) return; const x = buses.get(b) || { bus: b, am: [], pm: [], routes: new Set(), drivers: new Set() }; x[leg].push(s); if (s.bus[leg].route) x.routes.add(s.bus[leg].route); if (s.bus.driver) x.drivers.add(s.bus.driver); buses.set(b, x); }));
  const list = [...buses.values()].sort((a, b) => String(a.bus).localeCompare(String(b.bus), undefined, { numeric: true }));
  const riders = students.filter(s => s.bus?.transport === 'Bus rider');
  const unassigned = riders.filter(s => !s.bus?.am?.bus && !s.bus?.pm?.bus);
  const tally = k => students.filter(s => s.bus?.transport === k).length;
  const k = (label, v, sub, lvl) => `<div class="card p-5"><div class="text-xs text-gray-400 mb-2">${label}</div><div class="stat-value">${v}</div><div class="mt-1 text-xs text-gray-500 flex items-center gap-1.5">${lvl ? ico(lvl === 'good' ? 'circle-check' : 'triangle-alert', `w-3.5 h-3.5 ${lvl === 'good' ? 'st-good' : 'st-warning'}`) : ''}${sub}</div></div>`;
  $('#br-kpis').innerHTML = k('Buses', list.length, `${riders.length} bus riders`) + k('Riders without a bus', unassigned.length, unassigned.length ? 'Need an assignment' : 'Everyone assigned', unassigned.length ? 'warning' : 'good')
    + k('Car riders', tally('Car rider'), `${tally('Walker')} walkers`) + k('Transportation not set', students.filter(s => !s.bus?.transport).length, `of ${students.length} students`);
  const stopsOf = (arr, leg) => { const m = new Map(); arr.forEach(s => { const key = `${s.bus[leg].stop || 'No stop set'}|${s.bus[leg].time || ''}`; (m.get(key) || m.set(key, []).get(key)).push(s); }); return [...m.entries()].sort((a, b) => (a[0].split('|')[1] || '99').localeCompare(b[0].split('|')[1] || '99')); };
  const roster = x => ['am', 'pm'].map(leg => x[leg].length ? `<div><h4 class="label">${leg === 'am' ? 'Morning' : 'Afternoon'} · ${plural(x[leg].length, 'rider')}</h4><div class="space-y-3">${stopsOf(x[leg], leg).map(([key, ss]) => { const [stop, time] = key.split('|'); return `<div class="rounded-lg border border-white/[0.06] p-3"><div class="flex items-center justify-between gap-2 mb-2"><span class="text-sm text-white">${ico('map-pin', 'w-3.5 h-3.5 inline -mt-0.5 text-[#F59E0B]')} ${escapeHtml(stop)}</span><span class="text-xs text-gray-400 tabular-nums">${escapeHtml(fmtHM(time))}</span></div><div class="flex flex-wrap gap-1.5">${ss.map(s => `<a href="${buildUrl(`/${ctx.slug}/record/${s.uid}/busing`)}" class="badge badge-muted hover:text-white">${escapeHtml(displayNameOf(s))} · ${escapeHtml(gradeLabel(s.gradeLevel))}</a>`).join('')}</div></div>`; }).join('')}</div></div>` : '').join('');
  $('#br-list').innerHTML = (list.length ? `<div class="space-y-3">${list.map(x => `<details class="card overflow-hidden group"><summary class="flex flex-wrap items-center gap-4 px-5 py-4 cursor-pointer list-none">${iconTile('bus', 'amber')}<div class="flex-1 min-w-0"><div class="text-white font-medium">Bus ${escapeHtml(x.bus)}</div><div class="text-xs text-gray-500">${escapeHtml([[...x.routes].map(r => 'Route ' + r).join(', '), [...x.drivers].join(', ')].filter(Boolean).join(' · ') || 'No route or driver set')}</div></div>
        <div class="text-right text-xs text-gray-400 tabular-nums"><div><span class="text-white text-base font-semibold">${x.am.length}</span> AM · <span class="text-white text-base font-semibold">${x.pm.length}</span> PM</div><div>${new Set([...x.am.map(s => s.bus.am.stop), ...x.pm.map(s => s.bus.pm.stop)].filter(Boolean)).size} stops</div></div>
        <span class="flex gap-1"><a href="${buildUrl(`/${ctx.slug}/office/bulk?group=bus&bus=${encodeURIComponent(x.bus)}`)}" class="btn btn-ghost btn-sm" title="Edit riders on this bus">${ico('pencil', 'w-3.5 h-3.5')} Edit riders</a><button type="button" class="btn btn-ghost btn-sm" data-print-bus="${escapeHtml(x.bus)}">${ico('printer', 'w-3.5 h-3.5')}</button></span>${ico('chevron-down', 'w-4 h-4 text-gray-500 group-open:rotate-180 transition-transform')}</summary>
        <div class="px-5 pb-5 grid md:grid-cols-2 gap-5 border-t border-white/[0.06] pt-4">${roster(x)}</div></details>`).join('')}</div>`
      : emptyState({ icon: 'bus', title: 'No buses assigned yet', text: 'Use “Assign students” to put a whole group on a bus at once.', action: `<a href="${buildUrl(`/${ctx.slug}/office/bulk?group=bus`)}" class="btn btn-primary">${ico('list-checks')} Assign students</a>` }))
    + (unassigned.length ? `<section class="card mt-6 overflow-hidden"><div class="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between gap-3"><h2 class="text-white font-medium">${ico('triangle-alert', 'w-4 h-4 inline -mt-0.5 st-warning')} Bus riders without a bus</h2><a href="${buildUrl(`/${ctx.slug}/office/bulk?group=bus`)}" class="btn btn-secondary btn-sm">Assign</a></div><div class="flex flex-wrap gap-1.5 p-5">${unassigned.map(s => `<a href="${buildUrl(`/${ctx.slug}/record/${s.uid}/busing`)}" class="badge badge-amber">${escapeHtml(displayNameOf(s))}</a>`).join('')}</div></section>` : '');
  refreshIcons();
  $('#br-list').addEventListener('click', e => {
    const p = e.target.closest('[data-print-bus]'); if (!p) return;
    e.preventDefault();
    const x = buses.get(p.dataset.printBus);
    const rows = leg => stopsOf(x[leg], leg).flatMap(([key, ss]) => ss.map(s => `<tr><td>${escapeHtml(fmtHM(key.split('|')[1]))}</td><td>${escapeHtml(key.split('|')[0])}</td><td>${escapeHtml(displayNameOf(s))}</td><td>${escapeHtml(gradeLabel(s.gradeLevel))}</td><td>${escapeHtml((s.contacts || [])[0]?.phone || '')}</td></tr>`)).join('');
    let root = document.getElementById('print-root'); if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
    root.innerHTML = `<div class="pf"><div class="pf-head"><div><div class="pf-title">Bus ${escapeHtml(x.bus)} roster</div><div class="pf-sub">${escapeHtml(ctx.tenant.name)}${x.drivers.size ? ' · Driver: ' + escapeHtml([...x.drivers].join(', ')) : ''}</div></div><div class="pf-sub">Printed ${escapeHtml(new Date().toLocaleString())}</div></div>
      ${['am', 'pm'].filter(l => x[l].length).map(l => `<div class="pf-sec"><div class="pf-sec-t">${l === 'am' ? 'Morning' : 'Afternoon'} — ${x[l].length} riders</div><table><tr><th>Time</th><th>Stop</th><th>Student</th><th>Grade</th><th>Contact</th></tr>${rows(l)}</table></div>`).join('')}</div>`;
    const done = () => { root.innerHTML = ''; window.removeEventListener('afterprint', done); }; window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50);
  });
  $('#br-csv').addEventListener('click', () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Student', 'Student ID', 'Grade', 'Transportation', 'AM bus', 'AM route', 'AM stop', 'AM time', 'PM bus', 'PM route', 'PM stop', 'PM time', 'Driver'],
      ...students.map(s => [displayNameOf(s), s.studentNumber || '', s.gradeLevel ?? '', s.bus?.transport || '', s.bus?.am?.bus || '', s.bus?.am?.route || '', s.bus?.am?.stop || '', s.bus?.am?.time || '', s.bus?.pm?.bus || '', s.bus?.pm?.route || '', s.bus?.pm?.stop || '', s.bus?.pm?.time || '', s.bus?.driver || ''])];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' })); a.download = 'bus-assignments.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Exported');
  });
}
