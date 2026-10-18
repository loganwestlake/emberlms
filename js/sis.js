// Ember SIS — attendance, scheduling, report cards, family access, student records & services.
// Loaded on demand by app.js the first time an SIS page is opened.
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot, getDocs,
  serverTimestamp, arrayUnion, arrayRemove, writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
const {
  db, $, $$, ico, refreshIcons, escapeHtml, plural, displayNameOf, toDate, tsMillis, recency, formatDate, formatDateTime,
  timeAgo, toDateInput, render, setTitle, showError, iconTile, badge, avatar, skeletonRows, emptyState, errorBox, dataTable,
  toast, copyText, withBusy, openModal, modalHeader, modalBody, modalFooter, confirmDialog, buildUrl, navigate, live, unsubs,
  pageHeader, tenantPage, previewToggle, courseCol, cHref, loadAllItems, subsCol, hasGrade, itemPoints, typeMeta,
  GRADED_TYPES, courseHex, searchBox, panel, openComposeModal, routeTokenNow, randInt, renderRoute, districtShell, getDistrictSchools,
  notify, officeStaffUids, guardianUidsOf, notifItems, notifRow, notifUnread, markNotifRead, markAllNotifsRead, NOTIF_KINDS
} = globalThis.__ember; // helpers from app.js (see EMBER_API there)

// ═══════════════════════════════════════════════════════════════
// SETTINGS (bell schedule, terms, grade scale, report card template)
// ═══════════════════════════════════════════════════════════════
const DAYS = [['M', 'Mon'], ['T', 'Tue'], ['W', 'Wed'], ['R', 'Thu'], ['F', 'Fri']];
const GRADE_LEVELS = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const gradeLabel = g => g === undefined || g === null || g === '' ? '—' : g === 'K' ? 'Kindergarten' : `Grade ${g}`;
export const ATT_CODES = {
  P: { label: 'Present', short: 'P', tone: 'green', icon: 'check' },
  T: { label: 'Tardy', short: 'T', tone: 'amber', icon: 'clock' },
  A: { label: 'Absent', short: 'A', tone: 'red', icon: 'x' },
  E: { label: 'Excused', short: 'E', tone: 'blue', icon: 'file-check' },
};
const isAbsence = c => c === 'A' || c === 'E';

function defaultSettings() {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    schoolYear: `${y}–${y + 1}`,
    periods: [
      ['p1', 'Period 1', '08:00', '08:50'], ['p2', 'Period 2', '08:55', '09:45'], ['p3', 'Period 3', '09:50', '10:40'],
      ['p4', 'Period 4', '10:45', '11:35'], ['lunch', 'Lunch', '11:35', '12:10'], ['p5', 'Period 5', '12:15', '13:05'],
      ['p6', 'Period 6', '13:10', '14:00'], ['p7', 'Period 7', '14:05', '14:55'],
    ].map(([id, name, start, end]) => ({ id, name, start, end })),
    terms: [
      // Contiguous ranges (breaks belong to the following term) so every school day maps to a term.
      ['q1', 'Quarter 1', `${y}-08-01`, `${y}-10-16`], ['q2', 'Quarter 2', `${y}-10-17`, `${y}-12-31`],
      ['q3', 'Quarter 3', `${y + 1}-01-01`, `${y + 1}-03-13`], ['q4', 'Quarter 4', `${y + 1}-03-14`, `${y + 1}-06-30`],
    ].map(([id, name, start, end]) => ({ id, name, start, end })),
    gradeScale: [{ min: 90, letter: 'A' }, { min: 80, letter: 'B' }, { min: 70, letter: 'C' }, { min: 60, letter: 'D' }, { min: 0, letter: 'F' }],
    chronicThreshold: 10,
    publishedTerms: [],
    reportCard: { title: 'Report Card', principal: '', showAttendance: true, showComments: true, showScale: true, signatureLines: true, footer: '' },
  };
}
const settingsCache = new Map();
export async function getSettings(ctx, { fresh = false } = {}) {
  if (!fresh && settingsCache.has(ctx.slug)) return settingsCache.get(ctx.slug);
  let s = {};
  try { const d = await getDoc(doc(db, 'tenants', ctx.slug, 'sis', 'settings')); if (d.exists()) s = d.data(); } catch (e) { console.warn(e); }
  const def = defaultSettings();
  const merged = { ...def, ...s, reportCard: { ...def.reportCard, ...(s.reportCard || {}) } };
  settingsCache.set(ctx.slug, merged);
  return merged;
}
const todayISO = () => toDateInput(new Date());
const termRange = term => term ? { from: new Date(term.start + 'T00:00:00'), to: new Date(term.end + 'T23:59:59') } : null;
function currentTerm(settings, date = new Date()) {
  const iso = toDateInput(date);
  return settings.terms.find(t => t.start <= iso && iso <= t.end)
    || settings.terms.find(t => t.start > iso)              // between terms → the next one
    || [...settings.terms].reverse().find(t => t.end < iso) || settings.terms[0] || null;
}
function letterFor(pct, scale) {
  if (pct === null || pct === undefined || isNaN(pct)) return '';
  return ([...scale].sort((a, b) => b.min - a.min).find(s => pct >= Number(s.min)) || {}).letter || '';
}
const periodOrder = (settings, id) => { const i = settings.periods.findIndex(p => p.id === id); return i < 0 ? 999 : i; };
const periodName = (settings, id) => settings.periods.find(p => p.id === id)?.name || 'Unscheduled';
const fmtTime = hm => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const pct = (n, d) => d ? Math.round(n / d * 1000) / 10 : null;
const fmtPct = v => v === null || v === undefined ? '—' : `${v}%`;

// Status (fixed palette, always icon + label — never color alone)
const STATUS = { good: ['circle-check', 'st-good'], warning: ['triangle-alert', 'st-warning'], serious: ['circle-alert', 'st-serious'], critical: ['octagon-alert', 'st-critical'] };
const statusChip = (level, label) => `<span class="inline-flex items-center gap-1.5 text-xs text-gray-200 whitespace-nowrap">${ico(STATUS[level][0], 'w-3.5 h-3.5 ' + STATUS[level][1])}${escapeHtml(label)}</span>`;
const statTile = (label, value, sub = '', status = null) => `<div class="card p-5"><div class="text-xs text-gray-400 mb-2">${label}</div><div class="stat-value">${value}</div>${sub ? `<div class="mt-1 text-xs text-gray-500 flex items-center gap-1.5">${status ? ico(STATUS[status][0], 'w-3.5 h-3.5 ' + STATUS[status][1]) : ''}${sub}</div>` : ''}</div>`;

