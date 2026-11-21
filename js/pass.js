// Ember Pass — digital hall passes. Students request passes (some destinations are instant), teachers
// approve/send them, everyone sees a live timer, and admins see the whole hallway, settings and reports.
// Loaded on demand by app.js; helpers come from app.js via globalThis.__ember.
import {
  doc, getDoc, setDoc, addDoc, updateDoc, collection, query, where, getDocs, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
const {
  db, $, $$, ico, refreshIcons, escapeHtml, plural, displayNameOf, toDate, tsMillis, toDateInput, render, setTitle, showError, iconTile, badge, avatar,
  skeletonRows, emptyState, errorBox, toast, withBusy, confirmDialog, openModal, modalHeader, modalBody, modalFooter, buildUrl, navigate, live, unsubs,
  pageHeader, tenantPage, myCourses, routeTokenNow, notify, officeStaffUids, friendlyError
} = globalThis.__ember;
const BUILD = new URL(import.meta.url).search;
const sis = () => import('./sis.js' + BUILD);

// ── Defaults (admins change them under Ember Pass → Settings) ─────────
export const DEFAULT_DESTS = [
  { id: 'restroom', name: 'Restroom', icon: 'toilet', minutes: 5, approval: true, capacity: 3 },
  { id: 'water', name: 'Water fountain', icon: 'glass-water', minutes: 3, approval: false, capacity: 4 },
  { id: 'nurse', name: 'Nurse', icon: 'briefcase-medical', minutes: 10, approval: true, capacity: 0, alert: 'health' },
  { id: 'office', name: 'Front office', icon: 'building-2', minutes: 10, approval: true, capacity: 0, alert: 'admin' },
  { id: 'counselor', name: 'Counselor', icon: 'heart-handshake', minutes: 15, approval: true, capacity: 0, alert: 'services' },
  { id: 'library', name: 'Library / media center', icon: 'library', minutes: 15, approval: true, capacity: 6 },
  { id: 'locker', name: 'Locker', icon: 'lock', minutes: 4, approval: true, capacity: 0 },
  { id: 'room', name: 'Another classroom', icon: 'door-open', minutes: 8, approval: true, capacity: 0, kind: 'room' },
  { id: 'other', name: 'Somewhere else', icon: 'map-pin', minutes: 5, approval: true, capacity: 0, kind: 'other' },
];
const ICONS = ['toilet', 'glass-water', 'briefcase-medical', 'building-2', 'heart-handshake', 'library', 'lock', 'door-open', 'map-pin', 'dumbbell', 'utensils', 'music', 'palette', 'flask-conical', 'computer', 'bus', 'trophy', 'phone', 'shield', 'book-open'];
const SETTINGS_PATH = ctx => doc(db, 'tenants', ctx.slug, 'sis', 'passes');
async function loadSettings(ctx) {
  const snap = await getDoc(SETTINGS_PATH(ctx)).catch(() => null);
  const s = snap?.exists() ? snap.data() : {};
  return { exists: !!snap?.exists(), destinations: (s.destinations?.length ? s.destinations : DEFAULT_DESTS).filter(d => d.enabled !== false || s.destinations), dailyLimit: s.dailyLimit ?? 6, frozen: !!s.frozen, freezeMessage: s.freezeMessage || '', raw: s };
}
const enabledDests = st => st.destinations.filter(d => d.enabled !== false);
const autoApproveIds = dests => dests.filter(d => d.enabled !== false && !d.approval).map(d => d.id);

// ── Small helpers ───────────────────────────────────────────────────
const todayISO = () => toDateInput(new Date());
const ms = v => v ? (typeof v === 'number' ? v : tsMillis(v)) : 0;
const mmss = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
const elapsedSec = p => p.startAt ? (((p.status === 'ended' ? ms(p.endAt) : Date.now()) - ms(p.startAt)) / 1000) : 0;
const isOverdue = p => p.status === 'active' && elapsedSec(p) > (p.minutes || 5) * 60;
const fmtTime = v => v ? new Date(ms(v)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
const destOf = (st, id) => st.destinations.find(d => d.id === id) || DEFAULT_DESTS.find(d => d.id === id) || { id, name: id, icon: 'map-pin', minutes: 5 };
const toLabel = p => p.destKind === 'room' && (p.destTeacherName || p.destRoom) ? `${p.destTeacherName || 'Room'}${p.destRoom ? ' · Rm ' + p.destRoom : ''}` : p.destKind === 'other' && p.destOther ? p.destOther : p.destName;
const STATUS = { pending: ['warning', 'Waiting for approval'], active: ['good', 'Out now'], scheduled: ['info', 'Scheduled'], ended: ['muted', 'Back'], denied: ['critical', 'Denied'], cancelled: ['muted', 'Cancelled'] };
const statusBadge = p => isOverdue(p) ? `<span class="pass-pill is-late">${ico('siren', 'w-3 h-3')} Overdue</span>` : `<span class="pass-pill is-${p.status}">${escapeHtml(STATUS[p.status]?.[1] || p.status)}</span>`;
// Live countdown/elapsed: any element with data-timer is refreshed every second.
const timerHTML = (p, big = false) => `<span data-timer="${ms(p.startAt)}" data-limit="${(p.minutes || 5) * 60}" class="pass-timer ${big ? 'is-big' : ''} tabular-nums">${mmss(elapsedSec(p))}</span>`;
function startTicker() {
  const tick = () => $$('[data-timer]').forEach(el => {
    const start = +el.dataset.timer, limit = +el.dataset.limit; if (!start) return;
    const s = (Date.now() - start) / 1000; el.textContent = mmss(s);
    const late = s > limit; el.classList.toggle('is-late', late);
    const ring = el.closest('[data-ring]'); if (ring) { ring.style.setProperty('--pct', Math.min(100, s / limit * 100)); ring.classList.toggle('is-late', late); }
  });
  const id = setInterval(tick, 1000); tick();
  unsubs.push(() => clearInterval(id));
}
// The class a student is in right now (by bell schedule), else their first course.
function currentCourse(courses, settings) {
  const now = new Date(), hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const period = (settings?.periods || []).find(p => p.start && p.end && p.start <= hm && hm <= p.end);
  return (period && courses.find(c => c.periodId === period.id)) || null;
}
async function encounterGroups(ctx) {
  const snap = await getDoc(doc(db, 'tenants', ctx.slug, 'passPrivate', 'encounters')).catch(() => null);
  return snap?.exists() ? (snap.data().groups || []) : [];
}
// Students who must not be out at the same time as `uid` and currently are.
function encounterConflicts(groups, passes, uid) {
  const out = new Set(passes.filter(p => p.status === 'active').map(p => p.studentUid));
  return groups.filter(g => (g.uids || []).includes(uid)).flatMap(g => g.uids.filter(u => u !== uid && out.has(u)).map(u => ({ uid: u, name: g.names?.[u] || 'another student' })));
}

export async function viewPass(ctx, tab) {
  if (ctx.isStudent) return studentView(ctx);
  if (ctx.isRealTeacher) return staffView(ctx, tab || 'room');
  return navigate(`/${ctx.slug}`, { replace: true });
}

// ═══════════════════════════════════════════════════════════════
// STUDENT
// ═══════════════════════════════════════════════════════════════
async function studentView(ctx) {
  const t = routeTokenNow();
  setTitle('Ember Pass', ctx.tenant.name);
  render(tenantPage(ctx, 'pass', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'Ember Pass', subtitle: 'Get a hall pass, and show it to any staff member who asks.' }) + `<div class="max-w-4xl" id="ps">${skeletonRows(3, 'h-32')}</div>`));
  const [st, courses, settings] = await Promise.all([loadSettings(ctx), myCourses(ctx).catch(() => []), (await sis()).getSettings(ctx).catch(() => null)]);
  if (!live(t)) return;
  let passes = [];
  const el = $('#ps');
  const draw = () => {
    const today = todayISO();
    const mine = passes.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    const current = mine.find(p => p.status === 'active') || mine.find(p => p.status === 'pending');
    const upcoming = mine.filter(p => p.status === 'scheduled' && p.date === today).sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''));
    const usedToday = mine.filter(p => p.date === today && !['denied', 'cancelled'].includes(p.status)).length;
    const history = mine.filter(p => ['ended', 'denied', 'cancelled'].includes(p.status)).slice(0, 15);
    let top = '';
    if (current?.status === 'active') top = activeCard(current, { self: true });
    else if (current?.status === 'pending') top = `<section class="card p-6 mb-6 pass-wait"><div class="flex items-center gap-4">${iconTile('hourglass', 'amber', 'tile-lg')}<div class="flex-1 min-w-0"><div class="text-white text-lg">Waiting for ${escapeHtml(current.fromTeacherName || 'your teacher')}</div><div class="text-sm text-gray-400">${escapeHtml(current.fromTitle || 'Class')} → ${escapeHtml(toLabel(current))}${current.note ? ` · “${escapeHtml(current.note)}”` : ''}</div></div><button class="btn btn-secondary" data-cancel="${current.id}">Cancel</button></div></section>`;
    const sched = upcoming.length ? `<section class="mb-6"><h2 class="label">Coming up today</h2><div class="space-y-2">${upcoming.map(p => { const at = new Date(p.scheduledFor); const ready = at - Date.now() < 3 * 60000; return `<div class="card p-4 flex items-center gap-3">${iconTile(destOf(st, p.destId).icon, 'violet')}<div class="flex-1 min-w-0"><div class="text-white">${escapeHtml(toLabel(p))} at ${escapeHtml(at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</div><div class="text-xs text-gray-500">From ${escapeHtml(p.createdByName || 'staff')}${p.note ? ' · ' + escapeHtml(p.note) : ''}</div></div>${ready && !current ? `<button class="btn btn-primary btn-sm" data-start="${p.id}">${ico('play', 'w-3.5 h-3.5')} Start</button>` : `<span class="text-xs text-gray-500">Starts ${escapeHtml(at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</span>`}</div>`; }).join('')}</div></section>` : '';
    const picker = current ? '' : st.frozen ? `<div class="card p-6 text-center mb-6">${ico('snowflake', 'w-8 h-8 text-[#93C5FD] mx-auto mb-2')}<div class="text-white">Passes are paused right now</div><p class="text-sm text-gray-400 mt-1">${escapeHtml(st.freezeMessage || 'Stay in your classroom until your teacher says otherwise.')}</p></div>`
      : usedToday >= st.dailyLimit ? `<div class="card p-6 text-center mb-6">${ico('ban', 'w-8 h-8 text-gray-500 mx-auto mb-2')}<div class="text-white">You’ve used all ${st.dailyLimit} passes for today</div><p class="text-sm text-gray-400 mt-1">Ask your teacher if you need to leave class.</p></div>`
      : `<section class="mb-8"><div class="flex items-end justify-between mb-3"><h2 class="font-serif text-2xl text-white">Where are you going?</h2><span class="text-xs text-gray-500">${usedToday} of ${st.dailyLimit} passes used today</span></div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">${enabledDests(st).map(d => `<button class="pass-dest card card-hover p-4 text-left" data-dest="${escapeHtml(d.id)}">${iconTile(d.icon || 'map-pin', d.approval ? 'amber' : 'green')}<div class="text-white mt-3">${escapeHtml(d.name)}</div><div class="text-[11px] text-gray-500 mt-0.5">${d.minutes} min · ${d.approval ? 'Teacher approves' : 'Instant'}</div></button>`).join('')}</div></section>`;
    el.innerHTML = top + sched + picker + `<section><h2 class="label">Recent passes</h2>${history.length ? `<div class="card divide-y divide-white/[0.05] overflow-hidden">${history.map(p => `<div class="flex items-center gap-3 px-5 py-3">${ico(destOf(st, p.destId).icon || 'map-pin', 'w-4 h-4 text-gray-500 shrink-0')}<div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(toLabel(p))}</div><div class="text-[11px] text-gray-500">${escapeHtml(new Date(ms(p.createdAt)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}${p.startAt ? ' · ' + escapeHtml(fmtTime(p.startAt)) : ''}${p.status === 'ended' ? ' · ' + mmss(elapsedSec(p)) : ''}</div></div>${statusBadge(p)}</div>`).join('')}</div>` : `<p class="text-sm text-gray-500">No passes yet.</p>`}</section>`;
    refreshIcons();
  };
  const activeCard = (p, { self }) => `<section class="pass-card ${isOverdue(p) ? 'is-late' : ''} mb-6" data-ring style="--pct:${Math.min(100, elapsedSec(p) / ((p.minutes || 5) * 60) * 100)}">
      <div class="flex flex-wrap items-center gap-6">
        <div class="pass-ring"><div class="pass-ring-in">${timerHTML(p, true)}<span class="text-[11px] text-gray-400">of ${p.minutes || 5}:00</span></div></div>
        <div class="flex-1 min-w-[220px]"><div class="text-[11px] uppercase tracking-[0.18em] text-[#F59E0B] mb-1">Hall pass · ${escapeHtml(ctx.tenant.name)}</div>
          <div class="font-serif text-3xl text-white leading-tight">${escapeHtml(p.studentName || ctx.me.name)}</div>
          <div class="text-lg text-gray-200 mt-1 flex flex-wrap items-center gap-2">${escapeHtml(p.fromRoom ? 'Rm ' + p.fromRoom : p.fromTitle || 'Class')} ${ico('arrow-right', 'w-4 h-4 text-gray-500')} ${escapeHtml(toLabel(p))}</div>
          <div class="text-sm text-gray-400 mt-1">Left at ${escapeHtml(fmtTime(p.startAt))}${p.approvedByName ? ` · approved by ${escapeHtml(p.approvedByName)}` : p.createdByRole === 'staff' ? ` · from ${escapeHtml(p.createdByName || '')}` : ' · instant pass'}</div></div>
        ${self ? `<button class="btn btn-primary py-3 px-6" data-end="${p.id}">${ico('circle-stop', 'w-4 h-4')} I'm back — end pass</button>` : ''}
      </div></section>`;
  unsubs.push(onSnapshot(query(collection(db, 'tenants', ctx.slug, 'passes'), where('studentUid', '==', ctx.me.uid)), snap => { passes = snap.docs.map(d => ({ id: d.id, ...d.data() })); if (live(t)) draw(); }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  startTicker();
  el.addEventListener('click', async e => {
    const end = e.target.closest('[data-end]');
    if (end) return withBusy(end, 'Ending…', async () => { try { await updateDoc(doc(db, 'tenants', ctx.slug, 'passes', end.dataset.end), { status: 'ended', endAt: serverTimestamp(), endedBy: ctx.me.uid, updatedAt: serverTimestamp() }); toast('Welcome back'); } catch (ex) { toast(friendlyError(ex), 'error'); } });
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) { try { await updateDoc(doc(db, 'tenants', ctx.slug, 'passes', cancel.dataset.cancel), { status: 'cancelled', updatedAt: serverTimestamp() }); toast('Request cancelled', 'info'); } catch (ex) { toast(friendlyError(ex), 'error'); } return; }
    const start = e.target.closest('[data-start]');
    if (start) { try { await updateDoc(doc(db, 'tenants', ctx.slug, 'passes', start.dataset.start), { status: 'active', startAt: serverTimestamp(), updatedAt: serverTimestamp() }); toast('Pass started'); } catch (ex) { toast(friendlyError(ex), 'error'); } return; }
    const dest = e.target.closest('[data-dest]');
    if (dest) requestPass(ctx, destOf(st, dest.dataset.dest), { st, courses, settings });
  });
}
function requestPass(ctx, d, { st, courses, settings }) {
  const cur = currentCourse(courses, settings) || courses[0];
  const teachers = [...new Map(courses.filter(c => c.ownerUid).map(c => [c.ownerUid, { uid: c.ownerUid, name: c.ownerName || 'Teacher', room: c.room || '' }])).values()];
  const m = openModal({ size: 'sm', html: modalHeader({ title: d.name, subtitle: `${d.minutes} minutes · ${d.approval ? 'your teacher approves it' : 'starts right away'}`, icon: d.icon || 'ticket' }) + `<form novalidate>${modalBody(`
      <label class="label" for="rp-from">Leaving from</label><select id="rp-from" class="input mb-4">${courses.length ? courses.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === cur?.id ? 'selected' : ''}>${escapeHtml(c.title || 'Class')}${c.ownerName ? ' · ' + escapeHtml(c.ownerName) : ''}${c.room ? ' · Rm ' + escapeHtml(c.room) : ''}</option>`).join('') : '<option value="">Not in a class</option>'}</select>
      ${d.kind === 'room' ? `<label class="label" for="rp-to">Going to</label><select id="rp-to" class="input mb-2">${teachers.map(x => `<option value="${escapeHtml(x.uid)}">${escapeHtml(x.name)}${x.room ? ' · Rm ' + escapeHtml(x.room) : ''}</option>`).join('')}<option value="">Another teacher (type below)</option></select><input id="rp-room" class="input mb-4" placeholder="Teacher or room (if not listed)">` : ''}
      ${d.kind === 'other' ? `<label class="label" for="rp-other">Where?</label><input id="rp-other" class="input mb-4" placeholder="e.g. Band room">` : ''}
      <label class="label" for="rp-note">Note ${d.kind === 'other' ? '' : '<span class="normal-case tracking-normal text-gray-600">(optional)</span>'}</label><input id="rp-note" class="input" maxlength="140" placeholder="${d.id === 'nurse' ? 'e.g. Headache' : 'Anything your teacher should know'}">
      <p class="form-error mt-3 hidden" id="rp-err"></p>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${d.approval ? 'Request pass' : 'Start pass'}</button>`)}</form>` });
  m.$('form').addEventListener('submit', ev => {
    ev.preventDefault();
    const err = m.$('#rp-err'), from = courses.find(c => c.id === m.$('#rp-from').value);
    const toUid = m.$('#rp-to')?.value || '', toT = teachers.find(x => x.uid === toUid);
    const other = m.$('#rp-other')?.value.trim() || '', room = m.$('#rp-room')?.value.trim() || '';
    if (d.kind === 'other' && !other) return showError(err, 'Say where you’re going.');
    if (d.kind === 'room' && !toT && !room) return showError(err, 'Pick a teacher or type the room.');
    withBusy(ev.submitter || m.$('[type=submit]'), 'Sending…', async () => {
      const base = {
        studentUid: ctx.me.uid, studentName: ctx.me.name, date: todayISO(), createdBy: ctx.me.uid, createdByName: ctx.me.name, createdByRole: 'student',
        fromCourseId: from?.id || '', fromTitle: from?.title || '', fromTeacherUid: from?.ownerUid || '', fromTeacherName: from?.ownerName || '', fromRoom: from?.room || '',
        destId: d.id, destName: d.name, destKind: d.kind || '', destTeacherUid: toT?.uid || '', destTeacherName: toT?.name || room, destRoom: toT?.room || '', destOther: other,
        note: m.$('#rp-note').value.trim(), minutes: d.minutes || 5, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      try {
        let ref, status = d.approval ? 'pending' : 'active';
        try { ref = await addDoc(collection(db, 'tenants', ctx.slug, 'passes'), { ...base, status, ...(status === 'active' ? { startAt: serverTimestamp(), autoApproved: true } : {}) }); }
        catch (ex) { if (status !== 'active') throw ex; status = 'pending'; ref = await addDoc(collection(db, 'tenants', ctx.slug, 'passes'), { ...base, status }); } // instant passes need the school's pass settings saved
        if (status === 'pending' && base.fromTeacherUid) notify(ctx, { to: [base.fromTeacherUid], kind: 'pass', title: `${ctx.me.name} is asking for a pass`, body: `${d.name}${base.note ? ' · ' + base.note : ''}`, link: `/${ctx.slug}/pass` }).catch(() => {});
        if (status === 'active') arrivalAlerts(ctx, { ...base, id: ref.id }, d);
        m.close(); toast(status === 'active' ? 'Pass started' : 'Request sent to your teacher');
      } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
    });
  });
}
// Let the destination know someone is coming (classroom teacher, nurse, counselor or office).
function arrivalAlerts(ctx, p, d) {
  if (p.destTeacherUid) notify(ctx, { to: [p.destTeacherUid], kind: 'pass', title: `${p.studentName} is on the way to you`, body: `From ${p.fromTitle || 'class'}${p.fromTeacherName ? ' · ' + p.fromTeacherName : ''}`, link: `/${ctx.slug}/pass` }).catch(() => {});
  if (d?.alert && ctx.isRealTeacher) officeStaffUids(ctx, d.alert === 'admin' ? null : d.alert).then(to => notify(ctx, { to, kind: 'pass', title: `${p.studentName} is headed to the ${d.name.toLowerCase()}`, body: `From ${p.fromTitle || 'class'}${p.note ? ' · ' + p.note : ''}`, link: `/${ctx.slug}/pass/hall` })).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// STAFF
// ═══════════════════════════════════════════════════════════════
const STAFF_TABS = [['room', 'My room', 'door-open'], ['hall', 'Hallway', 'footprints'], ['history', 'History', 'history'], ['reports', 'Reports', 'chart-column', 'admin'], ['settings', 'Settings', 'settings-2', 'admin']];
async function staffView(ctx, tab) {
  const t = routeTokenNow();
  const tabs = STAFF_TABS.filter(x => !x[3] || ctx.isAdmin);
  if (!tabs.some(x => x[0] === tab)) tab = 'room';
  setTitle('Ember Pass', ctx.tenant.name);
  render(tenantPage(ctx, 'pass', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'Ember Pass', subtitle: 'Hall passes for your classes and the whole building.',
      actions: `<div class="flex flex-wrap gap-2">${ctx.isAdmin ? `<button id="pf-freeze" class="btn btn-secondary">${ico('snowflake', 'w-4 h-4')} <span>Pause passes</span></button>` : ''}<button id="pf-new" class="btn btn-primary">${ico('ticket', 'w-4 h-4')} New pass</button></div>` })
    + `<div class="max-w-6xl"><div id="pf-banner"></div><div class="segmented mb-6" role="tablist">${tabs.map(([k, l, i]) => `<a href="${buildUrl(`/${ctx.slug}/pass/${k}`)}" role="tab" class="seg-link" aria-pressed="${k === tab}">${ico(i, 'w-3.5 h-3.5')} ${l}</a>`).join('')}</div><div id="pf">${skeletonRows(4, 'h-24')}</div></div>`));
  const [st, groups, courses, staffSnap] = await Promise.all([loadSettings(ctx), encounterGroups(ctx), myCourses(ctx).catch(() => []), getDocs(collection(db, 'tenants', ctx.slug, 'users')).catch(() => ({ docs: [] }))]);
  if (!live(t)) return;
  // First visit by an admin: save the default settings so instant destinations work for students.
  if (ctx.isAdmin && !st.exists) setDoc(SETTINGS_PATH(ctx), { destinations: DEFAULT_DESTS, autoApprove: autoApproveIds(DEFAULT_DESTS), dailyLimit: 6, frozen: false }, { merge: true }).catch(() => {});
  const staff = staffSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const env = { st, groups, courses, staff };
  const el = $('#pf');
  const drawBanner = () => {
    $('#pf-banner').innerHTML = st.frozen ? `<div class="mb-5 p-4 rounded-xl border border-[#93C5FD]/30 bg-[#93C5FD]/5 flex items-center gap-3">${ico('snowflake', 'w-5 h-5 text-[#93C5FD] shrink-0')}<div class="flex-1"><div class="text-white">Passes are paused school-wide</div><div class="text-xs text-gray-400">${escapeHtml(st.freezeMessage || 'Students can’t request passes until an administrator resumes them.')}</div></div></div>` : '';
    const fb = $('#pf-freeze'); if (fb) fb.querySelector('span').textContent = st.frozen ? 'Resume passes' : 'Pause passes';
    refreshIcons();
  };
  drawBanner();
  $('#pf-new').addEventListener('click', () => newPassModal(ctx, env));
  $('#pf-freeze')?.addEventListener('click', async () => {
    const on = !st.frozen;
    let msg = '';
    if (on) { if (!await confirmDialog({ title: 'Pause all passes?', message: 'Students won’t be able to request or start passes until you resume them. Passes already out keep running.', confirmLabel: 'Pause passes' })) return; msg = 'Passes are paused. Stay in your classroom.'; }
    try { await setDoc(SETTINGS_PATH(ctx), { frozen: on, freezeMessage: msg, frozenBy: ctx.me.name, autoApprove: autoApproveIds(st.destinations) }, { merge: true }); st.frozen = on; st.freezeMessage = msg; drawBanner(); toast(on ? 'Passes paused' : 'Passes resumed', on ? 'info' : 'success'); }
    catch (ex) { toast(friendlyError(ex), 'error'); }
  });
  if (tab === 'settings') return settingsTab(ctx, el, env);
  if (tab === 'reports') return reportsTab(ctx, el, env);
  if (tab === 'history') return historyTab(ctx, el, env);
  return liveTab(ctx, el, env, tab, t);
}

