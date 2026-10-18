// Ember Family Access sections for a student record: Calendar, Student Info, Busing, Test Scores,
// Graduation Requirements, Academic History, Portfolio and Health Info. Students, parents and staff all
// see them; only staff with the right permission can edit. Loaded on demand by sis.js.
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
const {
  db, ico, refreshIcons, escapeHtml, plural, displayNameOf, toDate, formatDate, toDateInput, iconTile, badge,
  emptyState, toast, confirmDialog, buildUrl, live, loadAllItems, hasGrade, itemPoints, typeMeta, GRADED_TYPES, courseHex, subsCol, friendlyError
} = globalThis.__ember;
const BUILD = new URL(import.meta.url).search;
const forms = () => import('./staff.js' + BUILD);

const tcol = (ctx, name) => collection(db, 'tenants', ctx.slug, name);
const tdoc = (ctx, name, id) => doc(db, 'tenants', ctx.slug, name, id);
const fmtISO = iso => iso ? formatDate(iso + 'T12:00') : '';
const fmtHM = hm => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const todayISO = () => toDateInput(new Date());
const STATUS = { good: ['circle-check', 'st-good'], warning: ['triangle-alert', 'st-warning'], serious: ['circle-alert', 'st-serious'], critical: ['octagon-alert', 'st-critical'] };
const chip = (level, label) => `<span class="inline-flex items-center gap-1.5 text-xs text-gray-200 whitespace-nowrap">${ico(STATUS[level][0], 'w-3.5 h-3.5 ' + STATUS[level][1])}${escapeHtml(label)}</span>`;
const tile = (label, value, sub = '', level = null) => `<div class="card p-5"><div class="text-xs text-gray-400 mb-2">${label}</div><div class="stat-value tabular-nums">${value}</div>${sub || level ? `<div class="mt-1 text-xs text-gray-500 flex items-center gap-1.5">${level ? ico(STATUS[level][0], 'w-3.5 h-3.5 ' + STATUS[level][1]) : ''}${sub}</div>` : ''}</div>`;
const section = (title, actions, body, sub = '') => `<section class="card overflow-hidden mb-5"><div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]"><div><h2 class="text-white font-medium">${title}</h2>${sub ? `<p class="text-xs text-gray-500 mt-0.5">${sub}</p>` : ''}</div>${actions ? `<div class="flex gap-2">${actions}</div>` : ''}</div>${body}</section>`;
const dl = rows => { const r = rows.filter(([, v]) => v !== undefined && v !== null && v !== ''); return r.length ? `<dl class="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 p-5">${r.map(([k, v]) => `<div><dt class="text-[11px] uppercase tracking-wider text-gray-500 mb-1">${escapeHtml(k)}</dt><dd class="text-sm text-gray-200 whitespace-pre-wrap">${escapeHtml(v)}</dd></div>`).join('')}</dl>` : `<p class="text-sm text-gray-500 p-5">Nothing on file yet.</p>`; };
const btn = (attr, label, icon = 'plus', kind = 'secondary') => `<button type="button" class="btn btn-${kind} btn-sm" ${attr}>${ico(icon, 'w-3.5 h-3.5')} ${label}</button>`;
const rowBtns = (id, edit = true) => `<div class="flex justify-end gap-1 shrink-0">${edit ? `<button type="button" class="btn-icon" data-edit="${escapeHtml(id)}" aria-label="Edit">${ico('pencil', 'w-4 h-4')}</button>` : ''}<button type="button" class="btn-icon danger" data-del="${escapeHtml(id)}" aria-label="Delete">${ico('trash-2', 'w-4 h-4')}</button></div>`;
const studentCourses = async (ctx, student) => (await Promise.all((student.enrolledCourseIds || []).map(id => getDoc(doc(db, 'tenants', ctx.slug, 'courses', id)).then(c => c.exists() ? { id: c.id, ...c.data() } : null).catch(() => null)))).filter(Boolean);

export async function renderTab(ctx, tab, el, student, t, { settings, rerender }) {
  const fn = { calendar: calendarTab, info: infoTab, busing: busingTab, tests: testsTab, graduation: graduationTab, history: historyTab, portfolio: portfolioTab, health: healthTab }[tab];
  if (!fn) return false;
  await fn(ctx, el, student, t, { settings, rerender });
  refreshIcons();
  return true;
}