// ═══════════════════════════════════════════════════════════════
// DATA HELPERS
// ═══════════════════════════════════════════════════════════════
const tcol = (ctx, name) => collection(db, 'tenants', ctx.slug, name);
const tdoc = (ctx, name, id) => doc(db, 'tenants', ctx.slug, name, id);
async function loadStudents(ctx) {
  const snap = await getDocs(tcol(ctx, 'students'));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(s => s.status !== 'pending' && s.status !== 'rejected')
    .sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
}
async function loadStaff(ctx) {
  const snap = await getDocs(tcol(ctx, 'users'));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
}
async function loadAllCourses(ctx) {
  const snap = await getDocs(tcol(ctx, 'courses'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}
async function rosterOf(ctx, courseId) {
  const snap = await getDocs(courseCol(ctx, courseId, 'enrollments'));
  return snap.docs.map(d => ({ uid: d.id, name: d.data().studentName || d.data().username || 'Student', username: d.data().username || '' })).sort((a, b) => a.name.localeCompare(b.name));
}
async function studentDoc(ctx, sid) {
  const s = await getDoc(tdoc(ctx, 'students', sid));
  return s.exists() ? { uid: s.id, ...s.data() } : null;
}
async function recordsForStudent(ctx, sid) {
  const snap = await getDocs(query(tcol(ctx, 'attendance'), where('studentUid', '==', sid)));
  return snap.docs.map(d => d.data()).sort((a, b) => b.date.localeCompare(a.date) || periodCmp(a, b));
}
const periodCmp = (a, b) => String(a.periodId || '').localeCompare(String(b.periodId || ''));
function summarize(records, range = null) {
  const r = range ? records.filter(x => x.date >= toDateInput(range.from) && x.date <= toDateInput(range.to)) : records;
  const c = { P: 0, T: 0, A: 0, E: 0 };
  r.forEach(x => { if (c[x.code] !== undefined) c[x.code]++; });
  const total = r.length;
  return { ...c, total, absent: c.A + c.E, rate: pct(c.P + c.T, total), absenceRate: pct(c.A + c.E, total) };
}
function percentFor(items, subsByItem, range = null) {
  let got = 0, max = 0;
  for (const it of items) {
    if (!GRADED_TYPES.includes(it.type)) continue;
    const s = subsByItem.get(it.id);
    if (!hasGrade(s)) continue;
    if (range) { const d = toDate(it.data?.dueDate) || toDate(s.submittedAt); if (d && (d < range.from || d > range.to)) continue; }
    got += Number(s.grade); max += itemPoints(it);
  }
  return max ? Math.round(got / max * 1000) / 10 : null;
}
async function studentSubsMap(ctx, courseId, sid) {
  const snap = await getDocs(query(subsCol(ctx, courseId), where('studentId', '==', sid)));
  const m = new Map();
  snap.docs.forEach(d => { const s = d.data(); const p = m.get(s.itemId); if (!p || recency(s.submittedAt) > recency(p.submittedAt)) m.set(s.itemId, s); });
  return m;
}
async function studentCourses(ctx, student) {
  const ids = student.enrolledCourseIds || [];
  return (await Promise.all(ids.map(id => getDoc(doc(db, 'tenants', ctx.slug, 'courses', id)).then(c => c.exists() ? { id: c.id, ...c.data() } : null).catch(() => null)))).filter(Boolean);
}
async function studentGrades(ctx, student, settings, range = null) {
  const courses = await studentCourses(ctx, student);
  return Promise.all(courses.map(async c => {
    try {
      const [items, subs] = await Promise.all([loadAllItems(ctx, c.id), studentSubsMap(ctx, c.id, student.uid)]);
      const p = percentFor(items, subs, range);
      return { course: c, items, subs, percent: p, letter: letterFor(p, settings.gradeScale) };
    } catch (e) { return { course: c, items: [], subs: new Map(), percent: null, letter: '', error: e }; }
  }));
}
function canSeeStudent(ctx, sid) {
  if (ctx.isRealTeacher) return true;
  if (ctx.isStudent) return sid === ctx.me.uid;
  if (ctx.isGuardian) return (ctx.children || []).some(c => c.uid === sid);
  return false;
}

// ═══════════════════════════════════════════════════════════════
// CHARTS (inline SVG; single series ⇒ no legend; hover tooltip + table view)
// ═══════════════════════════════════════════════════════════════
const W = 640;
function tableView(head, rows) {
  return `<details class="mt-3"><summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300">View as table</summary>
    <div class="mt-2 max-h-60 overflow-y-auto"><table class="w-full text-xs"><thead><tr class="text-left text-gray-500">${head.map(h => `<th class="py-1.5 pr-4 font-medium">${h}</th>`).join('')}</tr></thead>
    <tbody class="tabular-nums">${rows.map(r => `<tr class="border-t border-white/[0.05]">${r.map(c => `<td class="py-1.5 pr-4 text-gray-300">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
function niceTicks(lo, hi, n = 4) { const step = (hi - lo) / n; return Array.from({ length: n + 1 }, (_, i) => Math.round((lo + step * i) * 10) / 10); }
export function vizLine(points, { label, format = v => `${v}%`, domain = null, xLabel = p => p.x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }) {
  if (!points.length) return { html: `<p class="text-sm text-gray-500 py-10 text-center">No attendance taken in this range yet.</p>`, mount() {} };
  const H = 240, ml = 44, mr = 60, mt = 16, mb = 30, iw = W - ml - mr, ih = H - mt - mb;
  const ys = points.map(p => p.y);
  // Round the axis to a clean step (1, 2, 5, 10, 25…) so ticks read 80/85/90/95/100, never 81.3.
  const autoLo = () => { const span = 100 - Math.max(0, Math.min(...ys) - 2); const step = [1, 2, 5, 10, 25].find(x => x * 4 >= span) || 25; return Math.max(0, 100 - step * 4); };
  let [lo, hi] = domain || [autoLo(), 100];
  if (hi <= lo) lo = hi - 10;
  const X = i => ml + (points.length === 1 ? iw / 2 : i * iw / (points.length - 1));
  const Y = v => mt + ih - (v - lo) / (hi - lo) * ih;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${line}L${X(points.length - 1).toFixed(1)},${Y(lo)}L${X(0).toFixed(1)},${Y(lo)}Z`;
  const ticks = niceTicks(lo, hi);
  const xIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const last = points[points.length - 1];
  const html = `<div class="viz" data-viz>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(label)}">
      ${ticks.map(t => `<line x1="${ml}" x2="${W - mr}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--viz-grid)" stroke-width="1"/><text x="${ml - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--viz-muted)" class="tabular-nums">${escapeHtml(format(t))}</text>`).join('')}
      <line x1="${ml}" x2="${W - mr}" y1="${Y(lo)}" y2="${Y(lo)}" stroke="var(--viz-axis)" stroke-width="1"/>
      ${xIdx.map(i => `<text x="${X(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}" font-size="11" fill="var(--viz-muted)">${escapeHtml(xLabel(points[i]))}</text>`).join('')}
      <path d="${area}" fill="var(--viz-1)" opacity="0.1"/>
      <path d="${line}" fill="none" stroke="var(--viz-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(points.length - 1)}" cy="${Y(last.y)}" r="4" fill="var(--viz-1)" stroke="var(--viz-surface)" stroke-width="2"/>
      <text x="${X(points.length - 1) + 10}" y="${Y(last.y) + 4}" font-size="12" font-weight="600" fill="var(--viz-text)">${escapeHtml(format(last.y))}</text>
      <line class="viz-cross" x1="0" x2="0" y1="${mt}" y2="${mt + ih}" stroke="var(--viz-axis)" stroke-width="1" visibility="hidden"/>
      <circle class="viz-dot" r="5" fill="var(--viz-1)" stroke="var(--viz-surface)" stroke-width="2" visibility="hidden"/>
      <rect class="viz-hit" x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg><div class="viz-tip" role="status"></div></div>`;
  return {
    html,
    mount(root) {
      const box = root.querySelector('[data-viz]'); if (!box) return;
      const svg = box.querySelector('svg'), tip = box.querySelector('.viz-tip'), cross = svg.querySelector('.viz-cross'), dot = svg.querySelector('.viz-dot');
      const show = clientX => {
        const r = svg.getBoundingClientRect(), k = r.width / W;
        const vx = (clientX - r.left) / k;
        const i = Math.max(0, Math.min(points.length - 1, Math.round(points.length === 1 ? 0 : (vx - ml) / iw * (points.length - 1))));
        const p = points[i];
        cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(p.y)); dot.setAttribute('visibility', 'visible');
        tip.innerHTML = `<div class="text-[11px] text-gray-400">${escapeHtml(p.x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}</div><div class="font-semibold">${escapeHtml(format(p.y))}</div>${p.detail ? `<div class="text-[11px] text-gray-400">${escapeHtml(p.detail)}</div>` : ''}`;
        tip.style.left = `${X(i) * k}px`; tip.style.top = `${Y(p.y) * k}px`; tip.classList.add('on');
      };
      const hide = () => { tip.classList.remove('on'); cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
      const hit = svg.querySelector('.viz-hit');
      hit.addEventListener('pointermove', e => show(e.clientX));
      hit.addEventListener('pointerleave', hide);
    }
  };
}
export function vizBars(cats, { label, format = v => `${v}%`, max = null }) {
  if (!cats.length || cats.every(c => !c.value)) return { html: `<p class="text-sm text-gray-500 py-10 text-center">No data yet.</p>`, mount() {} };
  const H = 220, ml = 40, mr = 12, mt = 24, mb = 30, iw = W - ml - mr, ih = H - mt - mb;
  const top = max || Math.max(5, Math.ceil(Math.max(...cats.map(c => c.value)) / 5) * 5);
  const band = iw / cats.length, bw = Math.min(24, band * 0.6);
  const Y = v => mt + ih - v / top * ih;
  const bar = (x, y, w, base) => { const r = Math.min(4, w / 2, base - y); return `M${x},${base}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${base}Z`; };
  const ticks = niceTicks(0, top);
  const html = `<div class="viz" data-viz>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(label)}">
      ${ticks.map(t => `<line x1="${ml}" x2="${W - mr}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--viz-grid)" stroke-width="1"/><text x="${ml - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--viz-muted)" class="tabular-nums">${escapeHtml(format(t))}</text>`).join('')}
      ${cats.map((c, i) => { const cx = ml + band * i + band / 2, x = cx - bw / 2, y = Y(c.value); return `
        ${c.value > 0 ? `<path d="${bar(x, y, bw, Y(0))}" fill="var(--viz-1)"/>` : ''}
        <text x="${cx}" y="${y - 6}" text-anchor="middle" font-size="11" fill="var(--viz-text-2)" class="tabular-nums">${escapeHtml(format(c.value))}</text>
        <text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--viz-muted)">${escapeHtml(c.label)}</text>
        <rect class="viz-bar-hit" data-i="${i}" x="${ml + band * i}" y="${mt}" width="${band}" height="${ih}" fill="transparent"/>`; }).join('')}
      <line x1="${ml}" x2="${W - mr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--viz-axis)" stroke-width="1"/>
    </svg><div class="viz-tip" role="status"></div></div>`;
  return {
    html,
    mount(root) {
      const box = root.querySelector('[data-viz]'); if (!box) return;
      const svg = box.querySelector('svg'), tip = box.querySelector('.viz-tip');
      svg.querySelectorAll('.viz-bar-hit').forEach(h => {
        h.addEventListener('pointerenter', () => {
          const i = +h.dataset.i, c = cats[i], k = svg.getBoundingClientRect().width / W;
          tip.innerHTML = `<div class="text-[11px] text-gray-400">${escapeHtml(c.label)}</div><div class="font-semibold">${escapeHtml(format(c.value))}</div>${c.detail ? `<div class="text-[11px] text-gray-400">${escapeHtml(c.detail)}</div>` : ''}`;
          tip.style.left = `${(ml + band * i + band / 2) * k}px`; tip.style.top = `${Y(c.value) * k}px`; tip.classList.add('on');
        });
        h.addEventListener('pointerleave', () => tip.classList.remove('on'));
      });
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// ROLL CALL (course → Attendance)
// ═══════════════════════════════════════════════════════════════
export async function viewRollCall(ctx, course) {
  if (ctx.studentView) return viewMyCourseAttendance(ctx, course);
  const t = routeTokenNow();
  setTitle('Attendance', course.title);
  const settings = await getSettings(ctx);
  const qd = new URLSearchParams(location.search).get('date') || '';
  let date = /^\d{4}-\d{2}-\d{2}$/.test(qd) && qd <= todayISO() ? qd : todayISO();
  render(tenantPage(ctx, 'attendance', pageHeader({
    eyebrow: escapeHtml(course.title || ''), title: 'Attendance',
    subtitle: `${escapeHtml(periodName(settings, course.periodId))}${course.room ? ' · Room ' + escapeHtml(course.room) : ''}`,
    actions: `<label class="sr-only" for="rc-date">Date</label><input id="rc-date" type="date" class="input !py-2 !w-auto" value="${escapeHtml(date)}" max="${todayISO()}">`
  }) + `<div class="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-8 max-w-6xl"><div id="rc-main" class="min-w-0">${skeletonRows(6)}</div><aside id="rc-side" class="space-y-6"></aside></div>`, course));
  let roster = [], marks = {}, notes = {}, savedAt = null, flags = {}, loadedMarks = {};
  const main = $('#rc-main');
  const load = async () => {
    main.innerHTML = skeletonRows(6);
    const want = date; // a slower load for a previous date must not overwrite this one
    try {
      const [r, recs, studs, sess] = await Promise.all([
        rosterOf(ctx, course.id),
        getDocs(query(tcol(ctx, 'attendance'), where('courseId', '==', course.id), where('date', '==', date))),
        loadStudents(ctx).catch(() => []),
        getDoc(tdoc(ctx, 'attendanceSessions', `${date}_${course.id}`)),
      ]);
      if (!live(t) || want !== date) return;
      roster = r; marks = {}; notes = {};
      recs.docs.forEach(d => { const x = d.data(); marks[x.studentUid] = x.code; if (x.note) notes[x.studentUid] = x.note; });
      loadedMarks = { ...marks };
      savedAt = sess.exists() ? sess.data().takenAt : null;
      flags = Object.fromEntries(studs.map(s => [s.uid, s]));
      draw();
      drawSide();
    } catch (e) { console.error(e); if (live(t)) { main.innerHTML = errorBox(e); refreshIcons(); } }
  };
  const flagIcons = s => !s ? '' : [
    s.iep ? `<span class="badge badge-violet" title="Has an IEP — see accommodations">IEP</span>` : '',
    s.plan504 ? `<span class="badge badge-blue" title="Has a 504 plan">504</span>` : '',
    s.ell ? `<span class="badge badge-muted" title="English language learner">ELL</span>` : '',
    (s.alerts || []).length ? `<span title="${escapeHtml((s.alerts || []).map(a => a.text).join(' · '))}">${ico('triangle-alert', 'w-3.5 h-3.5 st-warning')}</span>` : '',
  ].join(' ');
  const draw = () => {
    if (!roster.length) { main.innerHTML = emptyState({ icon: 'users', title: 'No students enrolled', text: 'Enroll students from the People page to take attendance.', action: `<a href="${cHref(ctx, course.id, 'people')}" class="btn btn-primary">${ico('user-plus')} Go to People</a>` }); refreshIcons(); return; }
    const counts = { P: 0, T: 0, A: 0, E: 0 }; Object.values(marks).forEach(c => counts[c] !== undefined && counts[c]++);
    const unmarked = roster.filter(s => !marks[s.uid]).length;
    main.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div class="flex flex-wrap items-center gap-3 text-xs text-gray-400">${Object.entries(ATT_CODES).map(([k, v]) => `<span class="inline-flex items-center gap-1">${badge(v.short, v.tone)} ${v.label} <span class="tabular-nums text-white">${counts[k]}</span></span>`).join('')}${unmarked ? `<span class="text-gray-500">· ${unmarked} not marked</span>` : ''}</div>
        <div class="flex gap-2"><button data-rc="all-present" class="btn btn-secondary btn-sm">${ico('check-check', 'w-3.5 h-3.5')} Mark all present</button></div>
      </div>
      <div class="card overflow-hidden divide-y divide-white/[0.05]">${roster.map(s => `
        <div class="flex flex-wrap sm:flex-nowrap items-center gap-3 px-4 sm:px-5 py-3">
          ${avatar(s.name)}
          <div class="min-w-0 flex-1"><a href="${buildUrl(`/${ctx.slug}/record/${s.uid}`)}" class="text-sm text-white hover:text-[#F59E0B] truncate block">${escapeHtml(s.name)}</a><div class="flex items-center gap-1.5 mt-0.5">${flagIcons(flags[s.uid])}</div></div>
          <div class="segmented shrink-0" role="radiogroup" aria-label="Attendance for ${escapeHtml(s.name)}">${Object.entries(ATT_CODES).map(([k, v]) => `<button type="button" role="radio" data-mark="${k}" data-sid="${s.uid}" aria-checked="${marks[s.uid] === k}" aria-pressed="${marks[s.uid] === k}" title="${v.label}" class="!px-3 tabular-nums">${v.short}</button>`).join('')}</div>
          <button type="button" class="btn-icon ${notes[s.uid] ? '!text-[#F59E0B]' : ''}" data-note="${s.uid}" aria-label="Note for ${escapeHtml(s.name)}" title="${escapeHtml(notes[s.uid] || 'Add a note')}">${ico('sticky-note', 'w-4 h-4')}</button>
        </div>`).join('')}</div>
      <div class="sticky bottom-0 mt-4 py-3 bg-[#0A0A0A]/90 backdrop-blur flex flex-wrap items-center gap-3">
        <button data-rc="save" class="btn btn-primary">${ico('save', 'w-4 h-4')} Save attendance</button>
        <span class="text-xs text-gray-500">${savedAt ? `Saved ${escapeHtml(formatDateTime(savedAt) || 'just now')}` : 'Not taken yet for ' + escapeHtml(new Date(date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))}</span>
      </div>`;
    refreshIcons();
  };
  const drawSide = async () => {
    const side = $('#rc-side'); if (!side) return;
    try {
      const [sessSnap, recSnap] = await Promise.all([
        getDocs(query(tcol(ctx, 'attendanceSessions'), where('courseId', '==', course.id))),
        getDocs(query(tcol(ctx, 'attendance'), where('courseId', '==', course.id))),
      ]);
      if (!live(t) || !side.isConnected) return;
      const sessions = sessSnap.docs.map(d => d.data()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
      const term = currentTerm(settings); const range = termRange(term);
      const per = {};
      recSnap.docs.map(d => d.data()).filter(r => !range || (r.date >= term.start && r.date <= term.end)).forEach(r => { (per[r.studentUid] ||= { name: r.studentName, A: 0, T: 0, E: 0, n: 0 }); per[r.studentUid].n++; if (per[r.studentUid][r.code] !== undefined) per[r.studentUid][r.code]++; });
      const worst = Object.entries(per).map(([uid, v]) => ({ uid, ...v, abs: v.A + v.E })).filter(v => v.abs || v.T).sort((a, b) => b.abs - a.abs || b.T - a.T).slice(0, 6);
      side.innerHTML = panel('Recent days', sessions.length ? sessions.map(s => `<button data-goto-date="${s.date}" class="w-full flex items-center justify-between gap-2 px-2.5 py-2 -mx-2.5 rounded-lg hover:bg-white/[0.04] text-left ${s.date === date ? 'bg-white/[0.05]' : ''}"><span class="text-sm text-white">${escapeHtml(new Date(s.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}</span><span class="text-[11px] text-gray-500 tabular-nums">${s.counts?.A || 0} A · ${s.counts?.T || 0} T</span></button>`).join('') : `<p class="text-sm text-gray-500">No attendance taken yet.</p>`)
        + panel(`${escapeHtml(term?.name || 'This term')} — most missed`, worst.length ? worst.map(w => `<a href="${buildUrl(`/${ctx.slug}/record/${w.uid}/attendance`)}" class="flex items-center justify-between gap-2 px-2.5 py-2 -mx-2.5 rounded-lg hover:bg-white/[0.04]"><span class="text-sm text-white truncate">${escapeHtml(w.name || '')}</span><span class="text-[11px] text-gray-400 tabular-nums shrink-0">${w.abs} absent · ${w.T} tardy</span></a>`).join('') : `<p class="text-sm text-gray-500">No absences this term.</p>`);
      refreshIcons();
    } catch (e) { console.warn(e); }
  };
  const save = async btn => {
    const missing = roster.filter(s => !marks[s.uid]);
    if (missing.length && !await confirmDialog({ title: `Mark ${plural(missing.length, 'student')} present?`, message: `${missing.map(s => s.name).slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''} ${missing.length === 1 ? "hasn't" : "haven't"} been marked.`, confirmLabel: 'Mark present & save' })) return;
    missing.forEach(s => { marks[s.uid] = 'P'; });
    await withBusy(btn, 'Saving…', async () => {
      try {
        const batch = writeBatch(db);
        const counts = { P: 0, T: 0, A: 0, E: 0 };
        roster.forEach(s => {
          const code = marks[s.uid]; counts[code]++;
          batch.set(tdoc(ctx, 'attendance', `${date}_${course.id}_${s.uid}`), {
            date, courseId: course.id, courseTitle: course.title || '', periodId: course.periodId || null, studentUid: s.uid, studentName: s.name,
            gradeLevel: flags[s.uid]?.gradeLevel ?? null, code, note: notes[s.uid] || '', takenBy: ctx.me.uid, updatedAt: serverTimestamp()
          });
        });
        batch.set(tdoc(ctx, 'attendanceSessions', `${date}_${course.id}`), { date, courseId: course.id, courseTitle: course.title || '', periodId: course.periodId || null, teacherUid: course.ownerUid || ctx.me.uid, counts, total: roster.length, takenBy: ctx.me.uid, takenAt: serverTimestamp() });
        await batch.commit();
        // Families hear about new absences/tardies once (not again on every re-save).
        const changed = roster.filter(s => ['A', 'T'].includes(marks[s.uid]) && loadedMarks[s.uid] !== marks[s.uid]);
        loadedMarks = { ...marks };
        const when = new Date(date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        changed.forEach(s => guardianUidsOf(ctx, [s.uid]).then(to => notify(ctx, { to, kind: 'attendance', title: `${s.name} was marked ${ATT_CODES[marks[s.uid]].label.toLowerCase()}`, body: `${course.title || 'Class'}${course.periodId ? ' · ' + periodName(settings, course.periodId) : ''} · ${when}`, link: `/${ctx.slug}/record/${s.uid}/attendance` })).catch(e => console.warn(e)));
        savedAt = new Date(); toast('Attendance saved'); draw(); drawSide();
      } catch (e) { console.error(e); toast(e.message || 'Could not save', 'error'); }
    });
  };
  $('#main').addEventListener('click', async e => {
    const m = e.target.closest('[data-mark]');
    if (m) { marks[m.dataset.sid] = m.dataset.mark; return draw(); }
    const n = e.target.closest('[data-note]');
    if (n) {
      const sid = n.dataset.note; const s = roster.find(x => x.uid === sid);
      const md = openModal({ size: 'sm', html: `<form class="p-6" novalidate><h2 class="font-serif text-xl text-white mb-4">Note for ${escapeHtml(s.name)}</h2><textarea id="rc-note" rows="3" class="input" placeholder="Arrived 10 min late — bus delay">${escapeHtml(notes[sid] || '')}</textarea><div class="flex gap-3 mt-5"><button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button class="btn btn-primary flex-1">Save note</button></div></form>` });
      md.$('form').addEventListener('submit', ev => { ev.preventDefault(); notes[sid] = md.$('#rc-note').value.trim(); md.close(); draw(); });
      return;
    }
    const a = e.target.closest('[data-rc]');
    if (a?.dataset.rc === 'all-present') { roster.forEach(s => { marks[s.uid] = 'P'; }); return draw(); }
    if (a?.dataset.rc === 'save') return save(a);
    const g = e.target.closest('[data-goto-date]');
    if (g) { date = g.dataset.gotoDate; $('#rc-date').value = date; load(); }
  });
  $('#rc-date').addEventListener('change', e => { if (e.target.value) { date = e.target.value; load(); } });
  load();
}
async function viewMyCourseAttendance(ctx, course) {
  const t = routeTokenNow();
  setTitle('Attendance', course.title);
  render(tenantPage(ctx, 'attendance', pageHeader({ eyebrow: escapeHtml(course.title || ''), title: 'My attendance', actions: previewToggle(ctx) }) + `<div id="ma" class="max-w-3xl">${skeletonRows(4)}</div>`, course));
  try {
    const snap = await getDocs(query(tcol(ctx, 'attendance'), where('studentUid', '==', ctx.me.uid)));
    if (!live(t)) return;
    const recs = snap.docs.map(d => d.data()).filter(r => r.courseId === course.id).sort((a, b) => b.date.localeCompare(a.date));
    $('#ma').innerHTML = recordsHTML(recs, { showCourse: false });
    refreshIcons();
  } catch (e) { $('#ma').innerHTML = errorBox(e); refreshIcons(); }
}
function recordsHTML(recs, { showCourse = true } = {}) {
  const s = summarize(recs);
  if (!recs.length) return emptyState({ icon: 'calendar-check', title: 'No attendance recorded yet' });
  const notPresent = recs.filter(r => r.code !== 'P');
  return `<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      ${statTile('Attendance rate', fmtPct(s.rate), `${s.total} class sessions`)}
      ${statTile('Absences', s.absent, `${s.E} excused`)}
      ${statTile('Tardies', s.T)}
      ${statTile('Present', s.P)}
    </div>
    <h2 class="label">Absences & tardies</h2>
    ${notPresent.length ? `<div class="card overflow-hidden divide-y divide-white/[0.05]">${notPresent.map(r => `<div class="flex items-center gap-3 px-5 py-3">
      ${badge(ATT_CODES[r.code]?.label || r.code, ATT_CODES[r.code]?.tone || 'muted')}
      <div class="flex-1 min-w-0"><div class="text-sm text-white">${escapeHtml(new Date(r.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</div>
      <div class="text-[11px] text-gray-500 truncate">${showCourse ? escapeHtml(r.courseTitle || '') : ''}${r.note ? (showCourse ? ' · ' : '') + escapeHtml(r.note) : ''}</div></div></div>`).join('')}</div>`
      : `<p class="text-sm text-gray-500">Perfect attendance so far.</p>`}`;
}

// ═══════════════════════════════════════════════════════════════
// OFFICE: ATTENDANCE DASHBOARD & TRENDS
// ═══════════════════════════════════════════════════════════════
export async function viewAttendanceOffice(ctx) {
  const t = routeTokenNow();
  setTitle('Attendance', ctx.tenant.name);
  const settings = await getSettings(ctx);
  let tab = new URLSearchParams(location.search).get('tab') || 'today';
  let date = todayISO(), range = '30';
  render(tenantPage(ctx, 'sis-attendance', pageHeader({ eyebrow: 'Office', title: 'Attendance', subtitle: escapeHtml(settings.schoolYear) }) + `
    <div class="max-w-6xl"><div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div class="segmented" role="tablist"><button data-tab="today">Daily</button><button data-tab="trends">Trends</button><button data-tab="chronic">Chronic absence</button></div>
      <div id="att-controls" class="flex items-center gap-2"></div></div>
      <div id="att-body">${skeletonRows(4, 'h-24')}</div></div>`));
  let cache = { students: null, courses: null, staff: null };
  const ensureBase = async () => {
    if (!cache.students) [cache.students, cache.courses, cache.staff] = await Promise.all([loadStudents(ctx), loadAllCourses(ctx), loadStaff(ctx).catch(() => [])]);
  };
  const body = $('#att-body'), controls = $('#att-controls');
  const fromISO = () => {
    if (range.startsWith('term:')) return settings.terms.find(x => x.id === range.slice(5))?.start || todayISO();
    const d = new Date(); d.setDate(d.getDate() - Number(range)); return toDateInput(d);
  };
  const toISO = () => range.startsWith('term:') ? (settings.terms.find(x => x.id === range.slice(5))?.end || todayISO()) : todayISO();
  const rangeSelect = () => `<label class="sr-only" for="att-range">Range</label><select id="att-range" class="input !py-2 !w-auto">${[['30', 'Last 30 days'], ['90', 'Last 90 days'], ...settings.terms.map(x => [`term:${x.id}`, x.name])].map(([v, l]) => `<option value="${v}" ${v === range ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
  let drawSeq = 0; // only the latest tab/range request may render
  const draw = async () => {
    const my = ++drawSeq;
    $$('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    body.innerHTML = skeletonRows(4, 'h-24');
    try {
      await ensureBase();
      if (!live(t) || my !== drawSeq) return;
      if (tab === 'today') {
        controls.innerHTML = `<label class="sr-only" for="att-date">Date</label><input id="att-date" type="date" class="input !py-2 !w-auto" value="${date}" max="${todayISO()}">`;
        const [sessSnap, recSnap] = await Promise.all([
          getDocs(query(tcol(ctx, 'attendanceSessions'), where('date', '==', date))),
          getDocs(query(tcol(ctx, 'attendance'), where('date', '==', date))),
        ]);
        if (!live(t) || my !== drawSeq) return;
        const taken = new Set(sessSnap.docs.map(d => d.data().courseId));
        const scheduled = cache.courses.filter(c => c.periodId);
        const pool = scheduled.length ? scheduled : cache.courses;
        const notTaken = pool.filter(c => !taken.has(c.id)).sort((a, b) => periodOrder(settings, a.periodId) - periodOrder(settings, b.periodId));
        const recs = recSnap.docs.map(d => d.data());
        const s = summarize(recs);
        const byStudent = {};
        recs.filter(r => r.code !== 'P').forEach(r => { (byStudent[r.studentUid] ||= { name: r.studentName, grade: r.gradeLevel, list: [] }).list.push(r); });
        const staffName = uid => displayNameOf(cache.staff.find(x => x.uid === uid)) || 'Teacher';
        body.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
            ${statTile('Classes taken', `${pool.length - notTaken.length}<span class="text-gray-500 text-lg">/${pool.length}</span>`, notTaken.length ? `${notTaken.length} still to take` : 'All classes taken', notTaken.length ? 'warning' : 'good')}
            ${statTile('Attendance rate', fmtPct(s.rate), `${s.total} student-periods`)}
            ${statTile('Absent', s.absent, `${s.E} excused`)}
            ${statTile('Tardy', s.T)}
          </div>
          <div class="grid lg:grid-cols-2 gap-6">
            <section><h2 class="label">Absent & tardy · ${Object.keys(byStudent).length} students</h2>${Object.keys(byStudent).length ? `<div class="card overflow-hidden divide-y divide-white/[0.05]">${Object.entries(byStudent).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([uid, v]) => `
              <div class="flex items-center gap-3 px-5 py-3">${avatar(v.name)}<div class="flex-1 min-w-0"><a href="${buildUrl(`/${ctx.slug}/record/${uid}/attendance`)}" class="text-sm text-white hover:text-[#F59E0B] truncate block">${escapeHtml(v.name)}</a>
                <div class="flex flex-wrap gap-1 mt-1">${v.list.sort((a, b) => periodOrder(settings, a.periodId) - periodOrder(settings, b.periodId)).map(r => `<span class="badge badge-${ATT_CODES[r.code]?.tone || 'muted'}" title="${escapeHtml(r.courseTitle)}">${escapeHtml(periodName(settings, r.periodId).replace('Period ', 'P'))} · ${r.code}</span>`).join('')}</div></div>
                <button class="btn-icon" data-contact="${uid}" data-name="${escapeHtml(v.name)}" aria-label="Message ${escapeHtml(v.name)}'s family" title="Message family">${ico('mail', 'w-4 h-4')}</button></div>`).join('')}</div>` : `<p class="text-sm text-gray-500">${recs.length ? 'Everyone is present.' : 'No attendance recorded for this day yet.'}</p>`}</section>
            <section><h2 class="label">Not taken yet · ${notTaken.length}</h2>${notTaken.length ? `<div class="card overflow-hidden divide-y divide-white/[0.05]">${notTaken.map(c => `
              <div class="flex items-center gap-3 px-5 py-3"><span class="w-2 h-2 rounded-full shrink-0" style="background:${courseHex(c)}"></span><div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(c.title || '')}</div><div class="text-[11px] text-gray-500 truncate">${escapeHtml(periodName(settings, c.periodId))} · ${escapeHtml(c.ownerName || staffName(c.ownerUid))}</div></div>
              ${c.ownerUid && c.ownerUid !== ctx.me.uid ? `<button class="btn btn-ghost btn-sm" data-remind="${c.id}">Remind</button>` : ''}</div>`).join('')}</div>` : `<p class="text-sm text-gray-500">${statusChip('good', 'Every class has taken attendance.')}</p>`}
              ${!scheduled.length && cache.courses.length ? `<p class="hint mt-3">Tip: give courses a period in the Master schedule so only scheduled classes are tracked here.</p>` : ''}</section>
          </div>`;
        refreshIcons();
        $('#att-date').addEventListener('change', e => { if (e.target.value) { date = e.target.value; draw(); } });
        return;
      }
      controls.innerHTML = rangeSelect();
      $('#att-range').addEventListener('change', e => { range = e.target.value; draw(); });
      const from = fromISO(), to = toISO();
      if (tab === 'trends') {
        const [sessSnap, recSnap] = await Promise.all([
          getDocs(query(tcol(ctx, 'attendanceSessions'), where('date', '>=', from))),
          getDocs(query(tcol(ctx, 'attendance'), where('date', '>=', from))),
        ]);
        if (!live(t) || my !== drawSeq) return;
        const sessions = sessSnap.docs.map(d => d.data()).filter(x => x.date <= to);
        const recs = recSnap.docs.map(d => d.data()).filter(x => x.date <= to);
        const days = {};
        sessions.forEach(x => { const d = (days[x.date] ||= { P: 0, T: 0, A: 0, E: 0, n: 0 }); Object.entries(x.counts || {}).forEach(([k, v]) => { if (d[k] !== undefined) d[k] += v; }); d.n += x.total || 0; });
        const points = Object.keys(days).sort().map(k => { const d = days[k]; return { x: new Date(k + 'T12:00'), y: pct(d.P + d.T, d.n) ?? 0, detail: `${d.A + d.E} absent · ${d.T} tardy of ${d.n}` }; });
        const wk = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
        const wAgg = {}; recs.forEach(r => { const d = new Date(r.date + 'T12:00').getDay(); if (!wk[d]) return; const w = (wAgg[d] ||= { abs: 0, n: 0 }); w.n++; if (isAbsence(r.code)) w.abs++; });
        const gradeOf = Object.fromEntries(cache.students.map(s => [s.uid, s.gradeLevel]));
        const gAgg = {}; recs.forEach(r => { const g = r.gradeLevel ?? gradeOf[r.studentUid]; if (g === undefined || g === null || g === '') return; const x = (gAgg[g] ||= { abs: 0, n: 0 }); x.n++; if (isAbsence(r.code)) x.abs++; });
        const all = summarize(recs);
        const perStudent = chronicList(recs, settings.chronicThreshold);
        const line = vizLine(points, { label: 'Daily attendance rate' });
        const weekday = vizBars(Object.keys(wk).map(d => ({ label: wk[d], value: pct(wAgg[d]?.abs || 0, wAgg[d]?.n || 0) || 0, detail: `${wAgg[d]?.abs || 0} of ${wAgg[d]?.n || 0} student-periods` })), { label: 'Absence rate by weekday' });
        const grades = GRADE_LEVELS.filter(g => gAgg[g]);
        const byGrade = vizBars(grades.map(g => ({ label: g === 'K' ? 'K' : `Gr ${g}`, value: pct(gAgg[g].abs, gAgg[g].n) || 0, detail: `${gAgg[g].abs} of ${gAgg[g].n} student-periods` })), { label: 'Absence rate by grade level' });
        body.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
            ${statTile('Average daily attendance', fmtPct(all.rate), `${Object.keys(days).length} school days`)}
            ${statTile('Absences', all.absent.toLocaleString(), `${all.E} excused`)}
            ${statTile('Tardies', all.T.toLocaleString())}
            ${statTile('Chronically absent', perStudent.filter(x => x.level !== 'warning').length, `missing ≥ ${settings.chronicThreshold}% of class time`, perStudent.some(x => x.level === 'critical') ? 'critical' : perStudent.some(x => x.level === 'serious') ? 'serious' : 'good')}
          </div>
          <section class="card p-5 sm:p-6 mb-6"><h2 class="text-sm text-white font-medium">Daily attendance rate</h2><p class="text-xs text-gray-500 mb-4">Present + tardy as a share of all student-periods recorded each day.</p>${line.html}${tableView(['Date', 'Rate', 'Absent / tardy'], points.map(p => [escapeHtml(p.x.toLocaleDateString()), fmtPct(p.y), escapeHtml(p.detail)]))}</section>
          <div class="grid lg:grid-cols-2 gap-6">
            <section class="card p-5 sm:p-6"><h2 class="text-sm text-white font-medium">Absence rate by weekday</h2><p class="text-xs text-gray-500 mb-4">Spot Monday/Friday patterns.</p>${weekday.html}</section>
            <section class="card p-5 sm:p-6"><h2 class="text-sm text-white font-medium">Absence rate by grade level</h2><p class="text-xs text-gray-500 mb-4">Uses each student's grade level from their record.</p>${byGrade.html}</section>
          </div>`;
        body.querySelectorAll('[data-viz]').forEach((el, i) => [line, weekday, byGrade][i]?.mount(el.parentElement));
        refreshIcons();
        return;
      }
      // chronic
      const recSnap = await getDocs(query(tcol(ctx, 'attendance'), where('date', '>=', from)));
      if (!live(t) || my !== drawSeq) return;
      const list = chronicList(recSnap.docs.map(d => d.data()).filter(x => x.date <= to), settings.chronicThreshold);
      const labels = { critical: 'Severe', serious: 'Chronic', warning: 'At risk' };
      body.innerHTML = `<p class="text-sm text-gray-400 mb-4 max-w-3xl">Students missing ${settings.chronicThreshold}% or more of their class time (excused and unexcused) are <strong class="text-white">chronically absent</strong>; ${Math.max(20, settings.chronicThreshold)}%+ is severe. Students at ${Math.min(5, settings.chronicThreshold / 2)}–${settings.chronicThreshold}% are flagged as at risk so you can intervene early.</p>
        <div class="flex justify-end mb-3"><button id="chronic-csv" class="btn btn-secondary btn-sm" ${list.length ? '' : 'disabled'}>${ico('download', 'w-3.5 h-3.5')} Export CSV</button></div>
        ${list.length ? dataTable(
          [{ label: 'Student', cls: 'col-span-12 sm:col-span-4' }, { label: 'Status', cls: 'col-span-6 sm:col-span-2' }, { label: 'Missed', cls: 'col-span-6 sm:col-span-2 text-right' }, { label: 'Absences', cls: 'col-span-4 sm:col-span-2 text-right' }, { label: '', cls: 'col-span-8 sm:col-span-2 text-right' }],
          list.map(x => ({ cells: [
            `<a href="${buildUrl(`/${ctx.slug}/record/${x.uid}/attendance`)}" class="flex items-center gap-3">${avatar(x.name)}<span class="min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(x.name)}</span><span class="block text-[11px] text-gray-500">${escapeHtml(gradeLabel(x.grade))}</span></span></a>`,
            statusChip(x.level, labels[x.level]),
            `<span class="text-sm text-white tabular-nums block text-right">${x.rate}%</span>`,
            `<span class="text-xs text-gray-400 tabular-nums block text-right">${x.abs} of ${x.n}</span>`,
            `<div class="flex justify-end"><button class="btn btn-ghost btn-sm" data-contact="${x.uid}" data-name="${escapeHtml(x.name)}">${ico('mail', 'w-3.5 h-3.5')} Family</button></div>`
          ] }))) : emptyState({ icon: 'circle-check', tone: 'green', title: 'No students at risk', text: `Nobody has missed ${Math.min(5, settings.chronicThreshold / 2)}% or more of their classes in this range.` })}`;
      refreshIcons();
      $('#chronic-csv')?.addEventListener('click', () => downloadCSV('chronic-absence.csv', [['Student', 'Grade', 'Status', 'Missed %', 'Absences', 'Sessions'], ...list.map(x => [x.name, x.grade ?? '', labels[x.level], x.rate, x.abs, x.n])]));
    } catch (e) { console.error(e); if (live(t)) { body.innerHTML = errorBox(e); refreshIcons(); } }
  };
  $('#main').addEventListener('click', async e => {
    const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; return draw(); }
    const c = e.target.closest('[data-contact]'); if (c) return contactFamily(ctx, c.dataset.contact, c.dataset.name);
    const r = e.target.closest('[data-remind]');
    if (r) { const course = cache.courses.find(x => x.id === r.dataset.remind); return openComposeModal(ctx, { courseId: course.id, to: [course.ownerUid], subject: `Attendance for ${course.title}` }); }
  });
  draw();
}
function chronicList(recs, threshold) {
  const per = {};
  recs.forEach(r => { const p = (per[r.studentUid] ||= { uid: r.studentUid, name: r.studentName || 'Student', grade: r.gradeLevel, n: 0, abs: 0 }); p.n++; if (isAbsence(r.code)) p.abs++; });
  // At risk from min(5%, half the threshold); severe from max(20%, the threshold), so a custom threshold stays consistent.
  const atRisk = Math.min(5, threshold / 2), severe = Math.max(20, threshold);
  return Object.values(per).map(p => ({ ...p, rate: pct(p.abs, p.n) || 0 }))
    .filter(p => p.rate >= atRisk).map(p => ({ ...p, level: p.rate >= severe ? 'critical' : p.rate >= threshold ? 'serious' : 'warning' }))
    .sort((a, b) => b.rate - a.rate);
}
function downloadCSV(name, rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Exported');
}
async function guardiansOf(ctx, sid) {
  const snap = await getDocs(query(tcol(ctx, 'guardianLinks'), where('studentUid', '==', sid)));
  const links = snap.docs.map(d => d.data());
  return Promise.all(links.map(async l => { try { const g = await getDoc(tdoc(ctx, 'guardians', l.guardianUid)); return { uid: l.guardianUid, name: g.exists() ? displayNameOf(g.data()) : 'Parent/guardian', email: g.data()?.email || '' }; } catch { return { uid: l.guardianUid, name: 'Parent/guardian' }; } }));
}
async function contactFamily(ctx, sid, name) {
  try {
    const gs = await guardiansOf(ctx, sid);
    if (!gs.length) {
      const st = await studentDoc(ctx, sid);
      const contacts = (st?.contacts || []).filter(c => c.phone || c.email);
      return openModal({ size: 'sm', html: modalHeader({ title: `${escapeHtml(name)}'s family`, icon: 'phone' }) + modalBody(contacts.length ? `<p class="text-sm text-gray-400 mb-4">No parent has linked a Family Access account yet. Contacts on file:</p><div class="space-y-3">${contacts.map(c => `<div class="card p-3"><div class="text-sm text-white">${escapeHtml(c.name || '')} <span class="text-xs text-gray-500">${escapeHtml(c.relation || '')}</span></div>${c.phone ? `<a href="tel:${escapeHtml(c.phone)}" class="text-xs text-[#F59E0B] block">${escapeHtml(c.phone)}</a>` : ''}${c.email ? `<a href="mailto:${escapeHtml(c.email)}" class="text-xs text-[#F59E0B] block">${escapeHtml(c.email)}</a>` : ''}</div>`).join('')}</div>` : `<p class="text-sm text-gray-400">No parent has linked a Family Access account and there are no contacts on file. Add contacts on the student's record.</p>`) });
    }
    const m = openModal({
      html: modalHeader({ title: `Message ${escapeHtml(name)}'s family`, icon: 'mail' }) + `<form novalidate>${modalBody(`
        <p class="text-xs text-gray-500 mb-3">To: ${gs.map(g => escapeHtml(g.name)).join(', ')}</p>
        <label class="label" for="cf-subj">Subject</label><input id="cf-subj" class="input mb-4" value="About ${escapeHtml(name)}">
        <label class="label" for="cf-body">Message</label><textarea id="cf-body" rows="5" class="input"></textarea><p id="cf-err" class="form-error mt-3 hidden"></p>`)}
        ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button class="btn btn-primary flex-1">${ico('send', 'w-4 h-4')} Send</button>`)}</form>`
    });
    m.$('form').addEventListener('submit', e => {
      e.preventDefault();
      const body = m.$('#cf-body').value.trim(); if (!body) return showError(m.$('#cf-err'), 'Write a message.');
      withBusy(e.currentTarget.querySelector('button:not([data-close])'), 'Sending…', async () => {
        try {
          const names = { [ctx.me.uid]: ctx.me.name }; gs.forEach(g => { names[g.uid] = `${g.name} (family of ${name})`; });
          const ref = await addDoc(tcol(ctx, 'conversations'), { participants: [ctx.me.uid, ...gs.map(g => g.uid)], names, subject: m.$('#cf-subj').value.trim() || `About ${name}`, courseId: null, courseTitle: '', studentUid: sid, lastMessage: body.slice(0, 140), lastAt: serverTimestamp(), lastSenderUid: ctx.me.uid, readBy: [ctx.me.uid], createdAt: serverTimestamp() });
          await addDoc(collection(ref, 'messages'), { senderUid: ctx.me.uid, senderName: ctx.me.name, body, createdAt: serverTimestamp() });
          m.close(); toast('Message sent to the family');
        } catch (ex) { showError(m.$('#cf-err'), ex.message); }
      });
    });
  } catch (e) { toast(e.message || 'Could not load family contacts', 'error'); }
}

// ═══════════════════════════════════════════════════════════════
// MASTER SCHEDULE
// ═══════════════════════════════════════════════════════════════
export async function viewMasterSchedule(ctx) {
  const t = routeTokenNow();
  setTitle('Master schedule', ctx.tenant.name);
  render(tenantPage(ctx, 'sis-schedule', pageHeader({ eyebrow: 'Office', title: 'Master schedule', subtitle: 'Assign every section a period, room and meeting days. Conflicts are checked automatically.', actions: `<div class="segmented" role="group" aria-label="Group by"><button data-by="teacher" aria-pressed="true">By teacher</button><button data-by="room" aria-pressed="false">By room</button></div>` }) +
    `<div id="ms" class="max-w-7xl">${skeletonRows(6, 'h-16')}</div>`));
  let by = 'teacher', settings, courses, staff, rosters;
  const el = $('#ms');
  const load = async () => {
    [settings, courses, staff] = await Promise.all([getSettings(ctx), loadAllCourses(ctx), loadStaff(ctx)]);
    rosters = Object.fromEntries(await Promise.all(courses.map(async c => [c.id, await rosterOf(ctx, c.id).catch(() => [])])));
  };
  const overlap = (a, b) => { const da = a.days?.length ? a.days : DAYS.map(d => d[0]); const dbb = b.days?.length ? b.days : DAYS.map(d => d[0]); return da.some(d => dbb.includes(d)); };
  // A course whose period was deleted in Setup counts as unscheduled (so it stays visible and fixable).
  const pidOf = c => settings.periods.some(p => p.id === c.periodId) ? c.periodId : null;
  const conflicts = () => {
    const out = [], byPeriod = {};
    courses.filter(c => pidOf(c)).forEach(c => (byPeriod[c.periodId] ||= []).push(c));
    const bad = new Set();
    Object.entries(byPeriod).forEach(([pid, list]) => {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j]; if (!overlap(a, b)) continue;
        if (a.ownerUid && a.ownerUid === b.ownerUid) { out.push({ kind: 'Teacher', text: `${a.ownerName || 'A teacher'} has ${a.title} and ${b.title} in ${periodName(settings, pid)}` }); bad.add(a.id); bad.add(b.id); }
        if (a.room && a.room === b.room) { out.push({ kind: 'Room', text: `Room ${a.room} is booked for ${a.title} and ${b.title} in ${periodName(settings, pid)}` }); bad.add(a.id); bad.add(b.id); }
        const ra = new Set((rosters[a.id] || []).map(s => s.uid));
        const both = (rosters[b.id] || []).filter(s => ra.has(s.uid));
        if (both.length) { out.push({ kind: 'Student', text: `${plural(both.length, 'student')} (${both.slice(0, 3).map(s => s.name).join(', ')}${both.length > 3 ? '…' : ''}) in both ${a.title} and ${b.title} during ${periodName(settings, pid)}` }); bad.add(a.id); bad.add(b.id); }
      }
    });
    return { list: out, bad };
  };
  const chip = (c, bad) => `<button type="button" data-course="${c.id}" class="w-full text-left rounded-lg px-2.5 py-2 mb-1.5 border transition-colors ${bad.has(c.id) ? 'border-[#d03b3b]/60 bg-[#d03b3b]/10' : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20'}">
      <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full shrink-0" style="background:${courseHex(c)}"></span><span class="text-xs text-white truncate">${escapeHtml(c.title || 'Untitled')}</span>${bad.has(c.id) ? ico('octagon-alert', 'w-3 h-3 st-critical shrink-0 ml-auto') : ''}</div>
      <div class="text-[10px] text-gray-500 truncate mt-0.5">${c.room ? 'Rm ' + escapeHtml(c.room) + ' · ' : ''}${(rosters[c.id] || []).length} students${c.days?.length && c.days.length < 5 ? ' · ' + escapeHtml(c.days.join('')) : ''}</div></button>`;
  const draw = () => {
    const { list, bad } = conflicts();
    $$('[data-by]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.by === by)));
    const cols = by === 'teacher'
      ? [...new Set(courses.map(c => c.ownerUid))].map(uid => ({ key: uid, label: courses.find(c => c.ownerUid === uid)?.ownerName || displayNameOf(staff.find(s => s.uid === uid)) || 'Unassigned', match: c => c.ownerUid === uid }))
      : [...new Set(courses.map(c => c.room || ''))].sort().map(r => ({ key: r, label: r ? `Room ${r}` : 'No room', match: c => (c.room || '') === r }));
    const rows = [...settings.periods.map(p => ({ id: p.id, label: p.name, sub: `${fmtTime(p.start)}–${fmtTime(p.end)}` })), { id: null, label: 'Unscheduled', sub: 'No period yet' }];
    el.innerHTML = `${list.length ? `<section class="card p-5 mb-6 border-[#d03b3b]/30"><h2 class="text-sm text-white font-medium mb-3 flex items-center gap-2">${ico('octagon-alert', 'w-4 h-4 st-critical')} ${plural(list.length, 'conflict')}</h2><ul class="space-y-1.5">${list.map(c => `<li class="text-sm text-gray-300 flex gap-2"><span class="badge badge-red shrink-0">${c.kind}</span>${escapeHtml(c.text)}</li>`).join('')}</ul></section>` : `<div class="mb-6">${statusChip('good', 'No teacher, room or student conflicts.')}</div>`}
      ${!courses.length ? emptyState({ icon: 'calendar-range', title: 'No courses yet', text: 'Teachers create courses (sections); you place them in periods here.' }) : `
      <div class="card overflow-auto"><table class="w-full text-sm border-separate border-spacing-0">
        <thead><tr><th class="sticky left-0 z-10 bg-[#161616] text-left text-[10px] uppercase tracking-wider text-gray-500 font-medium px-4 py-3 min-w-[120px]">Period</th>${cols.map(c => `<th class="bg-[#161616] text-left text-[11px] text-gray-300 font-medium px-3 py-3 min-w-[170px]">${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr class="align-top"><th class="sticky left-0 z-10 bg-[#141414] text-left px-4 py-3 border-t border-white/[0.05] font-normal"><div class="text-xs text-white">${escapeHtml(r.label)}</div><div class="text-[10px] text-gray-500">${escapeHtml(r.sub)}</div></th>
          ${cols.map(col => `<td class="px-3 py-2.5 border-t border-white/[0.05]">${courses.filter(c => col.match(c) && pidOf(c) === r.id).map(c => chip(c, bad)).join('')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="hint mt-3">Click a section to change its period, room or days. Edit periods and bell times in School setup.</p>`}`;
    refreshIcons();
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-course]'); if (!b) return;
    const c = courses.find(x => x.id === b.dataset.course);
    const m = openModal({
      html: modalHeader({ title: escapeHtml(c.title || 'Section'), subtitle: `${escapeHtml(c.ownerName || '')} · ${(rosters[c.id] || []).length} students`, icon: 'calendar-range' }) + `<form novalidate>${modalBody(`
        <label class="label" for="ms-period">Period</label><select id="ms-period" class="input mb-4"><option value="">Unscheduled</option>${settings.periods.map(p => `<option value="${p.id}" ${p.id === c.periodId ? 'selected' : ''}>${escapeHtml(p.name)} (${fmtTime(p.start)}–${fmtTime(p.end)})</option>`).join('')}</select>
        <label class="label" for="ms-room">Room</label><input id="ms-room" class="input mb-4" value="${escapeHtml(c.room || '')}" placeholder="204">
        <span class="label">Meets on</span><div class="flex gap-2">${DAYS.map(([k, l]) => `<label class="check"><input type="checkbox" data-day="${k}" ${!c.days?.length || c.days.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>`)}
        ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button class="btn btn-primary flex-1">Save</button>`)}</form>`
    });
    m.$('form').addEventListener('submit', ev => {
      ev.preventDefault();
      const days = m.$$('[data-day]').filter(x => x.checked).map(x => x.dataset.day);
      const data = { periodId: m.$('#ms-period').value || null, room: m.$('#ms-room').value.trim(), days: days.length === 5 ? [] : days };
      withBusy(ev.currentTarget.querySelector('button:not([data-close])'), 'Saving…', async () => {
        try { await updateDoc(doc(db, 'tenants', ctx.slug, 'courses', c.id), data); Object.assign(c, data); m.close(); toast('Schedule updated'); draw(); }
        catch (ex) { toast(ex.message, 'error'); }
      });
    });
  });
  $$('[data-by]').forEach(b => b.addEventListener('click', () => { by = b.dataset.by; draw(); }));
  try { await load(); if (live(t)) draw(); } catch (e) { console.error(e); if (live(t)) { el.innerHTML = errorBox(e); refreshIcons(); } }
}
function scheduleHTML(courses, settings) {
  if (!courses.length) return emptyState({ icon: 'calendar-range', title: 'No classes yet' });
  const sorted = [...courses].sort((a, b) => periodOrder(settings, a.periodId) - periodOrder(settings, b.periodId));
  return `<div class="card overflow-hidden divide-y divide-white/[0.05]">${sorted.map(c => { const p = settings.periods.find(x => x.id === c.periodId); return `
    <div class="flex items-center gap-4 px-5 py-3.5"><div class="w-24 shrink-0"><div class="text-xs text-white">${escapeHtml(p?.name || 'Unscheduled')}</div><div class="text-[11px] text-gray-500 tabular-nums">${p ? `${fmtTime(p.start)}–${fmtTime(p.end)}` : ''}</div></div>
      <span class="w-1 self-stretch rounded-full" style="background:${courseHex(c)}"></span>
      <div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(c.title || '')}</div><div class="text-[11px] text-gray-500 truncate">${escapeHtml(c.ownerName || '')}${c.room ? ' · Room ' + escapeHtml(c.room) : ''}${c.days?.length && c.days.length < 5 ? ' · ' + escapeHtml(c.days.join('')) : ''}</div></div></div>`; }).join('')}</div>`;
}

// ═══════════════════════════════════════════════════════════════
// TERM GRADES (teacher) & REPORT CARDS (office)
// ═══════════════════════════════════════════════════════════════
export async function viewTermGrades(ctx, course) {
  if (!ctx.teacherMode) return navigate(`/${ctx.slug}/course/${course.id}/grades`, { replace: true });
  const t = routeTokenNow();
  const settings = await getSettings(ctx);
  let termId = new URLSearchParams(location.search).get('term') || currentTerm(settings)?.id;
  setTitle('Report card grades', course.title);
  render(tenantPage(ctx, 'grades', pageHeader({
    back: { href: `/${ctx.slug}/course/${course.id}/grades`, label: 'Gradebook' }, eyebrow: escapeHtml(course.title || ''), title: 'Report card grades',
    subtitle: 'Calculated from graded work due in the term. Override a letter or add a comment before grades are published.',
    actions: `<label class="sr-only" for="tg-term">Term</label><select id="tg-term" class="input !py-2 !w-auto">${settings.terms.map(x => `<option value="${x.id}" ${x.id === termId ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>`
  }) + `<div id="tg" class="max-w-5xl">${skeletonRows(6)}</div>`, course, { crumbs: [{ label: 'Report card grades' }] }));
  const el = $('#tg');
  let rows = [];
  const load = async () => {
    el.innerHTML = skeletonRows(6);
    try {
      const term = settings.terms.find(x => x.id === termId); const range = termRange(term);
      const [roster, items, subsSnap, tgSnap] = await Promise.all([
        rosterOf(ctx, course.id), loadAllItems(ctx, course.id), getDocs(subsCol(ctx, course.id)),
        getDocs(query(courseCol(ctx, course.id, 'termGrades'), where('termId', '==', termId))),
      ]);
      if (!live(t)) return;
      const subsBy = {}; subsSnap.docs.forEach(d => { const s = d.data(); const m = (subsBy[s.studentId] ||= new Map()); const p = m.get(s.itemId); if (!p || recency(s.submittedAt) > recency(p.submittedAt)) m.set(s.itemId, s); });
      const saved = Object.fromEntries(tgSnap.docs.map(d => [d.data().studentUid, d.data()]));
      rows = roster.map(s => { const p = percentFor(items, subsBy[s.uid] || new Map(), range); return { ...s, percent: p, letter: letterFor(p, settings.gradeScale), override: saved[s.uid]?.override || '', comment: saved[s.uid]?.comment || '', saved: !!saved[s.uid] }; });
      const published = (settings.publishedTerms || []).includes(termId);
      const letters = [...settings.gradeScale.map(g => g.letter), 'I', 'P', 'NG'];
      el.innerHTML = !rows.length ? emptyState({ icon: 'users', title: 'No students enrolled' }) : `
        ${published ? `<div class="card p-4 mb-4 flex items-center gap-3 text-sm text-gray-300">${ico('triangle-alert', 'w-4 h-4 st-warning')} ${escapeHtml(term.name)} report cards are already published — families will see changes immediately.</div>` : ''}
        <div class="card overflow-hidden divide-y divide-white/[0.05]">${rows.map((r, i) => `
          <div class="grid grid-cols-12 gap-3 items-start px-4 sm:px-5 py-3">
            <div class="col-span-12 sm:col-span-3 flex items-center gap-3 min-w-0">${avatar(r.name)}<span class="text-sm text-white truncate">${escapeHtml(r.name)}</span></div>
            <div class="col-span-4 sm:col-span-2"><div class="text-[10px] text-gray-500 uppercase tracking-wider">Calculated</div><div class="text-sm text-white tabular-nums">${r.percent === null ? '—' : `${r.percent}% · ${r.letter}`}</div></div>
            <div class="col-span-8 sm:col-span-2"><label class="text-[10px] text-gray-500 uppercase tracking-wider" for="tg-o-${i}">Report card</label><select id="tg-o-${i}" data-o="${i}" class="input !py-1.5 text-sm"><option value="">${r.letter ? `Use ${r.letter}` : '—'}</option>${letters.map(l => `<option ${r.override === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="col-span-12 sm:col-span-5"><label class="text-[10px] text-gray-500 uppercase tracking-wider" for="tg-c-${i}">Comment</label><textarea id="tg-c-${i}" data-c="${i}" rows="1" class="input !py-1.5 text-sm" placeholder="Optional">${escapeHtml(r.comment)}</textarea></div>
          </div>`).join('')}</div>
        <div class="sticky bottom-0 mt-4 py-3 bg-[#0A0A0A]/90 backdrop-blur flex items-center gap-3"><button id="tg-save" class="btn btn-primary">${ico('save', 'w-4 h-4')} Save ${escapeHtml(term?.name || '')} grades</button><span class="text-xs text-gray-500">${rows.filter(r => r.saved).length} of ${rows.length} saved</span></div>`;
      refreshIcons();
      $('#tg-save')?.addEventListener('click', e => withBusy(e.currentTarget, 'Saving…', async () => {
        el.querySelectorAll('[data-o]').forEach(s => { rows[+s.dataset.o].override = s.value; });
        el.querySelectorAll('[data-c]').forEach(s => { rows[+s.dataset.c].comment = s.value.trim(); });
        try {
          const batch = writeBatch(db);
          rows.forEach(r => batch.set(doc(courseCol(ctx, course.id, 'termGrades'), `${termId}_${r.uid}`), { termId, studentUid: r.uid, studentName: r.name, percent: r.percent, letter: r.override || r.letter || '', calculatedLetter: r.letter || '', override: r.override || '', comment: r.comment, courseId: course.id, courseTitle: course.title || '', teacherName: course.ownerName || ctx.me.name, updatedBy: ctx.me.uid, updatedAt: serverTimestamp() }));
          await batch.commit(); toast('Report card grades saved'); load();
        } catch (ex) { toast(ex.message, 'error'); }
      }));
    } catch (e) { console.error(e); if (live(t)) { el.innerHTML = errorBox(e); refreshIcons(); } }
  };
  $('#tg-term').addEventListener('change', e => { termId = e.target.value; load(); });
  load();
}
async function reportCardData(ctx, student, term) {
  const courses = await studentCourses(ctx, student);
  const rows = await Promise.all(courses.map(async c => {
    const g = await getDoc(doc(courseCol(ctx, c.id, 'termGrades'), `${term.id}_${student.uid}`)).catch(() => null);
    return { course: c, grade: g?.exists() ? g.data() : null };
  }));
  let att = null;
  try { att = summarize(await recordsForStudent(ctx, student.uid), termRange(term)); } catch (e) {}
  return { rows, att };
}
function reportCardHTML(ctx, settings, student, term, { rows, att }) {
  const rc = settings.reportCard;
  const sorted = [...rows].sort((a, b) => periodOrder(settings, a.course.periodId) - periodOrder(settings, b.course.periodId));
  return `<article class="rc-page">
    <header class="rc-head"><div><div class="rc-school">${escapeHtml(ctx.tenant.name)}</div><div class="rc-sub">${escapeHtml(rc.title || 'Report Card')} · ${escapeHtml(term.name)} · ${escapeHtml(settings.schoolYear)}</div></div>
      <div class="rc-student"><div class="rc-name">${escapeHtml(displayNameOf(student))}</div><div class="rc-sub">${escapeHtml(gradeLabel(student.gradeLevel))}${student.studentNumber ? ' · ID ' + escapeHtml(student.studentNumber) : ''}</div></div></header>
    <table><thead><tr><th>Course</th><th>Teacher</th><th class="num">Grade</th><th class="num">%</th>${rc.showComments ? '<th>Comments</th>' : ''}</tr></thead>
      <tbody>${sorted.length ? sorted.map(r => `<tr><td>${escapeHtml(r.course.title || '')}</td><td>${escapeHtml(r.grade?.teacherName || r.course.ownerName || '')}</td><td class="num rc-letter">${escapeHtml(r.grade?.letter || '—')}</td><td class="num">${escapeHtml(r.grade?.percent ?? '—')}</td>${rc.showComments ? `<td>${escapeHtml(r.grade?.comment || '')}</td>` : ''}</tr>`).join('') : `<tr><td colspan="5">No courses.</td></tr>`}</tbody></table>
    ${rc.showAttendance && att ? `<div class="rc-row"><strong>Attendance this term:</strong> ${att.total ? `${att.rate}% present · ${att.absent} absences (${att.E} excused) · ${att.T} tardies` : 'No attendance recorded.'}</div>` : ''}
    ${rc.showScale ? `<div class="rc-row rc-small"><strong>Grading scale:</strong> ${[...settings.gradeScale].sort((a, b) => b.min - a.min).map(g => `${escapeHtml(g.letter)} ${g.min}+`).join(' · ')} · I = Incomplete · P = Pass</div>` : ''}
    ${rc.footer ? `<div class="rc-row">${escapeHtml(rc.footer)}</div>` : ''}
    ${rc.signatureLines ? `<div class="rc-sign"><div><span></span>${escapeHtml(rc.principal ? rc.principal + ', Principal' : 'Principal')}</div><div><span></span>Parent/guardian signature</div></div>` : ''}
  </article>`;
}
function printCards(html) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = html;
  const done = () => { root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
async function openReportCardPreview(ctx, settings, students, term) {
  const m = openModal({ size: 'xl', align: 'top', html: modalHeader({ title: students.length === 1 ? escapeHtml(displayNameOf(students[0])) : `${plural(students.length, 'report card')}`, subtitle: `${escapeHtml(term.name)} · ${escapeHtml(settings.schoolYear)}`, icon: 'file-text' }) + modalBody(`<div id="rc-preview" class="rc-preview space-y-6">${skeletonRows(2, 'h-64')}</div>`) + modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Close</button><button id="rc-print" class="btn btn-primary flex-1" disabled>${ico('printer', 'w-4 h-4')} Print</button>`) });
  try {
    const cards = [];
    for (const s of students) cards.push(reportCardHTML(ctx, settings, s, term, await reportCardData(ctx, s, term)));
    const html = cards.join('');
    if (!m.el.isConnected) return;
    m.$('#rc-preview').innerHTML = html;
    m.$('#rc-print').disabled = false;
    m.$('#rc-print').addEventListener('click', () => printCards(html));
  } catch (e) { m.$('#rc-preview').innerHTML = errorBox(e); refreshIcons(); }
}
export async function viewReportCards(ctx) {
  const t = routeTokenNow();
  setTitle('Report cards', ctx.tenant.name);
  let settings = await getSettings(ctx, { fresh: true });
  let termId = currentTerm(settings)?.id, grade = '', q = '';
  render(tenantPage(ctx, 'sis-reportcards', pageHeader({ eyebrow: 'Office', title: 'Report cards', subtitle: 'Track which teachers have entered grades, publish to families, and print.', actions: `<label class="sr-only" for="rcs-term">Term</label><select id="rcs-term" class="input !py-2 !w-auto">${settings.terms.map(x => `<option value="${x.id}" ${x.id === termId ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select><a href="${buildUrl(`/${ctx.slug}/office/setup`)}" class="btn btn-secondary">${ico('settings-2')} Template</a>` }) + `<div id="rcs" class="max-w-6xl">${skeletonRows(5)}</div>`));
  const el = $('#rcs');
  let students = [], courses = [], progress = null, progressFor = null;
  // refetch=false re-renders from cached data (search / grade filter), so typing doesn't hit Firestore or lose focus.
  const load = async (refetch = true) => {
    if (refetch || progressFor !== termId) el.innerHTML = skeletonRows(5);
    try {
      if (!students.length) [students, courses] = await Promise.all([loadStudents(ctx), loadAllCourses(ctx)]);
      const term = settings.terms.find(x => x.id === termId);
      if (refetch || progressFor !== termId) progress = await Promise.all(courses.map(async c => {
        const [n, g] = await Promise.all([getDocs(courseCol(ctx, c.id, 'enrollments')).then(s => s.size).catch(() => 0), getDocs(query(courseCol(ctx, c.id, 'termGrades'), where('termId', '==', termId))).then(s => s.size).catch(() => 0)]);
        return { c, n, g };
      }));
      progressFor = termId;
      if (!live(t)) return;
      const published = (settings.publishedTerms || []).includes(termId);
      const done = progress.filter(p => p.n && p.g >= p.n).length, withKids = progress.filter(p => p.n).length;
      const ql = q.trim().toLowerCase();
      const shown = students.filter(s => (!grade || String(s.gradeLevel) === grade) && (!ql || displayNameOf(s).toLowerCase().includes(ql)));
      el.innerHTML = `
        <div class="grid sm:grid-cols-3 gap-4 mb-8">
          ${statTile('Sections with grades in', `${done}<span class="text-gray-500 text-lg">/${withKids}</span>`, done === withKids ? 'All sections complete' : `${withKids - done} still entering`, done === withKids ? 'good' : 'warning')}
          ${statTile('Students', students.length)}
          <div class="card p-5"><div class="text-xs text-gray-400 mb-2">Family Access</div><div class="flex items-center justify-between gap-3"><div>${published ? statusChip('good', 'Published') : statusChip('warning', 'Not published')}</div><button id="rcs-publish" class="btn ${published ? 'btn-secondary' : 'btn-primary'} btn-sm">${published ? 'Unpublish' : 'Publish to families'}</button></div><p class="hint">${published ? 'Students and families can see this term.' : 'Hidden from students and families until published.'}</p></div>
        </div>
        <div class="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-8">
          <section class="min-w-0"><div class="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div class="flex flex-wrap gap-2">${searchBox('rcs-q', 'Search students…')}<select id="rcs-grade" class="input !py-2 !w-auto" aria-label="Grade level"><option value="">All grades</option>${GRADE_LEVELS.map(g => `<option value="${g}" ${grade === g ? 'selected' : ''}>${escapeHtml(gradeLabel(g))}</option>`).join('')}</select></div>
            <button id="rcs-print-all" class="btn btn-secondary btn-sm" ${shown.length ? '' : 'disabled'}>${ico('printer', 'w-3.5 h-3.5')} Print ${shown.length}</button></div>
            ${shown.length ? dataTable([{ label: 'Student', cls: 'col-span-8 sm:col-span-6' }, { label: 'Grade', cls: 'hidden sm:block sm:col-span-3' }, { label: '', cls: 'col-span-4 sm:col-span-3 text-right' }],
              shown.map(s => ({ cells: [`<div class="flex items-center gap-3">${avatar(displayNameOf(s))}<span class="text-sm text-white truncate">${escapeHtml(displayNameOf(s))}</span></div>`, `<span class="text-xs text-gray-400">${escapeHtml(gradeLabel(s.gradeLevel))}</span>`, `<div class="flex justify-end"><button class="btn btn-ghost btn-sm" data-preview="${s.uid}">${ico('eye', 'w-3.5 h-3.5')} Preview</button></div>`] }))) : `<p class="text-sm text-gray-500 py-6">No students match.</p>`}
          </section>
          <aside><h2 class="label">Grade entry by section</h2><div class="card divide-y divide-white/[0.05] overflow-hidden">${progress.filter(p => p.n).sort((a, b) => (a.g >= a.n) - (b.g >= b.n)).map(p => `<div class="flex items-center gap-3 px-4 py-2.5"><span class="flex-1 min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(p.c.title || '')}</span><span class="block text-[11px] text-gray-500 truncate">${escapeHtml(p.c.ownerName || '')}</span></span>${p.g >= p.n ? statusChip('good', 'Done') : statusChip('warning', `${p.g}/${p.n}`)}</div>`).join('') || '<p class="p-4 text-sm text-gray-500">No sections with students.</p>'}</div></aside>
        </div>`;
      refreshIcons();
      const qi = $('#rcs-q'); qi.value = q;
      qi.addEventListener('input', e => { q = e.target.value; load(false).then(() => { const n = $('#rcs-q'); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }); });
      $('#rcs-grade').addEventListener('change', e => { grade = e.target.value; load(false); });
      $('#rcs-print-all').addEventListener('click', () => openReportCardPreview(ctx, settings, shown, term));
      $('#rcs-publish').addEventListener('click', async ev => {
        const btn = ev.currentTarget; // capture before awaiting — currentTarget is cleared after dispatch
        const on = !published;
        if (on && !await confirmDialog({ title: `Publish ${term.name} report cards?`, message: 'Students and families will be able to view them in Family Access right away.', confirmLabel: 'Publish' })) return;
        withBusy(btn, 'Saving…', async () => {
          try { await setDoc(doc(db, 'tenants', ctx.slug, 'sis', 'settings'), { publishedTerms: on ? arrayUnion(termId) : arrayRemove(termId) }, { merge: true }); settings = await getSettings(ctx, { fresh: true }); toast(on ? 'Published to families' : 'Unpublished', on ? 'success' : 'info'); load();
            if (on) {
              notify(ctx, { to: students.map(x => x.uid), kind: 'reportcard', title: `${term.name} report card is ready`, body: ctx.tenant.name, link: `/${ctx.slug}/record/me/reportcards` }).catch(e => console.warn(e));
              getDocs(tcol(ctx, 'guardianLinks')).then(g => notify(ctx, { to: [...new Set(g.docs.map(d => d.data().guardianUid))], kind: 'reportcard', title: `${term.name} report cards are ready`, body: `View them in Family Access · ${ctx.tenant.name}`, link: `/${ctx.slug}` })).catch(e => console.warn(e));
            } }
          catch (ex) { toast(ex.message, 'error'); }
        });
      });
      el.querySelectorAll('[data-preview]').forEach(b => b.addEventListener('click', () => openReportCardPreview(ctx, settings, [students.find(s => s.uid === b.dataset.preview)], term)));
    } catch (e) { console.error(e); if (live(t)) { el.innerHTML = errorBox(e); refreshIcons(); } }
  };
  $('#rcs-term').addEventListener('change', e => { termId = e.target.value; load(); });
  load();
}

// ═══════════════════════════════════════════════════════════════
// SCHOOL SETUP (bell schedule, terms, grade scale, report card template)
// ═══════════════════════════════════════════════════════════════
export async function viewSisSetup(ctx) {
  if (!ctx.isAdmin) return navigate(`/${ctx.slug}`, { replace: true });
  setTitle('School setup', ctx.tenant.name);
  const s = structuredClone(await getSettings(ctx, { fresh: true }));
  render(tenantPage(ctx, 'sis-setup', pageHeader({ eyebrow: 'Office', title: 'School setup', subtitle: 'Bell schedule, grading periods, grade scale and report card template.' }) + `
    <form id="setup" class="max-w-4xl space-y-8" novalidate>
      <section class="card p-6"><h2 class="font-serif text-xl text-white mb-4">School year</h2><label class="label" for="su-year">Label</label><input id="su-year" class="input max-w-xs" value="${escapeHtml(s.schoolYear)}">
        <label class="label mt-4" for="su-chronic">Chronic absence threshold (% of class time)</label><input id="su-chronic" type="number" min="1" max="50" class="input max-w-[120px]" value="${s.chronicThreshold}"></section>
      <section class="card p-6"><div class="flex items-center justify-between mb-4"><h2 class="font-serif text-xl text-white">Bell schedule</h2><button type="button" data-add="periods" class="btn btn-ghost btn-sm">${ico('plus', 'w-3.5 h-3.5')} Period</button></div><div id="su-periods" class="space-y-2"></div></section>
      <section class="card p-6"><div class="flex items-center justify-between mb-4"><h2 class="font-serif text-xl text-white">Grading periods</h2><button type="button" data-add="terms" class="btn btn-ghost btn-sm">${ico('plus', 'w-3.5 h-3.5')} Term</button></div><div id="su-terms" class="space-y-2"></div></section>
      <section class="card p-6"><div class="flex items-center justify-between mb-4"><h2 class="font-serif text-xl text-white">Grade scale</h2><button type="button" data-add="gradeScale" class="btn btn-ghost btn-sm">${ico('plus', 'w-3.5 h-3.5')} Letter</button></div><div id="su-gradeScale" class="space-y-2"></div></section>
      <section class="card p-6"><h2 class="font-serif text-xl text-white mb-4">Report card template</h2>
        <div class="grid sm:grid-cols-2 gap-4 mb-4"><div><label class="label" for="rc-title">Title</label><input id="rc-title" class="input" value="${escapeHtml(s.reportCard.title)}"></div><div><label class="label" for="rc-principal">Principal</label><input id="rc-principal" class="input" value="${escapeHtml(s.reportCard.principal)}" placeholder="Dr. Jane Smith"></div></div>
        <div class="grid sm:grid-cols-2 gap-3 mb-4">${[['showAttendance', 'Show attendance summary'], ['showComments', 'Show teacher comments'], ['showScale', 'Show grading scale'], ['signatureLines', 'Include signature lines']].map(([k, l]) => `<label class="check"><input type="checkbox" data-rc="${k}" ${s.reportCard[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <label class="label" for="rc-footer">Footer message</label><textarea id="rc-footer" rows="2" class="input" placeholder="Conferences are November 12 — sign up in Family Access.">${escapeHtml(s.reportCard.footer)}</textarea></section>
      <p id="su-err" class="form-error hidden"></p>
      <div class="sticky bottom-0 py-3 bg-[#0A0A0A]/90 backdrop-blur"><button class="btn btn-primary">${ico('save', 'w-4 h-4')} Save setup</button></div>
    </form>`));
  const lists = {
    periods: { el: $('#su-periods'), blank: () => ({ id: 'p' + Date.now().toString(36), name: '', start: '', end: '' }), row: (p, i) => `<div class="grid grid-cols-[1fr_110px_110px_auto] gap-2 items-center"><input class="input !py-2" data-k="name" data-i="${i}" value="${escapeHtml(p.name)}" placeholder="Period 1" aria-label="Period name"><input type="time" class="input !py-2" data-k="start" data-i="${i}" value="${p.start}" aria-label="Start"><input type="time" class="input !py-2" data-k="end" data-i="${i}" value="${p.end}" aria-label="End"><button type="button" class="btn-icon danger" data-del="periods" data-i="${i}" aria-label="Remove">${ico('x', 'w-4 h-4')}</button></div>` },
    terms: { el: $('#su-terms'), blank: () => ({ id: 't' + Date.now().toString(36), name: '', start: '', end: '' }), row: (p, i) => `<div class="grid grid-cols-[1fr_150px_150px_auto] gap-2 items-center"><input class="input !py-2" data-k="name" data-i="${i}" value="${escapeHtml(p.name)}" placeholder="Quarter 1" aria-label="Term name"><input type="date" class="input !py-2" data-k="start" data-i="${i}" value="${p.start}" aria-label="Starts"><input type="date" class="input !py-2" data-k="end" data-i="${i}" value="${p.end}" aria-label="Ends"><button type="button" class="btn-icon danger" data-del="terms" data-i="${i}" aria-label="Remove">${ico('x', 'w-4 h-4')}</button></div>` },
    gradeScale: { el: $('#su-gradeScale'), blank: () => ({ letter: '', min: 0 }), row: (p, i) => `<div class="grid grid-cols-[100px_140px_auto] gap-2 items-center"><input class="input !py-2" data-k="letter" data-i="${i}" value="${escapeHtml(p.letter)}" placeholder="A" aria-label="Letter"><div class="flex items-center gap-2"><span class="text-xs text-gray-500">from</span><input type="number" class="input !py-2" data-k="min" data-i="${i}" value="${p.min}" aria-label="Minimum percent"><span class="text-xs text-gray-500">%</span></div><button type="button" class="btn-icon danger" data-del="gradeScale" data-i="${i}" aria-label="Remove">${ico('x', 'w-4 h-4')}</button></div>` },
  };
  const drawList = k => { lists[k].el.innerHTML = s[k].map(lists[k].row).join(''); refreshIcons(); };
  Object.keys(lists).forEach(k => {
    drawList(k);
    lists[k].el.addEventListener('input', e => { const i = e.target.dataset.i, f = e.target.dataset.k; if (i !== undefined && f) s[k][i][f] = f === 'min' ? Number(e.target.value) : e.target.value; });
  });
  const form = $('#setup');
  form.addEventListener('click', e => {
    const a = e.target.closest('[data-add]'); if (a) { s[a.dataset.add].push(lists[a.dataset.add].blank()); return drawList(a.dataset.add); }
    const d = e.target.closest('[data-del]'); if (d) { s[d.dataset.del].splice(+d.dataset.i, 1); drawList(d.dataset.del); }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const err = $('#su-err'); showError(err, '');
    if (s.periods.some(p => !p.name || !p.start || !p.end || p.start >= p.end)) return showError(err, 'Every period needs a name and a start time before its end time.');
    if (s.terms.some(p => !p.name || !p.start || !p.end || p.start > p.end)) return showError(err, 'Every term needs a name, a start date and an end date after it.');
    if (!s.gradeScale.length || s.gradeScale.some(g => !g.letter)) return showError(err, 'Each grade-scale row needs a letter.');
    const data = {
      schoolYear: $('#su-year').value.trim() || s.schoolYear, chronicThreshold: Math.max(1, Math.min(50, Number($('#su-chronic').value) || 10)),
      periods: s.periods, terms: [...s.terms].sort((a, b) => a.start.localeCompare(b.start)), gradeScale: [...s.gradeScale].sort((a, b) => b.min - a.min),
      reportCard: { title: $('#rc-title').value.trim(), principal: $('#rc-principal').value.trim(), footer: $('#rc-footer').value.trim(), ...Object.fromEntries($$('[data-rc]').map(c => [c.dataset.rc, c.checked])) },
    };
    withBusy(form.querySelector('button:not([type=button])'), 'Saving…', async () => {
      try { await setDoc(doc(db, 'tenants', ctx.slug, 'sis', 'settings'), data, { merge: true }); settingsCache.delete(ctx.slug); toast('School setup saved'); }
      catch (ex) { showError(err, ex.message); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// STUDENT DIRECTORY & RECORD
// ═══════════════════════════════════════════════════════════════
const flagBadges = s => [s.iep ? badge('IEP', 'violet') : '', s.plan504 ? badge('504', 'blue') : '', s.ell ? badge('ELL', 'muted') : '', (s.alerts || []).length ? `<span title="${escapeHtml((s.alerts || []).map(a => a.text).join(' · '))}">${ico('triangle-alert', 'w-3.5 h-3.5 st-warning')}</span>` : ''].join(' ');
export async function viewDirectory(ctx) {
  const t = routeTokenNow();
  setTitle('Students', ctx.tenant.name);
  render(tenantPage(ctx, 'sis-directory', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'Students', subtitle: 'Find any student to see their schedule, attendance, grades and records.' }) + `
    <div class="max-w-6xl"><div class="flex flex-wrap items-center gap-3 mb-4">${searchBox('dir-q', 'Search name, username or ID…')}
      <select id="dir-grade" class="input !py-2 !w-auto" aria-label="Grade level"><option value="">All grades</option>${GRADE_LEVELS.map(g => `<option value="${g}">${escapeHtml(gradeLabel(g))}</option>`).join('')}</select>
      <div class="segmented" role="group" aria-label="Filter">${[['', 'All'], ['iep', 'IEP'], ['plan504', '504'], ['ell', 'ELL'], ['alerts', 'Alerts']].map(([k, l]) => `<button data-flag="${k}" aria-pressed="${!k}">${l}</button>`).join('')}</div></div>
      <div id="dir">${skeletonRows(8)}</div></div>`));
  let list = [], q = '', grade = '', flag = '';
  const el = $('#dir');
  const draw = () => {
    const shown = list.filter(s => (!grade || String(s.gradeLevel) === grade) && (!flag || (flag === 'alerts' ? (s.alerts || []).length : s[flag])) && (!q || `${displayNameOf(s)} ${s.username || ''} ${s.studentNumber || ''}`.toLowerCase().includes(q)));
    $$('[data-flag]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.flag === flag)));
    el.innerHTML = `<p class="text-xs text-gray-500 mb-3">${plural(shown.length, 'student')}</p>` + (shown.length ? dataTable(
      [{ label: 'Student', cls: 'col-span-12 sm:col-span-5' }, { label: 'ID', cls: 'col-span-4 sm:col-span-2' }, { label: 'Grade', cls: 'col-span-4 sm:col-span-2' }, { label: 'Flags', cls: 'col-span-4 sm:col-span-2' }, { label: '', cls: 'hidden sm:block sm:col-span-1' }],
      shown.map(s => ({ cells: [
        `<a href="${buildUrl(`/${ctx.slug}/record/${s.uid}`)}" class="flex items-center gap-3 group/s">${avatar(displayNameOf(s))}<span class="min-w-0"><span class="block text-sm text-white truncate group-hover/s:text-[#F59E0B]">${escapeHtml(displayNameOf(s))}</span><span class="block text-[11px] text-gray-500 font-mono truncate">${escapeHtml(s.username || '')}</span></span></a>`,
        `<span class="text-xs text-gray-400 font-mono">${escapeHtml(s.studentNumber || '—')}</span>`,
        `<span class="text-xs text-gray-400">${escapeHtml(s.gradeLevel ?? '—')}</span>`,
        `<span class="flex items-center gap-1 flex-wrap">${flagBadges(s)}</span>`,
        `<a href="${buildUrl(`/${ctx.slug}/record/${s.uid}`)}" class="btn-icon" aria-label="Open record">${ico('chevron-right', 'w-4 h-4')}</a>`
      ] }))) : emptyState({ icon: 'search', title: 'No students match' }));
    refreshIcons();
  };
  $('#dir-q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
  $('#dir-grade').addEventListener('change', e => { grade = e.target.value; draw(); });
  $$('[data-flag]').forEach(b => b.addEventListener('click', () => { flag = b.dataset.flag; draw(); }));
  try { list = await loadStudents(ctx); if (live(t)) draw(); } catch (e) { if (live(t)) { el.innerHTML = errorBox(e); refreshIcons(); } }
}

const RECORD_TABS = [
  ['overview', 'Overview'], ['schedule', 'Schedule'], ['attendance', 'Attendance'], ['grades', 'Grades'], ['reportcards', 'Report cards'],
  ['activities', 'Activities'], ['career', 'Career plan'], ['services', 'Student services', 'services'], ['discipline', 'Discipline'], ['family', 'Family & contacts', 'admin'],
];
export async function viewRecord(ctx, sidParam, tab = 'overview') {
  const t = routeTokenNow();
  const sid = sidParam === 'me' ? ctx.me.uid : sidParam;
  if (!canSeeStudent(ctx, sid)) return navigate(`/${ctx.slug}`, { replace: true });
  const [student, settings] = await Promise.all([studentDoc(ctx, sid), getSettings(ctx)]);
  if (!live(t)) return;
  if (!student) { render(tenantPage(ctx, 'record', emptyState({ icon: 'user-x', title: 'Student not found' }))); refreshIcons(); return; }
  const name = displayNameOf(student);
  const staff = ctx.isRealTeacher;
  const tabs = RECORD_TABS.filter(([, , need]) => !need || (need === 'admin' ? ctx.isAdmin : ctx.can(need)));
  if (tab === 'incidents') tab = 'discipline'; // old links
  if (!tabs.some(x => x[0] === tab)) tab = 'overview';
  setTitle(name, ctx.tenant.name);
  const self = sid === ctx.me.uid;
  const base = `/${ctx.slug}/record/${self && !staff ? 'me' : sid}`;
  const subnav = { eyebrow: escapeHtml(gradeLabel(student.gradeLevel)), title: name, items: tabs.map(([k, l]) => ({ href: buildUrl(k === 'overview' ? base : `${base}/${k}`), label: l, active: k === tab })) };
  const label = tabs.find(x => x[0] === tab)?.[1];
  const header = `<header class="mb-6 sm:mb-8 max-w-6xl flex flex-col sm:flex-row sm:items-center gap-4">
      ${avatar(name, null, 'w-16 h-16', 'text-xl')}
      <div class="flex-1 min-w-0"><p class="text-[11px] text-[#F59E0B] uppercase tracking-[0.18em] mb-1">${escapeHtml(label)}</p><h1 class="font-serif text-3xl sm:text-4xl text-white leading-tight">${escapeHtml(name)}</h1>
        <p class="text-sm text-gray-500 mt-1 flex flex-wrap items-center gap-2">${escapeHtml(gradeLabel(student.gradeLevel))}${student.studentNumber ? ` · ID <span class="font-mono">${escapeHtml(student.studentNumber)}</span>` : ''}${staff ? ' ' + flagBadges(student) : ''}</p></div>
      ${staff ? `<div class="flex flex-wrap gap-2">${ctx.isAdmin ? `<button data-rec="edit" class="btn btn-secondary">${ico('pencil', 'w-3.5 h-3.5')} Edit record</button>` : ''}<a href="${buildUrl(`/${ctx.slug}/staff/new/referral?student=${sid}`)}" class="btn btn-secondary">${ico('flag', 'w-3.5 h-3.5')} Write referral</a><button data-rec="concern" class="btn btn-ghost">${ico('message-square-warning', 'w-3.5 h-3.5')} Quick concern</button></div>` : ''}
    </header>
    ${staff && (student.alerts || []).length ? `<div class="max-w-6xl mb-6 space-y-2">${student.alerts.map(a => `<div class="card px-4 py-3 flex items-start gap-3 border-[#fab219]/30">${ico('triangle-alert', 'w-4 h-4 st-warning shrink-0 mt-0.5')}<div><span class="text-xs uppercase tracking-wider text-gray-400">${escapeHtml(a.type || 'Alert')}</span><p class="text-sm text-white">${escapeHtml(a.text)}</p></div></div>`).join('')}</div>` : ''}`;
  render(tenantPage(ctx, 'record', header + `<div id="rec" class="max-w-6xl">${skeletonRows(4, 'h-24')}</div>`, null, { subnav, gActive: staff ? 'school' : (ctx.isGuardian ? 'dashboard' : 'account'), crumbs: [...(staff ? [{ label: 'Students', href: buildUrl(`/${ctx.slug}/sis`) }] : []), { label: name, href: buildUrl(base) }, ...(tab !== 'overview' ? [{ label }] : [])] }));
  const el = $('#rec');
  $('#main').addEventListener('click', e => {
    const r = e.target.closest('[data-rec]'); if (!r) return;
    if (r.dataset.rec === 'edit') openRecordEditor(ctx, student);
    if (r.dataset.rec === 'concern') openIncidentModal(ctx, null, [{ uid: sid, name }], { concern: !ctx.can('safety') });
  });
  const term = currentTerm(settings);
  try {
    if (tab === 'overview') {
      const [recs, grades, courses] = await Promise.all([recordsForStudent(ctx, sid).catch(() => []), studentGrades(ctx, student, settings).catch(() => []), studentCourses(ctx, student)]);
      if (!live(t)) return;
      const att = summarize(recs, termRange(term));
      const todayRecs = recs.filter(r => r.date === todayISO() && r.code !== 'P');
      let accom = null;
      if (staff) { try { const a = await getDoc(tdoc(ctx, 'accommodations', sid)); accom = a.exists() ? a.data().items : null; } catch (e) {} }
      el.innerHTML = `
        ${todayRecs.length ? `<div class="card px-4 py-3 mb-6 flex items-center gap-3">${ico('triangle-alert', 'w-4 h-4 st-warning')}<span class="text-sm text-white">${todayRecs.map(r => `${ATT_CODES[r.code]?.label} in ${escapeHtml(r.courseTitle)}`).join(' · ')} today</span></div>` : ''}
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
          ${statTile(`Attendance · ${escapeHtml(term?.name || 'term')}`, fmtPct(att.rate), `${att.absent} absences · ${att.T} tardies`, att.absenceRate >= 20 ? 'critical' : att.absenceRate >= settings.chronicThreshold ? 'serious' : null)}
          ${statTile('Classes', courses.length)}
          ${statTile('Average grade', (() => { const ps = grades.map(g => g.percent).filter(p => p !== null); return ps.length ? `${Math.round(ps.reduce((a, b) => a + b, 0) / ps.length)}%` : '—'; })())}
          ${statTile('Missing work', grades.reduce((n, g) => n + g.items.filter(it => GRADED_TYPES.includes(it.type) && toDate(it.data?.dueDate) && toDate(it.data.dueDate) < new Date() && !g.subs.has(it.id)).length, 0))}
        </div>
        <div class="grid lg:grid-cols-2 gap-6">
          <section><h2 class="label">Current grades</h2>${gradesListHTML(grades)}</section>
          <section class="space-y-6">
            ${accom ? `<div>${`<h2 class="label">Accommodations</h2><div class="card p-5"><ul class="space-y-1.5">${accom.map(a => `<li class="text-sm text-gray-300 flex gap-2">${ico('check', 'w-4 h-4 text-gray-500 shrink-0 mt-0.5')}${escapeHtml(a)}</li>`).join('')}</ul></div>`}</div>` : ''}
            <div><h2 class="label">Today's schedule</h2>${scheduleHTML(courses.filter(c => { const wd = new Date().getDay(); return wd > 0 && wd < 6 && (!c.days?.length || c.days.includes('UMTWRFS'[wd])); }), settings)}</div>
            ${staff && (student.contacts || []).length ? `<div><h2 class="label">Contacts</h2><div class="card divide-y divide-white/[0.05]">${student.contacts.map(c => `<div class="px-4 py-3"><div class="text-sm text-white">${escapeHtml(c.name || '')} <span class="text-xs text-gray-500">${escapeHtml(c.relation || '')}</span></div><div class="text-xs text-gray-400">${c.phone ? `<a class="hover:text-[#F59E0B]" href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a>` : ''}${c.phone && c.email ? ' · ' : ''}${c.email ? `<a class="hover:text-[#F59E0B]" href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : ''}</div></div>`).join('')}</div></div>` : ''}
          </section>
        </div>`;
    } else if (tab === 'schedule') {
      const courses = await studentCourses(ctx, student);
      if (!live(t)) return;
      el.innerHTML = `<p class="text-sm text-gray-500 mb-4">${escapeHtml(settings.schoolYear)}</p>${scheduleHTML(courses, settings)}`;
    } else if (tab === 'attendance') {
      const recs = await recordsForStudent(ctx, sid);
      if (!live(t)) return;
      el.innerHTML = `<div class="flex justify-end mb-4"><select id="ra-term" class="input !py-2 !w-auto" aria-label="Term"><option value="">Whole year</option>${settings.terms.map(x => `<option value="${x.id}" ${x.id === term?.id ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select></div><div id="ra-body"></div>`;
      const drawAtt = () => { const tm = settings.terms.find(x => x.id === $('#ra-term').value); const r = tm ? recs.filter(x => x.date >= tm.start && x.date <= tm.end) : recs; $('#ra-body').innerHTML = recordsHTML(r); refreshIcons(); };
      $('#ra-term').addEventListener('change', drawAtt); drawAtt();
    } else if (tab === 'grades') {
      const grades = await studentGrades(ctx, student, settings);
      if (!live(t)) return;
      el.innerHTML = grades.length ? grades.map(g => `<section class="card mb-4 overflow-hidden"><div class="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]"><span class="w-2.5 h-2.5 rounded-full" style="background:${courseHex(g.course)}"></span><h2 class="text-white font-medium flex-1 truncate">${escapeHtml(g.course.title || '')}</h2><span class="text-sm text-white tabular-nums">${g.percent === null ? '—' : `${g.percent}% ${g.letter}`}</span></div>
        <div class="divide-y divide-white/[0.04]">${g.items.filter(it => GRADED_TYPES.includes(it.type)).map(it => { const s = g.subs.get(it.id); const due = toDate(it.data?.dueDate); const missing = !s && due && due < new Date();
          return `<div class="flex items-center gap-3 px-5 py-2.5">${ico(typeMeta(it.type).icon, 'w-4 h-4 text-gray-500 shrink-0')}<div class="flex-1 min-w-0"><div class="text-sm text-gray-200 truncate">${escapeHtml(it.title || '')}</div><div class="text-[11px] text-gray-500">${due ? 'Due ' + escapeHtml(formatDate(due)) : 'No due date'}</div></div>
            <div class="text-right shrink-0">${hasGrade(s) ? `<span class="text-sm text-white tabular-nums">${escapeHtml(s.grade)}<span class="text-gray-500">/${itemPoints(it)}</span></span>` : s ? badge('Submitted', 'blue') : missing ? badge('Missing', 'red') : `<span class="text-xs text-gray-600">—/${itemPoints(it)}</span>`}</div></div>`; }).join('') || '<p class="px-5 py-3 text-sm text-gray-500">No graded work yet.</p>'}</div></section>`).join('') : emptyState({ icon: 'award', title: 'Not enrolled in any courses' });
    } else if (tab === 'reportcards') {
      const published = staff ? settings.terms : settings.terms.filter(x => (settings.publishedTerms || []).includes(x.id));
      el.innerHTML = published.length ? `<div class="grid sm:grid-cols-2 gap-4">${published.map(x => `<button data-rc-term="${x.id}" class="card card-hover p-5 text-left flex items-center gap-4">${iconTile('file-text', 'amber')}<span class="flex-1"><span class="block text-white">${escapeHtml(x.name)}</span><span class="block text-xs text-gray-500">${escapeHtml(formatDate(x.start + 'T12:00'))} – ${escapeHtml(formatDate(x.end + 'T12:00'))}</span></span>${staff && !(settings.publishedTerms || []).includes(x.id) ? badge('Not published', 'muted') : ''}</button>`).join('')}</div>` : emptyState({ icon: 'file-text', title: 'No report cards yet', text: 'Report cards appear here once the school publishes them.' });
      el.querySelectorAll('[data-rc-term]').forEach(b => b.addEventListener('click', () => openReportCardPreview(ctx, settings, [student], settings.terms.find(x => x.id === b.dataset.rcTerm))));
    } else if (tab === 'activities') {
      const snap = await getDocs(query(tcol(ctx, 'activities'), where('members', 'array-contains', sid)));
      if (!live(t)) return;
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      el.innerHTML = list.length ? `<div class="grid sm:grid-cols-2 gap-4">${list.map(a => activityCard(ctx, a)).join('')}</div>` : emptyState({ icon: 'trophy', title: 'No activities yet', action: `<a href="${buildUrl(`/${ctx.slug}/activities`)}" class="btn btn-secondary">${ico('search')} Browse activities</a>` });
    } else if (tab === 'career') {
      await careerPlanTab(ctx, el, student, { canEdit: staff || self });
    } else if (tab === 'services') {
      await servicesTab(ctx, el, student);
    } else if (tab === 'discipline') {
      await disciplineTab(ctx, el, student, t);
    } else if (tab === 'family') {
      await familyTab(ctx, el, student);
    }
    refreshIcons();
  } catch (e) { console.error(e); if (live(t)) { el.innerHTML = errorBox(e); refreshIcons(); } }
}
function gradesListHTML(grades) {
  if (!grades.length) return `<p class="text-sm text-gray-500">Not enrolled in any courses.</p>`;
  return `<div class="card divide-y divide-white/[0.05] overflow-hidden">${grades.map(g => `<div class="flex items-center gap-3 px-5 py-3"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${courseHex(g.course)}"></span><span class="flex-1 min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(g.course.title || '')}</span><span class="block text-[11px] text-gray-500 truncate">${escapeHtml(g.course.ownerName || '')}</span></span><span class="text-sm text-white tabular-nums">${g.percent === null ? '<span class="text-gray-600">—</span>' : `${g.percent}%`}</span><span class="w-8 text-right text-sm text-gray-300">${escapeHtml(g.letter || '')}</span></div>`).join('')}</div>`;
}
function openRecordEditor(ctx, student) {
  let contacts = (student.contacts || []).map(c => ({ ...c })), alerts = (student.alerts || []).map(a => ({ ...a }));
  const m = openModal({
    size: 'xl', align: 'top', html: modalHeader({ title: 'Edit record', subtitle: escapeHtml(displayNameOf(student)), icon: 'id-card' }) + `<form novalidate>${modalBody(`
      <div class="grid sm:grid-cols-2 gap-4 mb-6">
        <div><label class="label" for="er-first">First name</label><input id="er-first" class="input" value="${escapeHtml(student.firstName || '')}"></div>
        <div><label class="label" for="er-last">Last name</label><input id="er-last" class="input" value="${escapeHtml(student.lastName || '')}"></div>
        <div><label class="label" for="er-grade">Grade level</label><select id="er-grade" class="input"><option value="">—</option>${GRADE_LEVELS.map(g => `<option value="${g}" ${String(student.gradeLevel) === g ? 'selected' : ''}>${escapeHtml(gradeLabel(g))}</option>`).join('')}</select></div>
        <div><label class="label" for="er-num">Student ID</label><input id="er-num" class="input font-mono" value="${escapeHtml(student.studentNumber || '')}"></div>
        <div><label class="label" for="er-dob">Date of birth</label><input id="er-dob" type="date" class="input" value="${escapeHtml(student.dob || '')}"></div>
        <div><label class="label" for="er-home">Homeroom / advisory</label><input id="er-home" class="input" value="${escapeHtml(student.homeroom || '')}"></div>
      </div>
      <div class="flex items-center justify-between mb-2"><span class="label !mb-0">Contacts</span><button type="button" data-add-contact class="btn btn-ghost btn-sm">${ico('plus', 'w-3.5 h-3.5')} Contact</button></div><div id="er-contacts" class="space-y-2 mb-6"></div>
      <div class="flex items-center justify-between mb-2"><span class="label !mb-0">Alerts <span class="normal-case tracking-normal text-gray-600">(shown to all staff — medical, allergy, custody)</span></span><button type="button" data-add-alert class="btn btn-ghost btn-sm">${ico('plus', 'w-3.5 h-3.5')} Alert</button></div><div id="er-alerts" class="space-y-2"></div>
      <p id="er-err" class="form-error mt-3 hidden"></p>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button class="btn btn-primary flex-1">Save record</button>`)}</form>`
  });
  const drawC = () => { m.$('#er-contacts').innerHTML = contacts.length ? contacts.map((c, i) => `<div class="grid grid-cols-2 sm:grid-cols-[1fr_120px_1fr_1fr_auto] gap-2"><input class="input !py-2" data-ci="${i}" data-k="name" value="${escapeHtml(c.name || '')}" placeholder="Name" aria-label="Contact name"><input class="input !py-2" data-ci="${i}" data-k="relation" value="${escapeHtml(c.relation || '')}" placeholder="Mother" aria-label="Relationship"><input class="input !py-2" data-ci="${i}" data-k="phone" value="${escapeHtml(c.phone || '')}" placeholder="Phone" aria-label="Phone"><input class="input !py-2" data-ci="${i}" data-k="email" value="${escapeHtml(c.email || '')}" placeholder="Email" aria-label="Email"><button type="button" class="btn-icon danger" data-del-contact="${i}" aria-label="Remove contact">${ico('x', 'w-4 h-4')}</button></div>`).join('') : '<p class="text-xs text-gray-500">No contacts.</p>'; refreshIcons(); };
  const drawA = () => { m.$('#er-alerts').innerHTML = alerts.length ? alerts.map((a, i) => `<div class="grid grid-cols-[140px_1fr_auto] gap-2"><select class="input !py-2" data-ai="${i}" data-k="type" aria-label="Alert type">${['Medical', 'Allergy', 'Custody', 'Behavior', 'Other'].map(x => `<option ${a.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select><input class="input !py-2" data-ai="${i}" data-k="text" value="${escapeHtml(a.text || '')}" placeholder="Severe peanut allergy — EpiPen in nurse's office" aria-label="Alert"><button type="button" class="btn-icon danger" data-del-alert="${i}" aria-label="Remove alert">${ico('x', 'w-4 h-4')}</button></div>`).join('') : '<p class="text-xs text-gray-500">No alerts.</p>'; refreshIcons(); };
  drawC(); drawA();
  m.el.addEventListener('input', e => { const ci = e.target.dataset.ci, ai = e.target.dataset.ai, k = e.target.dataset.k; if (ci !== undefined) contacts[ci][k] = e.target.value; if (ai !== undefined) alerts[ai][k] = e.target.value; });
  m.el.addEventListener('change', e => { const ai = e.target.dataset.ai; if (ai !== undefined) alerts[ai][e.target.dataset.k] = e.target.value; });
  m.el.addEventListener('click', e => {
    if (e.target.closest('[data-add-contact]')) { contacts.push({ name: '', relation: '', phone: '', email: '' }); drawC(); }
    if (e.target.closest('[data-add-alert]')) { alerts.push({ type: 'Medical', text: '' }); drawA(); }
    const dc = e.target.closest('[data-del-contact]'); if (dc) { contacts.splice(+dc.dataset.delContact, 1); drawC(); }
    const da = e.target.closest('[data-del-alert]'); if (da) { alerts.splice(+da.dataset.delAlert, 1); drawA(); }
  });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const first = m.$('#er-first').value.trim(), last = m.$('#er-last').value.trim();
    if (!first) return showError(m.$('#er-err'), 'First name is required.');
    const data = { firstName: first, lastName: last, displayName: `${first} ${last}`.trim(), gradeLevel: m.$('#er-grade').value || null, studentNumber: m.$('#er-num').value.trim(), dob: m.$('#er-dob').value, homeroom: m.$('#er-home').value.trim(), contacts: contacts.filter(c => c.name || c.phone || c.email), alerts: alerts.filter(a => a.text.trim()) };
    withBusy(e.currentTarget.querySelector('button:not([data-close])'), 'Saving…', async () => {
      try { await updateDoc(tdoc(ctx, 'students', student.uid), data); m.close(); toast('Record updated'); renderRoute(); }
      catch (ex) { showError(m.$('#er-err'), ex.message); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// FAMILY ACCESS (codes, guardians, family home)
// ═══════════════════════════════════════════════════════════════
const familyCode = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let o = ''; for (let i = 0; i < 8; i++) o += c[randInt(c.length)]; return o; };
async function familyTab(ctx, el, student) {
  const gs = await guardiansOf(ctx, student.uid).catch(() => []);
  const code = student.familyCode || '';
  el.innerHTML = `<div class="grid lg:grid-cols-2 gap-6">
    <section class="card p-6"><h2 class="font-serif text-xl text-white mb-1">Family Access code</h2><p class="text-sm text-gray-500 mb-5">Parents and guardians create a Family Access account with this code to see grades, attendance and report cards, and to message teachers.</p>
      ${code ? `<div class="bg-[#0A0A0A] border border-white/[0.08] rounded-xl p-5 text-center mb-4"><code class="text-3xl font-mono text-[#F59E0B] tracking-[0.3em]">${escapeHtml(code)}</code></div>
        <div class="flex flex-wrap gap-2"><button data-fam="copy" class="btn btn-secondary btn-sm">${ico('copy', 'w-3.5 h-3.5')} Copy letter</button><button data-fam="new" class="btn btn-ghost btn-sm">${ico('refresh-cw', 'w-3.5 h-3.5')} New code</button></div>`
      : `<button data-fam="new" class="btn btn-primary">${ico('key-round')} Generate code</button>`}</section>
    <section><h2 class="label">Linked family accounts</h2>${gs.length ? `<div class="card divide-y divide-white/[0.05]">${gs.map(g => `<div class="flex items-center gap-3 px-4 py-3">${avatar(g.name)}<div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(g.name)}</div><div class="text-[11px] text-gray-500 truncate">${escapeHtml(g.email || '')}</div></div><button class="btn-icon danger" data-unlink="${g.uid}" aria-label="Remove access for ${escapeHtml(g.name)}">${ico('user-minus', 'w-4 h-4')}</button></div>`).join('')}</div>` : `<p class="text-sm text-gray-500">No family members have linked yet.</p>`}</section></div>`;
  refreshIcons();
  el.onclick = async e => {
    const b = e.target.closest('[data-fam]');
    if (b?.dataset.fam === 'copy') {
      const url = location.origin + buildUrl('/signup?role=guardian');
      return copyText(`Family Access for ${displayNameOf(student)} at ${ctx.tenant.name}\n\n1. Go to ${url}\n2. Choose "I'm a parent or guardian"\n3. Enter this code: ${code}\n\nYou'll be able to see grades, attendance and report cards, and message teachers.`, 'Family letter copied');
    }
    if (b?.dataset.fam === 'new') {
      if (code && !await confirmDialog({ title: 'Generate a new code?', message: 'The old code stops working. Families who already linked keep their access.', confirmLabel: 'New code' })) return;
      return withBusy(b, 'Generating…', async () => {
        try {
          const c = familyCode();
          await setDoc(doc(db, 'familyCodes', c), { tenantId: ctx.slug, studentUid: student.uid, studentName: `${student.firstName || displayNameOf(student).split(' ')[0]} ${(student.lastName || '').slice(0, 1)}.`.trim(), createdBy: ctx.me.uid, createdAt: serverTimestamp() });
          await updateDoc(tdoc(ctx, 'students', student.uid), { familyCode: c });
          if (code) deleteDoc(doc(db, 'familyCodes', code)).catch(() => {});
          student.familyCode = c; toast('Family Access code created'); familyTab(ctx, el, student);
        } catch (ex) { toast(ex.message, 'error'); }
      });
    }
    const u = e.target.closest('[data-unlink]');
    if (u && await confirmDialog({ title: 'Remove this family account?', message: 'They will no longer see this student. They can relink with a valid code.', confirmLabel: 'Remove', danger: true })) {
      try { await deleteDoc(tdoc(ctx, 'guardianLinks', `${u.dataset.unlink}_${student.uid}`)); toast('Access removed'); familyTab(ctx, el, student); } catch (ex) { toast(ex.message, 'error'); }
    }
  };
}
export async function lookupFamilyCode(code) {
  const s = await getDoc(doc(db, 'familyCodes', code.toUpperCase()));
  return s.exists() ? { code: s.id, ...s.data() } : null;
}
export async function linkGuardian(ctx, user, info, name) {
  // The guardian profile is created once (with the code that proves they belong to this school), never overwritten.
  const gRef = doc(db, 'tenants', info.tenantId, 'guardians', user.uid);
  const g = await getDoc(gRef).catch(() => null);
  if (!g?.exists()) await setDoc(gRef, { userId: user.uid, name, displayName: name, email: user.email || '', code: info.code, createdAt: serverTimestamp() });
  else if (user.email && !g.data().email) await updateDoc(gRef, { email: user.email });
  const lRef = doc(db, 'tenants', info.tenantId, 'guardianLinks', `${user.uid}_${info.studentUid}`);
  if ((await getDoc(lRef).catch(() => null))?.exists()) return 'exists';
  await setDoc(lRef, { guardianUid: user.uid, studentUid: info.studentUid, code: info.code, createdAt: serverTimestamp() });
  return 'linked';
}
export function openAddStudentCode(ctx) {
  const m = openModal({
    size: 'sm', html: `<form class="p-6 sm:p-7" novalidate><h2 class="font-serif text-xl text-white mb-1">Add a student</h2><p class="text-sm text-gray-500 mb-5">Enter the Family Access code from the school.</p>
      <input id="fc-code" class="input text-center text-xl font-mono tracking-[0.3em] uppercase" maxlength="8" placeholder="ABCD2345" autocomplete="off" aria-label="Family Access code"><p id="fc-err" class="form-error mt-3 hidden"></p>
      <div class="flex gap-3 mt-6"><button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button class="btn btn-primary flex-1">Add</button></div></form>`
  });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const code = m.$('#fc-code').value.trim().toUpperCase();
    withBusy(e.currentTarget.querySelector('button:not([data-close])'), 'Checking…', async () => {
      try {
        const info = await lookupFamilyCode(code);
        if (!info) return showError(m.$('#fc-err'), "That code didn't match a student.");
        if (info.tenantId !== ctx.slug) return showError(m.$('#fc-err'), 'That code is for a different school. Sign in there instead.');
        const res = await linkGuardian(ctx, { uid: ctx.me.uid, email: '' }, info, ctx.me.name);
        if (res === 'exists') return showError(m.$('#fc-err'), `${info.studentName} is already linked to your account.`);
        m.close(); toast(`${info.studentName} added`); navigate(`/${ctx.slug}`, { replace: true });
      } catch (ex) { showError(m.$('#fc-err'), ex.message); }
    });
  });
}
export async function viewFamilyHome(ctx) {
  const t = routeTokenNow();
  setTitle('Family Access', ctx.tenant.name);
  const kids = ctx.children || [];
  render(tenantPage(ctx, 'dashboard', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'Family Access', subtitle: `Welcome, ${escapeHtml(String(ctx.me.name || '').split(' ')[0])}.`, actions: `<button id="fam-add" class="btn btn-secondary">${ico('user-plus')} Add a student</button><a href="${buildUrl(`/${ctx.slug}/inbox`)}" class="btn btn-primary">${ico('mail')} Message a teacher</a>` }) + `<div id="fam" class="max-w-6xl space-y-6">${kids.length ? skeletonRows(kids.length, 'h-64') : emptyState({ icon: 'users', tone: 'amber', title: 'No students linked yet', text: 'Ask the school office for your Family Access code, then add your student here.' })}</div>`));
  $('#fam-add').addEventListener('click', () => openAddStudentCode(ctx));
  if (!kids.length) return refreshIcons();
  const settings = await getSettings(ctx);
  const term = currentTerm(settings);
  const cards = await Promise.all(kids.map(async k => {
    try {
      const [recs, grades] = await Promise.all([recordsForStudent(ctx, k.uid).catch(() => []), studentGrades(ctx, k, settings).catch(() => [])]);
      const att = summarize(recs, termRange(term));
      const recent = recs.filter(r => r.code !== 'P' && (Date.now() - new Date(r.date + 'T12:00')) < 7 * 864e5);
      const now = Date.now();
      const due = grades.flatMap(g => g.items.filter(it => GRADED_TYPES.includes(it.type) && !g.subs.has(it.id) && tsMillis(it.data?.dueDate) >= now - 7 * 864e5 && tsMillis(it.data?.dueDate) <= now + 7 * 864e5).map(it => ({ it, g }))).sort((a, b) => tsMillis(a.it.data.dueDate) - tsMillis(b.it.data.dueDate));
      const base = buildUrl(`/${ctx.slug}/record/${k.uid}`);
      return `<section class="card overflow-hidden">
        <div class="flex flex-wrap items-center gap-4 px-6 py-5 border-b border-white/[0.06]">${avatar(displayNameOf(k), null, 'w-12 h-12', 'text-base')}<div class="flex-1 min-w-0"><h2 class="font-serif text-2xl text-white">${escapeHtml(displayNameOf(k))}</h2><p class="text-xs text-gray-500">${escapeHtml(gradeLabel(k.gradeLevel))}</p></div><a href="${base}" class="btn btn-secondary btn-sm">Full record ${ico('arrow-right', 'w-3.5 h-3.5')}</a></div>
        ${recent.length ? `<div class="px-6 py-3 border-b border-white/[0.06] flex flex-wrap items-center gap-2 text-sm">${ico('triangle-alert', 'w-4 h-4 st-warning')}<span class="text-white">Attendance alert:</span><span class="text-gray-300">${recent.slice(0, 4).map(r => `${ATT_CODES[r.code].label} ${escapeHtml(new Date(r.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' }))} (${escapeHtml(r.courseTitle)})`).join(' · ')}</span></div>` : ''}
        <div class="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 p-6">
          <div><h3 class="label">Grades</h3>${gradesListHTML(grades)}</div>
          <div class="space-y-5">
            <div class="grid grid-cols-2 gap-3">${statTile('Attendance', fmtPct(att.rate), escapeHtml(term?.name || ''))}${statTile('Absences', att.absent, `${att.T} tardies`)}</div>
            <div><h3 class="label">Due this week</h3>${due.length ? `<div class="space-y-1">${due.slice(0, 5).map(({ it, g }) => `<div class="flex items-center gap-2 text-sm"><span class="w-2 h-2 rounded-full shrink-0" style="background:${courseHex(g.course)}"></span><span class="text-gray-200 truncate flex-1">${escapeHtml(it.title)}</span><span class="text-[11px] ${tsMillis(it.data.dueDate) < now ? 'text-red-400' : 'text-gray-500'} shrink-0">${tsMillis(it.data.dueDate) < now ? 'Missing' : escapeHtml(formatDate(it.data.dueDate))}</span></div>`).join('')}</div>` : `<p class="text-sm text-gray-500">Nothing due.</p>`}</div>
            <div class="flex flex-wrap gap-2"><a href="${base}/attendance" class="btn btn-ghost btn-sm">${ico('calendar-check', 'w-3.5 h-3.5')} Attendance</a><a href="${base}/reportcards" class="btn btn-ghost btn-sm">${ico('file-text', 'w-3.5 h-3.5')} Report cards</a><a href="${base}/schedule" class="btn btn-ghost btn-sm">${ico('calendar-range', 'w-3.5 h-3.5')} Schedule</a><a href="${base}/discipline" class="btn btn-ghost btn-sm">${ico('shield', 'w-3.5 h-3.5')} Discipline</a></div>
          </div>
        </div></section>`;
    } catch (e) { return `<section class="card p-6">${errorBox(e)}</section>`; }
  }));
  if (!live(t)) return;
  $('#fam').innerHTML = cards.join('');
  refreshIcons();
}

// ═══════════════════════════════════════════════════════════════
// STUDENT SERVICES (special education, 504, ELL)
// ═══════════════════════════════════════════════════════════════
const DISABILITIES = ['Specific learning disability', 'Speech or language impairment', 'Other health impairment', 'Autism', 'Emotional disturbance', 'Intellectual disability', 'Developmental delay', 'Multiple disabilities', 'Hearing impairment', 'Visual impairment', 'Orthopedic impairment', 'Traumatic brain injury', 'Deaf-blindness'];
const RATINGS = ['No progress', 'Some progress', 'Adequate progress', 'Goal met'];
function dueStatus(iso) {
  if (!iso) return statusChip('warning', 'Not set');
  const days = Math.round((new Date(iso + 'T12:00') - Date.now()) / 864e5);
  if (days < 0) return statusChip('critical', `Overdue ${-days}d`);
  if (days <= 30) return statusChip('warning', `Due in ${days}d`);
  return statusChip('good', formatDate(iso + 'T12:00'));
}
export async function viewServices(ctx) {
  if (!ctx.can('services')) return navigate(`/${ctx.slug}`, { replace: true });
  const t = routeTokenNow();
  setTitle('Student services', ctx.tenant.name);
  let tab = 'iep';
  render(tenantPage(ctx, 'sis-services', pageHeader({ eyebrow: 'Office', title: 'Student services', subtitle: 'IEP and 504 compliance, ELL services and accommodations. Visible only to admins and staff with Student services access.', actions: `<button id="sv-add" class="btn btn-primary">${ico('plus')} Add student</button>` }) + `
    <div class="max-w-6xl"><div class="segmented mb-6" role="tablist"><button data-tab="iep">IEP caseload</button><button data-tab="plan504">504 plans</button><button data-tab="ell">ELL</button></div><div id="sv">${skeletonRows(5)}</div></div>`));
  let services = [], students = [];
  const el = $('#sv');
  const draw = () => {
    $$('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    const by = Object.fromEntries(students.map(s => [s.uid, s]));
    const list = services.filter(s => s[tab]?.active).map(s => ({ ...s, student: by[s.uid] })).filter(s => s.student);
    if (tab === 'iep') {
      const overdue = list.filter(s => s.iep.annualReview && s.iep.annualReview < todayISO()).length;
      const soon = list.filter(s => { const d = s.iep.annualReview; return d && d >= todayISO() && (new Date(d + 'T12:00') - Date.now()) / 864e5 <= 30; }).length;
      el.innerHTML = `<div class="grid grid-cols-3 gap-3 sm:gap-4 mb-6">${statTile('Active IEPs', list.length)}${statTile('Reviews overdue', overdue, overdue ? 'Needs attention' : 'None', overdue ? 'critical' : 'good')}${statTile('Due in 30 days', soon, '', soon ? 'warning' : null)}</div>`
        + (list.length ? dataTable([{ label: 'Student', cls: 'col-span-12 sm:col-span-3' }, { label: 'Case manager', cls: 'col-span-6 sm:col-span-2' }, { label: 'Annual review', cls: 'col-span-6 sm:col-span-2' }, { label: 'Re-evaluation', cls: 'col-span-6 sm:col-span-2' }, { label: 'Goals', cls: 'col-span-3 sm:col-span-1' }, { label: '', cls: 'col-span-3 sm:col-span-2 text-right' }],
          list.sort((a, b) => (a.iep.annualReview || '').localeCompare(b.iep.annualReview || '')).map(s => ({ cells: [
            `<a href="${buildUrl(`/${ctx.slug}/record/${s.uid}/services`)}" class="flex items-center gap-3">${avatar(displayNameOf(s.student))}<span class="min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(displayNameOf(s.student))}</span><span class="block text-[11px] text-gray-500 truncate">${escapeHtml(s.iep.disability || '')}</span></span></a>`,
            `<span class="text-xs text-gray-300 truncate block">${escapeHtml(s.iep.caseManagerName || '—')}</span>`, dueStatus(s.iep.annualReview), dueStatus(s.iep.reevaluation),
            `<span class="text-xs text-gray-400">${(s.iep.goals || []).length}</span>`,
            `<div class="flex justify-end"><button class="btn btn-ghost btn-sm" data-edit-sv="${s.uid}">Edit</button></div>`] }))) : emptyState({ icon: 'heart-handshake', title: 'No active IEPs', text: 'Use “Add student” to start tracking an IEP.' }));
    } else {
      el.innerHTML = list.length ? dataTable([{ label: 'Student', cls: 'col-span-12 sm:col-span-5' }, { label: tab === 'ell' ? 'Proficiency level' : 'Review date', cls: 'col-span-6 sm:col-span-4' }, { label: '', cls: 'col-span-6 sm:col-span-3 text-right' }],
        list.map(s => ({ cells: [`<a href="${buildUrl(`/${ctx.slug}/record/${s.uid}/services`)}" class="flex items-center gap-3">${avatar(displayNameOf(s.student))}<span class="text-sm text-white truncate">${escapeHtml(displayNameOf(s.student))}</span></a>`,
          tab === 'ell' ? `<span class="text-xs text-gray-300">Level ${escapeHtml(s.ell.level || '—')}</span>` : dueStatus(s.plan504.reviewDate),
          `<div class="flex justify-end"><button class="btn btn-ghost btn-sm" data-edit-sv="${s.uid}">Edit</button></div>`] }))) : emptyState({ icon: 'heart-handshake', title: `No students with ${tab === 'ell' ? 'ELL services' : '504 plans'}` });
    }
    refreshIcons();
  };
  const load = async () => {
    [services, students] = await Promise.all([getDocs(tcol(ctx, 'services')).then(s => s.docs.map(d => ({ uid: d.id, ...d.data() }))), loadStudents(ctx)]);
    if (live(t)) draw();
  };
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  el.addEventListener('click', e => { const b = e.target.closest('[data-edit-sv]'); if (b) openServicesEditor(ctx, students.find(s => s.uid === b.dataset.editSv), services.find(s => s.uid === b.dataset.editSv), load); });
  $('#sv-add').addEventListener('click', () => pickStudent(ctx, students, s => openServicesEditor(ctx, s, services.find(x => x.uid === s.uid), load)));
  try { await load(); } catch (e) { if (live(t)) { el.innerHTML = errorBox(e); refreshIcons(); } }
}
function pickStudent(ctx, students, onPick, { multi = false, title = 'Choose a student' } = {}) {
  const chosen = new Map();
  const m = openModal({ html: modalHeader({ title, icon: 'search' }) + modalBody(`${searchBox('ps-q', 'Search students…')}<div id="ps-list" class="mt-3 max-h-72 overflow-y-auto space-y-0.5"></div>`) + (multi ? modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button id="ps-done" class="btn btn-primary flex-1" disabled>Add</button>`) : '') });
  const draw = q => {
    const list = students.filter(s => !q || `${displayNameOf(s)} ${s.username || ''} ${s.studentNumber || ''}`.toLowerCase().includes(q)).slice(0, 50);
    m.$('#ps-list').innerHTML = list.map(s => `<button type="button" data-pick="${s.uid}" class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.05] text-left ${chosen.has(s.uid) ? 'bg-white/[0.06]' : ''}">${avatar(displayNameOf(s))}<span class="flex-1 min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(displayNameOf(s))}</span><span class="block text-[11px] text-gray-500">${escapeHtml(gradeLabel(s.gradeLevel))}</span></span>${chosen.has(s.uid) ? ico('check', 'w-4 h-4 text-[#F59E0B]') : ''}</button>`).join('') || '<p class="text-sm text-gray-500 p-3">No matches.</p>';
    refreshIcons();
  };
  draw('');
  m.$('#ps-q').addEventListener('input', e => draw(e.target.value.trim().toLowerCase()));
  m.$('#ps-list').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const s = students.find(x => x.uid === b.dataset.pick);
    if (!multi) { m.close(); return onPick(s); }
    chosen.has(s.uid) ? chosen.delete(s.uid) : chosen.set(s.uid, s);
    m.$('#ps-done').disabled = !chosen.size; m.$('#ps-done').textContent = chosen.size ? `Add ${chosen.size}` : 'Add';
    draw(m.$('#ps-q').value.trim().toLowerCase());
  });
  m.$('#ps-done')?.addEventListener('click', () => { m.close(); onPick([...chosen.values()]); });
}
async function servicesTab(ctx, el, student) {
  const [svc, acc] = await Promise.all([getDoc(tdoc(ctx, 'services', student.uid)), getDoc(tdoc(ctx, 'accommodations', student.uid)).catch(() => null)]);
  if (!el.isConnected) return;
  const s = svc.exists() ? svc.data() : {};
  const items = acc?.exists() ? acc.data().items || [] : [];
  el.innerHTML = `<div class="flex justify-end mb-4"><button id="sv-edit" class="btn btn-primary">${ico('pencil', 'w-3.5 h-3.5')} ${svc.exists() ? 'Edit services' : 'Add services'}</button></div>
    <div class="grid lg:grid-cols-2 gap-6">
      <section class="card p-6"><h2 class="font-serif text-xl text-white mb-4">IEP</h2>${s.iep?.active ? `<dl class="grid grid-cols-2 gap-3 text-sm mb-4"><div><dt class="text-xs text-gray-500">Eligibility</dt><dd class="text-white">${escapeHtml(s.iep.disability || '—')}</dd></div><div><dt class="text-xs text-gray-500">Case manager</dt><dd class="text-white">${escapeHtml(s.iep.caseManagerName || '—')}</dd></div><div><dt class="text-xs text-gray-500">Annual review</dt><dd>${dueStatus(s.iep.annualReview)}</dd></div><div><dt class="text-xs text-gray-500">Re-evaluation</dt><dd>${dueStatus(s.iep.reevaluation)}</dd></div></dl>
        <h3 class="label">Goals & progress</h3>${(s.iep.goals || []).length ? `<ol class="space-y-3">${s.iep.goals.map((g, i) => `<li class="rounded-lg border border-white/[0.06] p-3"><p class="text-sm text-white mb-2">${i + 1}. ${escapeHtml(g.text)}</p>${(g.progress || []).slice(-3).reverse().map(p => `<div class="text-xs text-gray-400 flex gap-2"><span class="text-gray-500 shrink-0">${escapeHtml(formatDate(p.date + 'T12:00'))}</span><span class="shrink-0">${escapeHtml(p.rating)}</span><span class="truncate">${escapeHtml(p.note || '')}</span></div>`).join('') || '<p class="text-xs text-gray-500">No progress notes yet.</p>'}<button data-progress="${i}" class="btn btn-ghost btn-sm mt-2">${ico('plus', 'w-3.5 h-3.5')} Progress note</button></li>`).join('')}</ol>` : '<p class="text-sm text-gray-500">No goals entered.</p>'}` : '<p class="text-sm text-gray-500">No active IEP.</p>'}</section>
      <div class="space-y-6">
        <section class="card p-6"><h2 class="font-serif text-xl text-white mb-3">Accommodations</h2>${items.length ? `<ul class="space-y-1.5">${items.map(a => `<li class="text-sm text-gray-300 flex gap-2">${ico('check', 'w-4 h-4 text-gray-500 shrink-0 mt-0.5')}${escapeHtml(a)}</li>`).join('')}</ul><p class="hint mt-3">Visible to all of this student's teachers.</p>` : '<p class="text-sm text-gray-500">None.</p>'}</section>
        <section class="card p-6"><h2 class="font-serif text-xl text-white mb-3">504 & ELL</h2><p class="text-sm text-gray-300">504 plan: ${s.plan504?.active ? `active · review ${dueStatus(s.plan504.reviewDate)}` : 'none'}</p><p class="text-sm text-gray-300 mt-2">ELL: ${s.ell?.active ? `active · level ${escapeHtml(s.ell.level || '—')}` : 'none'}</p>${s.notes ? `<p class="text-sm text-gray-400 mt-3 whitespace-pre-wrap">${escapeHtml(s.notes)}</p>` : ''}</section>
      </div></div>`;
  refreshIcons();
  const reload = () => servicesTab(ctx, el, student);
  $('#sv-edit').addEventListener('click', () => openServicesEditor(ctx, student, svc.exists() ? { uid: student.uid, ...s, accommodations: items } : null, reload));
  el.querySelectorAll('[data-progress]').forEach(b => b.addEventListener('click', () => {
    const gi = +b.dataset.progress;
    const m = openModal({ size: 'sm', html: `<form class="p-6" novalidate><h2 class="font-serif text-xl text-white mb-4">Progress note</h2><label class="label" for="pn-date">Date</label><input id="pn-date" type="date" class="input mb-3" value="${todayISO()}"><label class="label" for="pn-rating">Progress</label><select id="pn-rating" class="input mb-3">${RATINGS.map(r => `<option>${r}</option>`).join('')}</select><label class="label" for="pn-note">Note</label><textarea id="pn-note" rows="3" class="input"></textarea><div class="flex gap-3 mt-5"><button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button class="btn btn-primary flex-1">Add</button></div></form>` });
    m.$('form').addEventListener('submit', async e => {
      e.preventDefault();
      const goals = structuredClone(s.iep.goals); (goals[gi].progress ||= []).push({ date: m.$('#pn-date').value || todayISO(), rating: m.$('#pn-rating').value, note: m.$('#pn-note').value.trim(), by: ctx.me.name });
      try { await updateDoc(tdoc(ctx, 'services', student.uid), { 'iep.goals': goals, updatedAt: serverTimestamp() }); m.close(); toast('Progress note added'); reload(); } catch (ex) { toast(ex.message, 'error'); }
    });
  }));
}
async function openServicesEditor(ctx, student, existing, onDone) {
  const staff = await loadStaff(ctx).catch(() => []);
  let acc = existing?.accommodations;
  if (!acc) { try { const a = await getDoc(tdoc(ctx, 'accommodations', student.uid)); acc = a.exists() ? a.data().items || [] : []; } catch { acc = []; } }
  const s = existing || {}; const iep = s.iep || {}; let goals = (iep.goals || []).map(g => ({ ...g }));
  const m = openModal({
    size: 'xl', align: 'top', html: modalHeader({ title: 'Student services', subtitle: escapeHtml(displayNameOf(student)), icon: 'heart-handshake' }) + `<form novalidate>${modalBody(`<div class="space-y-6">
      <section><label class="check mb-4"><input type="checkbox" id="sv-iep" ${iep.active ? 'checked' : ''}> <span class="text-white font-medium">Active IEP</span></label>
        <div class="grid sm:grid-cols-2 gap-4"><div><label class="label" for="sv-dis">Eligibility category</label><select id="sv-dis" class="input"><option value="">—</option>${DISABILITIES.map(d => `<option ${iep.disability === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
          <div><label class="label" for="sv-cm">Case manager</label><select id="sv-cm" class="input"><option value="">—</option>${staff.map(x => `<option value="${x.uid}" ${iep.caseManagerUid === x.uid ? 'selected' : ''}>${escapeHtml(displayNameOf(x))}</option>`).join('')}</select></div>
          <div><label class="label" for="sv-start">IEP start</label><input id="sv-start" type="date" class="input" value="${escapeHtml(iep.startDate || '')}"></div>
          <div><label class="label" for="sv-annual">Annual review due</label><input id="sv-annual" type="date" class="input" value="${escapeHtml(iep.annualReview || '')}"></div>
          <div><label class="label" for="sv-reeval">Re-evaluation due</label><input id="sv-reeval" type="date" class="input" value="${escapeHtml(iep.reevaluation || '')}"></div></div>
        <div class="flex items-center justify-between mt-5 mb-2"><span class="label !mb-0">Annual goals</span><button type="button" id="sv-add-goal" class="btn btn-ghost btn-sm">${ico('plus', 'w-3.5 h-3.5')} Goal</button></div><div id="sv-goals" class="space-y-2"></div></section>
      <section class="grid sm:grid-cols-2 gap-6 pt-6 border-t border-white/[0.06]"><div><label class="check mb-3"><input type="checkbox" id="sv-504" ${s.plan504?.active ? 'checked' : ''}> <span class="text-white font-medium">504 plan</span></label><label class="label" for="sv-504date">Review date</label><input id="sv-504date" type="date" class="input" value="${escapeHtml(s.plan504?.reviewDate || '')}"></div>
        <div><label class="check mb-3"><input type="checkbox" id="sv-ell" ${s.ell?.active ? 'checked' : ''}> <span class="text-white font-medium">English language learner</span></label><label class="label" for="sv-ell-level">Proficiency level (1–6)</label><select id="sv-ell-level" class="input">${['', '1', '2', '3', '4', '5', '6'].map(l => `<option ${s.ell?.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div></section>
      <section class="pt-6 border-t border-white/[0.06]"><label class="label" for="sv-acc">Accommodations <span class="normal-case tracking-normal text-gray-600">(one per line — shared with the student's teachers)</span></label><textarea id="sv-acc" rows="5" class="input" placeholder="Extended time (1.5x) on tests&#10;Preferential seating&#10;Copies of notes">${escapeHtml(acc.join('\n'))}</textarea>
        <label class="label mt-4" for="sv-notes">Confidential notes</label><textarea id="sv-notes" rows="3" class="input">${escapeHtml(s.notes || '')}</textarea></section>
      <p id="sv-err" class="form-error hidden"></p></div>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button class="btn btn-primary flex-1">Save services</button>`)}</form>`
  });
  const drawGoals = () => { m.$('#sv-goals').innerHTML = goals.length ? goals.map((g, i) => `<div class="flex gap-2"><textarea class="input !py-2 text-sm" rows="2" data-goal="${i}" aria-label="Goal ${i + 1}" placeholder="By May, given grade-level text, the student will…">${escapeHtml(g.text || '')}</textarea><button type="button" class="btn-icon danger self-start" data-del-goal="${i}" aria-label="Remove goal">${ico('x', 'w-4 h-4')}</button></div>`).join('') : '<p class="text-xs text-gray-500">No goals.</p>'; refreshIcons(); };
  drawGoals();
  m.$('#sv-goals').addEventListener('input', e => { const i = e.target.dataset.goal; if (i !== undefined) goals[i].text = e.target.value; });
  m.$('#sv-goals').addEventListener('click', e => { const d = e.target.closest('[data-del-goal]'); if (d) { goals.splice(+d.dataset.delGoal, 1); drawGoals(); } });
  m.$('#sv-add-goal').addEventListener('click', () => { goals.push({ text: '', progress: [] }); drawGoals(); });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const cm = staff.find(x => x.uid === m.$('#sv-cm').value);
    const data = {
      iep: { active: m.$('#sv-iep').checked, disability: m.$('#sv-dis').value, caseManagerUid: cm?.uid || '', caseManagerName: cm ? displayNameOf(cm) : '', startDate: m.$('#sv-start').value, annualReview: m.$('#sv-annual').value, reevaluation: m.$('#sv-reeval').value, goals: goals.filter(g => g.text.trim()) },
      plan504: { active: m.$('#sv-504').checked, reviewDate: m.$('#sv-504date').value },
      ell: { active: m.$('#sv-ell').checked, level: m.$('#sv-ell-level').value },
      notes: m.$('#sv-notes').value.trim(), studentName: displayNameOf(student), updatedBy: ctx.me.uid, updatedAt: serverTimestamp(),
    };
    const accItems = m.$('#sv-acc').value.split('\n').map(x => x.trim()).filter(Boolean);
    withBusy(e.currentTarget.querySelector('button:not([data-close])'), 'Saving…', async () => {
      try {
        const b = writeBatch(db);
        b.set(tdoc(ctx, 'services', student.uid), data, { merge: true });
        b.set(tdoc(ctx, 'accommodations', student.uid), { items: accItems, updatedAt: serverTimestamp() });
        b.update(tdoc(ctx, 'students', student.uid), { iep: data.iep.active, plan504: data.plan504.active, ell: data.ell.active });
        await b.commit(); m.close(); toast('Services saved'); onDone?.();
      } catch (ex) { showError(m.$('#sv-err'), ex.message); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SAFETY & INCIDENTS
// ═══════════════════════════════════════════════════════════════
const INCIDENT_TYPES = ['Bullying / harassment', 'Fight / physical aggression', 'Threat', 'Weapon', 'Substance', 'Self-harm concern', 'Medical emergency', 'Disruption', 'Property damage', 'Attendance / truancy', 'Other'];
const SEVERITY = { low: ['Low', 'good'], medium: ['Medium', 'warning'], high: ['High', 'serious'], critical: ['Critical', 'critical'] };
function incidentList(list) {
  return `<div class="card overflow-hidden divide-y divide-white/[0.05]">${list.map(x => `<button data-incident="${x.id}" class="w-full text-left flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 py-3.5 hover:bg-white/[0.03]">
    <div class="w-20 shrink-0 text-xs text-gray-400">${escapeHtml(formatDate((x.date || '') + 'T12:00'))}</div>
    <div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(x.type || 'Incident')}${x.form === 'referral' ? ' <span class="badge badge-red">Referral</span>' : ''}${x.isConcern ? ' <span class="badge badge-blue">Staff concern</span>' : ''}</div><div class="text-[11px] text-gray-500 truncate">${escapeHtml((x.studentNames || []).join(', '))}${x.location ? ' · ' + escapeHtml(x.location) : ''}</div></div>
    ${statusChip(SEVERITY[x.severity]?.[1] || 'warning', SEVERITY[x.severity]?.[0] || 'Medium')}
    ${['closed', 'resolved'].includes((x.status || '').toLowerCase()) ? badge('Resolved', 'muted') : (x.status || '').toLowerCase() === 'under review' ? badge('Under review', 'blue') : badge('Open', 'amber')}</button>`).join('')}</div>`;
}
export async function viewIncidents(ctx) {
  if (!ctx.can('safety')) return navigate(`/${ctx.slug}`, { replace: true });
  const t = routeTokenNow();
  setTitle('Discipline & safety', ctx.tenant.name);
  let status = 'open', type = '', q = '';
  render(tenantPage(ctx, 'sis-safety', pageHeader({ eyebrow: 'Office', title: 'Discipline & safety', subtitle: 'Referrals, incidents, safety concerns and follow-up. Teachers can report concerns; only admins and Safety staff can see this log.', actions: `<div class="flex flex-wrap gap-2"><a href="${buildUrl(`/${ctx.slug}/staff/new/referral`)}" class="btn btn-primary">${ico('flag')} New referral</a><button id="inc-new" class="btn btn-secondary">${ico('plus')} Quick incident</button></div>` }) + `
    <div class="max-w-6xl"><div class="flex flex-wrap items-center gap-3 mb-4"><div class="segmented" role="group"><button data-status="open" aria-pressed="true">Open</button><button data-status="closed" aria-pressed="false">Closed</button><button data-status="" aria-pressed="false">All</button></div>
      <select id="inc-type" class="input !py-2 !w-auto" aria-label="Type"><option value="">All types</option></select>${searchBox('inc-q', 'Search students…')}</div><div id="inc">${skeletonRows(5)}</div></div>`));
  let list = [];
  const el = $('#inc');
  const draw = () => {
    $$('[data-status]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === status)));
    const isClosed = x => ['closed', 'resolved'].includes((x.status || 'open').toLowerCase());
    const shown = list.filter(x => (!status || (status === 'closed' ? isClosed(x) : !isClosed(x))) && (!type || x.type === type) && (!q || (x.studentNames || []).join(' ').toLowerCase().includes(q)));
    el.innerHTML = shown.length ? incidentList(shown) : emptyState({ icon: 'shield-check', tone: 'green', title: status === 'open' ? 'No open incidents' : 'Nothing found' });
    refreshIcons();
  };
  unsubs.push(onSnapshot(tcol(ctx, 'incidents'), snap => { list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || '').localeCompare(a.date || '') || recency(b.createdAt) - recency(a.createdAt)); if (!live(t)) return; const ts = $('#inc-type'); if (ts) ts.innerHTML = `<option value="">All types</option>${[...new Set([...INCIDENT_TYPES, ...list.map(x => x.type).filter(Boolean)])].sort().map(x => `<option ${x === type ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('')}`; draw(); }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  $$('[data-status]').forEach(b => b.addEventListener('click', () => { status = b.dataset.status; draw(); }));
  $('#inc-type').addEventListener('change', e => { type = e.target.value; draw(); });
  $('#inc-q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
  el.addEventListener('click', e => { const b = e.target.closest('[data-incident]'); if (!b) return; const x = list.find(i => i.id === b.dataset.incident); if (x?.form === 'referral') navigate(`/${ctx.slug}/referrals/${x.id}`); else openIncidentModal(ctx, x); });
  $('#inc-new').addEventListener('click', () => openIncidentModal(ctx));
}
export async function openIncidentModal(ctx, existing = null, preset = [], { concern = false } = {}) {
  const x = existing || {};
  let people = existing ? (x.studentUids || []).map((uid, i) => ({ uid, name: x.studentNames?.[i] || 'Student' })) : [...preset];
  let students = null;
  const m = openModal({
    size: 'lg', align: 'top', html: modalHeader({ title: existing ? escapeHtml(x.type || 'Incident') : concern ? 'Report a concern' : 'New incident', subtitle: concern ? 'Goes privately to administrators and safety staff.' : '', icon: concern ? 'flag' : 'shield-alert', tone: concern ? 'amber' : 'red' }) + `<form novalidate>${modalBody(`<div class="space-y-4">
      <div><div class="flex items-center justify-between mb-2"><span class="label !mb-0">Students involved</span><button type="button" id="inc-add-st" class="btn btn-ghost btn-sm">${ico('plus', 'w-3.5 h-3.5')} Student</button></div><div id="inc-people" class="flex flex-wrap gap-2"></div></div>
      <div class="grid sm:grid-cols-3 gap-3"><div><label class="label" for="inc-date">Date</label><input id="inc-date" type="date" class="input" value="${escapeHtml(x.date || todayISO())}"></div><div><label class="label" for="inc-t">Type</label><select id="inc-t" class="input">${INCIDENT_TYPES.map(o => `<option ${x.type === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div><div><label class="label" for="inc-sev">Severity</label><select id="inc-sev" class="input">${Object.entries(SEVERITY).map(([k, [l]]) => `<option value="${k}" ${(x.severity || 'medium') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div><label class="label" for="inc-loc">Location</label><input id="inc-loc" class="input" value="${escapeHtml(x.location || '')}" placeholder="Cafeteria"></div>
      <div><label class="label" for="inc-desc">What happened?</label><textarea id="inc-desc" rows="4" class="input">${escapeHtml(x.description || '')}</textarea></div>
      ${concern ? '' : `<div><label class="label" for="inc-act">Action taken / follow-up</label><textarea id="inc-act" rows="3" class="input">${escapeHtml(x.actionTaken || '')}</textarea></div>
      <div class="flex flex-wrap gap-6"><label class="check"><input type="checkbox" id="inc-parent" ${x.parentContacted ? 'checked' : ''}> Parent/guardian contacted</label><label class="check"><input type="checkbox" id="inc-closed" ${x.status === 'closed' ? 'checked' : ''}> Closed</label></div>`}
      ${existing ? `<p class="text-xs text-gray-500">Reported by ${escapeHtml(x.reportedByName || '')} · ${escapeHtml(formatDateTime(x.createdAt))}</p>` : ''}
      <p id="inc-err" class="form-error hidden"></p></div>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button class="btn btn-primary flex-1">${existing ? 'Save' : concern ? 'Send report' : 'Log incident'}</button>`)}</form>`
  });
  const drawP = () => { m.$('#inc-people').innerHTML = people.length ? people.map((p, i) => `<span class="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-white/[0.06] text-sm text-white">${avatar(p.name, null, 'w-6 h-6', 'text-[9px]')}${escapeHtml(p.name)}<button type="button" data-rm="${i}" aria-label="Remove ${escapeHtml(p.name)}" class="text-gray-500 hover:text-white">${ico('x', 'w-3 h-3')}</button></span>`).join('') : '<span class="text-xs text-gray-500">None added.</span>'; refreshIcons(); };
  drawP();
  m.$('#inc-people').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { people.splice(+b.dataset.rm, 1); drawP(); } });
  m.$('#inc-add-st').addEventListener('click', async () => {
    students ||= await loadStudents(ctx).catch(() => []);
    pickStudent(ctx, students, list => { list.forEach(s => { if (!people.some(p => p.uid === s.uid)) people.push({ uid: s.uid, name: displayNameOf(s) }); }); drawP(); }, { multi: true, title: 'Students involved' });
  });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const err = m.$('#inc-err'); showError(err, '');
    const description = m.$('#inc-desc').value.trim();
    if (!people.length) return showError(err, 'Add at least one student.');
    if (!description) return showError(err, 'Describe what happened.');
    const data = { date: m.$('#inc-date').value || todayISO(), type: m.$('#inc-t').value, severity: m.$('#inc-sev').value, location: m.$('#inc-loc').value.trim(), description, studentUids: people.map(p => p.uid), studentNames: people.map(p => p.name) };
    if (!concern) Object.assign(data, { actionTaken: m.$('#inc-act').value.trim(), parentContacted: m.$('#inc-parent').checked, status: m.$('#inc-closed').checked ? 'closed' : 'open' });
    withBusy(e.currentTarget.querySelector('button:not([data-close])'), 'Saving…', async () => {
      try {
        if (existing) await updateDoc(tdoc(ctx, 'incidents', existing.id), { ...data, updatedAt: serverTimestamp(), updatedBy: ctx.me.uid });
        else {
          const ref = await addDoc(tcol(ctx, 'incidents'), { ...data, status: data.status || 'open', isConcern: concern, reportedBy: ctx.me.uid, reportedByName: ctx.me.name, createdAt: serverTimestamp() });
          officeStaffUids(ctx, 'safety').then(to => notify(ctx, { to, kind: 'incident', title: `${concern ? 'New concern' : 'New incident'}: ${data.type}`, body: `${data.studentNames.join(', ') || 'No student named'} · reported by ${ctx.me.name}`, link: `/${ctx.slug}/referrals/${ref.id}` })).catch(e => console.warn(e));
        }
        m.close(); toast(concern ? 'Concern sent to administrators' : 'Incident saved');
      } catch (ex) { showError(err, ex.message); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// ACTIVITIES (extracurriculars)
// ═══════════════════════════════════════════════════════════════
const ACT_CATEGORIES = ['Athletics', 'Club', 'Arts', 'Academic', 'Service', 'Other'];
function activityCard(ctx, a) {
  const n = (a.members || []).length;
  return `<a href="${buildUrl(`/${ctx.slug}/activities/${a.id}`)}" class="card card-hover p-5 flex flex-col">
    <div class="flex items-center gap-2 mb-3">${iconTile({ Athletics: 'trophy', Club: 'users-round', Arts: 'palette', Academic: 'brain', Service: 'hand-heart' }[a.category] || 'sparkles', 'amber')}${badge(escapeHtml(a.category || 'Other'), 'muted')}${a.season ? badge(escapeHtml(a.season), 'muted') : ''}</div>
    <h3 class="font-serif text-lg text-white mb-1">${escapeHtml(a.name)}</h3>
    <p class="text-xs text-gray-500 mb-3">${escapeHtml(a.advisorName || 'No advisor')}${a.meets ? ' · ' + escapeHtml(a.meets) : ''}</p>
    <div class="mt-auto text-xs text-gray-400">${n}${Number(a.capacity) ? ` / ${Number(a.capacity)}` : ''} ${n === 1 ? 'member' : 'members'}${(a.requests || []).length && (ctx.isAdmin || a.advisorUid === ctx.me.uid) ? ` · <span class="text-[#F59E0B]">${a.requests.length} requests</span>` : ''}</div></a>`;
}
export async function viewActivities(ctx, id = null) {
  if (id) return viewActivity(ctx, id);
  const t = routeTokenNow();
  setTitle('Activities', ctx.tenant.name);
  const canManage = ctx.isAdmin;
  render(tenantPage(ctx, 'sis-activities', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'Activities', subtitle: 'Sports, clubs, arts and service — find something to join.', actions: canManage ? `<button id="act-new" class="btn btn-primary">${ico('plus')} Activity</button>` : '' }) + `
    <div class="max-w-6xl"><div class="segmented flex-wrap mb-6" role="group"><button data-cat="" aria-pressed="true">All</button>${ACT_CATEGORIES.map(c => `<button data-cat="${c}" aria-pressed="false">${c}</button>`).join('')}</div><div id="acts" class="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">${skeletonRows(3, 'h-40')}</div></div>`));
  let list = [], cat = '';
  const el = $('#acts');
  const draw = () => {
    $$('[data-cat]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)));
    const shown = list.filter(a => !cat || a.category === cat);
    el.innerHTML = shown.length ? shown.map(a => activityCard(ctx, a)).join('') : `<div class="col-span-full">${emptyState({ icon: 'trophy', tone: 'amber', title: 'No activities yet', text: canManage ? 'Add your school’s teams and clubs so students can join.' : '' })}</div>`;
    refreshIcons();
  };
  unsubs.push(onSnapshot(tcol(ctx, 'activities'), snap => { list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name)); if (live(t)) draw(); }, e => { el.innerHTML = `<div class="col-span-full">${errorBox(e)}</div>`; refreshIcons(); }));
  $$('[data-cat]').forEach(b => b.addEventListener('click', () => { cat = b.dataset.cat; draw(); }));
  $('#act-new')?.addEventListener('click', () => openActivityEditor(ctx));
}
async function openActivityEditor(ctx, existing = null) {
  const staff = await loadStaff(ctx).catch(() => []);
  const a = existing || {};
  const m = openModal({
    html: modalHeader({ title: existing ? 'Edit activity' : 'New activity', icon: 'trophy' }) + `<form novalidate>${modalBody(`<div class="space-y-4">
      <div><label class="label" for="ac-name">Name</label><input id="ac-name" class="input" value="${escapeHtml(a.name || '')}" placeholder="Varsity soccer"></div>
      <div class="grid grid-cols-2 gap-3"><div><label class="label" for="ac-cat">Category</label><select id="ac-cat" class="input">${ACT_CATEGORIES.map(c => `<option ${a.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div><div><label class="label" for="ac-season">Season</label><input id="ac-season" class="input" value="${escapeHtml(a.season || '')}" placeholder="Fall"></div></div>
      <div><label class="label" for="ac-adv">Advisor / coach</label><select id="ac-adv" class="input"><option value="">—</option>${staff.map(s => `<option value="${s.uid}" ${a.advisorUid === s.uid ? 'selected' : ''}>${escapeHtml(displayNameOf(s))}</option>`).join('')}</select></div>
      <div class="grid grid-cols-2 gap-3"><div><label class="label" for="ac-meets">Meets</label><input id="ac-meets" class="input" value="${escapeHtml(a.meets || '')}" placeholder="Tue/Thu 3:15, Field"></div><div><label class="label" for="ac-cap">Capacity</label><input id="ac-cap" type="number" min="0" class="input" value="${escapeHtml(a.capacity || '')}" placeholder="No limit"></div></div>
      <div><label class="label" for="ac-desc">Description</label><textarea id="ac-desc" rows="3" class="input">${escapeHtml(a.description || '')}</textarea></div>
      <p id="ac-err" class="form-error hidden"></p></div>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button class="btn btn-primary flex-1">Save</button>`)}</form>`
  });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const name = m.$('#ac-name').value.trim(); if (!name) return showError(m.$('#ac-err'), 'Name the activity.');
    const adv = staff.find(s => s.uid === m.$('#ac-adv').value);
    const data = { name, category: m.$('#ac-cat').value, season: m.$('#ac-season').value.trim(), advisorUid: adv?.uid || '', advisorName: adv ? displayNameOf(adv) : '', meets: m.$('#ac-meets').value.trim(), capacity: Number(m.$('#ac-cap').value) || null, description: m.$('#ac-desc').value.trim() };
    withBusy(e.currentTarget.querySelector('button:not([data-close])'), 'Saving…', async () => {
      try {
        if (existing) await updateDoc(tdoc(ctx, 'activities', existing.id), data);
        else await addDoc(tcol(ctx, 'activities'), { ...data, members: [], memberNames: {}, requests: [], requestNames: {}, createdAt: serverTimestamp() });
        m.close(); toast('Activity saved');
      } catch (ex) { showError(m.$('#ac-err'), ex.message); }
    });
  });
}
async function viewActivity(ctx, id) {
  const t = routeTokenNow();
  const ref = tdoc(ctx, 'activities', id);
  render(tenantPage(ctx, 'sis-activities', `<div id="act">${skeletonRows(4, 'h-24')}</div>`, null, { crumbs: [{ label: 'Activities', href: buildUrl(`/${ctx.slug}/activities`) }, { label: 'Activity' }] }));
  let a = null, students = null;
  const el = $('#act');
  const draw = () => {
    if (!a) { el.innerHTML = emptyState({ icon: 'trophy', title: 'Activity not found' }); refreshIcons(); return; }
    setTitle(a.name, ctx.tenant.name);
    const manage = ctx.isAdmin || a.advisorUid === ctx.me.uid;
    const me = ctx.me.uid, member = (a.members || []).includes(me), requested = (a.requests || []).includes(me);
    const full = a.capacity && (a.members || []).length >= a.capacity;
    const kidStatus = ctx.isGuardian ? (ctx.children || []).map(k => `${escapeHtml(displayNameOf(k))}: ${(a.members || []).includes(k.uid) ? 'member' : (a.requests || []).includes(k.uid) ? 'requested' : 'not joined'}`).join(' · ') : '';
    el.innerHTML = pageHeader({ back: { href: `/${ctx.slug}/activities`, label: 'Activities' }, eyebrow: escapeHtml(`${a.category || ''}${a.season ? ' · ' + a.season : ''}`), title: escapeHtml(a.name),
      actions: `${manage ? `<button data-act="edit" class="btn btn-secondary">${ico('pencil', 'w-3.5 h-3.5')} Edit</button><button data-act="add" class="btn btn-secondary">${ico('user-plus', 'w-3.5 h-3.5')} Add members</button>` : ''}${ctx.isStudent ? (member ? badge('You’re a member', 'green') : requested ? badge('Request sent', 'blue') : `<button data-act="join" class="btn btn-primary" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Request to join'}</button>`) : ''}` }) + `
      <div class="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-8 max-w-6xl"><div class="space-y-6 min-w-0">
        ${a.description ? `<div class="card p-6 text-sm text-gray-300 whitespace-pre-wrap">${escapeHtml(a.description)}</div>` : ''}
        ${kidStatus ? `<div class="card p-4 text-sm text-gray-300">${kidStatus}</div>` : ''}
        ${manage && (a.requests || []).length ? `<section><h2 class="label">Requests to join · ${a.requests.length}</h2><div class="card divide-y divide-white/[0.05]">${a.requests.map(uid => `<div class="flex items-center gap-3 px-4 py-3">${avatar(a.requestNames?.[uid] || 'Student')}<span class="flex-1 text-sm text-white">${escapeHtml(a.requestNames?.[uid] || 'Student')}</span><button class="btn btn-primary btn-sm" data-approve="${uid}">Approve</button><button class="btn btn-ghost btn-sm" data-decline="${uid}">Decline</button></div>`).join('')}</div></section>` : ''}
        ${ctx.isRealTeacher ? `<section><h2 class="label">Roster · ${(a.members || []).length}${Number(a.capacity) ? ` of ${Number(a.capacity)}` : ''}</h2>${(a.members || []).length ? `<div class="card divide-y divide-white/[0.05]">${a.members.map(uid => `<div class="flex items-center gap-3 px-4 py-3">${avatar(a.memberNames?.[uid] || 'Student')}<a href="${buildUrl(`/${ctx.slug}/record/${uid}`)}" class="flex-1 text-sm text-white hover:text-[#F59E0B]">${escapeHtml(a.memberNames?.[uid] || 'Student')}</a>${manage ? `<button class="btn-icon danger" data-remove="${uid}" aria-label="Remove">${ico('user-minus', 'w-4 h-4')}</button>` : ''}</div>`).join('')}</div>` : '<p class="text-sm text-gray-500">No members yet.</p>'}</section>` : ''}
      </div><aside class="card p-5 space-y-3 h-fit">
        <div><div class="text-xs text-gray-500">Advisor / coach</div><div class="text-sm text-white">${escapeHtml(a.advisorName || '—')}</div></div>
        <div><div class="text-xs text-gray-500">Meets</div><div class="text-sm text-white">${escapeHtml(a.meets || '—')}</div></div>
        <div><div class="text-xs text-gray-500">Members</div><div class="text-sm text-white">${(a.members || []).length}${Number(a.capacity) ? ` of ${Number(a.capacity)}` : ''}</div></div>
        ${a.advisorUid && a.advisorUid !== me && !ctx.isRealTeacher ? `<button data-act="msg" class="btn btn-secondary btn-block">${ico('mail', 'w-4 h-4')} Message advisor</button>` : ''}
      </aside></div>`;
    refreshIcons();
  };
  unsubs.push(onSnapshot(ref, s => { a = s.exists() ? { id: s.id, ...s.data() } : null; if (live(t)) draw(); }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-act],[data-approve],[data-decline],[data-remove]'); if (!b) return;
    try {
      if (b.dataset.act === 'edit') return openActivityEditor(ctx, a);
      if (b.dataset.act === 'join') { await updateDoc(ref, { requests: arrayUnion(ctx.me.uid), [`requestNames.${ctx.me.uid}`]: ctx.me.name }); return toast('Request sent to the advisor'); }
      if (b.dataset.act === 'msg') return openComposeModal(ctx, { subject: a.name });
      if (b.dataset.act === 'add') {
        students ||= await loadStudents(ctx);
        return pickStudent(ctx, students.filter(s => !(a.members || []).includes(s.uid)), list => {
          const upd = { members: arrayUnion(...list.map(s => s.uid)) }; list.forEach(s => { upd[`memberNames.${s.uid}`] = displayNameOf(s); });
          updateDoc(ref, upd).then(() => toast(`Added ${plural(list.length, 'member')}`)).catch(ex => toast(ex.message, 'error'));
        }, { multi: true, title: 'Add members' });
      }
      if (b.dataset.approve) { const uid = b.dataset.approve; await updateDoc(ref, { requests: arrayRemove(uid), members: arrayUnion(uid), [`memberNames.${uid}`]: a.requestNames?.[uid] || 'Student' }); return toast('Approved'); }
      if (b.dataset.decline) { await updateDoc(ref, { requests: arrayRemove(b.dataset.decline) }); return toast('Declined', 'info'); }
      if (b.dataset.remove && await confirmDialog({ title: 'Remove from roster?', confirmLabel: 'Remove', danger: true })) await updateDoc(ref, { members: arrayRemove(b.dataset.remove) });
    } catch (ex) { toast(ex.message, 'error'); }
  });
}

// ═══════════════════════════════════════════════════════════════
// CAREER PLANNING
// ═══════════════════════════════════════════════════════════════
const CLUSTERS = ['Agriculture & natural resources', 'Architecture & construction', 'Arts, A/V & communications', 'Business & management', 'Education & training', 'Finance', 'Government & public administration', 'Health science', 'Hospitality & tourism', 'Human services', 'Information technology', 'Law & public safety', 'Manufacturing', 'Marketing', 'STEM', 'Transportation & logistics'];
const PATHS = ['4-year college', '2-year college', 'Technical / trade school', 'Apprenticeship', 'Military', 'Workforce', 'Undecided'];
const MILESTONES = ['Career interest survey', 'Résumé', 'Job shadow or internship', 'Campus visit', 'Applications sent', 'FAFSA / financial aid', 'Scholarship applications'];
async function careerPlanTab(ctx, el, student, { canEdit }) {
  const ref = tdoc(ctx, 'careerPlans', student.uid);
  const s = await getDoc(ref);
  if (!el.isConnected) return; // the user moved on to another student/tab
  const p = s.exists() ? s.data() : {};
  const plan = { clusters: p.clusters || [], path: p.path || '', goals: p.goals || '', interests: p.interests || '', courses: p.courses || { 9: '', 10: '', 11: '', 12: '' }, milestones: p.milestones || {} };
  const dis = canEdit ? '' : 'disabled';
  el.innerHTML = `<form id="cp" class="space-y-6 max-w-4xl" novalidate>
    <section class="card p-6"><h2 class="font-serif text-xl text-white mb-1">Career interests</h2><p class="text-xs text-gray-500 mb-4">Pick the career clusters that sound interesting.</p>
      <div class="flex flex-wrap gap-2">${CLUSTERS.map(c => `<label class="cursor-pointer"><input type="checkbox" class="sr-only peer" data-cluster="${c}" ${plan.clusters.includes(c) ? 'checked' : ''} ${dis}><span class="inline-block px-3 py-1.5 rounded-full text-xs border border-white/10 text-gray-400 peer-checked:border-[#F59E0B]/60 peer-checked:bg-[#F59E0B]/10 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[#F59E0B]">${c}</span></label>`).join('')}</div>
      <label class="label mt-5" for="cp-int">Interests, strengths & dream jobs</label><textarea id="cp-int" rows="2" class="input" ${dis}>${escapeHtml(plan.interests)}</textarea></section>
    <section class="card p-6"><h2 class="font-serif text-xl text-white mb-4">After high school</h2><label class="label" for="cp-path">Plan</label><select id="cp-path" class="input max-w-sm mb-4" ${dis}><option value="">—</option>${PATHS.map(x => `<option ${plan.path === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <label class="label" for="cp-goals">Goals</label><textarea id="cp-goals" rows="3" class="input" placeholder="Study nursing at the state university; work part-time at a clinic." ${dis}>${escapeHtml(plan.goals)}</textarea></section>
    <section class="card p-6"><h2 class="font-serif text-xl text-white mb-1">Four-year course plan</h2><p class="text-xs text-gray-500 mb-4">One course per line.</p><div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">${[9, 10, 11, 12].map(g => `<div><label class="label" for="cp-g${g}">Grade ${g}</label><textarea id="cp-g${g}" rows="6" class="input text-sm" ${dis}>${escapeHtml(plan.courses[g] || '')}</textarea></div>`).join('')}</div></section>
    <section class="card p-6"><h2 class="font-serif text-xl text-white mb-4">Milestones</h2><div class="grid sm:grid-cols-2 gap-3">${MILESTONES.map(x => `<label class="check"><input type="checkbox" data-ms="${x}" ${plan.milestones[x] ? 'checked' : ''} ${dis}> ${x}</label>`).join('')}</div></section>
    ${canEdit ? `<div class="sticky bottom-0 py-3 bg-[#0A0A0A]/90 backdrop-blur flex items-center gap-3"><button class="btn btn-primary">${ico('save', 'w-4 h-4')} Save plan</button>${p.updatedAt ? `<span class="text-xs text-gray-500">Last saved ${escapeHtml(timeAgo(p.updatedAt))}</span>` : ''}</div>` : ''}
  </form>`;
  if (!canEdit) return;
  $('#cp').addEventListener('submit', e => {
    e.preventDefault();
    const data = { clusters: $$('[data-cluster]').filter(c => c.checked).map(c => c.dataset.cluster), path: $('#cp-path').value, goals: $('#cp-goals').value.trim(), interests: $('#cp-int').value.trim(), courses: Object.fromEntries([9, 10, 11, 12].map(g => [g, $(`#cp-g${g}`).value.trim()])), milestones: Object.fromEntries($$('[data-ms]').map(c => [c.dataset.ms, c.checked])), studentUid: student.uid, updatedBy: ctx.me.uid, updatedAt: serverTimestamp() };
    withBusy(e.currentTarget.querySelector('button'), 'Saving…', async () => {
      try { await setDoc(ref, data, { merge: true }); toast('Career plan saved'); } catch (ex) { toast(ex.message, 'error'); }
    });
  });
}


// ═══════════════════════════════════════════════════════════════
// DISTRICT (cross-school dashboards: attendance, students, safety)
// ═══════════════════════════════════════════════════════════════
const ADA_LEVEL = r => r === null ? null : r >= 95 ? 'good' : r >= 90 ? 'warning' : r >= 85 ? 'serious' : 'critical';
const ADA_LABEL = { good: 'On track', warning: 'Watch', serious: 'Concern', critical: 'Urgent' };
const CHRONIC_LEVEL = r => r === null ? null : r < 10 ? 'good' : r < 20 ? 'warning' : r < 30 ? 'serious' : 'critical';
const DISTRICT_RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['year', 'This school year']];
function rangeFrom(range) {
  const d = new Date();
  if (range === 'year') return toDateInput(new Date(d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1, 7, 1));
  d.setDate(d.getDate() - Number(range)); return toDateInput(d);
}
const shortName = s => (s.name || s.id).replace(/\b(Elementary|Middle|High|Junior|Senior|School|Academy)\b/g, m => ({ Elementary: 'Elem.', Middle: 'Middle', High: 'High', Junior: 'Jr.', Senior: 'Sr.', School: '', Academy: 'Acad.' })[m]).replace(/\s+/g, ' ').trim() || s.id;

// One load per district + date range, shared by every district page for two minutes.
const districtCache = new Map();
export async function loadDistrict(dctx, range = '30', { fresh = false } = {}) {
  const key = `${dctx.districtId}|${range}`, hit = districtCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 120000) return hit.data;
  const from = rangeFrom(range), to = todayISO();
  const schools = await getDistrictSchools(dctx.districtId);
  await Promise.all(schools.map(async s => {
    const col = name => collection(db, 'tenants', s.id, name);
    const [st, att, inc] = await Promise.allSettled([
      getDocs(col('students')),
      getDocs(query(col('attendance'), where('date', '>=', from))),
      getDocs(query(col('incidents'), where('date', '>=', from))),
    ]);
    s.students = st.status === 'fulfilled' ? st.value.docs.map(d => ({ uid: d.id, ...d.data(), _school: s })).filter(x => x.status !== 'pending' && x.status !== 'rejected') : [];
    s.records = att.status === 'fulfilled' ? att.value.docs.map(d => d.data()).filter(r => r.date <= to) : [];
    s.incidents = inc.status === 'fulfilled' ? inc.value.docs.map(d => ({ id: d.id, ...d.data() })) : null; // null = not readable
    s.att = summarize(s.records);
    s.chronic = chronicList(s.records, 10).filter(x => x.level !== 'warning');
    s.chronicRate = s.records.length ? pct(s.chronic.length, new Set(s.records.map(r => r.studentUid)).size) : null;
    s.errors = [st, att].filter(x => x.status === 'rejected').map(x => x.reason);
  }));
  const records = schools.flatMap(s => s.records);
  const tracked = schools.reduce((a, s) => a + new Set(s.records.map(r => r.studentUid)).size, 0);
  const chronic = schools.flatMap(s => s.chronic.map(c => ({ ...c, school: s })));
  const data = {
    schools, from, to, range, records, att: summarize(records), tracked, chronic,
    chronicRate: tracked ? pct(chronic.length, tracked) : null,
    students: schools.flatMap(s => s.students),
    incidents: schools.flatMap(s => (s.incidents || []).map(i => ({ ...i, school: s }))),
    incidentsReadable: schools.some(s => s.incidents !== null),
  };
  districtCache.set(key, { at: Date.now(), data });
  return data;
}
function dailySeries(records) {
  const days = {};
  records.forEach(r => { const d = (days[r.date] ||= { ok: 0, abs: 0, T: 0, n: 0 }); d.n++; if (r.code === 'P' || r.code === 'T') d.ok++; if (isAbsence(r.code)) d.abs++; if (r.code === 'T') d.T++; });
  return Object.keys(days).sort().map(k => { const d = days[k]; return { x: new Date(k + 'T12:00'), y: pct(d.ok, d.n) ?? 0, detail: `${d.abs} absent · ${d.T} tardy of ${d.n.toLocaleString()}` }; });
}
// Horizontal bars for comparing named things (schools, types): every bar is direct-labelled, with a hover tooltip.
function vizRank(rows, { label, format = v => `${v}%`, max = null, empty = 'No data yet.' }) {
  rows = rows.filter(r => r.value !== null && r.value !== undefined);
  if (!rows.length) return { html: `<p class="text-sm text-gray-500 py-10 text-center">${empty}</p>`, mount() {} };
  const top = max || Math.max(...rows.map(r => r.value)) || 1;
  const html = `<div class="viz rank" data-viz role="list" aria-label="${escapeHtml(label)}">
    ${rows.map((r, i) => `<div class="rank-row" role="listitem" data-i="${i}">
      <div class="rank-name" title="${escapeHtml(r.label)}">${r.href ? `<a href="${r.href}">${escapeHtml(r.label)}</a>` : escapeHtml(r.label)}</div>
      <div class="rank-track"><div class="rank-bar" style="width:${Math.max(r.value ? 1.5 : 0, r.value / top * 100).toFixed(1)}%"></div></div>
      <div class="rank-val">${escapeHtml(format(r.value))}${r.status ? ` ${ico(STATUS[r.status][0], 'w-3.5 h-3.5 ' + STATUS[r.status][1])}` : ''}</div>
    </div>`).join('')}<div class="viz-tip" role="status"></div></div>`;
  return {
    html,
    mount(root) {
      const box = root.querySelector('[data-viz]'); if (!box) return;
      const tip = box.querySelector('.viz-tip');
      box.querySelectorAll('.rank-row').forEach(row => {
        row.addEventListener('pointerenter', () => {
          const r = rows[+row.dataset.i], bar = row.querySelector('.rank-bar'), b = box.getBoundingClientRect(), br = bar.getBoundingClientRect();
          tip.innerHTML = `<div class="text-[11px] text-gray-400">${escapeHtml(r.label)}</div><div class="font-semibold">${escapeHtml(format(r.value))}</div>${r.detail ? `<div class="text-[11px] text-gray-400">${escapeHtml(r.detail)}</div>` : ''}`;
          tip.style.left = `${br.right - b.left}px`; tip.style.top = `${br.top - b.top}px`; tip.classList.add('on');
        });
        row.addEventListener('pointerleave', () => tip.classList.remove('on'));
      });
    }
  };
}
const mountAll = (root, charts) => root.querySelectorAll('[data-chart]').forEach(el => charts[el.dataset.chart]?.mount(el));
const chartCard = (key, title, sub, chart, extra = '') => `<section class="card p-5 sm:p-6"><h2 class="text-sm text-white font-medium">${title}</h2>${sub ? `<p class="text-xs text-gray-500 mb-4">${sub}</p>` : '<div class="mb-4"></div>'}<div data-chart="${key}">${chart.html}</div>${extra}</section>`;
const kpi = (label, value, sub = '', status = null, href = '') => `<${href ? `a href="${href}"` : 'div'} class="card ${href ? 'card-hover' : ''} p-5 block">${statTileInner(label, value, sub, status)}</${href ? 'a' : 'div'}>`;
const statTileInner = (label, value, sub, status) => `<div class="text-xs text-gray-400 mb-2">${label}</div><div class="stat-value tabular-nums">${value}</div>${sub || status ? `<div class="mt-1 text-xs text-gray-500 flex items-center gap-1.5">${status ? ico(STATUS[status][0], 'w-3.5 h-3.5 ' + STATUS[status][1]) : ''}${sub}</div>` : ''}`;
const rangeControl = range => `<label class="sr-only" for="d-range">Date range</label><select id="d-range" class="input !py-2 !w-auto">${DISTRICT_RANGES.map(([v, l]) => `<option value="${v}" ${v === range ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const rangeLabel = range => DISTRICT_RANGES.find(r => r[0] === range)?.[1].toLowerCase() || '';
function partialNote(data) {
  const bad = data.schools.filter(s => s.errors.length);
  return bad.length ? `<div class="mb-6 p-3 rounded-lg border border-[#fab219]/30 bg-[#fab219]/5 text-xs text-gray-300 flex gap-2">${ico('triangle-alert', 'w-4 h-4 st-warning shrink-0')}<span>Some data couldn't be loaded for ${bad.map(s => escapeHtml(s.name || s.id)).join(', ')}. Make sure the latest security rules are published.</span></div>` : '';
}
// Shared scaffolding: header with a range picker, skeleton, load, then draw(data).
function districtPage(dctx, active, header, draw) {
  const t = routeTokenNow();
  const url = new URLSearchParams(location.search);
  let range = DISTRICT_RANGES.some(r => r[0] === url.get('range')) ? url.get('range') : '30';
  setTitle(header.title, dctx.district.name);
  render(districtShell(dctx, active, { eyebrow: escapeHtml(dctx.district.name || dctx.districtId), ...header, actions: `<div class="flex items-center gap-2">${header.actions || ''}${header.noRange ? '' : rangeControl(range)}<button id="d-refresh" class="btn-icon" aria-label="Refresh" title="Refresh">${ico('refresh-cw', 'w-4 h-4')}</button></div>` },
    `<div id="d-body" class="max-w-6xl"><div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">${Array.from({ length: 4 }, () => '<div class="skeleton h-28"></div>').join('')}</div><div class="skeleton h-72 mb-6"></div>${skeletonRows(4)}</div>`));
  const body = $('#d-body');
  const load = async fresh => {
    try {
      const data = await loadDistrict(dctx, range, { fresh });
      if (!live(t)) return;
      body.innerHTML = partialNote(data) + draw(data, range);
      refreshIcons();
      body.dispatchEvent(new CustomEvent('district:drawn', { detail: data }));
    } catch (e) { console.error(e); if (live(t)) { body.innerHTML = errorBox(e); refreshIcons(); } }
  };
  $('#d-range')?.addEventListener('change', e => {
    range = e.target.value;
    const u = new URL(location.href); u.searchParams.set('range', range); history.replaceState(history.state, '', u);
    body.innerHTML = skeletonRows(5, 'h-24'); load(false);
  });
  $('#d-refresh').addEventListener('click', () => { body.innerHTML = skeletonRows(5, 'h-24'); load(true); });
  setTimeout(() => load(false)); // after the caller has attached its listeners
  return body;
}
const schoolHref = (s, path = '/admin') => buildUrl(`/${s.id}${path}`);

export async function viewDistrictHome(dctx) {
  const p = s => buildUrl(`/district/${dctx.districtId}${s}`);
  let charts = {};
  const body = districtPage(dctx, 'overview',
    { title: 'Dashboard', subtitle: 'Every school in your district at a glance.', actions: `<button data-create-school class="btn btn-violet">${ico('plus')} <span class="hidden sm:inline">New school</span></button>` },
    (data, range) => {
      const { schools, att } = data;
      if (!schools.length) return emptyState({ icon: 'building-2', tone: 'violet', title: 'No schools yet', text: "Create the first school in your district. You'll become its admin and get a join code for teachers.", action: `<button data-create-school class="btn btn-violet">${ico('plus')} Create first school</button>` });
      const teachers = schools.reduce((a, s) => a + (s._teacherCount || 0), 0);
      const lvl = ADA_LEVEL(att.rate);
      const watch = schools.map(s => {
        const flags = [];
        const l = ADA_LEVEL(s.att.rate);
        if (l && l !== 'good') flags.push({ level: l, text: `Attendance ${fmtPct(s.att.rate)}` });
        const c = CHRONIC_LEVEL(s.chronicRate);
        if (c && c !== 'good') flags.push({ level: c, text: `${s.chronic.length} chronically absent (${fmtPct(s.chronicRate)})` });
        const hi = (s.incidents || []).filter(i => i.severity === 'high' || i.severity === 'critical').length;
        if (hi) flags.push({ level: 'serious', text: `${plural(hi, 'high-severity incident')}` });
        if (!s.records.length && s.students.length) flags.push({ level: 'warning', text: 'No attendance taken in this range' });
        return { s, flags };
      }).filter(x => x.flags.length);
      const sev = { critical: 0, serious: 1, warning: 2, good: 3 };
      watch.sort((a, b) => Math.min(...a.flags.map(f => sev[f.level])) - Math.min(...b.flags.map(f => sev[f.level])));
      charts = { trend: vizLine(dailySeries(data.records), { label: 'District daily attendance rate' }) };
      return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          ${kpi('Students enrolled', data.students.length.toLocaleString(), `${plural(schools.length, 'school')} · ${plural(teachers, 'teacher')}`, null, p('/students'))}
          ${kpi('Attendance rate', fmtPct(att.rate), lvl ? ADA_LABEL[lvl] : 'No attendance yet', lvl, p('/attendance'))}
          ${kpi('Chronically absent', data.chronic.length.toLocaleString(), data.tracked ? `${fmtPct(data.chronicRate)} of students` : 'No attendance yet', CHRONIC_LEVEL(data.chronicRate), p('/attendance?show=chronic'))}
          ${kpi('Incidents', data.incidentsReadable ? data.incidents.length.toLocaleString() : '—', data.incidentsReadable ? `${data.incidents.filter(i => i.status !== 'resolved' && i.status !== 'closed').length} open` : 'Publish the latest rules', null, p('/safety'))}
        </div>
        <div class="grid lg:grid-cols-3 gap-6 mb-8">
          <div class="lg:col-span-2">${chartCard('trend', 'District attendance', `Present + tardy as a share of all student-periods, ${rangeLabel(range)}.`, charts.trend)}</div>
          <section class="card p-5 sm:p-6 flex flex-col"><h2 class="text-sm text-white font-medium mb-1">Needs attention</h2><p class="text-xs text-gray-500 mb-4">Schools below target, ${rangeLabel(range)}.</p>
            ${watch.length ? `<ul class="space-y-3 overflow-y-auto max-h-72 -mr-2 pr-2">${watch.map(({ s, flags }) => `<li><a href="${schoolHref(s, '/office/attendance')}" class="text-sm text-white hover:text-[#A78BFA] transition-colors">${escapeHtml(s.name || s.id)}</a><div class="mt-1 space-y-1">${flags.map(f => `<div>${statusChip(f.level, f.text)}</div>`).join('')}</div></li>`).join('')}</ul>`
              : `<div class="flex-1 flex flex-col items-center justify-center text-center py-6">${ico('circle-check', 'w-8 h-8 st-good mb-2')}<p class="text-sm text-gray-300">Every school is on track.</p></div>`}
          </section>
        </div>
        <div class="flex items-center justify-between mb-3"><h2 class="font-serif text-xl text-white">Schools</h2><a href="${p('/schools')}" class="text-xs text-[#A78BFA] hover:underline">Manage schools →</a></div>
        ${districtSchoolsTable(schools)}`;
    });
  body.addEventListener('district:drawn', () => mountAll(body, charts));
}
function districtSchoolsTable(schools) {
  return dataTable(
    [{ label: 'School', cls: 'col-span-12 sm:col-span-4' }, { label: 'Students', cls: 'col-span-4 sm:col-span-2 sm:text-right' }, { label: 'Attendance', cls: 'col-span-4 sm:col-span-2 sm:text-right' }, { label: 'Chronic', cls: 'col-span-4 sm:col-span-2 sm:text-right' }, { label: 'Status', cls: 'col-span-12 sm:col-span-2' }],
    schools.map(s => {
      const l = ADA_LEVEL(s.att.rate);
      return {
        cells: [
          `<a href="${schoolHref(s)}" class="flex items-center gap-3 group/link"><div class="tile tile-violet text-[10px] font-mono">${escapeHtml(s.id.slice(0, 3).toUpperCase())}</div><div class="min-w-0"><div class="text-sm text-white truncate group-hover/link:text-[#A78BFA] transition-colors">${escapeHtml(s.name || s.id)}</div><div class="text-xs text-gray-500 truncate">${plural(s._teacherCount || 0, 'teacher')} · ${plural(s._courseCount || 0, 'course')}</div></div></a>`,
          `<span class="text-sm text-gray-200 tabular-nums sm:block sm:text-right"><span class="sm:hidden text-gray-500 text-xs">Students </span>${s.students.length.toLocaleString()}</span>`,
          `<span class="text-sm text-gray-200 tabular-nums sm:block sm:text-right"><span class="sm:hidden text-gray-500 text-xs">Attendance </span>${fmtPct(s.att.rate)}</span>`,
          `<span class="text-sm text-gray-200 tabular-nums sm:block sm:text-right"><span class="sm:hidden text-gray-500 text-xs">Chronic </span>${s.records.length ? s.chronic.length : '—'}</span>`,
          l ? statusChip(l, ADA_LABEL[l]) : `<span class="text-xs text-gray-500">No attendance yet</span>`,
        ]
      };
    }));
}

export async function viewDistrictAttendance(dctx) {
  let charts = {}, current = null;
  const body = districtPage(dctx, 'attendance',
    { title: 'Attendance', subtitle: 'Attendance and chronic absence across every school.' },
    (data, range) => {
      current = data;
      const { schools, att } = data;
      if (!data.records.length) return emptyState({ icon: 'calendar-check', tone: 'violet', title: 'No attendance yet', text: `No school has taken attendance in the ${rangeLabel(range)}. Teachers take it from each course's Attendance tab.` });
      const gAgg = {};
      data.records.forEach(r => { const g = r.gradeLevel; if (g === undefined || g === null || g === '') return; const x = (gAgg[g] ||= { abs: 0, n: 0 }); x.n++; if (isAbsence(r.code)) x.abs++; });
      const withData = schools.filter(s => s.records.length);
      const p = s => buildUrl(`/district/${dctx.districtId}${s}`);
      charts = {
        trend: vizLine(dailySeries(data.records), { label: 'District daily attendance rate' }),
        bySchool: vizRank(withData.map(s => ({ label: s.name || s.id, href: schoolHref(s, '/office/attendance'), value: s.att.absenceRate ?? 0, detail: `${s.att.absent.toLocaleString()} of ${s.att.total.toLocaleString()} student-periods`, status: ADA_LEVEL(s.att.rate) })).sort((a, b) => b.value - a.value), { label: 'Absence rate by school' }),
        chronic: vizRank(withData.map(s => ({ label: s.name || s.id, href: schoolHref(s, '/office/attendance?tab=chronic'), value: s.chronicRate ?? 0, detail: `${s.chronic.length} of ${new Set(s.records.map(r => r.studentUid)).size} students`, status: CHRONIC_LEVEL(s.chronicRate) })).sort((a, b) => b.value - a.value), { label: 'Chronic absence rate by school' }),
        byGrade: vizBars(GRADE_LEVELS.filter(g => gAgg[g]).map(g => ({ label: g === 'K' ? 'K' : `Gr ${g}`, value: pct(gAgg[g].abs, gAgg[g].n) || 0, detail: `${gAgg[g].abs} of ${gAgg[g].n} student-periods` })), { label: 'Absence rate by grade level' }),
      };
      const lvl = ADA_LEVEL(att.rate);
      const labels = { critical: 'Severe', serious: 'Chronic' };
      return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          ${kpi('Average daily attendance', fmtPct(att.rate), lvl ? ADA_LABEL[lvl] : '', lvl)}
          ${kpi('Absences', att.absent.toLocaleString(), `${att.E.toLocaleString()} excused`)}
          ${kpi('Tardies', att.T.toLocaleString(), `${fmtPct(pct(att.T, att.total))} of student-periods`)}
          ${kpi('Chronically absent', data.chronic.length.toLocaleString(), `${fmtPct(data.chronicRate)} of ${data.tracked.toLocaleString()} students`, CHRONIC_LEVEL(data.chronicRate))}
        </div>
        <div class="mb-6">${chartCard('trend', 'Daily attendance rate', `All schools combined, ${rangeLabel(range)}. Hover for daily detail.`, charts.trend, tableView(['Date', 'Rate', 'Absent / tardy'], dailySeries(data.records).map(x => [escapeHtml(x.x.toLocaleDateString()), fmtPct(x.y), escapeHtml(x.detail)])))}</div>
        <div class="grid lg:grid-cols-2 gap-6 mb-6">
          ${chartCard('bySchool', 'Absence rate by school', 'Excused + unexcused, as a share of student-periods. Icons show each school’s attendance status.', charts.bySchool)}
          ${chartCard('chronic', 'Chronic absence by school', 'Share of students missing 10% or more of their class time.', charts.chronic)}
        </div>
        <div class="mb-8">${chartCard('byGrade', 'Absence rate by grade level', 'District-wide, from each student’s grade level at the time attendance was taken.', charts.byGrade)}</div>
        <div class="flex flex-wrap items-center justify-between gap-3 mb-3"><h2 class="font-serif text-xl text-white">By school</h2><button data-csv="schools" class="btn btn-secondary btn-sm">${ico('download', 'w-3.5 h-3.5')} Export CSV</button></div>
        <div class="mb-10">${dataTable(
          [{ label: 'School', cls: 'col-span-12 sm:col-span-4' }, { label: 'Attendance', cls: 'col-span-3 sm:col-span-2 sm:text-right' }, { label: 'Absences', cls: 'col-span-3 sm:col-span-2 sm:text-right' }, { label: 'Tardies', cls: 'col-span-3 sm:col-span-1 sm:text-right' }, { label: 'Chronic', cls: 'col-span-3 sm:col-span-1 sm:text-right' }, { label: 'Status', cls: 'col-span-12 sm:col-span-2' }],
          schools.map(s => { const l = ADA_LEVEL(s.att.rate); const cell = (lab, v) => `<span class="text-sm text-gray-200 tabular-nums sm:block sm:text-right"><span class="sm:hidden text-gray-500 text-xs">${lab} </span>${v}</span>`; return { cells: [
            `<a href="${schoolHref(s, '/office/attendance')}" class="text-sm text-white hover:text-[#A78BFA] transition-colors truncate block">${escapeHtml(s.name || s.id)}</a>`,
            cell('Rate', fmtPct(s.att.rate)), cell('Abs.', s.att.absent.toLocaleString()), cell('Tardy', s.att.T.toLocaleString()), cell('Chronic', s.records.length ? s.chronic.length : '—'),
            l ? statusChip(l, ADA_LABEL[l]) : `<span class="text-xs text-gray-500">No data</span>`] }; }))}</div>
        <div id="chronic" class="flex flex-wrap items-center justify-between gap-3 mb-3 scroll-mt-6"><div><h2 class="font-serif text-xl text-white">Chronically absent students</h2><p class="text-xs text-gray-500 mt-1">Missing 10% or more of class time; 20%+ is severe. ${plural(data.chronic.length, 'student')}.</p></div><button data-csv="chronic" class="btn btn-secondary btn-sm" ${data.chronic.length ? '' : 'disabled'}>${ico('download', 'w-3.5 h-3.5')} Export CSV</button></div>
        ${data.chronic.length ? dataTable(
          [{ label: 'Student', cls: 'col-span-12 sm:col-span-4' }, { label: 'School', cls: 'col-span-12 sm:col-span-3' }, { label: 'Status', cls: 'col-span-5 sm:col-span-2' }, { label: 'Missed', cls: 'col-span-3 sm:col-span-1 text-right' }, { label: 'Absences', cls: 'col-span-4 sm:col-span-2 text-right' }],
          [...data.chronic].sort((a, b) => b.rate - a.rate).slice(0, 200).map(x => ({ cells: [
            `<a href="${schoolHref(x.school, `/record/${x.uid}/attendance`)}" class="flex items-center gap-3">${avatar(x.name)}<span class="min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(x.name)}</span><span class="block text-[11px] text-gray-500">${escapeHtml(gradeLabel(x.grade))}</span></span></a>`,
            `<span class="text-xs text-gray-400 truncate block">${escapeHtml(x.school.name || x.school.id)}</span>`,
            statusChip(x.level, labels[x.level]),
            `<span class="text-sm text-white tabular-nums block text-right">${x.rate}%</span>`,
            `<span class="text-xs text-gray-400 tabular-nums block text-right">${x.abs} of ${x.n}</span>`] })))
          + (data.chronic.length > 200 ? `<p class="hint mt-2">Showing the 200 highest. Export CSV for the full list.</p>` : '')
          : emptyState({ icon: 'circle-check', tone: 'green', title: 'No chronically absent students', text: 'Nobody has missed 10% or more of their classes in this range.' })}`;
    });
  body.addEventListener('district:drawn', () => { mountAll(body, charts); if (new URLSearchParams(location.search).get('show') === 'chronic') $('#chronic')?.scrollIntoView(); });
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-csv]'); if (!b || !current) return;
    if (b.dataset.csv === 'schools') downloadCSV(`attendance-by-school-${current.from}-to-${current.to}.csv`, [['School', 'Attendance %', 'Absence %', 'Absences', 'Excused', 'Tardies', 'Student-periods', 'Chronically absent', 'Chronic %'], ...current.schools.map(s => [s.name || s.id, s.att.rate ?? '', s.att.absenceRate ?? '', s.att.absent, s.att.E, s.att.T, s.att.total, s.chronic.length, s.chronicRate ?? ''])]);
    else downloadCSV(`chronic-absence-${current.from}-to-${current.to}.csv`, [['Student', 'School', 'Grade', 'Missed %', 'Absences', 'Sessions'], ...current.chronic.map(x => [x.name, x.school.name || x.school.id, x.grade ?? '', x.rate, x.abs, x.n])]);
  });
}

export async function viewDistrictStudents(dctx) {
  let charts = {}, state = { q: '', school: '', grade: '', flag: '' };
  const body = districtPage(dctx, 'students',
    { title: 'Students', subtitle: 'Enrollment and student programs across the district.', noRange: true },
    data => {
      const { students, schools } = data;
      if (!students.length) return emptyState({ icon: 'graduation-cap', tone: 'violet', title: 'No students yet', text: 'Students appear here once schools add them.' });
      const byGrade = {}; students.forEach(s => { if (s.gradeLevel !== undefined && s.gradeLevel !== null && s.gradeLevel !== '') byGrade[s.gradeLevel] = (byGrade[s.gradeLevel] || 0) + 1; });
      const count = f => students.filter(f).length;
      charts = {
        grade: vizBars(GRADE_LEVELS.filter(g => byGrade[g]).map(g => ({ label: g === 'K' ? 'K' : `Gr ${g}`, value: byGrade[g], detail: `${gradeLabel(g)}` })), { label: 'Enrollment by grade level', format: v => Math.round(v).toLocaleString() }),
        school: vizRank(schools.map(s => ({ label: s.name || s.id, href: schoolHref(s, '/sis'), value: s.students.length })).sort((a, b) => b.value - a.value), { label: 'Enrollment by school', format: v => v.toLocaleString() }),
      };
      const unassigned = count(s => s.gradeLevel === undefined || s.gradeLevel === null || s.gradeLevel === '');
      return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          ${kpi('Students enrolled', students.length.toLocaleString(), plural(schools.length, 'school'))}
          ${kpi('IEP', count(s => s.iep).toLocaleString(), `${fmtPct(pct(count(s => s.iep), students.length))} of students`)}
          ${kpi('504 plans', count(s => s.plan504).toLocaleString(), `${fmtPct(pct(count(s => s.plan504), students.length))} of students`)}
          ${kpi('English learners', count(s => s.ell).toLocaleString(), `${fmtPct(pct(count(s => s.ell), students.length))} of students`)}
        </div>
        <div class="grid lg:grid-cols-2 gap-6 mb-8">
          ${chartCard('grade', 'Enrollment by grade level', unassigned ? `${plural(unassigned, 'student')} without a grade level ${unassigned === 1 ? "isn't" : "aren't"} shown.` : 'From each student’s record.', charts.grade)}
          ${chartCard('school', 'Enrollment by school', 'Click a school to open its student directory.', charts.school)}
        </div>
        <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
          <h2 class="font-serif text-xl text-white">Directory</h2>
          <div class="flex flex-wrap items-center gap-2">
            <div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">${ico('search', 'w-3.5 h-3.5')}</span><input id="ds-q" type="search" placeholder="Search name or ID…" class="input !py-2 pl-9 w-52" aria-label="Search students" value="${escapeHtml(state.q)}"></div>
            <select id="ds-school" class="input !py-2 !w-auto" aria-label="School"><option value="">All schools</option>${schools.map(s => `<option value="${escapeHtml(s.id)}" ${state.school === s.id ? 'selected' : ''}>${escapeHtml(s.name || s.id)}</option>`).join('')}</select>
            <select id="ds-grade" class="input !py-2 !w-auto" aria-label="Grade level"><option value="">All grades</option>${GRADE_LEVELS.map(g => `<option value="${g}" ${state.grade === g ? 'selected' : ''}>${escapeHtml(gradeLabel(g))}</option>`).join('')}</select>
            <select id="ds-flag" class="input !py-2 !w-auto" aria-label="Program"><option value="">All programs</option><option value="iep">IEP</option><option value="plan504">504</option><option value="ell">ELL</option><option value="alerts">Has alerts</option></select>
            <button data-csv class="btn btn-secondary btn-sm">${ico('download', 'w-3.5 h-3.5')} CSV</button>
          </div>
        </div>
        <div id="ds-list"></div>`;
    });
  let all = [];
  const filtered = () => {
    const q = state.q.toLowerCase();
    return all.filter(s => (!state.school || s._school.id === state.school) && (!state.grade || String(s.gradeLevel) === state.grade)
      && (!state.flag || (state.flag === 'alerts' ? (s.alerts || []).length : s[state.flag]))
      && (!q || `${displayNameOf(s)} ${s.studentNumber || ''} ${s.username || ''}`.toLowerCase().includes(q)));
  };
  const drawList = () => {
    const el = $('#ds-list'); if (!el) return;
    const list = filtered(), shown = list.slice(0, 150);
    el.innerHTML = !list.length ? `<p class="text-sm text-gray-500 py-10 text-center">No students match these filters.</p>` : dataTable(
      [{ label: 'Student', cls: 'col-span-12 sm:col-span-4' }, { label: 'School', cls: 'col-span-7 sm:col-span-3' }, { label: 'Grade', cls: 'col-span-5 sm:col-span-2' }, { label: 'Programs', cls: 'col-span-12 sm:col-span-3' }],
      shown.map(s => ({ cells: [
        `<a href="${schoolHref(s._school, `/record/${s.uid}`)}" class="flex items-center gap-3 group/link">${avatar(displayNameOf(s), s.photoURL)}<span class="min-w-0"><span class="block text-sm text-white truncate group-hover/link:text-[#A78BFA] transition-colors">${escapeHtml(displayNameOf(s))}</span><span class="block text-[11px] text-gray-500 truncate">${s.studentNumber ? 'ID ' + escapeHtml(s.studentNumber) : escapeHtml(s.username || '')}</span></span></a>`,
        `<span class="text-xs text-gray-400 truncate block">${escapeHtml(s._school.name || s._school.id)}</span>`,
        `<span class="text-xs text-gray-400">${escapeHtml(gradeLabel(s.gradeLevel))}</span>`,
        `<div class="flex flex-wrap items-center gap-1">${flagBadges(s) || '<span class="text-xs text-gray-600">—</span>'}</div>`] }))) + `<p class="hint mt-2">${list.length > shown.length ? `Showing ${shown.length} of ${list.length.toLocaleString()}. Narrow the filters or export CSV to see everyone.` : plural(list.length, 'student')}</p>`;
    refreshIcons();
  };
  body.addEventListener('district:drawn', e => {
    mountAll(body, charts);
    all = [...e.detail.students].sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
    const f = $('#ds-flag'); if (f) f.value = state.flag;
    drawList();
  });
  body.addEventListener('input', e => { if (e.target.id === 'ds-q') { state.q = e.target.value.trim(); drawList(); } });
  body.addEventListener('change', e => { const k = { 'ds-school': 'school', 'ds-grade': 'grade', 'ds-flag': 'flag' }[e.target.id]; if (k) { state[k] = e.target.value; drawList(); } });
  body.addEventListener('click', e => {
    if (!e.target.closest('[data-csv]')) return;
    downloadCSV('district-students.csv', [['Student', 'Student ID', 'School', 'Grade', 'IEP', '504', 'ELL'], ...filtered().map(s => [displayNameOf(s), s.studentNumber || '', s._school.name || s._school.id, s.gradeLevel ?? '', s.iep ? 'Y' : '', s.plan504 ? 'Y' : '', s.ell ? 'Y' : ''])]);
  });
}

export async function viewDistrictSafety(dctx) {
  let charts = {};
  const body = districtPage(dctx, 'safety',
    { title: 'Safety', subtitle: 'Incidents and concerns reported across every school.' },
    (data, range) => {
      if (!data.incidentsReadable) return emptyState({ icon: 'shield-alert', tone: 'violet', title: "Incidents aren't available yet", text: 'Publish the latest Firestore security rules so district admins can read incident logs.' });
      const inc = data.incidents;
      if (!inc.length) return emptyState({ icon: 'shield-check', tone: 'green', title: 'No incidents', text: `Nothing has been reported in the ${rangeLabel(range)}.` });
      const open = inc.filter(i => i.status !== 'resolved' && i.status !== 'closed');
      const hi = inc.filter(i => i.severity === 'high' || i.severity === 'critical');
      const byType = {}; inc.forEach(i => { byType[i.type || 'Other'] = (byType[i.type || 'Other'] || 0) + 1; });
      const perK = s => s.students.length ? Math.round((s.incidents || []).length / s.students.length * 1000 * 10) / 10 : null;
      charts = {
        school: vizRank(data.schools.filter(s => s.incidents).map(s => ({ label: s.name || s.id, href: schoolHref(s, '/office/discipline'), value: (s.incidents || []).length, detail: s.students.length ? `${perK(s)} per 1,000 students` : '' })).sort((a, b) => b.value - a.value), { label: 'Incidents by school', format: v => v.toLocaleString() }),
        type: vizRank(Object.entries(byType).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value), { label: 'Incidents by type', format: v => v.toLocaleString() }),
      };
      return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          ${kpi('Incidents', inc.length.toLocaleString(), rangeLabel(range))}
          ${kpi('Open', open.length.toLocaleString(), open.length ? 'Awaiting follow-up' : 'All resolved', open.length ? 'warning' : 'good')}
          ${kpi('High severity', hi.length.toLocaleString(), 'High + critical', hi.length ? 'serious' : 'good')}
          ${kpi('Concerns from staff', inc.filter(i => i.isConcern).length.toLocaleString(), 'Reported by teachers')}
        </div>
        <div class="grid lg:grid-cols-2 gap-6 mb-8">
          ${chartCard('school', 'Incidents by school', 'Hover for the rate per 1,000 students.', charts.school)}
          ${chartCard('type', 'Incidents by type', '', charts.type)}
        </div>
        <h2 class="font-serif text-xl text-white mb-3">Recent high-severity incidents</h2>
        ${hi.length ? `<div class="card overflow-hidden divide-y divide-white/[0.05]">${[...hi].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 25).map(i => `
          <a href="${schoolHref(i.school, '/office/discipline')}" class="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors">
            <div class="w-20 shrink-0 text-xs text-gray-400 tabular-nums">${escapeHtml(formatDate((i.date || '') + 'T12:00'))}</div>
            <div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(i.type || 'Incident')}</div><div class="text-[11px] text-gray-500 truncate">${escapeHtml(i.school.name || i.school.id)}${i.location ? ' · ' + escapeHtml(i.location) : ''}</div></div>
            ${statusChip(SEVERITY[i.severity]?.[1] || 'serious', SEVERITY[i.severity]?.[0] || 'High')}
            <span class="hidden sm:inline text-xs text-gray-500 w-20 text-right">${escapeHtml(i.status === 'resolved' || i.status === 'closed' ? 'Resolved' : 'Open')}</span>
          </a>`).join('')}</div>` : `<p class="text-sm text-gray-500">${statusChip('good', 'No high-severity incidents in this range.')}</p>`}
        <p class="hint mt-4">Student names and details stay in each school's incident log; open a school to review individual reports.</p>`;
    });
  body.addEventListener('district:drawn', () => mountAll(body, charts));
}

// ═══════════════════════════════════════════════════════════════
// OFFICE HOME (the school office's front page — separate from courses and LMS admin)
// ═══════════════════════════════════════════════════════════════
// "Today" for the admin overview: live KPIs and a needs-attention list across attendance, discipline, services and staff requests.
export async function officeToday(ctx) {
  const today = todayISO();
  const settled = p => p.then(v => v, () => null);
  const [settings, courses, sess, recs, inc, svc, reqs, pending] = await Promise.all([
    settled(getSettings(ctx)), settled(loadAllCourses(ctx)),
    settled(getDocs(query(tcol(ctx, 'attendanceSessions'), where('date', '==', today)))),
    settled(getDocs(query(tcol(ctx, 'attendance'), where('date', '==', today)))),
    ctx.can('safety') ? settled(getDocs(tcol(ctx, 'incidents'))) : null,
    ctx.can('services') ? settled(getDocs(tcol(ctx, 'services'))) : null,
    ctx.isAdmin ? settled(getDocs(tcol(ctx, 'requests'))) : null,
    ctx.isAdmin ? settled(getDocs(query(tcol(ctx, 'students'), where('status', '==', 'pending')))) : null,
  ]);
  const href = path => buildUrl(`/${ctx.slug}${path}`);
  const tiles = [], todo = [];
  const weekend = [0, 6].includes(new Date().getDay());
  if (courses && sess && recs) {
    const scheduled = courses.filter(c => c.periodId), pool = scheduled.length ? scheduled : courses;
    const taken = new Set(sess.docs.map(d => d.data().courseId));
    const missing = pool.filter(c => !taken.has(c.id));
    const sum = summarize(recs.docs.map(d => d.data()));
    tiles.push(kpi('Attendance taken', `${pool.length - missing.length}<span class="text-gray-500 text-lg">/${pool.length}</span>`, weekend ? 'No school today' : missing.length ? `${plural(missing.length, 'class', 'classes')} still to take` : 'Every class is done', weekend || !pool.length ? null : missing.length ? 'warning' : 'good', href('/office/attendance')));
    tiles.push(kpi('Absent today', sum.absent.toLocaleString(), sum.total ? `${fmtPct(sum.rate)} attendance · ${sum.T} tardy` : 'Nothing recorded yet', null, href('/office/attendance')));
    if (!weekend && missing.length) todo.push({ level: 'warning', icon: 'calendar-check', text: `${plural(missing.length, 'class', 'classes')} ${missing.length === 1 ? "hasn't" : "haven't"} taken attendance today`, href: href('/office/attendance') });
  }
  if (inc) {
    const open = inc.docs.map(d => d.data()).filter(i => !['resolved', 'closed'].includes((i.status || 'open').toLowerCase()));
    const serious = open.filter(i => i.severity === 'high' || i.severity === 'critical');
    const fresh = open.filter(i => i.form === 'referral' && !i.office);
    tiles.push(kpi('Open discipline', open.length.toLocaleString(), serious.length ? `${serious.length} high severity` : open.length ? 'Awaiting follow-up' : 'All resolved', serious.length ? 'serious' : open.length ? 'warning' : 'good', href('/office/discipline')));
    if (fresh.length) todo.push({ level: 'serious', icon: 'flag', text: `${plural(fresh.length, 'new referral')} waiting for an office decision`, href: href('/office/discipline') });
    if (serious.length) todo.push({ level: 'critical', icon: 'shield-alert', text: `${plural(serious.length, 'high-severity case')} open`, href: href('/office/discipline') });
    const concerns = open.filter(i => i.isConcern).length;
    if (concerns) todo.push({ level: 'warning', icon: 'message-square-warning', text: `${plural(concerns, 'teacher concern')} to review`, href: href('/office/discipline') });
  }
  if (reqs) {
    const open = reqs.docs.map(d => d.data()).filter(r => ['submitted', 'in_progress'].includes(r.status));
    const cov = open.filter(r => r.type === 'coverage').length;
    tiles.push(kpi('Staff requests', open.length.toLocaleString(), cov ? `${cov} need coverage now` : open.length ? 'Waiting for you' : 'All handled', cov ? 'serious' : open.length ? 'warning' : 'good', href('/office/requests')));
    if (cov) todo.push({ level: 'critical', icon: 'hand', text: `${plural(cov, 'teacher')} waiting for classroom coverage`, href: href('/office/requests') });
    const other = open.length - cov;
    if (other) todo.push({ level: 'warning', icon: 'inbox', text: `${plural(other, 'staff request')} to answer`, href: href('/office/requests') });
  }
  if (svc) {
    const ieps = svc.docs.map(d => d.data()).filter(x => x.iep?.active);
    const overdue = ieps.filter(x => x.iep.annualReview && x.iep.annualReview < today).length;
    const soon = ieps.filter(x => { const d = x.iep.annualReview; return d && d >= today && (new Date(d + 'T12:00') - Date.now()) / 864e5 <= 30; }).length;
    if (overdue) todo.push({ level: 'critical', icon: 'heart-handshake', text: `${plural(overdue, 'IEP annual review')} overdue`, href: href('/office/services') });
    if (soon) todo.push({ level: 'warning', icon: 'heart-handshake', text: `${plural(soon, 'IEP review')} due in the next 30 days`, href: href('/office/services') });
  }
  if (pending?.size) todo.push({ level: 'warning', icon: 'user-plus', text: `${plural(pending.size, 'student sign-up')} waiting for approval`, href: href('/admin/students') });
  if (settings && ctx.isAdmin) {
    const term = currentTerm(settings), pub = term && (settings.publishedTerms || []).includes(term.id);
    if (term && !pub && (new Date(term.end + 'T12:00') - Date.now()) / 864e5 <= 7) todo.push({ level: 'warning', icon: 'file-text', text: `${term.name} report cards aren't published yet`, href: href('/office/reportcards') });
  }
  const sev = { critical: 0, serious: 1, warning: 2 };
  todo.sort((a, b) => sev[a.level] - sev[b.level]);
  return {
    tiles: tiles.slice(0, 4).join(''),
    todo: todo.length ? `<div class="card divide-y divide-white/[0.05] overflow-hidden">${todo.map(x => `<a href="${x.href}" class="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors">${ico(STATUS[x.level][0], 'w-4 h-4 shrink-0 ' + STATUS[x.level][1])}<span class="flex-1 text-sm text-gray-200">${escapeHtml(x.text)}</span>${ico('chevron-right', 'w-4 h-4 text-gray-600')}</a>`).join('')}</div>`
      : `<div class="card p-6 text-center">${ico('circle-check', 'w-7 h-7 st-good mx-auto mb-2')}<p class="text-sm text-gray-300">Nothing needs attention right now.</p></div>`,
    count: todo.length,
  };
}

// ═══════════════════════════════════════════════════════════════
// DISCIPLINE HISTORY (student record tab)
// Safety staff see every incident; other staff see referrals they wrote plus family-shared records;
// students and parents see only family-shared records (disciplineRecords — no internal notes).
// ═══════════════════════════════════════════════════════════════
const DISC_STATUS = s => ['resolved', 'closed'].includes((s || 'open').toLowerCase()) ? ['good', 'Resolved'] : (s || '').toLowerCase() === 'under review' ? ['warning', 'Under review'] : ['warning', 'Open'];
async function disciplineTab(ctx, el, student, t) {
  const sid = student.uid, staff = ctx.isRealTeacher, full = ctx.can('safety');
  const [inc, shared] = await Promise.all([
    full ? getDocs(query(tcol(ctx, 'incidents'), where('studentUids', 'array-contains', sid))).then(sn => sn.docs.map(d => ({ id: d.id, ...d.data() })))
      : staff ? getDocs(query(tcol(ctx, 'incidents'), where('reportedBy', '==', ctx.me.uid))).then(sn => sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => (x.studentUids || []).includes(sid))).catch(() => [])
      : Promise.resolve([]),
    getDocs(query(tcol(ctx, 'disciplineRecords'), where('studentUid', '==', sid))).then(sn => sn.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
  ]);
  if (!live(t)) return;
  const sharedIds = new Set(shared.map(x => x.incidentId));
  if (staff) {
    const list = [...inc].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const extra = full ? [] : shared.filter(x => !inc.some(i => i.id === x.incidentId));
    const open = list.filter(x => DISC_STATUS(x.status)[1] !== 'Resolved').length;
    const susp = list.reduce((a, x) => a + Number(x.office?.['officeActions|Out-of-school suspension|days'] || 0), 0);
    const isss = list.reduce((a, x) => a + Number(x.office?.['officeActions|In-school suspension|days'] || 0), 0);
    el.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3 mb-5"><p class="text-sm text-gray-400 max-w-2xl">${full ? 'Every referral, incident and concern involving this student.' : 'Referrals you wrote about this student, plus anything the office has shared with the family.'}</p>
        <div class="flex gap-2"><a href="${buildUrl(`/${ctx.slug}/staff/new/referral?student=${sid}`)}" class="btn btn-primary">${ico('flag', 'w-4 h-4')} Write referral</a>${full ? `<button data-rec="concern" class="btn btn-secondary">${ico('plus', 'w-4 h-4')} Quick incident</button>` : ''}</div></div>
      ${full ? `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">${statTile('Referrals & incidents', list.length)}${statTile('Open', open, open ? 'Needs follow-up' : 'All resolved', open ? 'warning' : 'good')}${statTile('Out-of-school suspension', `${susp}<span class="text-gray-500 text-lg"> days</span>`)}${statTile('In-school suspension', `${isss}<span class="text-gray-500 text-lg"> days</span>`)}</div>` : ''}
      ${list.length ? `<div class="card overflow-hidden divide-y divide-white/[0.05]">${list.map(x => {
        const [lvl, lbl] = DISC_STATUS(x.status), sev = SEVERITY[x.severity];
        return `<button data-incident="${escapeHtml(x.id)}" class="w-full text-left flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 py-3.5 hover:bg-white/[0.03]">
          <div class="w-24 shrink-0 text-xs text-gray-400 tabular-nums">${escapeHtml(formatDate((x.date || '') + 'T12:00'))}</div>
          <div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(x.type || 'Incident')} ${x.form === 'referral' ? badge('Referral', 'red') : x.isConcern ? badge('Concern', 'blue') : badge('Incident', 'muted')} ${sharedIds.has(x.id) ? badge('Shared with family', 'violet') : ''}</div>
            <div class="text-[11px] text-gray-500 truncate">${escapeHtml(x.location || '')}${x.reportedByName ? ' · by ' + escapeHtml(x.reportedByName) : ''}${x.office ? ' · ' + escapeHtml(officeActionsText(x.office)) : ''}</div></div>
          ${sev ? statusChip(sev[1], sev[0]) : ''} ${statusChip(lvl, lbl)}</button>`;
      }).join('')}</div>` : emptyState({ icon: 'shield-check', tone: 'green', title: 'No discipline records', text: full ? 'Nothing has been reported for this student.' : 'You haven’t written any referrals for this student.' })}
      ${extra.length ? `<h3 class="label mt-8">Shared with the family</h3>${familyDisciplineHTML(extra)}` : ''}`;
    el.onclick = e => {
      const b = e.target.closest('[data-incident]'); if (!b) return;
      const x = list.find(i => i.id === b.dataset.incident);
      if (x?.form === 'referral') navigate(`/${ctx.slug}/referrals/${x.id}`); else if (full) openIncidentModal(ctx, x);
    };
    return;
  }
  el.innerHTML = `<p class="text-sm text-gray-400 mb-5 max-w-2xl">Discipline records the school has shared with ${ctx.isGuardian ? 'your family' : 'you'}. Questions? Contact the administrator listed on the record.</p>`
    + (shared.length ? familyDisciplineHTML(shared) : emptyState({ icon: 'shield-check', tone: 'green', title: 'No discipline records', text: `${ctx.isGuardian ? escapeHtml(displayNameOf(student)) + ' has' : 'You have'} no discipline records on file.` }));
}
function officeActionsText(office) {
  return (office.officeActions || []).map(a => {
    const days = office[`officeActions|${a}|days`];
    if (a === 'Out-of-school suspension') return `OSS ${days || '?'} day(s)${office['officeActions|Out-of-school suspension|returnOn'] ? ', return ' + formatDate(office['officeActions|Out-of-school suspension|returnOn'] + 'T12:00') : ''}`;
    if (a === 'In-school suspension') return `ISS ${days || '?'} day(s)`;
    if (a === 'Detention(s)') return `Detention${(office['officeActions|Detention(s)|dates'] || []).length > 1 ? 's' : ''}`;
    return a;
  }).join(', ');
}
function familyDisciplineHTML(list) {
  return `<div class="space-y-3">${[...list].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(x => { const [lvl, lbl] = DISC_STATUS(x.status); return `<article class="card p-5">
    <div class="flex flex-wrap items-start justify-between gap-3"><div><div class="text-xs text-gray-500 mb-1">${escapeHtml(formatDate((x.date || '') + 'T12:00'))}${x.location ? ' · ' + escapeHtml(x.location) : ''}</div><h3 class="text-white font-medium">${escapeHtml(x.behavior || 'Behavior referral')}</h3></div>${statusChip(lvl, lbl)}</div>
    ${(x.behaviors || []).length > 1 ? `<p class="text-xs text-gray-400 mt-2">Also noted: ${escapeHtml(x.behaviors.filter(b => b !== x.behavior).join(', '))}</p>` : ''}
    ${x.actions ? `<div class="mt-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]"><div class="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Action taken</div><p class="text-sm text-gray-200">${escapeHtml(x.actions)}</p></div>` : ''}
    ${x.summary ? `<p class="text-sm text-gray-300 mt-3 whitespace-pre-wrap">${escapeHtml(x.summary)}</p>` : ''}
    <p class="text-xs text-gray-500 mt-3">${ico('user', 'w-3.5 h-3.5 inline -mt-0.5')} ${escapeHtml(x.adminName || 'School administration')}${x.adminPhone ? ` · <a class="text-[#F59E0B] hover:underline" href="tel:${escapeHtml(x.adminPhone.replace(/[^\d+]/g, ''))}">${escapeHtml(x.adminPhone)}</a>` : ''}</p></article>`; }).join('')}</div>`;
}