function passRow(ctx, p, env, { actions = '', showFrom = true } = {}) {
  const d = destOf(env.st, p.destId);
  const conflicts = p.status === 'active' || p.status === 'pending' ? encounterConflicts(env.groups, env.all || [], p.studentUid).filter(c => c.uid !== p.studentUid) : [];
  return `<div class="pass-row ${isOverdue(p) ? 'is-late' : ''} flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 py-3">
    ${iconTile(d.icon || 'map-pin', isOverdue(p) ? 'red' : p.status === 'pending' ? 'amber' : 'teal')}
    <div class="flex-1 min-w-0"><div class="text-sm text-white truncate"><a href="${buildUrl(`/${ctx.slug}/record/${p.studentUid}`)}" class="hover:underline">${escapeHtml(p.studentName || 'Student')}</a> <span class="text-gray-500">→</span> ${escapeHtml(toLabel(p))}</div>
      <div class="text-[11px] text-gray-500 truncate">${showFrom ? `${escapeHtml(p.fromTitle || 'No class')}${p.fromTeacherName ? ' · ' + escapeHtml(p.fromTeacherName) : ''} · ` : ''}${p.status === 'scheduled' ? `at ${escapeHtml(new Date(p.scheduledFor).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}` : p.startAt ? `left ${escapeHtml(fmtTime(p.startAt))}` : `asked ${escapeHtml(fmtTime(p.createdAt))}`}${p.note ? ` · “${escapeHtml(p.note)}”` : ''}</div>
      ${conflicts.length ? `<div class="text-[11px] text-[#f08a8a] mt-0.5">${ico('shield-ban', 'w-3 h-3 inline -mt-0.5')} Encounter alert: ${escapeHtml(conflicts.map(c => c.name).join(', '))} ${conflicts.length === 1 ? 'is' : 'are'} also out</div>` : ''}</div>
    ${p.status === 'active' ? `<div class="text-right">${timerHTML(p)}<div class="text-[10px] text-gray-500">of ${p.minutes || 5}:00</div></div>` : ''}
    ${statusBadge(p)}<div class="flex gap-1.5">${actions}</div></div>`;
}
const listCard = (title, sub, rows, empty) => `<section class="mb-6"><div class="flex items-end justify-between mb-2"><h2 class="label !mb-0">${title}</h2>${sub ? `<span class="text-xs text-gray-500">${sub}</span>` : ''}</div>${rows.length ? `<div class="card divide-y divide-white/[0.05] overflow-hidden">${rows.join('')}</div>` : `<p class="text-sm text-gray-500 card p-5">${empty}</p>`}</section>`;

function liveTab(ctx, el, env, tab, t) {
  let passes = [];
  const mineFrom = p => p.fromTeacherUid === ctx.me.uid || (p.createdBy === ctx.me.uid && p.createdByRole === 'staff');
  const draw = () => {
    env.all = passes;
    const active = passes.filter(p => p.status === 'active'), pending = passes.filter(p => p.status === 'pending');
    if (tab === 'hall') {
      const byDest = new Map();
      active.forEach(p => (byDest.get(p.destId) || byDest.set(p.destId, []).get(p.destId)).push(p));
      const overdue = active.filter(isOverdue);
      el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">${kpi('Out right now', active.length)}${kpi('Overdue', overdue.length, overdue.length ? 'critical' : 'good')}${kpi('Waiting for approval', pending.length)}${kpi('Passes today', passes.filter(p => !['denied', 'cancelled'].includes(p.status)).length)}</div>
        <div class="flex flex-wrap gap-2 mb-6">${enabledDests(env.st).map(d => { const n = (byDest.get(d.id) || []).length; const full = d.capacity && n >= d.capacity; return `<span class="pass-cap ${full ? 'is-full' : n ? 'is-busy' : ''}">${ico(d.icon || 'map-pin', 'w-3.5 h-3.5')} ${escapeHtml(d.name)} <b>${n}${d.capacity ? '/' + d.capacity : ''}</b></span>`; }).join('')}</div>
        ${listCard('Out of class', overdue.length ? `${overdue.length} overdue` : '', [...active].sort((a, b) => isOverdue(b) - isOverdue(a) || ms(a.startAt) - ms(b.startAt)).map(p => passRow(ctx, p, env, { actions: `<button class="btn btn-ghost btn-sm" data-end="${p.id}">End</button>` })), 'Nobody is out of class right now.')}`;
    } else {
      const myPending = pending.filter(p => p.fromTeacherUid === ctx.me.uid || (ctx.isAdmin && !p.fromTeacherUid));
      const myOut = active.filter(mineFrom);
      const incoming = active.filter(p => p.destTeacherUid === ctx.me.uid);
      const scheduled = passes.filter(p => p.status === 'scheduled' && (mineFrom(p) || p.createdBy === ctx.me.uid));
      el.innerHTML = listCard(`Requests ${myPending.length ? `<span class="pass-dot">${myPending.length}</span>` : ''}`, 'Approve or deny', myPending.map(p => passRow(ctx, p, env, { showFrom: false, actions: `<button class="btn btn-primary btn-sm" data-approve="${p.id}">${ico('check', 'w-3.5 h-3.5')} Approve</button><button class="btn btn-ghost btn-sm" data-deny="${p.id}">Deny</button>` })), 'No pass requests right now.')
        + listCard('Out of my room', '', myOut.map(p => passRow(ctx, p, env, { showFrom: false, actions: `<button class="btn btn-ghost btn-sm" data-end="${p.id}">Back</button>` })), 'All of your students are in class.')
        + (incoming.length ? listCard('On the way to me', '', incoming.map(p => passRow(ctx, p, env, { actions: `<button class="btn btn-secondary btn-sm" data-arrived="${p.id}">${ico('user-round-check', 'w-3.5 h-3.5')} Arrived</button>` })), '') : '')
        + (scheduled.length ? listCard('Scheduled today', '', scheduled.map(p => passRow(ctx, p, env, { actions: `<button class="btn btn-ghost btn-sm" data-cancel-pass="${p.id}">Cancel</button>` })), '') : '');
    }
    refreshIcons();
    watchOverdue(ctx, passes);
  };
  unsubs.push(onSnapshot(query(collection(db, 'tenants', ctx.slug, 'passes'), where('date', '==', todayISO())), snap => { passes = snap.docs.map(d => ({ id: d.id, ...d.data() })); if (live(t)) draw(); }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  // Overdue state changes without a database change, so redraw every 15 s (timers tick every second on their own).
  const id = setInterval(() => { if (live(t)) draw(); }, 15000); unsubs.push(() => clearInterval(id));
  startTicker();
  el.addEventListener('click', async e => {
    const pass = id2 => passes.find(p => p.id === id2);
    const ref = id2 => doc(db, 'tenants', ctx.slug, 'passes', id2);
    const ap = e.target.closest('[data-approve]');
    if (ap) {
      const p = pass(ap.dataset.approve), d = destOf(env.st, p.destId);
      const blockers = approveBlockers(env, passes, p, d);
      if (blockers.length && !await confirmDialog({ title: 'Approve anyway?', message: blockers.join(' '), confirmLabel: 'Approve anyway', danger: true })) return;
      return withBusy(ap, '…', async () => {
        try { await updateDoc(ref(p.id), { status: 'active', startAt: serverTimestamp(), approvedBy: ctx.me.uid, approvedByName: ctx.me.name, updatedAt: serverTimestamp() });
          notify(ctx, { to: [p.studentUid], kind: 'pass', title: `Pass approved: ${toLabel(p)}`, body: `You have ${p.minutes || 5} minutes. Show your pass if a staff member asks.`, link: `/${ctx.slug}/pass` }).catch(() => {});
          arrivalAlerts(ctx, p, d); toast(`${p.studentName} is out`); }
        catch (ex) { toast(friendlyError(ex), 'error'); }
      });
    }
    const dn = e.target.closest('[data-deny]');
    if (dn) { const p = pass(dn.dataset.deny); try { await updateDoc(ref(p.id), { status: 'denied', deniedBy: ctx.me.uid, deniedByName: ctx.me.name, updatedAt: serverTimestamp() }); notify(ctx, { to: [p.studentUid], kind: 'pass', title: `Pass not approved: ${toLabel(p)}`, body: `${ctx.me.name} said not right now.`, link: `/${ctx.slug}/pass` }).catch(() => {}); toast('Request denied', 'info'); } catch (ex) { toast(friendlyError(ex), 'error'); } return; }
    const en = e.target.closest('[data-end],[data-arrived]');
    if (en) { const p = pass(en.dataset.end || en.dataset.arrived); try { await updateDoc(ref(p.id), { status: 'ended', endAt: serverTimestamp(), endedBy: ctx.me.uid, ...(en.dataset.arrived ? { arrivedAt: serverTimestamp() } : {}), updatedAt: serverTimestamp() }); toast(en.dataset.arrived ? `${p.studentName} arrived` : 'Pass ended'); } catch (ex) { toast(friendlyError(ex), 'error'); } return; }
    const cp = e.target.closest('[data-cancel-pass]');
    if (cp) { try { await updateDoc(ref(cp.dataset.cancelPass), { status: 'cancelled', updatedAt: serverTimestamp() }); toast('Pass cancelled', 'info'); } catch (ex) { toast(friendlyError(ex), 'error'); } }
  });
}
const kpi = (label, v, lvl = null) => `<div class="card p-5"><div class="text-xs text-gray-400 mb-2">${label}</div><div class="stat-value ${lvl === 'critical' && v ? 'text-[#f08a8a]' : ''}">${v}</div>${lvl ? `<div class="mt-1 text-xs text-gray-500 flex items-center gap-1.5">${ico(lvl === 'good' ? 'circle-check' : 'siren', `w-3.5 h-3.5 ${lvl === 'good' ? 'st-good' : 'st-critical'}`)}${lvl === 'good' ? 'All on time' : 'Check on them'}</div>` : ''}</div>`;
// Capacity, daily limit and "keep apart" checks before a pass goes out.
function approveBlockers(env, passes, p, d) {
  const out = [];
  const activeHere = passes.filter(x => x.status === 'active' && x.destId === d.id).length;
  if (d.capacity && activeHere >= d.capacity) out.push(`${d.name} is full (${activeHere}/${d.capacity}).`);
  const conflicts = encounterConflicts(env.groups, passes, p.studentUid);
  if (conflicts.length) out.push(`Encounter alert: ${conflicts.map(c => c.name).join(', ')} ${conflicts.length === 1 ? 'is' : 'are'} out right now and should not be in the hall at the same time as ${p.studentName}.`);
  const used = passes.filter(x => x.studentUid === p.studentUid && x.id !== p.id && !['denied', 'cancelled'].includes(x.status)).length;
  if (used >= env.st.dailyLimit) out.push(`${p.studentName} has already used ${used} passes today (limit ${env.st.dailyLimit}).`);
  return out;
}
// Tell the teacher and administrators once when a pass runs long.
const notified = new Set();
function watchOverdue(ctx, passes) {
  passes.filter(p => isOverdue(p) && !p.overdueNotified && !notified.has(p.id) && (p.fromTeacherUid === ctx.me.uid || p.createdBy === ctx.me.uid)).forEach(p => {
    notified.add(p.id);
    updateDoc(doc(db, 'tenants', ctx.slug, 'passes', p.id), { overdueNotified: true }).catch(() => {});
    officeStaffUids(ctx).then(to => notify(ctx, { to: [...to, p.fromTeacherUid].filter(Boolean), kind: 'pass', title: `${p.studentName} is overdue`, body: `${toLabel(p)} · out since ${fmtTime(p.startAt)} (limit ${p.minutes || 5} min)`, link: `/${ctx.slug}/pass/hall` })).catch(() => {});
  });
}

// ── New pass (staff) ────────────────────────────────────────────────
async function newPassModal(ctx, env) {
  const F = await import('./staff.js' + BUILD);
  const sisM = await sis();
  const settings = await sisM.getSettings(ctx).catch(() => null);
  // Any student in the school (teachers often send a student who isn't on their own roster).
  const students = (await getDocs(collection(db, 'tenants', ctx.slug, 'students'))).docs.map(d => ({ uid: d.id, ...d.data() })).filter(s => s.status !== 'pending' && s.status !== 'rejected');
  students.sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
  const cur = currentCourse(env.courses, settings) || env.courses[0];
  const dests = enabledDests(env.st);
  const form = { sections: [{ fields: [
    { id: 'students', type: 'students', label: 'Student(s)', required: true },
    { id: 'dest', type: 'select', label: 'Going to', required: true, options: dests.map(d => ({ v: d.id, l: d.name })) },
    { id: 'toTeacher', type: 'select', label: 'Teacher', options: env.staff.filter(s => s.uid !== ctx.me.uid).map(s => ({ v: s.uid, l: displayNameOf(s) })), showIf: { id: 'dest', eq: 'room' } },
    { id: 'other', type: 'text', label: 'Where?', required: true, showIf: { id: 'dest', eq: 'other' } },
    { id: 'from', type: 'select', label: 'From class', options: env.courses.map(c => ({ v: c.id, l: `${c.title || 'Class'}${c.room ? ' · Rm ' + c.room : ''}` })) },
    { id: 'minutes', type: 'number', label: 'Minutes', min: 1, maxN: 120, hint: 'Blank = the destination’s usual time.' },
    { id: 'when', type: 'chips', label: 'When', required: true, options: ['Now', 'Later today'] },
    { id: 'at', type: 'time', label: 'At', required: true, showIf: { id: 'when', eq: 'Later today' } },
    { id: 'note', type: 'text', label: 'Note', span: 'sm:col-span-2', placeholder: 'e.g. Testing in the media center' },
  ] }] };
  F.formModal({ title: 'New pass', subtitle: 'Sends a pass that starts right away (or at a set time).', icon: 'ticket', form, env: { students }, data: { when: 'Now', from: cur?.id || '', dest: dests[0]?.id }, submit: 'Send pass', onSubmit: async v => {
    const d = destOf(env.st, v.dest), from = env.courses.find(c => c.id === v.from), toT = env.staff.find(s => s.uid === v.toTeacher);
    const today = await getDocs(query(collection(db, 'tenants', ctx.slug, 'passes'), where('date', '==', todayISO()))).then(s => s.docs.map(x => ({ id: x.id, ...x.data() })));
    if (v.when === 'Now') {
      const warn = v.students.flatMap(s => approveBlockers(env, today, { studentUid: s.uid, studentName: s.name, id: '' }, d));
      if (warn.length && !await confirmDialog({ title: 'Send anyway?', message: [...new Set(warn)].join(' '), confirmLabel: 'Send anyway', danger: true })) return false;
    }
    const scheduledFor = v.when === 'Later today' ? `${todayISO()}T${v.at}` : '';
    for (const s of v.students) {
      const p = { studentUid: s.uid, studentName: s.name, date: todayISO(), createdBy: ctx.me.uid, createdByName: ctx.me.name, createdByRole: 'staff',
        fromCourseId: from?.id || '', fromTitle: from?.title || '', fromTeacherUid: from?.ownerUid || ctx.me.uid, fromTeacherName: from?.ownerName || ctx.me.name, fromRoom: from?.room || '',
        destId: d.id, destName: d.name, destKind: d.kind || '', destTeacherUid: toT?.uid || '', destTeacherName: toT ? displayNameOf(toT) : '', destRoom: '', destOther: v.other || '',
        note: v.note || '', minutes: Number(v.minutes) || d.minutes || 5, status: scheduledFor ? 'scheduled' : 'active', scheduledFor, approvedBy: ctx.me.uid, approvedByName: ctx.me.name,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...(scheduledFor ? {} : { startAt: serverTimestamp() }) };
      const ref = await addDoc(collection(db, 'tenants', ctx.slug, 'passes'), p);
      notify(ctx, { to: [s.uid], kind: 'pass', title: scheduledFor ? `Pass at ${new Date(scheduledFor).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}: ${toLabel(p)}` : `You have a pass: ${toLabel(p)}`, body: `From ${ctx.me.name}${p.note ? ' · ' + p.note : ''}`, link: `/${ctx.slug}/pass` }).catch(() => {});
      if (!scheduledFor) arrivalAlerts(ctx, { ...p, id: ref.id }, d);
    }
    toast(`${plural(v.students.length, 'pass', 'passes')} sent`); return true;
  } });
}

// ── History (staff) ─────────────────────────────────────────────────
async function historyTab(ctx, el, env) {
  let date = todayISO();
  const draw = async () => {
    el.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3 mb-4"><input type="date" id="ph-date" class="input !py-2 !w-auto" value="${date}" max="${todayISO()}" aria-label="Date"><button id="ph-csv" class="btn btn-secondary btn-sm">${ico('download', 'w-3.5 h-3.5')} Export CSV</button></div><div id="ph-list">${skeletonRows(4)}</div>`;
    refreshIcons();
    $('#ph-date').addEventListener('change', e => { if (e.target.value) { date = e.target.value; draw(); } });
    const all = (await getDocs(query(collection(db, 'tenants', ctx.slug, 'passes'), where('date', '==', date)))).docs.map(d => ({ id: d.id, ...d.data() }));
    const list = (ctx.isAdmin ? all : all.filter(p => p.fromTeacherUid === ctx.me.uid || p.createdBy === ctx.me.uid || p.destTeacherUid === ctx.me.uid)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    $('#ph-list').innerHTML = list.length ? `<div class="card overflow-x-auto"><table class="w-full text-sm pass-table"><thead><tr><th>Student</th><th>From</th><th>To</th><th>Out</th><th>Back</th><th>Time</th><th>Status</th></tr></thead><tbody>${list.map(p => `<tr><td class="text-white">${escapeHtml(p.studentName || '')}</td><td>${escapeHtml(p.fromTitle || '—')}</td><td>${escapeHtml(toLabel(p))}</td><td>${escapeHtml(fmtTime(p.startAt) || '—')}</td><td>${escapeHtml(fmtTime(p.endAt) || '—')}</td><td class="tabular-nums ${p.startAt && elapsedSec(p) > (p.minutes || 5) * 60 ? 'text-[#f08a8a]' : ''}">${p.startAt ? mmss(elapsedSec(p)) : '—'}</td><td>${statusBadge(p)}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState({ icon: 'ticket', title: 'No passes on this day' });
    refreshIcons();
    $('#ph-csv').addEventListener('click', () => csv(`passes-${date}.csv`, list));
  };
  draw();
}
function csv(name, list) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Student', 'From class', 'From teacher', 'Destination', 'Note', 'Status', 'Out', 'Back', 'Minutes out', 'Limit', 'Created by'],
    ...list.map(p => [p.date, p.studentName, p.fromTitle, p.fromTeacherName, toLabel(p), p.note, p.status, fmtTime(p.startAt), fmtTime(p.endAt), p.startAt ? Math.round(elapsedSec(p) / 6) / 10 : '', p.minutes, p.createdByName])];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Exported');
}

// ── Reports (admin) ─────────────────────────────────────────────────
async function reportsTab(ctx, el, env) {
  let days = 30;
  const draw = async () => {
    el.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3 mb-5"><select id="pr-range" class="input !py-2 !w-auto" aria-label="Range">${[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([v, l]) => `<option value="${v}" ${v === days ? 'selected' : ''}>${l}</option>`).join('')}</select><button id="pr-csv" class="btn btn-secondary btn-sm">${ico('download', 'w-3.5 h-3.5')} Export CSV</button></div><div id="pr-body">${skeletonRows(4, 'h-24')}</div>`;
    refreshIcons();
    $('#pr-range').addEventListener('change', e => { days = +e.target.value; draw(); });
    const from = new Date(); from.setDate(from.getDate() - days);
    const list = (await getDocs(query(collection(db, 'tenants', ctx.slug, 'passes'), where('date', '>=', toDateInput(from))))).docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.startAt);
    const mins = list.map(p => elapsedSec(p) / 60), avg = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0;
    const late = list.filter(p => elapsedSec(p) > (p.minutes || 5) * 60);
    const count = key => { const m = new Map(); list.forEach(p => { const k = key(p); if (k) m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const rank = (rows, total) => rows.length ? `<div class="space-y-2">${rows.slice(0, 10).map(([k, n]) => `<div class="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3"><span class="text-sm text-gray-300 truncate" title="${escapeHtml(k)}">${escapeHtml(k)}</span><span class="h-2.5 rounded bg-white/[0.05] overflow-hidden"><span class="block h-full bg-[#D97706]" style="width:${(n / (total || 1) * 100).toFixed(1)}%"></span></span><span class="text-sm text-white text-right tabular-nums">${n}</span></div>`).join('')}</div>` : '<p class="text-sm text-gray-500">No passes yet.</p>';
    const byDest = count(p => toLabel(p)), byStudent = count(p => p.studentName), byHour = Array.from({ length: 24 }, (_, h) => [h, list.filter(p => new Date(ms(p.startAt)).getHours() === h).length]).filter(([h]) => h >= 7 && h <= 16);
    const maxH = Math.max(1, ...byHour.map(x => x[1]));
    $('#pr-body').innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">${kpi('Passes', list.length)}${kpi('Average time out', `${avg.toFixed(1)}<span class="text-gray-500 text-lg"> min</span>`)}${kpi('Ran over the limit', late.length)}${kpi('Students who used a pass', new Set(list.map(p => p.studentUid)).size)}</div>
      <div class="grid lg:grid-cols-2 gap-6 mb-6"><section class="card p-5"><h2 class="text-sm text-white font-medium mb-4">Where students go</h2>${rank(byDest, byDest[0]?.[1])}</section><section class="card p-5"><h2 class="text-sm text-white font-medium mb-1">Most passes</h2><p class="text-xs text-gray-500 mb-4">Students who leave class most often.</p>${rank(byStudent, byStudent[0]?.[1])}</section></div>
      <section class="card p-5"><h2 class="text-sm text-white font-medium mb-4">When passes happen</h2><div class="flex items-end gap-2 h-36">${byHour.map(([h, n]) => `<div class="flex-1 flex flex-col items-center gap-1" title="${n} passes"><span class="text-[11px] text-gray-400 tabular-nums">${n || ''}</span><span class="w-full rounded-t bg-[#D97706]" style="height:${(n / maxH * 100).toFixed(0)}%;min-height:${n ? 3 : 0}px"></span><span class="text-[10px] text-gray-500">${h % 12 || 12}${h < 12 ? 'a' : 'p'}</span></div>`).join('')}</div></section>`;
    refreshIcons();
    $('#pr-csv').addEventListener('click', () => csv(`passes-last-${days}-days.csv`, list));
  };
  draw();
}

// ── Settings (admin) ────────────────────────────────────────────────
function settingsTab(ctx, el, env) {
  const dests = env.st.destinations.map(d => ({ ...d }));
  let groups = (env.groups || []).map(g => ({ ...g }));
  const row = (d, i) => `<tr data-i="${i}"><td><select class="input !py-1.5" data-k="icon" aria-label="Icon">${ICONS.map(x => `<option ${x === d.icon ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
    <td><input class="input !py-1.5" data-k="name" value="${escapeHtml(d.name)}" aria-label="Name"></td>
    <td><input class="input !py-1.5 w-20" type="number" min="1" max="120" data-k="minutes" value="${d.minutes}" aria-label="Minutes"></td>
    <td><input class="input !py-1.5 w-20" type="number" min="0" max="100" data-k="capacity" value="${d.capacity || 0}" aria-label="At once"></td>
    <td class="text-center"><input type="checkbox" data-k="approval" ${d.approval ? 'checked' : ''} class="w-4 h-4 accent-[#F59E0B]" aria-label="Needs approval"></td>
    <td class="text-center"><input type="checkbox" data-k="enabled" ${d.enabled !== false ? 'checked' : ''} class="w-4 h-4 accent-[#F59E0B]" aria-label="Enabled"></td>
    <td>${DEFAULT_DESTS.some(x => x.id === d.id) ? '' : `<button type="button" class="btn-icon danger" data-del-dest="${i}" aria-label="Remove">${ico('trash-2', 'w-4 h-4')}</button>`}</td></tr>`;
  const draw = () => {
    el.innerHTML = `<section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]"><div><h2 class="text-white font-medium">Destinations</h2><p class="text-xs text-gray-500">“At once” limits how many students can be there at the same time (0 = no limit). Uncheck “Teacher approves” to make a pass instant.</p></div><button type="button" class="btn btn-secondary btn-sm" data-add-dest>${ico('plus', 'w-3.5 h-3.5')} Destination</button></div>
        <div class="overflow-x-auto"><table class="w-full text-sm pass-table" id="ps-dests"><thead><tr><th>Icon</th><th>Name</th><th>Minutes</th><th>At once</th><th class="text-center">Teacher approves</th><th class="text-center">On</th><th></th></tr></thead><tbody>${dests.map(row).join('')}</tbody></table></div></section>
      <section class="card p-5 mb-6"><h2 class="text-white font-medium mb-3">Limits</h2><label class="label" for="ps-limit">Passes per student per day</label><input id="ps-limit" type="number" min="1" max="30" class="input !w-32" value="${env.st.dailyLimit}"></section>
      <section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]"><div><h2 class="text-white font-medium">Keep apart (encounter prevention)</h2><p class="text-xs text-gray-500">Students in the same group shouldn’t be in the hallway at the same time. Teachers get a warning before approving. Students never see this list.</p></div><button type="button" class="btn btn-secondary btn-sm" data-add-group>${ico('plus', 'w-3.5 h-3.5')} Group</button></div>
        ${groups.length ? `<div class="divide-y divide-white/[0.05]">${groups.map((g, i) => `<div class="flex items-center gap-3 px-5 py-3">${ico('shield-ban', 'w-4 h-4 text-[#f08a8a] shrink-0')}<div class="flex-1 flex flex-wrap gap-1.5">${g.uids.map(u => `<span class="badge badge-red">${escapeHtml(g.names?.[u] || 'Student')}</span>`).join('')}${g.note ? `<span class="text-xs text-gray-500">${escapeHtml(g.note)}</span>` : ''}</div><button type="button" class="btn-icon danger" data-del-group="${i}" aria-label="Remove group">${ico('trash-2', 'w-4 h-4')}</button></div>`).join('')}</div>` : `<p class="text-sm text-gray-500 p-5">No groups yet.</p>`}</section>
      <div class="sticky bottom-0 py-3 bg-[#0A0A0A]/90 backdrop-blur border-t border-white/[0.06]"><button class="btn btn-primary" id="ps-save">${ico('save', 'w-4 h-4')} Save settings</button></div>`;
    refreshIcons();
  };
  const readTable = () => $$('#ps-dests tbody tr').forEach(tr => { const d = dests[+tr.dataset.i]; tr.querySelectorAll('[data-k]').forEach(inp => { const k = inp.dataset.k; d[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) || 0 : inp.value.trim(); }); });
  draw();
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-add-dest]')) { readTable(); dests.push({ id: 'd' + Date.now().toString(36), name: 'New destination', icon: 'map-pin', minutes: 5, approval: true, capacity: 0 }); return draw(); }
    const dd = e.target.closest('[data-del-dest]'); if (dd) { readTable(); dests.splice(+dd.dataset.delDest, 1); return draw(); }
    const dg = e.target.closest('[data-del-group]'); if (dg) { readTable(); groups.splice(+dg.dataset.delGroup, 1); return draw(); }
    if (e.target.closest('[data-add-group]')) {
      readTable();
      const F = await import('./staff.js' + BUILD);
      const students = (await getDocs(collection(db, 'tenants', ctx.slug, 'students'))).docs.map(d => ({ uid: d.id, ...d.data() })).filter(s => s.status !== 'pending' && s.status !== 'rejected');
      F.formModal({ title: 'Keep these students apart', icon: 'shield-ban', form: { sections: [{ fields: [{ id: 'students', type: 'students', label: 'Students (2 or more)', required: true }, { id: 'note', type: 'text', label: 'Private note (optional)' }] }], rules: [d => (d.students || []).length < 2 ? { id: 'students', msg: 'Pick at least two students.' } : null] }, env: { students }, submit: 'Add group', onSubmit: async d => {
        groups.push({ uids: d.students.map(s => s.uid), names: Object.fromEntries(d.students.map(s => [s.uid, s.name])), note: d.note || '' }); draw(); return true;
      } });
      return;
    }
    const sv = e.target.closest('#ps-save');
    if (sv) {
      readTable();
      const clean = dests.filter(d => d.name).map(d => ({ id: d.id, name: d.name, icon: d.icon || 'map-pin', minutes: Math.max(1, d.minutes || 5), capacity: Math.max(0, d.capacity || 0), approval: !!d.approval, enabled: d.enabled !== false, ...(d.kind ? { kind: d.kind } : {}), ...(d.alert ? { alert: d.alert } : {}) }));
      const limit = Math.max(1, Number($('#ps-limit').value) || 6);
      withBusy(sv, 'Saving…', async () => {
        try {
          await setDoc(SETTINGS_PATH(ctx), { destinations: clean, autoApprove: autoApproveIds(clean), dailyLimit: limit }, { merge: true });
          await setDoc(doc(db, 'tenants', ctx.slug, 'passPrivate', 'encounters'), { groups, updatedBy: ctx.me.uid, updatedAt: serverTimestamp() });
          env.st.destinations = clean; env.st.dailyLimit = limit; env.groups = groups;
          toast('Ember Pass settings saved');
        } catch (ex) { toast(friendlyError(ex), 'error'); }
      });
    }
  });
}