// ── Calendar: what's coming up for this student ─────────────────────
async function calendarTab(ctx, el, student, t, { settings }) {
  const courses = await studentCourses(ctx, student);
  const from = new Date(); from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
  const to = new Date(); to.setDate(to.getDate() + 30); to.setHours(23, 59, 59, 999);
  const entries = [];
  await Promise.all(courses.map(async c => {
    const [items, evs, subs] = await Promise.all([
      loadAllItems(ctx, c.id).catch(() => []),
      getDocs(collection(db, 'tenants', ctx.slug, 'courses', c.id, 'events')).then(s => s.docs.map(d => d.data())).catch(() => []),
      getDocs(query(subsCol(ctx, c.id), where('studentId', '==', student.uid))).then(s => s.docs.map(d => d.data())).catch(() => []),
    ]);
    items.forEach(it => {
      const due = toDate(it.data?.dueDate); if (!due || due < from || due > to) return;
      const s = subs.find(x => x.itemId === it.id);
      const status = hasGrade(s) ? ['good', `Graded ${s.grade}/${itemPoints(it)}`] : s ? ['good', 'Turned in'] : due < new Date() ? ['critical', 'Missing'] : null;
      entries.push({ at: due, title: it.title || 'Assignment', icon: typeMeta(it.type).icon, course: c, status, kind: typeMeta(it.type).label || 'Assignment' });
    });
    evs.forEach(e => { const at = toDate(e.startAt); if (at && at >= from && at <= to) entries.push({ at, title: e.title || 'Event', icon: 'calendar', course: c, allDay: e.allDay, kind: 'Event' }); });
  }));
  (settings?.terms || []).forEach(term => {
    [[term.start, `${term.name} begins`], [term.end, `${term.name} ends`]].forEach(([d, label]) => { if (!d) return; const at = new Date(d + 'T12:00'); if (at >= from && at <= to) entries.push({ at, title: label, icon: 'flag', kind: 'School', allDay: true }); });
  });
  if (!live(t)) return;
  entries.sort((a, b) => a.at - b.at);
  const byDay = new Map();
  entries.forEach(e => { const k = toDateInput(e.at); (byDay.get(k) || byDay.set(k, []).get(k)).push(e); });
  const today = todayISO();
  const missing = entries.filter(e => e.status?.[1] === 'Missing').length;
  const dueWeek = entries.filter(e => e.kind !== 'Event' && e.kind !== 'School' && e.at >= new Date() && (e.at - new Date()) / 864e5 <= 7).length;
  el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">${tile('Due in the next 7 days', dueWeek)}${tile('Missing (last 7 days)', missing, missing ? 'Talk with the teacher' : 'Nothing missing', missing ? 'critical' : 'good')}${tile('Classes', courses.length)}</div>`
    + (entries.length ? `<div class="space-y-4">${[...byDay.entries()].map(([day, list]) => `<section><h3 class="label ${day === today ? '!text-[#F59E0B]' : ''}">${day === today ? 'Today · ' : ''}${escapeHtml(new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</h3>
        <div class="card divide-y divide-white/[0.05] overflow-hidden">${list.map(e => `<div class="flex items-center gap-3 px-5 py-3">${e.course ? `<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${courseHex(e.course)}"></span>` : ico('flag', 'w-3.5 h-3.5 text-[#F59E0B] shrink-0')}
          ${ico(e.icon, 'w-4 h-4 text-gray-500 shrink-0')}<div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(e.title)}</div><div class="text-[11px] text-gray-500 truncate">${escapeHtml(e.kind)}${e.course ? ' · ' + escapeHtml(e.course.title || '') : ''}${e.allDay ? '' : ' · ' + escapeHtml(e.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</div></div>
          ${e.status ? chip(...e.status) : ''}</div>`).join('')}</div></section>`).join('')}</div>`
      : emptyState({ icon: 'calendar-check', title: 'Nothing scheduled', text: 'No assignments, events or school dates in the next 30 days.' }));
}

// ── Student Info ────────────────────────────────────────────────────
const INFO_FIELDS = [
  { id: 'preferredName', type: 'text', label: 'Preferred name' }, { id: 'gender', type: 'select', label: 'Gender', options: ['Female', 'Male', 'Nonbinary', 'Prefer not to say'] },
  { id: 'language', type: 'text', label: 'Home language' }, { id: 'phone', type: 'phone', label: 'Home phone' },
  { id: 'address', type: 'textarea', label: 'Home address', rows: 2, span: 'sm:col-span-2' },
  { id: 'counselor', type: 'text', label: 'Counselor' }, { id: 'enrolledOn', type: 'date', label: 'Enrollment date' },
  { id: 'lunch', type: 'select', label: 'Meal status', options: ['Paid', 'Reduced', 'Free', 'Universal / CEP'] }, { id: 'locker', type: 'text', label: 'Locker' },
];
async function infoTab(ctx, el, student, t, { rerender }) {
  const canEdit = ctx.isAdmin || ctx.can('records');
  const contacts = student.contacts || [];
  el.innerHTML = section('Student', canEdit ? btn('data-info-edit', 'Edit', 'pencil') : '', dl([
    ['Legal name', [student.firstName, student.lastName].filter(Boolean).join(' ') || displayNameOf(student)], ['Preferred name', student.preferredName], ['Student ID', student.studentNumber],
    ['Grade', student.gradeLevel ? (student.gradeLevel === 'K' ? 'Kindergarten' : `Grade ${student.gradeLevel}`) : ''], ['Date of birth', fmtISO(student.dob)], ['Gender', student.gender],
    ['Homeroom / advisory', student.homeroom], ['Counselor', student.counselor], ['Enrollment date', fmtISO(student.enrolledOn)],
    ['Home language', student.language], ['Meal status', ctx.isRealTeacher || ctx.isGuardian ? student.lunch : ''], ['Locker', student.locker],
    ['Home address', student.address], ['Home phone', student.phone], ['School', ctx.tenant.name],
  ]))
    + section('Emergency contacts', '', contacts.length ? `<div class="divide-y divide-white/[0.05]">${contacts.map(c => `<div class="flex flex-wrap items-center gap-3 px-5 py-3"><div class="flex-1 min-w-0"><div class="text-sm text-white">${escapeHtml(c.name || '')}${c.relation ? ` <span class="text-xs text-gray-500">· ${escapeHtml(c.relation)}</span>` : ''}</div></div>${c.phone ? `<a href="tel:${escapeHtml(String(c.phone).replace(/[^\d+]/g, ''))}" class="text-sm text-[#F59E0B] hover:underline">${escapeHtml(c.phone)}</a>` : ''}${c.email ? `<a href="mailto:${escapeHtml(c.email)}" class="text-sm text-gray-400 hover:text-white">${escapeHtml(c.email)}</a>` : ''}</div>`).join('')}</div>` : `<p class="text-sm text-gray-500 p-5">No emergency contacts on file.${ctx.isAdmin ? ' Add them with “Edit record” above.' : ' Contact the school office to add one.'}</p>`)
    + (ctx.isRealTeacher ? '' : `<p class="hint">${ico('info', 'w-3.5 h-3.5 inline -mt-0.5')} Something out of date? Contact the school office to update ${ctx.isGuardian ? 'your student’s' : 'your'} information.</p>`);
  el.querySelector('[data-info-edit]')?.addEventListener('click', async () => {
    const { formModal } = await forms();
    formModal({ title: 'Edit student info', subtitle: displayNameOf(student), icon: 'id-card', form: { sections: [{ fields: INFO_FIELDS }] }, data: Object.fromEntries(INFO_FIELDS.map(f => [f.id, student[f.id] || ''])), onSubmit: async d => {
      await updateDoc(tdoc(ctx, 'students', student.uid), { ...d, updatedAt: serverTimestamp() }); toast('Saved'); rerender(); return true;
    } });
  });
}

// ── Busing ──────────────────────────────────────────────────────────
const TRANSPORT = ['Bus rider', 'Car rider', 'Walker', 'Bike rider', 'Daycare / van', 'Student driver', 'After-school program'];
async function busingTab(ctx, el, student, t, { rerender }) {
  const b = student.bus || {}, canEdit = ctx.can('records');
  const leg = (label, x = {}, icon) => `<div class="card p-5"><div class="flex items-center gap-3 mb-4">${iconTile(icon, 'amber')}<h3 class="text-white font-medium">${label}</h3></div>
    ${x.bus || x.stop || x.time ? `<div class="grid grid-cols-2 gap-4"><div><div class="text-[11px] uppercase tracking-wider text-gray-500">Bus</div><div class="stat-value">${escapeHtml(x.bus || '—')}</div></div><div><div class="text-[11px] uppercase tracking-wider text-gray-500">${label === 'Morning' ? 'Pick-up' : 'Drop-off'}</div><div class="stat-value">${escapeHtml(fmtHM(x.time) || '—')}</div></div>
      <div class="col-span-2"><div class="text-[11px] uppercase tracking-wider text-gray-500">Stop</div><div class="text-sm text-gray-200">${escapeHtml(x.stop || '—')}</div></div>${x.route ? `<div class="col-span-2 text-xs text-gray-500">Route ${escapeHtml(x.route)}</div>` : ''}</div>` : `<p class="text-sm text-gray-500">No ${label.toLowerCase()} bus assigned.</p>`}</div>`;
  el.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3 mb-5"><div class="flex items-center gap-3">${iconTile('bus', 'teal')}<div><div class="text-white">${escapeHtml(b.transport || 'Transportation not set')}</div><div class="text-xs text-gray-500">How ${escapeHtml(displayNameOf(student))} gets to and from school</div></div></div>${canEdit ? btn('data-bus-edit', 'Edit busing', 'pencil') : ''}</div>
    ${b.transport === 'Bus rider' || b.am?.bus || b.pm?.bus ? `<div class="grid md:grid-cols-2 gap-4 mb-5">${leg('Morning', b.am, 'sunrise')}${leg('Afternoon', b.pm, 'sunset')}</div>` : ''}
    ${section('Details', '', dl([['Driver', b.driver], ['Transportation office', b.phone], ['Eligibility', b.eligibility], ['Authorized pick-up', b.pickup], ['Notes', b.notes]]))}
    <p class="hint">${ico('info', 'w-3.5 h-3.5 inline -mt-0.5')} Times can change at the start of each term. Watch for notifications from the school.</p>`;
  el.querySelector('[data-bus-edit]')?.addEventListener('click', async () => {
    const { formModal } = await forms();
    const legFields = p => [{ id: `${p}Bus`, type: 'text', label: `${p === 'am' ? 'Morning' : 'Afternoon'} bus #` }, { id: `${p}Route`, type: 'text', label: 'Route' }, { id: `${p}Stop`, type: 'text', label: 'Stop', span: 'sm:col-span-2' }, { id: `${p}Time`, type: 'time', label: p === 'am' ? 'Pick-up time' : 'Drop-off time' }];
    const form = { sections: [{ fields: [
      { id: 'transport', type: 'radio', label: 'Transportation', required: true, options: TRANSPORT },
      ...legFields('am').map(f => ({ ...f, showIf: { id: 'transport', eq: 'Bus rider' } })), ...legFields('pm').map(f => ({ ...f, showIf: { id: 'transport', eq: 'Bus rider' } })),
      { id: 'driver', type: 'text', label: 'Driver', showIf: { id: 'transport', eq: 'Bus rider' } }, { id: 'phone', type: 'phone', label: 'Transportation office phone' },
      { id: 'eligibility', type: 'select', label: 'Eligibility', options: ['Eligible (2+ miles)', 'Hazardous walk route', 'ESE / IEP transportation', 'Courtesy rider', 'Not eligible'] },
      { id: 'pickup', type: 'text', label: 'Authorized pick-up people', span: 'sm:col-span-2' }, { id: 'notes', type: 'textarea', label: 'Notes', rows: 2 },
    ] }] };
    const data = { transport: b.transport || '', amBus: b.am?.bus || '', amRoute: b.am?.route || '', amStop: b.am?.stop || '', amTime: b.am?.time || '', pmBus: b.pm?.bus || '', pmRoute: b.pm?.route || '', pmStop: b.pm?.stop || '', pmTime: b.pm?.time || '', driver: b.driver || '', phone: b.phone || '', eligibility: b.eligibility || '', pickup: b.pickup || '', notes: b.notes || '' };
    formModal({ title: 'Edit busing', subtitle: displayNameOf(student), icon: 'bus', form, data, onSubmit: async d => {
      const bus = { transport: d.transport, am: { bus: d.amBus || '', route: d.amRoute || '', stop: d.amStop || '', time: d.amTime || '' }, pm: { bus: d.pmBus || '', route: d.pmRoute || '', stop: d.pmStop || '', time: d.pmTime || '' }, driver: d.driver || '', phone: d.phone || '', eligibility: d.eligibility || '', pickup: d.pickup || '', notes: d.notes || '' };
      await updateDoc(tdoc(ctx, 'students', student.uid), { bus, updatedAt: serverTimestamp() }); toast('Busing saved'); rerender(); return true;
    } });
  });
}

// ── Records lists (test scores, academic history, portfolio) share one pattern ──
async function recordList(ctx, name, student) {
  const snap = await getDocs(query(tcol(ctx, name), where('studentUid', '==', student.uid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function editEntry(ctx, { name, student, existing, title, icon, fields, rerender, extra = {} }) {
  const { formModal } = await forms();
  formModal({ title: existing ? `Edit ${title.toLowerCase()}` : `Add ${title.toLowerCase()}`, subtitle: displayNameOf(student), icon, form: { sections: [{ fields }] }, data: existing || extra.defaults || {}, onSubmit: async d => {
    const clean = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === undefined ? '' : v]));
    if (existing) await updateDoc(tdoc(ctx, name, existing.id), { ...clean, updatedAt: serverTimestamp() });
    else await addDoc(tcol(ctx, name), { ...clean, ...(extra.add || {}), studentUid: student.uid, studentName: displayNameOf(student), addedBy: ctx.me.uid, addedByName: ctx.me.name, createdAt: serverTimestamp() });
    toast('Saved'); rerender(); return true;
  } });
}
function bindRows(ctx, el, { name, list, student, title, icon, fields, rerender }) {
  el.onclick = async e => {
    if (e.target.closest('[data-add]')) return editEntry(ctx, { name, student, title, icon, fields, rerender });
    const ed = e.target.closest('[data-edit]'); if (ed) return editEntry(ctx, { name, student, existing: list.find(x => x.id === ed.dataset.edit), title, icon, fields, rerender });
    const dl2 = e.target.closest('[data-del]');
    if (dl2) {
      if (!await confirmDialog({ title: `Delete this ${title.toLowerCase()}?`, confirmLabel: 'Delete', danger: true })) return;
      try { await deleteDoc(tdoc(ctx, name, dl2.dataset.del)); toast('Deleted'); rerender(); } catch (ex) { toast(friendlyError(ex), 'error'); }
    }
  };
}

// ── Test Scores ─────────────────────────────────────────────────────
const TESTS = ['FAST ELA Reading', 'FAST Mathematics', 'B.E.S.T. Writing', 'Statewide Science (SSA)', 'Algebra 1 EOC', 'Geometry EOC', 'Biology 1 EOC', 'U.S. History EOC', 'Civics EOC', 'PSAT 8/9', 'PSAT/NMSQT', 'SAT', 'ACT', 'CLT', 'AP Exam', 'PERT', 'ASVAB', 'WIDA ACCESS', 'i-Ready Reading', 'i-Ready Math', 'Industry certification', 'Other'];
const TEST_FIELDS = [
  { id: 'test', type: 'select', label: 'Test', required: true, options: TESTS }, { id: 'subject', type: 'text', label: 'Subject / part', placeholder: 'e.g. AP Biology, Composite, PM3' },
  { id: 'date', type: 'date', label: 'Date taken', required: true, maxToday: true }, { id: 'gradeAtTest', type: 'select', label: 'Grade when taken', options: ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] },
  { id: 'score', type: 'text', label: 'Score', required: true, placeholder: 'e.g. 1240, 352, 4' }, { id: 'level', type: 'select', label: 'Result / level', options: ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Passed', 'Not passed', 'Concordant score met', 'AP 1', 'AP 2', 'AP 3', 'AP 4', 'AP 5', 'Certified', 'Not certified'] },
  { id: 'percentile', type: 'number', label: 'Percentile', min: 1, maxN: 99 }, { id: 'notes', type: 'textarea', label: 'Notes', rows: 2 },
];
const levelTone = l => !l ? null : /Level (3|4|5)|Passed|met|AP (3|4|5)|^Certified/.test(l) ? 'good' : /Level 2|AP 2/.test(l) ? 'warning' : 'serious';
async function testsTab(ctx, el, student, t, { rerender }) {
  const list = (await recordList(ctx, 'testScores', student)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!live(t)) return;
  const canEdit = ctx.can('records');
  const groups = [...new Set(list.map(x => x.test))];
  el.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3 mb-5"><p class="text-sm text-gray-400 max-w-2xl">State assessments, college entrance exams, AP and other tests.</p>${canEdit ? btn('data-add', 'Add test score') : ''}</div>`
    + (list.length ? groups.map(g => section(escapeHtml(g), '', `<div class="divide-y divide-white/[0.05]">${list.filter(x => x.test === g).map(x => `<div class="flex flex-wrap sm:flex-nowrap items-center gap-4 px-5 py-3">
        <div class="w-28 shrink-0 text-xs text-gray-400">${escapeHtml(fmtISO(x.date))}${x.gradeAtTest ? `<div class="text-gray-600">Grade ${escapeHtml(x.gradeAtTest)}</div>` : ''}</div>
        <div class="flex-1 min-w-0"><div class="text-sm text-white">${escapeHtml(x.subject || g)}</div>${x.notes ? `<div class="text-[11px] text-gray-500 truncate">${escapeHtml(x.notes)}</div>` : ''}</div>
        <div class="text-right"><div class="text-lg text-white font-semibold tabular-nums">${escapeHtml(x.score || '—')}</div>${x.percentile ? `<div class="text-[11px] text-gray-500">${escapeHtml(x.percentile)}th percentile</div>` : ''}</div>
        <div class="w-36 shrink-0">${x.level ? chip(levelTone(x.level) || 'warning', x.level) : ''}</div>${canEdit ? rowBtns(x.id) : ''}</div>`).join('')}</div>`)).join('')
      : emptyState({ icon: 'chart-column', title: 'No test scores yet', text: canEdit ? 'Add state, college-entrance and AP scores here.' : 'Scores appear here once the school records them.' }));
  bindRows(ctx, el, { name: 'testScores', list, student, title: 'Test score', icon: 'chart-column', fields: TEST_FIELDS, rerender });
}

// ── Academic History + GPA ──────────────────────────────────────────
export const SUBJECTS = ['English / Language Arts', 'Mathematics', 'Science', 'Social Studies', 'World Language', 'Fine & Performing Arts', 'Physical Education', 'Career & Technical (CTE)', 'Elective'];
const POINTS = { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0 };
const isPass = g => g && !/^(F|WF|I|NG)$/i.test(String(g).trim());
// Unweighted 4.0 scale; weighted adds 1 point for honors/AP/dual-enrollment courses (grade D or better).
function gpaOf(rows) {
  let pts = 0, wpts = 0, cr = 0;
  rows.forEach(r => {
    const p = POINTS[String(r.finalGrade || '').toUpperCase().trim()], c = Number(r.credits) || 0;
    if (p === undefined || !c) return;
    pts += p * c; wpts += (p + (r.weighted === 'Yes' && p >= 1 ? 1 : 0)) * c; cr += c;
  });
  return cr ? { unweighted: Math.round(pts / cr * 100) / 100, weighted: Math.round(wpts / cr * 100) / 100 } : null;
}
const yearOptions = () => { const y = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1; return Array.from({ length: 14 }, (_, i) => `${y - i}–${y - i + 1}`); };
const HISTORY_FIELDS = [
  { id: 'year', type: 'select', label: 'School year', required: true, options: yearOptions() }, { id: 'gradeLevel', type: 'select', label: 'Grade', options: ['6', '7', '8', '9', '10', '11', '12'] },
  { id: 'course', type: 'text', label: 'Course', required: true, placeholder: 'English 1 Honors' }, { id: 'courseCode', type: 'text', label: 'Course number', placeholder: '1001320' },
  { id: 'subject', type: 'select', label: 'Subject area', required: true, options: SUBJECTS }, { id: 'credits', type: 'number', label: 'Credits', required: true, min: 0, maxN: 3, hint: 'Usually 1 (or 0.5 for a semester course).' },
  { id: 'finalGrade', type: 'select', label: 'Final grade', required: true, options: ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F', 'P (pass)', 'I (incomplete)', 'WF'] },
  { id: 'weighted', type: 'yesno', label: 'Honors / AP / dual enrollment (weighted)?' }, { id: 'school', type: 'text', label: 'School (if not this one)' }, { id: 'online', type: 'yesno', label: 'Online course?' },
];
async function historyTab(ctx, el, student, t, { rerender }) {
  const list = await recordList(ctx, 'academicHistory', student);
  const courses = await studentCourses(ctx, student);
  if (!live(t)) return;
  const canEdit = ctx.can('records');
  const rows = list.map(r => ({ ...r, finalGrade: String(r.finalGrade || '').split(' ')[0] })).sort((a, b) => (b.year || '').localeCompare(a.year || '') || (a.course || '').localeCompare(b.course || ''));
  const years = [...new Set(rows.map(r => r.year))];
  const g = gpaOf(rows), earned = rows.filter(r => isPass(r.finalGrade)).reduce((a, r) => a + (Number(r.credits) || 0), 0);
  el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">${tile('Unweighted GPA', g ? g.unweighted.toFixed(2) : '—')}${tile('Weighted GPA', g ? g.weighted.toFixed(2) : '—')}${tile('Credits earned', earned % 1 ? earned.toFixed(1) : earned)}${tile('In progress now', courses.length, 'Current courses')}</div>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4"><p class="text-sm text-gray-400">Final grades and credits from past school years and transfer schools.</p>${canEdit ? btn('data-add', 'Add course') : ''}</div>
    ${courses.length ? section('This year — in progress', `<a class="btn btn-ghost btn-sm" href="${buildUrl(`/${ctx.slug}/record/${ctx.isStudent ? 'me' : student.uid}/reportcards`)}">${ico('file-text', 'w-3.5 h-3.5')} Report cards</a>`, `<div class="divide-y divide-white/[0.05]">${courses.map(c => `<div class="flex items-center gap-3 px-5 py-2.5"><span class="w-2.5 h-2.5 rounded-full" style="background:${courseHex(c)}"></span><span class="flex-1 text-sm text-gray-200">${escapeHtml(c.title || '')}</span><span class="text-xs text-gray-500">${escapeHtml(c.subject || 'Elective')} · ${Number(c.credits ?? 1)} cr</span></div>`).join('')}</div>`) : ''}
    ${rows.length ? years.map(y => { const yr = rows.filter(r => r.year === y), yg = gpaOf(yr); return section(escapeHtml(y), '', `<div class="divide-y divide-white/[0.05]">${yr.map(r => `<div class="flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 py-2.5"><div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(r.course || '')}${r.weighted === 'Yes' ? ' ' + badge('Weighted', 'violet') : ''}${r.online === 'Yes' ? ' ' + badge('Online', 'blue') : ''}</div><div class="text-[11px] text-gray-500">${escapeHtml([r.courseCode, r.subject, r.school].filter(Boolean).join(' · '))}</div></div><span class="w-12 text-right text-sm ${isPass(r.finalGrade) ? 'text-white' : 'text-[#d03b3b]'} font-semibold">${escapeHtml(r.finalGrade || '—')}</span><span class="w-16 text-right text-xs text-gray-400 tabular-nums">${escapeHtml(r.credits ?? '')} cr</span>${canEdit ? rowBtns(r.id) : ''}</div>`).join('')}</div>`, `${yr[0]?.gradeLevel ? `Grade ${escapeHtml(yr[0].gradeLevel)} · ` : ''}${yg ? `GPA ${yg.unweighted.toFixed(2)}` : ''}`); }).join('')
      : emptyState({ icon: 'history', title: 'No academic history yet', text: canEdit ? 'Add final grades from past years and transfer schools to calculate GPA and graduation progress.' : 'Past years appear here once the school records them.' })}`;
  bindRows(ctx, el, { name: 'academicHistory', list, student, title: 'Course', icon: 'history', fields: HISTORY_FIELDS, rerender });
}

// ── Graduation Requirements ─────────────────────────────────────────
// Default: Florida standard 24-credit diploma (editable per school under the tab).
export const DEFAULT_GRAD = {
  name: 'Standard diploma (24 credits)', total: 24, gpa: 2.0,
  subjects: [['English / Language Arts', 4], ['Mathematics', 4], ['Science', 3], ['Social Studies', 3], ['Fine & Performing Arts', 1], ['Physical Education', 1], ['Elective', 8]],
  checks: ['Grade 10 ELA (FAST) — passing score or concordant', 'Algebra 1 EOC — passing score or comparative', 'One online course', 'Personal financial literacy (0.5 credit)'],
};
async function graduationTab(ctx, el, student, t, { settings, rerender }) {
  const grad = { ...DEFAULT_GRAD, ...(settings?.graduation || {}) };
  grad.subjects = (grad.subjects || []).map(x => Array.isArray(x) ? x : [x.subject, Number(x.credits) || 0]); // stored as objects (Firestore has no nested arrays)
  const [hist, courses] = await Promise.all([recordList(ctx, 'academicHistory', student), studentCourses(ctx, student)]);
  if (!live(t)) return;
  const reqSubjects = grad.subjects.map(([s]) => s);
  const bucket = s => reqSubjects.includes(s) ? s : 'Elective';
  const earned = {}, inprog = {};
  hist.filter(r => isPass(String(r.finalGrade || '').split(' ')[0])).forEach(r => { const b = bucket(r.subject); earned[b] = (earned[b] || 0) + (Number(r.credits) || 0); });
  courses.forEach(c => { const b = bucket(c.subject || 'Elective'); inprog[b] = (inprog[b] || 0) + Number(c.credits ?? 1); });
  // Extra credits in a core subject count toward electives.
  let overflow = 0;
  grad.subjects.forEach(([s, need]) => { if (s !== 'Elective' && (earned[s] || 0) > need) { overflow += earned[s] - need; earned[s] = need; } });
  earned.Elective = (earned.Elective || 0) + overflow;
  const totalEarned = Object.values(earned).reduce((a, b) => a + b, 0), totalProg = Object.values(inprog).reduce((a, b) => a + b, 0);
  const g = gpaOf(hist.map(r => ({ ...r, finalGrade: String(r.finalGrade || '').split(' ')[0] })));
  const checks = student.gradChecks || {};
  const canEdit = ctx.can('records'), canConfig = ctx.isAdmin;
  const pct = (a, b) => Math.min(100, b ? a / b * 100 : 0);
  const bar = (e, p, need) => `<div class="h-2.5 rounded-full bg-white/[0.06] overflow-hidden flex"><div class="h-full bg-[#D97706]" style="width:${pct(e, need)}%"></div><div class="h-full bg-[#D97706]/35" style="width:${Math.max(0, pct(e + p, need) - pct(e, need))}%"></div></div>`;
  const level = totalEarned >= grad.total ? 'good' : totalEarned + totalProg >= expectedCredits(student) ? 'good' : 'warning';
  el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">${tile('Credits earned', `${fmtCr(totalEarned)}<span class="text-gray-500 text-lg">/${grad.total}</span>`, `${fmtCr(totalProg)} in progress`, level)}${tile('GPA (unweighted)', g ? g.unweighted.toFixed(2) : '—', `${grad.gpa.toFixed(1)} required`, g ? (g.unweighted >= grad.gpa ? 'good' : 'critical') : null)}${tile('Other requirements', `${grad.checks.filter(c => checks[c]).length}<span class="text-gray-500 text-lg">/${grad.checks.length}</span>`, 'Completed')}${tile('Diploma', `<span class="text-base">${escapeHtml(grad.name)}</span>`)}</div>
    ${section('Credits by subject', canConfig ? btn('data-grad-config', 'Edit requirements', 'settings-2') : '', `<div class="p-5 space-y-4">${grad.subjects.map(([s, need]) => { const e = earned[s] || 0, p = inprog[s] || 0, done = e >= need; return `<div><div class="flex items-center justify-between gap-3 mb-1.5"><span class="text-sm text-gray-200">${escapeHtml(s)}</span><span class="text-xs text-gray-400 tabular-nums">${fmtCr(e)} earned${p ? ` · ${fmtCr(p)} in progress` : ''} · <span class="text-gray-200">${fmtCr(need)} needed</span> ${done ? ico('circle-check', 'w-3.5 h-3.5 st-good inline -mt-0.5') : ''}</span></div>${bar(e, p, need)}</div>`; }).join('')}
      <p class="text-[11px] text-gray-500 flex items-center gap-3"><span class="inline-flex items-center gap-1"><span class="w-3 h-2 rounded-sm bg-[#D97706]"></span>Earned</span><span class="inline-flex items-center gap-1"><span class="w-3 h-2 rounded-sm bg-[#D97706]/35"></span>In progress this year</span></p></div>`,
      'From Academic History (passed courses) plus this year’s classes.')}
    ${section('Other requirements', '', `<div class="divide-y divide-white/[0.05]">${grad.checks.map(c => `<label class="flex items-center gap-3 px-5 py-3 ${canEdit ? 'cursor-pointer' : ''}"><input type="checkbox" data-grad-check="${escapeHtml(c)}" ${checks[c] ? 'checked' : ''} ${canEdit ? '' : 'disabled'} class="w-4 h-4 accent-[#F59E0B]"><span class="flex-1 text-sm ${checks[c] ? 'text-white' : 'text-gray-300'}">${escapeHtml(c)}</span>${checks[c] ? chip('good', 'Met') : chip('warning', 'Not yet')}</label>`).join('')}</div>`)}
    <p class="hint">${ico('info', 'w-3.5 h-3.5 inline -mt-0.5')} This is a progress guide. Your school counselor confirms official graduation status.</p>`;
  el.onchange = async e => {
    const cb = e.target.closest('[data-grad-check]'); if (!cb || !canEdit) return;
    try { await updateDoc(tdoc(ctx, 'students', student.uid), { [`gradChecks.${cb.dataset.gradCheck}`]: cb.checked }); student.gradChecks = { ...(student.gradChecks || {}), [cb.dataset.gradCheck]: cb.checked }; toast('Saved'); rerender(); }
    catch (ex) { toast(friendlyError(ex), 'error'); cb.checked = !cb.checked; }
  };
  el.querySelector('[data-grad-config]')?.addEventListener('click', async () => {
    const { formModal } = await forms();
    const fields = [{ id: 'name', type: 'text', label: 'Diploma name', required: true }, { id: 'gpa', type: 'number', label: 'Minimum GPA', required: true, min: 0, maxN: 4 },
      ...SUBJECTS.map(s => ({ id: `s_${s}`, type: 'number', label: `${s} credits`, min: 0, maxN: 12 })),
      { id: 'checks', type: 'textarea', label: 'Other requirements (one per line)', rows: 4, span: 'sm:col-span-2' }];
    const data = { name: grad.name, gpa: grad.gpa, checks: grad.checks.join('\n'), ...Object.fromEntries(SUBJECTS.map(s => [`s_${s}`, grad.subjects.find(x => x[0] === s)?.[1] ?? ''])) };
    formModal({ title: 'Graduation requirements', subtitle: `${ctx.tenant.name} · applies to every student`, icon: 'graduation-cap', form: { sections: [{ fields }] }, data, onSubmit: async d => {
      const subjects = SUBJECTS.map(s => [s, Number(d[`s_${s}`]) || 0]).filter(([, n]) => n > 0);
      const graduation = { name: d.name, gpa: Number(d.gpa) || 0, total: subjects.reduce((a, [, n]) => a + n, 0), subjects: subjects.map(([s, n]) => ({ subject: s, credits: n })), checks: String(d.checks || '').split('\n').map(x => x.trim()).filter(Boolean) };
      await setDoc(doc(db, 'tenants', ctx.slug, 'sis', 'settings'), { graduation }, { merge: true });
      toast('Requirements saved'); rerender({ freshSettings: true }); return true;
    } });
  });
}
const fmtCr = n => (Math.round(n * 10) / 10).toString();
// Rough on-track check: about 6 credits per completed high-school year.
const expectedCredits = s => { const g = Number(s.gradeLevel); return g >= 9 ? (g - 8) * 6 : 0; };

// ── Portfolio ───────────────────────────────────────────────────────
const PORT_TYPES = ['Work sample', 'Project', 'Award / honor', 'Certification', 'Community service', 'Leadership', 'Reflection', 'Other'];
const PORT_FIELDS = [
  { id: 'kind', type: 'select', label: 'Type', required: true, options: PORT_TYPES }, { id: 'date', type: 'date', label: 'Date', maxToday: true },
  { id: 'title', type: 'text', label: 'Title', required: true, span: 'sm:col-span-2' },
  { id: 'description', type: 'textarea', label: 'Description', rows: 3 },
  { id: 'url', type: 'text', label: 'Link (Google Drive, website, video…)', span: 'sm:col-span-2' },
  { id: 'hours', type: 'number', label: 'Service hours', min: 0, maxN: 2000, showIf: { id: 'kind', eq: 'Community service' } },
  { id: 'verifiedBy', type: 'text', label: 'Supervisor / verified by', showIf: { id: 'kind', eq: 'Community service' } },
];
const PORT_ICON = { 'Work sample': 'file-text', Project: 'lightbulb', 'Award / honor': 'award', Certification: 'badge-check', 'Community service': 'hand-heart', Leadership: 'flag', Reflection: 'notebook-pen', Other: 'star' };
async function portfolioTab(ctx, el, student, t, { rerender }) {
  const [list, acts, plan] = await Promise.all([
    recordList(ctx, 'portfolio', student),
    getDocs(query(tcol(ctx, 'activities'), where('members', 'array-contains', student.uid))).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    getDoc(tdoc(ctx, 'careerPlans', student.uid)).then(d => d.exists() ? d.data() : null).catch(() => null),
  ]);
  if (!live(t)) return;
  const self = student.uid === ctx.me.uid, staff = ctx.isRealTeacher;
  const canAdd = self || staff;
  const items = list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const hours = items.filter(x => x.kind === 'Community service').reduce((a, x) => a + (Number(x.hours) || 0), 0);
  const base = `/${ctx.slug}/record/${ctx.isStudent ? 'me' : student.uid}`;
  const safe = u => /^https?:\/\//i.test(u || '') ? u : '';
  el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">${tile('Portfolio items', items.length)}${tile('Service hours', hours)}${tile('Activities', acts.length)}${tile('Awards & certifications', items.filter(x => /Award|Certification/.test(x.kind)).length)}</div>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4"><p class="text-sm text-gray-400 max-w-2xl">${self ? 'Show off your best work, awards, service hours and certifications.' : 'Work samples, awards, service hours and certifications.'}</p>${canAdd ? btn('data-add', 'Add to portfolio', 'plus', 'primary') : ''}</div>
    ${items.length ? `<div class="grid md:grid-cols-2 gap-4 mb-6">${items.map(x => `<article class="card p-5 flex flex-col"><div class="flex items-start gap-3">${iconTile(PORT_ICON[x.kind] || 'star', /Award|Cert/.test(x.kind) ? 'amber' : x.kind === 'Community service' ? 'green' : 'violet')}<div class="flex-1 min-w-0"><div class="text-white font-medium">${escapeHtml(x.title || '')}</div><div class="text-[11px] text-gray-500">${escapeHtml(x.kind || '')}${x.date ? ' · ' + escapeHtml(fmtISO(x.date)) : ''}${x.hours ? ` · ${escapeHtml(x.hours)} hrs` : ''}</div></div>${(staff || x.addedBy === ctx.me.uid) ? rowBtns(x.id) : ''}</div>
        ${x.description ? `<p class="text-sm text-gray-300 mt-3 whitespace-pre-wrap">${escapeHtml(x.description)}</p>` : ''}
        <div class="mt-auto pt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">${safe(x.url) ? `<a href="${escapeHtml(safe(x.url))}" target="_blank" rel="noopener noreferrer" class="text-[#F59E0B] hover:underline inline-flex items-center gap-1">${ico('external-link', 'w-3.5 h-3.5')} Open</a>` : ''}${x.verifiedBy ? `<span>Verified by ${escapeHtml(x.verifiedBy)}</span>` : ''}<span>Added by ${escapeHtml(x.addedByName || '')}</span></div></article>`).join('')}</div>`
      : `<div class="mb-6">${emptyState({ icon: 'folder-heart', title: 'Nothing here yet', text: self ? 'Add a project you’re proud of, an award, or your service hours.' : 'Portfolio items will appear here.' })}</div>`}
    ${section('Activities & clubs', '', acts.length ? `<div class="flex flex-wrap gap-2 p-5">${acts.map(a => `<a href="${buildUrl(`/${ctx.slug}/activities/${a.id}`)}" class="badge badge-amber hover:opacity-80">${escapeHtml(a.name || '')}</a>`).join('')}</div>` : `<p class="text-sm text-gray-500 p-5">Not in any activities yet.${self ? ` <a href="${buildUrl(`/${ctx.slug}/activities`)}" class="text-[#F59E0B] hover:underline">Browse activities →</a>` : ''}</p>`)}
    ${section('Career plan', `<a href="${buildUrl(`${base}/career`)}" class="btn btn-ghost btn-sm">${self || staff ? 'Open plan' : 'View'} →</a>`, plan ? dl([['After high school', plan.path], ['Interests', (plan.clusters || []).join(', ')], ['Goals', plan.goals]]) : `<p class="text-sm text-gray-500 p-5">No career plan yet.</p>`)}`;
  bindRows(ctx, el, { name: 'portfolio', list: items, student, title: 'Portfolio item', icon: 'folder-heart', fields: PORT_FIELDS, rerender });
}

// ── Health Info ─────────────────────────────────────────────────────
const HEALTH_LISTS = {
  allergies: { title: 'Allergies', icon: 'triangle-alert', fields: [{ id: 'name', type: 'text', label: 'Allergy', required: true }, { id: 'severity', type: 'select', label: 'Severity', required: true, options: ['Mild', 'Moderate', 'Severe', 'Life-threatening'] }, { id: 'reaction', type: 'text', label: 'Reaction', span: 'sm:col-span-2' }, { id: 'epipen', type: 'yesno', label: 'EpiPen at school?' }, { id: 'plan', type: 'textarea', label: 'What to do', rows: 2 }] },
  conditions: { title: 'Health conditions', icon: 'stethoscope', fields: [{ id: 'name', type: 'text', label: 'Condition', required: true }, { id: 'notes', type: 'textarea', label: 'Notes / emergency plan', rows: 3 }] },
  medications: { title: 'Medications', icon: 'pill', fields: [{ id: 'name', type: 'text', label: 'Medication', required: true }, { id: 'dose', type: 'text', label: 'Dose' }, { id: 'time', type: 'text', label: 'When', placeholder: 'e.g. 12:00, as needed' }, { id: 'atSchool', type: 'yesno', label: 'Given at school?' }, { id: 'notes', type: 'text', label: 'Notes', span: 'sm:col-span-2' }] },
  immunizations: { title: 'Immunizations', icon: 'syringe', fields: [{ id: 'name', type: 'select', label: 'Vaccine', required: true, options: ['DTaP / Tdap', 'Polio (IPV)', 'MMR', 'Hepatitis B', 'Varicella', 'Meningococcal', 'HPV', 'Hib', 'Pneumococcal', 'Influenza', 'COVID-19', 'Other'] }, { id: 'dates', type: 'dates', label: 'Dates given' }, { id: 'notes', type: 'text', label: 'Notes' }] },
  screenings: { title: 'Screenings', icon: 'eye', fields: [{ id: 'name', type: 'select', label: 'Screening', required: true, options: ['Vision', 'Hearing', 'Scoliosis', 'Dental', 'BMI', 'Physical (sports)'] }, { id: 'date', type: 'date', label: 'Date', required: true, maxToday: true }, { id: 'result', type: 'select', label: 'Result', options: ['Passed', 'Referred for follow-up', 'Follow-up completed', 'Cleared'] }, { id: 'notes', type: 'text', label: 'Notes' }] },
  visits: { title: 'Nurse visits', icon: 'hospital', fields: [{ id: 'date', type: 'date', label: 'Date', required: true, maxToday: true }, { id: 'time', type: 'time', label: 'Time' }, { id: 'name', type: 'text', label: 'Reason', required: true }, { id: 'action', type: 'select', label: 'Outcome', options: ['Returned to class', 'Parent contacted', 'Sent home', 'Medication given', 'Ice / first aid', '911 called'] }, { id: 'notes', type: 'textarea', label: 'Notes', rows: 2 }] },
};
const HEALTH_GENERAL = [
  { id: 'immStatus', type: 'select', label: 'Immunization status', options: ['Complete', 'Incomplete', 'Temporary exemption', 'Religious exemption', 'Medical exemption'] },
  { id: 'bloodType', type: 'select', label: 'Blood type', options: ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−', 'Unknown'] },
  { id: 'physician', type: 'text', label: 'Physician' }, { id: 'physicianPhone', type: 'phone', label: 'Physician phone' },
  { id: 'dentist', type: 'text', label: 'Dentist' }, { id: 'insurance', type: 'text', label: 'Insurance' },
  { id: 'emergencyPlan', type: 'textarea', label: 'Emergency care plan', rows: 3 }, { id: 'restrictions', type: 'textarea', label: 'Activity or diet restrictions', rows: 2 },
];
async function healthTab(ctx, el, student, t, { rerender }) {
  const ref = tdoc(ctx, 'health', student.uid);
  const snap = await getDoc(ref).catch(() => null);
  if (!live(t)) return;
  const h = snap?.exists() ? snap.data() : {};
  const canEdit = ctx.can('health');
  const sev = s => s === 'Life-threatening' ? 'critical' : s === 'Severe' ? 'serious' : 'warning';
  const listHTML = (key, render) => {
    const arr = h[key] || [], meta = HEALTH_LISTS[key];
    return section(`${meta.title}${arr.length ? ` <span class="text-gray-500 font-normal">· ${arr.length}</span>` : ''}`, canEdit ? btn(`data-h-add="${key}"`, 'Add') : '',
      arr.length ? `<div class="divide-y divide-white/[0.05]">${arr.map((x, i) => `<div class="flex items-start gap-3 px-5 py-3"><div class="flex-1 min-w-0">${render(x)}</div>${canEdit ? `<button type="button" class="btn-icon" data-h-edit="${key}:${i}" aria-label="Edit">${ico('pencil', 'w-4 h-4')}</button><button type="button" class="btn-icon danger" data-h-del="${key}:${i}" aria-label="Delete">${ico('trash-2', 'w-4 h-4')}</button>` : ''}</div>`).join('')}</div>` : `<p class="text-sm text-gray-500 p-5">None on file.</p>`);
  };
  const severe = (h.allergies || []).filter(a => /Severe|Life/.test(a.severity));
  el.innerHTML = `${severe.length ? `<div class="mb-5 p-4 rounded-xl border border-[#d03b3b]/40 bg-[#d03b3b]/10 flex gap-3">${ico('octagon-alert', 'w-5 h-5 st-critical shrink-0')}<div><div class="text-white font-medium">Severe allergy</div><div class="text-sm text-gray-300">${severe.map(a => `${escapeHtml(a.name)}${a.epipen === 'Yes' ? ' (EpiPen at school)' : ''}`).join(' · ')}</div></div></div>` : ''}
    ${section('General', canEdit ? btn('data-h-general', 'Edit', 'pencil') : '', dl([['Immunization status', h.immStatus], ['Blood type', h.bloodType], ['Physician', [h.physician, h.physicianPhone].filter(Boolean).join(' · ')], ['Dentist', h.dentist], ['Insurance', ctx.isRealTeacher && !ctx.can('health') ? '' : h.insurance], ['Emergency care plan', h.emergencyPlan], ['Restrictions', h.restrictions]]))}
    <div class="grid lg:grid-cols-2 gap-x-5">
      <div>${listHTML('allergies', a => `<div class="flex flex-wrap items-center gap-2"><span class="text-sm text-white">${escapeHtml(a.name)}</span>${chip(sev(a.severity), a.severity || '')}${a.epipen === 'Yes' ? badge('EpiPen', 'red') : ''}</div>${a.reaction ? `<div class="text-xs text-gray-400 mt-0.5">${escapeHtml(a.reaction)}</div>` : ''}${a.plan ? `<div class="text-xs text-gray-500 mt-0.5">${escapeHtml(a.plan)}</div>` : ''}`)}
        ${listHTML('medications', m => `<div class="text-sm text-white">${escapeHtml(m.name)} ${m.atSchool === 'Yes' ? badge('At school', 'blue') : ''}</div><div class="text-xs text-gray-400">${escapeHtml([m.dose, m.time, m.notes].filter(Boolean).join(' · '))}</div>`)}
        ${listHTML('conditions', c => `<div class="text-sm text-white">${escapeHtml(c.name)}</div>${c.notes ? `<div class="text-xs text-gray-400 whitespace-pre-wrap">${escapeHtml(c.notes)}</div>` : ''}`)}</div>
      <div>${listHTML('immunizations', v => `<div class="text-sm text-white">${escapeHtml(v.name)}</div><div class="text-xs text-gray-400">${escapeHtml((v.dates || []).map(fmtISO).join(', ') || 'No dates recorded')}${v.notes ? ' · ' + escapeHtml(v.notes) : ''}</div>`)}
        ${listHTML('screenings', x => `<div class="text-sm text-white">${escapeHtml(x.name)} <span class="text-xs text-gray-500">${escapeHtml(fmtISO(x.date))}</span></div><div class="text-xs ${/Referred/.test(x.result || '') ? 'text-[#fab219]' : 'text-gray-400'}">${escapeHtml([x.result, x.notes].filter(Boolean).join(' · '))}</div>`)}
        ${listHTML('visits', v => `<div class="text-sm text-white">${escapeHtml(v.name)} <span class="text-xs text-gray-500">${escapeHtml(fmtISO(v.date))}${v.time ? ' ' + escapeHtml(fmtHM(v.time)) : ''}</span></div><div class="text-xs text-gray-400">${escapeHtml([v.action, v.notes].filter(Boolean).join(' · '))}</div>`)}</div>
    </div>
    <p class="hint">${ico('lock', 'w-3.5 h-3.5 inline -mt-0.5')} Health information is visible to the student, their family and school staff who need it. ${canEdit ? '' : 'Contact the school nurse to update it.'}</p>`;
  const save = async patch => { await setDoc(ref, { ...patch, studentUid: student.uid, updatedAt: serverTimestamp(), updatedBy: ctx.me.uid }, { merge: true }); toast('Saved'); rerender(); return true; };
  el.onclick = async e => {
    if (!canEdit) return;
    const { formModal } = await forms();
    if (e.target.closest('[data-h-general]')) return formModal({ title: 'Health — general', subtitle: displayNameOf(student), icon: 'heart-pulse', form: { sections: [{ fields: HEALTH_GENERAL }] }, data: Object.fromEntries(HEALTH_GENERAL.map(f => [f.id, h[f.id] || ''])), onSubmit: d => save(d) });
    const add = e.target.closest('[data-h-add]'), ed = e.target.closest('[data-h-edit]'), del = e.target.closest('[data-h-del]');
    if (add) { const key = add.dataset.hAdd, meta = HEALTH_LISTS[key]; return formModal({ title: `Add — ${meta.title.toLowerCase()}`, subtitle: displayNameOf(student), icon: meta.icon, form: { sections: [{ fields: meta.fields }] }, data: { date: todayISO() }, onSubmit: d => save({ [key]: [...(h[key] || []), d] }) }); }
    if (ed) { const [key, i] = ed.dataset.hEdit.split(':'), meta = HEALTH_LISTS[key]; return formModal({ title: `Edit — ${meta.title.toLowerCase()}`, subtitle: displayNameOf(student), icon: meta.icon, form: { sections: [{ fields: meta.fields }] }, data: h[key][+i], onSubmit: d => save({ [key]: h[key].map((x, j) => j === +i ? d : x) }) }); }
    if (del) { const [key, i] = del.dataset.hDel.split(':'); if (!await confirmDialog({ title: 'Delete this entry?', confirmLabel: 'Delete', danger: true })) return; try { await save({ [key]: h[key].filter((_, j) => j !== +i) }); } catch (ex) { toast(friendlyError(ex), 'error'); } }
  };
}
