// Ember Pass — digital hall passes.
// Rules come in layers: district policy → school settings → each teacher's class rules → per-student
// restrictions. Students request passes (some are instant); staff approve, send, track and report.
// Loaded on demand by app.js; helpers come from app.js via globalThis.__ember.
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs, onSnapshot, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
const {
  db, $, $$, ico, refreshIcons, escapeHtml, plural, displayNameOf, tsMillis, toDateInput, render, setTitle, showError, iconTile, badge, avatar,
  skeletonRows, emptyState, errorBox, toast, withBusy, confirmDialog, openModal, modalHeader, modalBody, modalFooter, buildUrl, navigate, live, unsubs,
  pageHeader, tenantPage, myCourses, routeTokenNow, notify, officeStaffUids, friendlyError, districtShell, ls
} = globalThis.__ember;
const BUILD = new URL(import.meta.url).search;
const sis = () => import('./sis.js' + BUILD);
const forms = () => import('./staff.js' + BUILD);

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════
export const DEFAULT_DESTS = [
  { id: 'restroom', name: 'Restroom', icon: 'toilet', minutes: 5, approval: true, capacity: 3, perDay: 0 },
  { id: 'water', name: 'Water fountain', icon: 'glass-water', minutes: 3, approval: false, capacity: 4, perDay: 0 },
  { id: 'nurse', name: 'Nurse', icon: 'briefcase-medical', minutes: 10, approval: true, capacity: 0, alert: 'health', openFrom: '07:30', openTo: '15:30' },
  { id: 'office', name: 'Front office', icon: 'building-2', minutes: 10, approval: true, capacity: 0, alert: 'admin' },
  { id: 'counselor', name: 'Counselor', icon: 'heart-handshake', minutes: 15, approval: true, capacity: 0, alert: 'services' },
  { id: 'library', name: 'Library / media center', icon: 'library', minutes: 15, approval: true, capacity: 6 },
  { id: 'locker', name: 'Locker', icon: 'lock', minutes: 4, approval: true, capacity: 0 },
  { id: 'room', name: 'Another classroom', icon: 'door-open', minutes: 8, approval: true, capacity: 0, kind: 'room' },
  { id: 'other', name: 'Somewhere else', icon: 'map-pin', minutes: 5, approval: true, capacity: 0, kind: 'other' },
];
const SCHOOL_DEFAULTS = { dailyLimit: 6, weeklyLimit: 0, roomCapacity: 2, blockFirstMin: 0, blockLastMin: 0, blackouts: [], autoEndAfter: 0, escalateAfter: 5, frequentAlert: 5, allowTeacherRules: true, allowTeacherKeepApart: true, allowTeacherInstant: true, showCode: true, frozen: false, freezeMessage: '' };
const POLICY_FIELDS = [
  ['dailyLimit', 'Passes per student per day'], ['weeklyLimit', 'Passes per student per week (0 = no limit)'], ['roomCapacity', 'Students out of one room at once (0 = no limit)'],
  ['blockFirstMin', 'No passes in the first … minutes of a period'], ['blockLastMin', 'No passes in the last … minutes of a period'],
  ['escalateAfter', 'Alert administrators … minutes after a pass runs over'], ['autoEndAfter', 'Auto-end a pass … minutes after it runs over (0 = never)'], ['frequentAlert', 'Alert administrators when a student reaches … passes in a day (0 = off)'],
];
const ICONS = ['toilet', 'glass-water', 'briefcase-medical', 'building-2', 'heart-handshake', 'library', 'lock', 'door-open', 'map-pin', 'dumbbell', 'utensils', 'music', 'palette', 'flask-conical', 'computer', 'bus', 'trophy', 'phone', 'shield', 'book-open', 'printer', 'clipboard-check'];
const TYPES = {
  standard: ['ticket', 'Pass'], late: ['alarm-clock', 'Late pass'], checkout: ['log-out', 'Early check-out'], appointment: ['calendar-clock', 'Appointment'],
  return: ['undo-2', 'Return trip'], kiosk: ['tablet-smartphone', 'Kiosk'], group: ['users', 'Group pass'],
};
const DAYS = [['M', 'Mon'], ['T', 'Tue'], ['W', 'Wed'], ['R', 'Thu'], ['F', 'Fri']];

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
const todayISO = () => toDateInput(new Date());
const ms = v => v ? (typeof v === 'number' ? v : typeof v === 'string' ? new Date(v).getTime() : tsMillis(v)) : 0;
const mmss = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
const limitSec = p => ((p.minutes || 5) + (p.extraMinutes || 0)) * 60;
const elapsedSec = p => p.startAt ? (((p.status === 'ended' ? ms(p.endAt) : Date.now()) - ms(p.startAt)) / 1000) : 0;
const overBy = p => p.status === 'active' ? elapsedSec(p) - limitSec(p) : 0;
const isOverdue = p => overBy(p) > 0;
const fmtTime = v => v ? new Date(ms(v)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
const fmtHM = hm => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const nowHM = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const dayLetter = (d = new Date()) => 'UMTWRFS'[d.getDay()];
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toDateInput(d); };
const toLabel = p => p.destKind === 'room' && (p.destTeacherName || p.destRoom) ? `${p.destTeacherName || 'Room'}${p.destRoom ? ' · Rm ' + p.destRoom : ''}` : p.destKind === 'other' && p.destOther ? p.destOther : p.destName;
const counts = p => !['denied', 'cancelled'].includes(p.status) && p.type !== 'return' && p.type !== 'late';
// Live code: changes every 30 s, so a screenshot of an old pass can be spotted by any adult.
const CODE_CHARS = 'ACDEFHJKMNPRTUVWXY34679';
function liveCode(id, t = Date.now()) { let h = 5381; const s = id + Math.floor(t / 30000); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return Array.from({ length: 3 }, (_, i) => CODE_CHARS[(h >>> (i * 5)) % CODE_CHARS.length]).join(''); }

// ═══════════════════════════════════════════════════════════════
// POLICY: district → school → teacher (class) → student restrictions
// ═══════════════════════════════════════════════════════════════
const SCHOOL_DOC = ctx => doc(db, 'tenants', ctx.slug, 'sis', 'passes');
const DISTRICT_DOC = id => doc(db, 'districts', id, 'policy', 'passes');
const TEACHER_DOC = (ctx, uid) => doc(db, 'tenants', ctx.slug, 'passRules', uid);
async function loadPolicy(ctx) {
  const [s, dp] = await Promise.all([
    getDoc(SCHOOL_DOC(ctx)).then(x => x.exists() ? x.data() : null).catch(() => null),
    ctx.tenant.districtId ? getDoc(DISTRICT_DOC(ctx.tenant.districtId)).then(x => x.exists() ? x.data() : null).catch(() => null) : null,
  ]);
  const school = s || {};
  const district = dp || {};
  const enforced = district.enforced || [];
  // District values are defaults unless the district enforces them; schools fill in the rest.
  const eff = { ...SCHOOL_DEFAULTS, ...Object.fromEntries(Object.entries(district).filter(([k]) => k in SCHOOL_DEFAULTS)), ...school };
  enforced.forEach(k => { if (k in district) eff[k] = district[k]; });
  eff.destinations = (school.destinations?.length ? school.destinations : DEFAULT_DESTS).map(d => ({ ...d, minutes: district.maxMinutes ? Math.min(d.minutes || 5, district.maxMinutes) : d.minutes || 5 }));
  eff.blackouts = [...(school.blackouts || []), ...(district.blackouts || [])];
  eff.frozen = !!school.frozen || !!district.frozen;
  eff.freezeMessage = district.frozen ? (district.freezeMessage || 'Passes are paused across the district.') : (school.freezeMessage || '');
  if (district.maxDailyLimit) eff.dailyLimit = Math.min(eff.dailyLimit || 99, district.maxDailyLimit);
  return { exists: !!s, school, district, enforced, eff };
}
async function teacherRules(ctx, uid) {
  if (!uid) return null;
  const x = await getDoc(TEACHER_DOC(ctx, uid)).catch(() => null);
  return x?.exists() ? x.data() : null;
}
const destOf = (pol, id) => pol.eff.destinations.find(d => d.id === id) || DEFAULT_DESTS.find(d => d.id === id) || (id === 'return' ? { id: 'return', name: 'Back to class', icon: 'undo-2', minutes: 5 } : { id, name: id, icon: 'map-pin', minutes: 5 });
const enabledDests = pol => pol.eff.destinations.filter(d => d.enabled !== false);
const autoApproveIds = dests => dests.filter(d => d.enabled !== false && !d.approval).map(d => d.id);
const isOpen = (d, now = new Date()) => !(d.openFrom && d.openTo) || (nowHM(now) >= d.openFrom && nowHM(now) <= d.openTo);
const activeRestrictions = (list, uid) => list.filter(r => r.studentUid === uid && (!r.until || r.until >= todayISO()));
// Everything that applies to one pass. `blocks` stop students; staff see them as warnings they can override.
function evaluate({ pol, rules, restrictions = [], mine = [], dest, periods = [], teacherName = 'Your teacher', studentUid }) {
  const eff = pol.eff, blocks = [], now = new Date(), hm = nowHM(now);
  if (eff.frozen) blocks.push(eff.freezeMessage || 'Passes are paused school-wide.');
  if (rules?.paused) blocks.push(rules.pausedMessage || `${teacherName} has paused passes for this class.`);
  if (dest.enabled === false || (rules?.disabled || []).includes(dest.id)) blocks.push(`${dest.name} isn't available from this class.`);
  if (!isOpen(dest, now)) blocks.push(`${dest.name} is open ${fmtHM(dest.openFrom)}–${fmtHM(dest.openTo)}.`);
  const bo = eff.blackouts.find(b => (!b.days?.length || b.days.includes(dayLetter(now))) && b.from <= hm && hm <= b.to);
  if (bo) blocks.push(`No passes during ${bo.label || 'this time'} (${fmtHM(bo.from)}–${fmtHM(bo.to)}).`);
  const first = rules?.blockFirstMin ?? eff.blockFirstMin, last = rules?.blockLastMin ?? eff.blockLastMin;
  const period = periods.find(p => p.start && p.end && p.start <= hm && hm <= p.end);
  if (period) {
    const toMin = x => +x.slice(0, 2) * 60 + +x.slice(3), n = toMin(hm);
    if (first && n - toMin(period.start) < first) blocks.push(`No passes in the first ${first} minutes of ${period.name}.`);
    if (last && toMin(period.end) - n < last) blocks.push(`No passes in the last ${last} minutes of ${period.name}.`);
  }
  let needsApproval = !!dest.approval && !(eff.allowTeacherInstant && (rules?.instant || []).includes(dest.id));
  const today = mine.filter(p => p.date === todayISO() && counts(p)), week = mine.filter(p => p.date >= weekStart() && counts(p));
  const daily = rules?.dailyLimit || eff.dailyLimit;
  activeRestrictions(restrictions, studentUid).forEach(r => {
    const why = r.reason ? ` (${r.reason})` : '';
    if (r.mode === 'none') blocks.push(`You can't use passes right now${r.until ? ' until ' + new Date(r.until + 'T12:00').toLocaleDateString() : ''}${why}. Talk with your teacher.`);
    if (r.mode === 'only' && !(r.destIds || []).includes(dest.id)) blocks.push(`You can only get passes to ${(r.destIds || []).map(id => destOf(pol, id).name).join(', ') || 'certain places'} right now.`);
    if (r.mode === 'approval') needsApproval = true;
    if (r.perDay && today.length >= r.perDay) blocks.push(`You've reached your limit of ${r.perDay} passes today.`);
  });
  if (daily && today.length >= daily) blocks.push(`You've used all ${daily} passes for today.`);
  if (eff.weeklyLimit && week.length >= eff.weeklyLimit) blocks.push(`You've used all ${eff.weeklyLimit} passes for this week.`);
  if (dest.perDay && today.filter(p => p.destId === dest.id).length >= dest.perDay) blocks.push(`You can go to the ${dest.name.toLowerCase()} ${plural(dest.perDay, 'time')} a day.`);
  return { blocks: [...new Set(blocks)], needsApproval, minutes: rules?.minutes?.[dest.id] || dest.minutes || 5 };
}
// Hallway checks only staff can make (they can see every pass and the keep-apart list).
function staffChecks({ pol, rules, keepApart, passes, studentUid, studentName, dest, fromTeacherUid }) {
  const out = [], active = passes.filter(p => p.status === 'active' && p.studentUid !== studentUid);
  const here = active.filter(p => p.destId === dest.id).length;
  if (dest.capacity && here >= dest.capacity) out.push(`${dest.name} is full (${here}/${dest.capacity}).`);
  const roomCap = rules?.roomCapacity ?? pol.eff.roomCapacity;
  const fromRoom = active.filter(p => p.fromTeacherUid && p.fromTeacherUid === fromTeacherUid && p.type !== 'late').length;
  if (fromTeacherUid && roomCap && fromRoom >= roomCap) out.push(`${fromRoom} student${fromRoom === 1 ? ' is' : 's are'} already out of this room (limit ${roomCap}).`);
  keepApart.filter(g => (g.uids || []).includes(studentUid)).forEach(g => {
    const others = active.filter(p => g.uids.includes(p.studentUid) && (g.scope !== 'destination' || p.destId === dest.id));
    others.forEach(p => out.push(`Keep apart: ${p.studentName} is ${g.scope === 'destination' ? 'at the ' + dest.name.toLowerCase() : 'out of class'} and shouldn't be ${g.scope === 'destination' ? 'there' : 'in the hall'} with ${studentName}.`));
  });
  return [...new Set(out)];
}
async function loadKeepApart(ctx) {
  const [snap, legacy] = await Promise.all([
    getDocs(collection(db, 'tenants', ctx.slug, 'passKeepApart')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    getDoc(doc(db, 'tenants', ctx.slug, 'passPrivate', 'encounters')).then(d => d.exists() ? (d.data().groups || []).map((g, i) => ({ id: 'legacy' + i, legacy: true, scope: 'hallway', ...g })) : []).catch(() => []),
  ]);
  return [...snap, ...legacy];
}
const loadRestrictions = (ctx, studentUid = null) => getDocs(studentUid ? query(collection(db, 'tenants', ctx.slug, 'passRestrictions'), where('studentUid', '==', studentUid)) : collection(db, 'tenants', ctx.slug, 'passRestrictions'))
  .then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
function currentCourse(courses, periods) {
  const hm = nowHM(), period = (periods || []).find(p => p.start && p.end && p.start <= hm && hm <= p.end);
  return (period && courses.find(c => c.periodId === period.id)) || null;
}

// ── Live UI bits ────────────────────────────────────────────────────
const timerHTML = (p, big = false) => `<span data-timer="${ms(p.startAt)}" data-limit="${limitSec(p)}" class="pass-timer ${big ? 'is-big' : ''} tabular-nums">${mmss(elapsedSec(p))}</span>`;
const codeHTML = (p, big = false) => `<span class="pass-code ${big ? 'is-big' : ''}" data-code="${escapeHtml(p.id)}">${liveCode(p.id)}</span>`;
const STATUS_TXT = { pending: 'Waiting', active: 'Out', scheduled: 'Scheduled', ended: 'Back', denied: 'Denied', cancelled: 'Cancelled' };
const statusPill = p => isOverdue(p) ? `<span class="pass-pill is-late">${ico('siren', 'w-3 h-3')} ${mmss(overBy(p))} over</span>` : `<span class="pass-pill is-${p.status}">${escapeHtml(STATUS_TXT[p.status] || p.status)}</span>`;
const typeChip = p => p.type && p.type !== 'standard' && TYPES[p.type] ? `<span class="pass-type">${ico(TYPES[p.type][0], 'w-3 h-3')} ${TYPES[p.type][1]}</span>` : '';
function startTicker() {
  const tick = () => {
    $$('[data-timer]').forEach(el => {
      const start = +el.dataset.timer, limit = +el.dataset.limit; if (!start) return;
      const s = (Date.now() - start) / 1000; el.textContent = mmss(s);
      el.classList.toggle('is-late', s > limit);
      const ring = el.closest('[data-ring]'); if (ring) { ring.style.setProperty('--pct', Math.min(100, s / limit * 100)); ring.classList.toggle('is-late', s > limit); }
    });
    $$('[data-code]').forEach(el => { const c = liveCode(el.dataset.code); if (el.textContent !== c) { el.textContent = c; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } });
    $$('[data-code-bar]').forEach(el => { el.style.width = `${100 - (Date.now() % 30000) / 300}%`; });
  };
  const id = setInterval(tick, 1000); tick();
  unsubs.push(() => clearInterval(id));
}
// Short tone + desktop notification for new requests (teacher choice, remembered on this device).
function chime() {
  try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.25, a.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.4); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.45); } catch (e) {}
}
function desktopAlert(title, body) { try { if (window.Notification?.permission === 'granted') new Notification(title, { body, tag: 'ember-pass' }); } catch (e) {} }
function printPass(ctx, p, pol) {
  let root = document.getElementById('print-root'); if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = `<div class="pf" style="max-width:420px;border:2px solid #111;padding:16px;border-radius:12px"><div class="pf-title">HALL PASS</div><div class="pf-sub">${escapeHtml(ctx.tenant.name)} · ${escapeHtml(new Date().toLocaleDateString())}</div>
    <table style="margin-top:10px"><tr><th>Student</th><td>${escapeHtml(p.studentName || '')}</td></tr><tr><th>From</th><td>${escapeHtml(p.fromTitle || '')}${p.fromRoom ? ' · Rm ' + escapeHtml(p.fromRoom) : ''}</td></tr><tr><th>To</th><td>${escapeHtml(toLabel(p))}</td></tr>
    <tr><th>Out</th><td>${escapeHtml(fmtTime(p.startAt) || fmtTime(Date.now()))}</td></tr><tr><th>Time allowed</th><td>${(p.minutes || 5) + (p.extraMinutes || 0)} minutes</td></tr><tr><th>Issued by</th><td>${escapeHtml(p.approvedByName || p.createdByName || '')}</td></tr>${p.note ? `<tr><th>Note</th><td>${escapeHtml(p.note)}</td></tr>` : ''}</table>
    <div class="pf-sign"><div>Staff signature</div><div>Time back</div></div></div>`;
  const done = () => { root.innerHTML = ''; window.removeEventListener('afterprint', done); }; window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50);
}
const passRef = (ctx, id) => doc(db, 'tenants', ctx.slug, 'passes', id);
const passCol = ctx => collection(db, 'tenants', ctx.slug, 'passes');

export async function viewPass(ctx, tab) {
  if (ctx.isStudent) return studentView(ctx);
  if (ctx.isRealTeacher) return tab === 'kiosk' ? navigate(`/kiosk?school=${encodeURIComponent(ctx.slug)}`, { replace: true }) : staffView(ctx, tab || 'room');
  return navigate(`/${ctx.slug}`, { replace: true });
}

// ═══════════════════════════════════════════════════════════════
// STUDENT
// ═══════════════════════════════════════════════════════════════
async function studentView(ctx) {
  const t = routeTokenNow();
  setTitle('Ember Pass', ctx.tenant.name);
  render(tenantPage(ctx, 'pass', `<div class="max-w-4xl" id="ps">${skeletonRows(3, 'h-32')}</div>`));
  const [pol, courses, settings, restrictions] = await Promise.all([loadPolicy(ctx), myCourses(ctx).catch(() => []), (await sis()).getSettings(ctx).catch(() => null), loadRestrictions(ctx, ctx.me.uid)]);
  if (!live(t)) return;
  const periods = settings?.periods || [];
  const rulesCache = new Map();
  const rulesFor = async uid => { if (!uid) return null; if (!rulesCache.has(uid)) rulesCache.set(uid, await teacherRules(ctx, uid)); return rulesCache.get(uid); };
  const cur = currentCourse(courses, periods) || courses[0];
  const curRules = await rulesFor(cur?.ownerUid);
  if (!live(t)) return;
  let passes = [];
  const el = $('#ps');
  const draw = () => {
    const mine = passes.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    const current = mine.find(p => p.status === 'active') || mine.find(p => p.status === 'pending');
    const upcoming = mine.filter(p => p.status === 'scheduled' && p.date === todayISO()).sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''));
    const usedToday = mine.filter(p => p.date === todayISO() && counts(p)).length;
    const history = mine.filter(p => ['ended', 'denied', 'cancelled'].includes(p.status)).slice(0, 12);
    const lastEnded = mine.find(p => p.status === 'ended');
    const canReturn = lastEnded && lastEnded.arrivedAt && lastEnded.type !== 'return' && lastEnded.destKind === 'room' && Date.now() - ms(lastEnded.endAt) < 60 * 60000 && !mine.some(p => p.returnOf === lastEnded.id);
    // Favorites: the places this student goes most.
    const freq = {}; mine.filter(counts).forEach(p => { freq[p.destId] = (freq[p.destId] || 0) + 1; });
    const dests = enabledDests(pol).sort((a, b) => (freq[b.id] || 0) - (freq[a.id] || 0));
    let top = `<header class="pass-hero mb-6"><div><p class="text-[11px] uppercase tracking-[0.18em] text-[#F59E0B] mb-1">${escapeHtml(ctx.tenant.name)}</p><h1 class="font-serif text-4xl text-white">Ember Pass</h1><p class="text-sm text-gray-400 mt-1">${cur ? `In <span class="text-white">${escapeHtml(cur.title || 'class')}</span>${cur.ownerName ? ' with ' + escapeHtml(cur.ownerName) : ''}` : 'Get a hall pass and show it to any staff member who asks.'}</p></div>
      <div class="pass-meter" title="Passes used today"><span class="text-2xl text-white font-semibold tabular-nums">${usedToday}</span><span class="text-gray-500">/${curRules?.dailyLimit || pol.eff.dailyLimit}</span><div class="text-[10px] uppercase tracking-wider text-gray-500">today</div></div></header>`;
    if (current?.status === 'active') top += activeCard(current);
    else if (current?.status === 'pending') top += `<section class="card p-6 mb-6 pass-wait"><div class="flex flex-wrap items-center gap-4">${iconTile('hourglass', 'amber', 'tile-lg')}<div class="flex-1 min-w-0"><div class="text-white text-lg">${current.type === 'appointment' ? `${escapeHtml(current.createdByName || 'Staff')} asked for you` : `Waiting for ${escapeHtml(current.fromTeacherName || 'your teacher')}`}</div><div class="text-sm text-gray-400">${escapeHtml(current.fromTitle || 'Class')} → ${escapeHtml(toLabel(current))}${current.note ? ` · “${escapeHtml(current.note)}”` : ''}</div>${current.type === 'appointment' ? `<div class="text-xs text-gray-500 mt-1">Your teacher will send you when it's a good time.</div>` : ''}</div>${current.type === 'appointment' ? '' : `<button class="btn btn-secondary" data-cancel="${current.id}">Cancel</button>`}</div><div class="pass-wait-bar mt-4"><span></span></div></section>`;
    const sched = upcoming.length ? `<section class="mb-6"><h2 class="label">Coming up today</h2><div class="space-y-2">${upcoming.map(p => { const at = new Date(p.scheduledFor), ready = at - Date.now() < 3 * 60000; return `<div class="card p-4 flex items-center gap-3">${iconTile(TYPES[p.type]?.[0] || destOf(pol, p.destId).icon, 'violet')}<div class="flex-1 min-w-0"><div class="text-white">${escapeHtml(toLabel(p))} at ${escapeHtml(at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))} ${typeChip(p)}</div><div class="text-xs text-gray-500">From ${escapeHtml(p.createdByName || 'staff')}${p.note ? ' · ' + escapeHtml(p.note) : ''}</div></div>${ready && !current ? `<button class="btn btn-primary btn-sm" data-start="${p.id}">${ico('play', 'w-3.5 h-3.5')} Start</button>` : `<span class="text-xs text-gray-500">Starts ${escapeHtml(at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</span>`}</div>`; }).join('')}</div></section>` : '';
    const ret = canReturn && !current ? `<section class="card p-4 mb-6 flex items-center gap-3">${iconTile('undo-2', 'teal')}<div class="flex-1"><div class="text-white">Heading back to ${escapeHtml(lastEnded.fromTitle || 'class')}?</div><div class="text-xs text-gray-500">Start a return pass so staff know you're on the way.</div></div><button class="btn btn-primary btn-sm" data-return="${lastEnded.id}">${ico('undo-2', 'w-3.5 h-3.5')} Return pass</button></section>` : '';
    const picker = current ? '' : pol.eff.frozen ? `<div class="card p-8 text-center mb-6">${ico('snowflake', 'w-10 h-10 text-[#93C5FD] mx-auto mb-3')}<div class="text-white text-lg">Passes are paused right now</div><p class="text-sm text-gray-400 mt-1">${escapeHtml(pol.eff.freezeMessage || 'Stay in your classroom until your teacher says otherwise.')}</p></div>`
      : `<section class="mb-8"><div class="flex flex-wrap items-end justify-between gap-2 mb-3"><h2 class="font-serif text-2xl text-white">Where are you going?</h2>${lastEnded && !canReturn ? `<button class="text-xs text-[#F59E0B] hover:underline" data-dest="${escapeHtml(lastEnded.destId)}">${ico('rotate-ccw', 'w-3 h-3 inline -mt-0.5')} Same as last time: ${escapeHtml(destOf(pol, lastEnded.destId).name)}</button>` : ''}</div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">${dests.map(d => { const ev = evaluate({ pol, rules: curRules, restrictions, mine, dest: d, periods, studentUid: ctx.me.uid, teacherName: cur?.ownerName }); const blocked = ev.blocks.length; return `<button class="pass-dest card ${blocked ? 'is-blocked' : 'card-hover'} p-4 text-left" data-dest="${escapeHtml(d.id)}" ${blocked ? `title="${escapeHtml(ev.blocks[0])}"` : ''}>${iconTile(d.icon || 'map-pin', blocked ? 'muted' : ev.needsApproval ? 'amber' : 'green')}<div class="text-white mt-3 flex items-center gap-1.5">${escapeHtml(d.name)}${freq[d.id] >= 2 ? ico('star', 'w-3 h-3 text-[#F59E0B]') : ''}</div><div class="text-[11px] text-gray-500 mt-0.5">${blocked ? escapeHtml(ev.blocks[0]) : `${ev.minutes} min · ${ev.needsApproval ? 'Teacher approves' : 'Instant'}`}</div></button>`; }).join('')}</div></section>`;
    el.innerHTML = top + ret + sched + picker + `<section><h2 class="label">Recent passes</h2>${history.length ? `<div class="card divide-y divide-white/[0.05] overflow-hidden">${history.map(p => `<div class="flex items-center gap-3 px-5 py-3">${ico(destOf(pol, p.destId).icon || 'map-pin', 'w-4 h-4 text-gray-500 shrink-0')}<div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(toLabel(p))} ${typeChip(p)}</div><div class="text-[11px] text-gray-500">${escapeHtml(new Date(ms(p.createdAt)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}${p.startAt ? ' · ' + escapeHtml(fmtTime(p.startAt)) : ''}${p.status === 'ended' ? ' · ' + mmss(elapsedSec(p)) : ''}</div></div>${statusPill(p)}</div>`).join('')}</div>` : `<p class="text-sm text-gray-500">No passes yet.</p>`}</section>`;
    refreshIcons();
  };
  const activeCard = p => `<section class="pass-card ${isOverdue(p) ? 'is-late' : ''} mb-6" data-ring style="--pct:${Math.min(100, elapsedSec(p) / limitSec(p) * 100)}">
      <div class="pass-stripe" aria-hidden="true"></div>
      <div class="relative flex flex-wrap items-center gap-6">
        <div class="pass-ring"><div class="pass-ring-in">${timerHTML(p, true)}<span class="text-[11px] text-gray-400">of ${mmss(limitSec(p))}</span></div></div>
        <div class="flex-1 min-w-[220px]"><div class="text-[11px] uppercase tracking-[0.18em] text-[#F59E0B] mb-1">Hall pass · ${escapeHtml(ctx.tenant.name)} ${typeChip(p)}</div>
          <div class="font-serif text-3xl text-white leading-tight">${escapeHtml(p.studentName || ctx.me.name)}</div>
          <div class="text-lg text-gray-200 mt-1 flex flex-wrap items-center gap-2">${escapeHtml(p.fromRoom ? 'Rm ' + p.fromRoom : p.fromTitle || 'Class')} ${ico('arrow-right', 'w-4 h-4 text-gray-500')} ${escapeHtml(toLabel(p))}</div>
          <div class="text-sm text-gray-400 mt-1">Left at ${escapeHtml(fmtTime(p.startAt))}${p.approvedByName ? ` · approved by ${escapeHtml(p.approvedByName)}` : p.createdByRole === 'staff' ? ` · from ${escapeHtml(p.createdByName || '')}` : ' · instant pass'}${p.extraMinutes ? ` · +${p.extraMinutes} min` : ''}</div></div>
        ${pol.eff.showCode !== false ? `<div class="text-center"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Live code</div>${codeHTML(p, true)}<div class="pass-code-bar"><span data-code-bar></span></div></div>` : ''}
      </div>
      <div class="relative flex flex-wrap items-center gap-3 mt-5"><button class="btn btn-primary py-3 px-6" data-end="${p.id}">${ico('circle-stop', 'w-4 h-4')} I'm back — end pass</button><span class="text-xs text-gray-500">Show this screen to any staff member. The code changes every 30 seconds.</span></div></section>`;
  unsubs.push(onSnapshot(query(passCol(ctx), where('studentUid', '==', ctx.me.uid)), snap => { passes = snap.docs.map(d => ({ id: d.id, ...d.data() })); if (live(t)) { draw(); autoEndOwn(); } }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  // A student's own pass ends itself if it runs far past the limit (when the school turns that on).
  const autoEndOwn = () => { const p = passes.find(x => x.status === 'active'); if (p && pol.eff.autoEndAfter && overBy(p) > pol.eff.autoEndAfter * 60) updateDoc(passRef(ctx, p.id), { status: 'ended', endAt: serverTimestamp(), endedBy: 'auto', updatedAt: serverTimestamp() }).catch(() => {}); };
  const id = setInterval(autoEndOwn, 20000); unsubs.push(() => clearInterval(id));
  startTicker();
  el.addEventListener('click', async e => {
    const end = e.target.closest('[data-end]');
    if (end) return withBusy(end, 'Ending…', async () => { try { await updateDoc(passRef(ctx, end.dataset.end), { status: 'ended', endAt: serverTimestamp(), endedBy: ctx.me.uid, updatedAt: serverTimestamp() }); toast('Welcome back'); } catch (ex) { toast(friendlyError(ex), 'error'); } });
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) { try { await updateDoc(passRef(ctx, cancel.dataset.cancel), { status: 'cancelled', updatedAt: serverTimestamp() }); toast('Request cancelled', 'info'); } catch (ex) { toast(friendlyError(ex), 'error'); } return; }
    const start = e.target.closest('[data-start]');
    if (start) { try { await updateDoc(passRef(ctx, start.dataset.start), { status: 'active', startAt: serverTimestamp(), updatedAt: serverTimestamp() }); toast('Pass started'); } catch (ex) { toast(friendlyError(ex), 'error'); } return; }
    const rt = e.target.closest('[data-return]');
    if (rt) {
      const p = passes.find(x => x.id === rt.dataset.return);
      try { await addDoc(passCol(ctx), { studentUid: ctx.me.uid, studentName: ctx.me.name, date: todayISO(), createdBy: ctx.me.uid, createdByName: ctx.me.name, createdByRole: 'student', type: 'return', returnOf: p.id, status: 'active', startAt: serverTimestamp(),
        fromCourseId: '', fromTitle: toLabel(p), fromTeacherUid: p.destTeacherUid || '', fromTeacherName: p.destTeacherName || '', fromRoom: p.destRoom || '', destId: 'return', destName: `Back to ${p.fromTitle || 'class'}`, destKind: '', destTeacherUid: p.fromTeacherUid || '', destTeacherName: p.fromTeacherName || '', minutes: 5, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        toast('Return pass started'); } catch (ex) { toast(friendlyError(ex), 'error'); }
      return;
    }
    const dest = e.target.closest('[data-dest]');
    if (dest) requestPass(ctx, destOf(pol, dest.dataset.dest), { pol, courses, periods, restrictions, mine: passes, rulesFor });
  });
}
async function requestPass(ctx, d, { pol, courses, periods, restrictions, mine, rulesFor }) {
  const cur = currentCourse(courses, periods) || courses[0];
  const teachers = [...new Map(courses.filter(c => c.ownerUid).map(c => [c.ownerUid, { uid: c.ownerUid, name: c.ownerName || 'Teacher', room: c.room || '' }])).values()];
  const m = openModal({ size: 'sm', html: modalHeader({ title: d.name, subtitle: '<span data-rp-sub>Checking the rules…</span>', icon: d.icon || 'ticket' }) + `<form novalidate>${modalBody(`
      <label class="label" for="rp-from">Leaving from</label><select id="rp-from" class="input mb-4" data-icon="door-open">${courses.length ? courses.map(c => `<option value="${escapeHtml(c.id)}" data-icon="book-open" ${c.id === cur?.id ? 'selected' : ''}>${escapeHtml(c.title || 'Class')}${c.ownerName ? ' · ' + escapeHtml(c.ownerName) : ''}${c.room ? ' · Rm ' + escapeHtml(c.room) : ''}</option>`).join('') : '<option value="">Not in a class</option>'}</select>
      ${d.kind === 'room' ? `<label class="label" for="rp-to">Going to</label><select id="rp-to" class="input mb-2" data-icon="user">${teachers.map(x => `<option value="${escapeHtml(x.uid)}" data-icon="user">${escapeHtml(x.name)}${x.room ? ' · Rm ' + escapeHtml(x.room) : ''}</option>`).join('')}<option value="" data-icon="pencil">Another teacher (type below)</option></select><input id="rp-room" class="input mb-4" placeholder="Teacher or room (if not listed)">` : ''}
      ${d.kind === 'other' ? `<label class="label" for="rp-other">Where?</label><input id="rp-other" class="input mb-4" placeholder="e.g. Band room">` : ''}
      <label class="label" for="rp-note">Note <span class="normal-case tracking-normal text-gray-600">(optional)</span></label><input id="rp-note" class="input" maxlength="140" placeholder="${d.id === 'nurse' ? 'e.g. Headache' : 'Anything your teacher should know'}">
      <div id="rp-check" class="mt-4"></div><p class="form-error mt-3 hidden" id="rp-err"></p>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1" disabled>Checking…</button>`)}</form>` });
  let ev, rules;
  const recheck = async () => {
    const from = courses.find(c => c.id === m.$('#rp-from').value);
    rules = await rulesFor(from?.ownerUid);
    ev = evaluate({ pol, rules, restrictions, mine, dest: d, periods, studentUid: ctx.me.uid, teacherName: from?.ownerName || 'Your teacher' });
    m.$('[data-rp-sub]').textContent = `${ev.minutes}-minute pass · from ${from?.title || 'class'}`;
    m.$('#rp-check').innerHTML = ev.blocks.length ? `<div class="p-3 rounded-lg border border-[#d03b3b]/40 bg-[#d03b3b]/10 text-sm text-gray-200 space-y-1">${ev.blocks.map(b => `<div class="flex gap-2">${ico('ban', 'w-4 h-4 text-[#f08a8a] shrink-0 mt-0.5')}<span>${escapeHtml(b)}</span></div>`).join('')}</div>`
      : `<div class="p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm text-gray-300 flex gap-2">${ico(ev.needsApproval ? 'hourglass' : 'zap', 'w-4 h-4 shrink-0 mt-0.5 ' + (ev.needsApproval ? 'text-[#fcd34d]' : 'text-[#6ee06e]'))}<span>${ev.minutes} minutes · ${ev.needsApproval ? `${escapeHtml(from?.ownerName || 'Your teacher')} will approve it` : 'starts right away'}</span></div>`;
    const sb = m.$('[type=submit]'); sb.disabled = !!ev.blocks.length; sb.textContent = ev.blocks.length ? 'Not available' : ev.needsApproval ? 'Request pass' : 'Start pass';
    refreshIcons();
  };
  m.$('#rp-from').addEventListener('change', recheck);
  await recheck();
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    if (ev.blocks.length) return;
    const err = m.$('#rp-err'), from = courses.find(c => c.id === m.$('#rp-from').value);
    const toUid = m.$('#rp-to')?.value || '', toT = teachers.find(x => x.uid === toUid);
    const other = m.$('#rp-other')?.value.trim() || '', room = m.$('#rp-room')?.value.trim() || '';
    if (d.kind === 'other' && !other) return showError(err, 'Say where you’re going.');
    if (d.kind === 'room' && !toT && !room) return showError(err, 'Pick a teacher or type the room.');
    withBusy(e.submitter || m.$('[type=submit]'), 'Sending…', async () => {
      const base = {
        studentUid: ctx.me.uid, studentName: ctx.me.name, date: todayISO(), createdBy: ctx.me.uid, createdByName: ctx.me.name, createdByRole: 'student', type: 'standard',
        fromCourseId: from?.id || '', fromTitle: from?.title || '', fromTeacherUid: from?.ownerUid || '', fromTeacherName: from?.ownerName || '', fromRoom: from?.room || '',
        destId: d.id, destName: d.name, destKind: d.kind || '', destTeacherUid: toT?.uid || '', destTeacherName: toT?.name || room, destRoom: toT?.room || '', destOther: other,
        note: m.$('#rp-note').value.trim(), minutes: ev.minutes, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      try {
        let ref, status = ev.needsApproval ? 'pending' : 'active';
        try { ref = await addDoc(passCol(ctx), { ...base, status, ...(status === 'active' ? { startAt: serverTimestamp(), autoApproved: true } : {}) }); }
        catch (ex) { if (status !== 'active') throw ex; status = 'pending'; ref = await addDoc(passCol(ctx), { ...base, status }); } // instant needs the saved settings; fall back to a request
        if (status === 'pending' && base.fromTeacherUid) notify(ctx, { to: [base.fromTeacherUid], kind: 'pass', title: `${ctx.me.name} is asking for a pass`, body: `${d.name}${base.note ? ' · ' + base.note : ''}`, link: `/${ctx.slug}/pass` }).catch(() => {});
        if (status === 'active' && base.destTeacherUid) notify(ctx, { to: [base.destTeacherUid], kind: 'pass', title: `${ctx.me.name} is on the way to you`, body: `From ${base.fromTitle || 'class'}`, link: `/${ctx.slug}/pass` }).catch(() => {});
        m.close(); toast(status === 'active' ? 'Pass started' : 'Request sent to your teacher');
      } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// STAFF
// ═══════════════════════════════════════════════════════════════
const STAFF_TABS = [['room', 'My room', 'door-open'], ['hall', 'Hallway', 'footprints'], ['history', 'History', 'history'], ['rules', 'Rules', 'scale'], ['reports', 'Reports', 'chart-column', 'admin'], ['settings', 'School settings', 'settings-2', 'admin']];
async function staffView(ctx, tab) {
  const t = routeTokenNow();
  const tabs = STAFF_TABS.filter(x => !x[3] || ctx.isAdmin);
  if (!tabs.some(x => x[0] === tab)) tab = 'room';
  setTitle('Ember Pass', ctx.tenant.name);
  const sound = () => ls(`ember_pass_sound:${ctx.me.uid}`) !== 'off';
  render(tenantPage(ctx, 'pass', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'Ember Pass', subtitle: 'Hall passes for your classes and the whole building.',
      actions: `<div class="flex flex-wrap gap-2"><button id="pf-sound" class="btn-icon" title="Sound and desktop alerts for new requests" aria-label="Toggle request alerts">${ico(sound() ? 'bell-ring' : 'bell-off', 'w-4 h-4')}</button>
        <button id="pf-kiosk" class="btn btn-secondary">${ico('tablet-smartphone', 'w-4 h-4')} Kiosk</button>
        <button id="pf-pause" class="btn btn-secondary">${ico('pause', 'w-4 h-4')} <span>Pause my room</span></button>
        ${ctx.isAdmin ? `<button id="pf-freeze" class="btn btn-secondary">${ico('snowflake', 'w-4 h-4')} <span>Pause school</span></button>` : ''}
        <button id="pf-new" class="btn btn-primary">${ico('ticket', 'w-4 h-4')} New pass</button></div>` })
    + `<div class="max-w-6xl"><div id="pf-banner"></div><div class="segmented mb-6 flex-wrap" role="tablist">${tabs.map(([k, l, i]) => `<a href="${buildUrl(`/${ctx.slug}/pass/${k}`)}" role="tab" class="seg-link" aria-pressed="${k === tab}">${ico(i, 'w-3.5 h-3.5')} ${l}</a>`).join('')}</div><div id="pf">${skeletonRows(4, 'h-24')}</div></div>`));
  const [pol, keepApart, courses, staffSnap, myRules, restrictions, settings] = await Promise.all([
    loadPolicy(ctx), loadKeepApart(ctx), myCourses(ctx).catch(() => []), getDocs(collection(db, 'tenants', ctx.slug, 'users')).catch(() => ({ docs: [] })),
    teacherRules(ctx, ctx.me.uid), loadRestrictions(ctx), (await sis()).getSettings(ctx).catch(() => null)]);
  if (!live(t)) return;
  // First visit by an admin: save default settings so instant destinations work for students.
  if (ctx.isAdmin && !pol.exists) setDoc(doc(db, 'tenants', ctx.slug, 'sis', 'passes'), { destinations: DEFAULT_DESTS, autoApprove: autoApproveIds(DEFAULT_DESTS), ...SCHOOL_DEFAULTS }, { merge: true }).catch(() => {});
  const staff = staffSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const env = { pol, keepApart, courses, staff, myRules: myRules || {}, restrictions, periods: settings?.periods || [], all: [] };
  const el = $('#pf');
  const drawBanner = () => {
    const parts = [];
    if (pol.eff.frozen) parts.push(`<div class="pass-banner is-frozen">${ico('snowflake', 'w-5 h-5 shrink-0')}<div class="flex-1"><div class="text-white">Passes are paused ${pol.district.frozen ? 'across the district' : 'school-wide'}</div><div class="text-xs text-gray-400">${escapeHtml(pol.eff.freezeMessage || 'Students can’t request passes until an administrator resumes them.')}</div></div></div>`);
    if (env.myRules.paused) parts.push(`<div class="pass-banner is-paused">${ico('pause', 'w-5 h-5 shrink-0')}<div class="flex-1"><div class="text-white">Passes are paused for your room</div><div class="text-xs text-gray-400">Students in your classes can’t request passes. You can still send them.</div></div></div>`);
    $('#pf-banner').innerHTML = parts.join('');
    const fb = $('#pf-freeze'); if (fb) fb.querySelector('span').textContent = pol.school.frozen ? 'Resume school' : 'Pause school';
    $('#pf-pause').querySelector('span').textContent = env.myRules.paused ? 'Resume my room' : 'Pause my room';
    $('#pf-pause').disabled = !!env.myRules.locked && !ctx.isAdmin;
    refreshIcons();
  };
  drawBanner();
  $('#pf-new').addEventListener('click', () => newPassModal(ctx, env));
  $('#pf-kiosk').addEventListener('click', () => kioskModal(ctx));
  $('#pf-sound').addEventListener('click', async e => {
    const on = !sound(); ls(`ember_pass_sound:${ctx.me.uid}`, on ? 'on' : 'off');
    if (on && window.Notification && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
    e.currentTarget.innerHTML = ico(on ? 'bell-ring' : 'bell-off', 'w-4 h-4'); refreshIcons(); toast(on ? 'Request alerts on' : 'Request alerts off', 'info');
  });
  $('#pf-pause').addEventListener('click', async () => {
    const on = !env.myRules.paused;
    try { await setDoc(TEACHER_DOC(ctx, ctx.me.uid), { paused: on, pausedMessage: on ? `${ctx.me.name} has paused passes for this class.` : '', setByName: ctx.me.name, updatedAt: serverTimestamp() }, { merge: true }); env.myRules.paused = on; drawBanner(); toast(on ? 'Passes paused for your room' : 'Passes resumed for your room', on ? 'info' : 'success'); }
    catch (ex) { toast(friendlyError(ex), 'error'); }
  });
  $('#pf-freeze')?.addEventListener('click', async () => {
    const on = !pol.school.frozen;
    let msg = '';
    if (on) {
      const F = await forms();
      return F.formModal({ title: 'Pause all passes?', subtitle: 'Students won’t be able to request or start passes. Passes already out keep running.', icon: 'snowflake', submit: 'Pause passes',
        form: { sections: [{ fields: [{ id: 'reason', type: 'select', label: 'Reason', options: ['Drill', 'Lockdown / secure', 'Testing', 'Assembly', 'Class change', 'Other'] }, { id: 'msg', type: 'text', label: 'Message students see', span: 'sm:col-span-2' }] }] },
        data: { reason: 'Drill', msg: 'Passes are paused. Stay in your classroom.' }, onSubmit: async d => {
          await setDoc(doc(db, 'tenants', ctx.slug, 'sis', 'passes'), { frozen: true, freezeMessage: d.msg || 'Passes are paused.', frozenReason: d.reason || '', frozenBy: ctx.me.name, autoApprove: autoApproveIds(pol.eff.destinations) }, { merge: true });
          pol.school.frozen = true; pol.eff.frozen = true; pol.eff.freezeMessage = d.msg; drawBanner(); toast('Passes paused', 'info');
          officeStaffUids(ctx).then(to => notify(ctx, { to, kind: 'pass', title: 'Ember Pass paused', body: `${d.reason || ''} · by ${ctx.me.name}`, link: `/${ctx.slug}/pass` })).catch(() => {});
          return true;
        } });
    }
    try { await setDoc(doc(db, 'tenants', ctx.slug, 'sis', 'passes'), { frozen: false, freezeMessage: msg }, { merge: true }); pol.school.frozen = false; pol.eff.frozen = !!pol.district.frozen; drawBanner(); toast('Passes resumed'); }
    catch (ex) { toast(friendlyError(ex), 'error'); }
  });
  if (tab === 'settings') return settingsTab(ctx, el, env);
  if (tab === 'reports') return reportsTab(ctx, el, env);
  if (tab === 'history') return historyTab(ctx, el, env);
  if (tab === 'rules') return rulesTab(ctx, el, env);
  return liveTab(ctx, el, env, tab, t);
}

function passRow(ctx, p, env, { actions = '', showFrom = true, showCode = false } = {}) {
  const d = destOf(env.pol, p.destId);
  const warns = p.status === 'active' ? staffChecks({ pol: env.pol, rules: null, keepApart: env.keepApart, passes: env.all, studentUid: p.studentUid, studentName: p.studentName, dest: d, fromTeacherUid: null }).filter(w => w.startsWith('Keep apart')) : [];
  const last = (p.checkins || []).slice(-1)[0], note = (p.comments || []).slice(-1)[0];
  return `<div class="pass-row ${isOverdue(p) ? 'is-late' : ''} flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 py-3" data-pass="${escapeHtml(p.id)}">
    ${iconTile(TYPES[p.type]?.[0] && p.type !== 'standard' ? TYPES[p.type][0] : d.icon || 'map-pin', isOverdue(p) ? 'red' : p.status === 'pending' ? 'amber' : 'teal')}
    <div class="flex-1 min-w-0"><div class="text-sm text-white truncate"><a href="${buildUrl(`/${ctx.slug}/record/${p.studentUid}`)}" class="hover:underline">${escapeHtml(p.studentName || 'Student')}</a> <span class="text-gray-500">→</span> ${escapeHtml(toLabel(p))} ${typeChip(p)}${p.groupId ? ` <span class="pass-type">${ico('users', 'w-3 h-3')} group</span>` : ''}</div>
      <div class="text-[11px] text-gray-500 truncate">${showFrom ? `${escapeHtml(p.fromTitle || 'No class')}${p.fromTeacherName ? ' · ' + escapeHtml(p.fromTeacherName) : ''} · ` : ''}${p.status === 'scheduled' ? `at ${escapeHtml(new Date(p.scheduledFor).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}` : p.startAt ? `left ${escapeHtml(fmtTime(p.startAt))}` : `asked ${escapeHtml(fmtTime(p.createdAt))}`}${p.note ? ` · “${escapeHtml(p.note)}”` : ''}${last ? ` · seen ${escapeHtml(last.where || '')} ${escapeHtml(fmtTime(last.at))}` : ''}${note ? ` · 💬 ${escapeHtml(note.text)}` : ''}</div>
      ${warns.length ? `<div class="text-[11px] text-[#f08a8a] mt-0.5">${ico('shield-ban', 'w-3 h-3 inline -mt-0.5')} ${escapeHtml(warns[0])}</div>` : ''}</div>
    ${showCode && p.status === 'active' && env.pol.eff.showCode !== false ? `<div class="text-center" title="Live code on the student's screen">${codeHTML(p)}</div>` : ''}
    ${p.status === 'active' ? `<div class="text-right">${timerHTML(p)}<div class="text-[10px] text-gray-500">of ${mmss(limitSec(p))}</div></div>` : ''}
    ${statusPill(p)}<div class="flex flex-wrap gap-1">${actions}</div>
    ${p.status === 'active' ? `<div class="pass-more"><button class="btn-icon" data-menu="${escapeHtml(p.id)}" aria-label="More actions">${ico('ellipsis', 'w-4 h-4')}</button></div>` : ''}</div>`;
}
const listCard = (title, sub, rows, empty) => `<section class="mb-6"><div class="flex items-end justify-between mb-2"><h2 class="label !mb-0">${title}</h2>${sub ? `<span class="text-xs text-gray-500">${sub}</span>` : ''}</div>${rows.length ? `<div class="card divide-y divide-white/[0.05] overflow-hidden">${rows.join('')}</div>` : `<p class="text-sm text-gray-500 card p-5">${empty}</p>`}</section>`;
const kpi = (label, v, lvl = null, sub = '') => `<div class="card p-5"><div class="text-xs text-gray-400 mb-2">${label}</div><div class="stat-value ${lvl === 'critical' && v ? 'text-[#f08a8a]' : ''}">${v}</div>${lvl || sub ? `<div class="mt-1 text-xs text-gray-500 flex items-center gap-1.5">${lvl ? ico(lvl === 'good' ? 'circle-check' : 'siren', `w-3.5 h-3.5 ${lvl === 'good' ? 'st-good' : 'st-critical'}`) : ''}${sub || (lvl === 'good' ? 'All on time' : 'Check on them')}</div>` : ''}</div>`;

function liveTab(ctx, el, env, tab, t) {
  let passes = [], seen = null;
  const mineFrom = p => p.fromTeacherUid === ctx.me.uid || (p.createdBy === ctx.me.uid && p.createdByRole === 'staff');
  const draw = () => {
    env.all = passes;
    const active = passes.filter(p => p.status === 'active'), pending = passes.filter(p => p.status === 'pending');
    if (tab === 'hall') {
      const byDest = new Map(); active.forEach(p => (byDest.get(p.destId) || byDest.set(p.destId, []).get(p.destId)).push(p));
      const overdue = active.filter(isOverdue);
      el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">${kpi('Out right now', active.length)}${kpi('Overdue', overdue.length, overdue.length ? 'critical' : 'good')}${kpi('Waiting for approval', pending.length)}${kpi('Passes today', passes.filter(counts).length)}</div>
        <div class="flex flex-wrap items-center gap-2 mb-6">${enabledDests(env.pol).map(d => { const n = (byDest.get(d.id) || []).length, full = d.capacity && n >= d.capacity; return `<span class="pass-cap ${full ? 'is-full' : n ? 'is-busy' : ''}">${ico(d.icon || 'map-pin', 'w-3.5 h-3.5')} ${escapeHtml(d.name)} <b>${n}${d.capacity ? '/' + d.capacity : ''}</b></span>`; }).join('')}
          <button class="btn btn-ghost btn-sm ml-auto" data-sweep>${ico('user-x', 'w-3.5 h-3.5')} Student without a pass</button></div>
        ${listCard('Out of class', overdue.length ? `${overdue.length} overdue · live code shown so you can check a student's screen` : 'Live code shown so you can check a student’s screen', [...active].sort((a, b) => overBy(b) - overBy(a)).map(p => passRow(ctx, p, env, { showCode: true, actions: `<button class="btn btn-ghost btn-sm" data-seen="${p.id}" title="I saw this student in the hall">${ico('eye', 'w-3.5 h-3.5')} Seen</button><button class="btn btn-ghost btn-sm" data-end="${p.id}">End</button>` })), 'Nobody is out of class right now.')}
        <div id="pf-sweeps"></div>`;
      getDocs(query(collection(db, 'tenants', ctx.slug, 'hallSweeps'), where('date', '==', todayISO()))).then(s => { const list = s.docs.map(d => d.data()).sort((a, b) => ms(b.at) - ms(a.at)); const box = $('#pf-sweeps'); if (box && list.length) { box.innerHTML = listCard('Students found without a pass today', '', list.map(x => `<div class="flex items-center gap-3 px-5 py-3">${iconTile('user-x', 'red')}<div class="flex-1 min-w-0"><div class="text-sm text-white">${escapeHtml(x.studentName || 'Unknown student')}</div><div class="text-[11px] text-gray-500">${escapeHtml(x.where || '')} · ${escapeHtml(fmtTime(x.at))} · by ${escapeHtml(x.byName || '')}${x.note ? ' · ' + escapeHtml(x.note) : ''}</div></div></div>`), ''); refreshIcons(); } }).catch(() => {});
    } else {
      const myPending = pending.filter(p => p.fromTeacherUid === ctx.me.uid || (ctx.isAdmin && !p.fromTeacherUid));
      const myOut = active.filter(mineFrom);
      const incoming = active.filter(p => p.destTeacherUid === ctx.me.uid);
      const scheduled = passes.filter(p => p.status === 'scheduled' && (mineFrom(p) || p.createdBy === ctx.me.uid));
      const roomCap = env.myRules.roomCapacity ?? env.pol.eff.roomCapacity;
      el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">${kpi('Out of my room', `${myOut.length}${roomCap ? `<span class="text-gray-500 text-lg">/${roomCap}</span>` : ''}`)}${kpi('Requests', myPending.length)}${kpi('On the way to me', incoming.length)}${kpi('Overdue', myOut.filter(isOverdue).length, myOut.some(isOverdue) ? 'critical' : 'good')}</div>`
        + listCard(`Requests ${myPending.length ? `<span class="pass-dot">${myPending.length}</span>` : ''}`, myPending.length > 1 ? `<button class="text-[#F59E0B] hover:underline" data-approve-all>Approve all</button>` : 'Approve or deny', myPending.map(p => passRow(ctx, p, env, { showFrom: false, actions: `<button class="btn btn-primary btn-sm" data-approve="${p.id}">${ico('check', 'w-3.5 h-3.5')} ${p.type === 'appointment' ? 'Send' : 'Approve'}</button><button class="btn btn-ghost btn-sm" data-deny="${p.id}">${p.type === 'appointment' ? 'Not now' : 'Deny'}</button>` })), 'No pass requests right now.')
        + listCard('Out of my room', '', myOut.map(p => passRow(ctx, p, env, { showFrom: false, actions: `<button class="btn btn-ghost btn-sm" data-extend="${p.id}" title="Give 5 more minutes">+5</button><button class="btn btn-ghost btn-sm" data-end="${p.id}">Back</button>` })), 'All of your students are in class.')
        + (incoming.length ? listCard('On the way to me', '', incoming.map(p => passRow(ctx, p, env, { actions: `<button class="btn btn-secondary btn-sm" data-arrived="${p.id}">${ico('user-round-check', 'w-3.5 h-3.5')} Arrived</button>` })), '') : '')
        + (scheduled.length ? listCard('Scheduled today', '', scheduled.map(p => passRow(ctx, p, env, { actions: `<button class="btn btn-ghost btn-sm" data-cancel-pass="${p.id}">Cancel</button>` })), '') : '');
    }
    refreshIcons();
    watchPasses(ctx, env, passes);
  };
  unsubs.push(onSnapshot(query(passCol(ctx), where('date', '==', todayISO())), snap => {
    passes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // New requests for me → chime + desktop alert (not on the first load).
    const mine = passes.filter(p => p.status === 'pending' && p.fromTeacherUid === ctx.me.uid).map(p => p.id);
    if (seen && ls(`ember_pass_sound:${ctx.me.uid}`) !== 'off') { const fresh = mine.filter(id => !seen.has(id)); if (fresh.length) { chime(); const p = passes.find(x => x.id === fresh[0]); desktopAlert(`${p.studentName} is asking for a pass`, toLabel(p)); } }
    seen = new Set(mine);
    if (live(t)) draw();
  }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  const id = setInterval(() => { if (live(t) && !document.querySelector('.ui-pop,[role=dialog]')) draw(); }, 15000); unsubs.push(() => clearInterval(id));
  startTicker();
  el.addEventListener('click', async e => {
    const pass = id2 => passes.find(p => p.id === id2);
    const ap = e.target.closest('[data-approve]');
    if (ap) return approve(ctx, env, passes, pass(ap.dataset.approve), ap);
    if (e.target.closest('[data-approve-all]')) { for (const p of passes.filter(x => x.status === 'pending' && x.fromTeacherUid === ctx.me.uid)) await approve(ctx, env, passes, p, null, true); return; }
    const dn = e.target.closest('[data-deny]');
    if (dn) { const p = pass(dn.dataset.deny); try { await updateDoc(passRef(ctx, p.id), { status: 'denied', deniedBy: ctx.me.uid, deniedByName: ctx.me.name, updatedAt: serverTimestamp() }); notify(ctx, { to: [p.studentUid], kind: 'pass', title: `Pass not approved: ${toLabel(p)}`, body: `${ctx.me.name} said not right now.`, link: `/${ctx.slug}/pass` }).catch(() => {}); toast('Request denied', 'info'); } catch (ex) { toast(friendlyError(ex), 'error'); } return; }
    const en = e.target.closest('[data-end],[data-arrived]');
    if (en) return endPass(ctx, pass(en.dataset.end || en.dataset.arrived), !!en.dataset.arrived);
    const ex = e.target.closest('[data-extend]');
    if (ex) { const p = pass(ex.dataset.extend); try { await updateDoc(passRef(ctx, p.id), { extraMinutes: (p.extraMinutes || 0) + 5, overdueNotified: false, comments: arrayUnion({ at: Date.now(), by: ctx.me.uid, byName: ctx.me.name, text: '+5 minutes' }), updatedAt: serverTimestamp() }); toast(`${p.studentName} has 5 more minutes`); } catch (er) { toast(friendlyError(er), 'error'); } return; }
    const sn = e.target.closest('[data-seen]');
    if (sn) return seenModal(ctx, pass(sn.dataset.seen));
    const cp = e.target.closest('[data-cancel-pass]');
    if (cp) { try { await updateDoc(passRef(ctx, cp.dataset.cancelPass), { status: 'cancelled', updatedAt: serverTimestamp() }); toast('Pass cancelled', 'info'); } catch (er) { toast(friendlyError(er), 'error'); } return; }
    if (e.target.closest('[data-sweep]')) return sweepModal(ctx);
    const mn = e.target.closest('[data-menu]');
    if (mn) return passMenu(ctx, env, pass(mn.dataset.menu), mn);
  });
}
async function approve(ctx, env, passes, p, btn, quiet = false) {
  const d = destOf(env.pol, p.destId);
  const rules = await teacherRules(ctx, p.fromTeacherUid);
  const mine = passes.filter(x => x.studentUid === p.studentUid && x.id !== p.id);
  const ev = evaluate({ pol: env.pol, rules, restrictions: env.restrictions, mine, dest: d, periods: env.periods, studentUid: p.studentUid, teacherName: p.fromTeacherName });
  const warns = [...ev.blocks.map(b => `${p.studentName}: ${b}`), ...staffChecks({ pol: env.pol, rules, keepApart: env.keepApart, passes, studentUid: p.studentUid, studentName: p.studentName, dest: d, fromTeacherUid: p.fromTeacherUid })];
  if (warns.length && !await confirmDialog({ title: quiet ? `Approve ${p.studentName} anyway?` : 'Approve anyway?', message: warns.join(' '), confirmLabel: 'Approve anyway', danger: true })) return;
  const run = async () => {
    try {
      await updateDoc(passRef(ctx, p.id), { status: 'active', startAt: serverTimestamp(), approvedBy: ctx.me.uid, approvedByName: ctx.me.name, ...(warns.length ? { overrides: warns } : {}), updatedAt: serverTimestamp() });
      notify(ctx, { to: [p.studentUid], kind: 'pass', title: `Pass approved: ${toLabel(p)}`, body: `You have ${ev.minutes} minutes. Show your pass if a staff member asks.`, link: `/${ctx.slug}/pass` }).catch(() => {});
      arrivalAlerts(ctx, p, d); frequentCheck(ctx, env, passes, p);
      if (!quiet) toast(`${p.studentName} is out`);
    } catch (ex) { toast(friendlyError(ex), 'error'); }
  };
  return btn ? withBusy(btn, '…', run) : run();
}
async function endPass(ctx, p, arrived) {
  try {
    await updateDoc(passRef(ctx, p.id), { status: 'ended', endAt: serverTimestamp(), endedBy: ctx.me.uid, ...(arrived ? { arrivedAt: serverTimestamp() } : {}), updatedAt: serverTimestamp() });
    // Late passes: record a tardy for the class the student arrived in.
    if (arrived && p.type === 'late' && p.recordTardy && p.destCourseId) setDoc(doc(db, 'tenants', ctx.slug, 'attendance', `${p.date}_${p.destCourseId}_${p.studentUid}`), { date: p.date, courseId: p.destCourseId, courseTitle: p.destCourseTitle || '', studentUid: p.studentUid, studentName: p.studentName, code: 'T', note: `Late pass from ${p.createdByName || 'office'}`, takenBy: ctx.me.uid, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
    toast(arrived ? `${p.studentName} arrived` : 'Pass ended');
  } catch (ex) { toast(friendlyError(ex), 'error'); }
}
function arrivalAlerts(ctx, p, d) {
  if (p.destTeacherUid && p.destTeacherUid !== ctx.me.uid) notify(ctx, { to: [p.destTeacherUid], kind: 'pass', title: `${p.studentName} is on the way to you`, body: `From ${p.fromTitle || 'class'}${p.fromTeacherName ? ' · ' + p.fromTeacherName : ''}`, link: `/${ctx.slug}/pass` }).catch(() => {});
  if (d?.alert) officeStaffUids(ctx, d.alert === 'admin' ? null : d.alert).then(to => notify(ctx, { to, kind: 'pass', title: `${p.studentName} is headed to the ${d.name.toLowerCase()}`, body: `From ${p.fromTitle || 'class'}${p.note ? ' · ' + p.note : ''}`, link: `/${ctx.slug}/pass/hall` })).catch(() => {});
}
function frequentCheck(ctx, env, passes, p) {
  const n = env.pol.eff.frequentAlert; if (!n) return;
  const today = passes.filter(x => x.studentUid === p.studentUid && counts(x) && x.id !== p.id).length + 1;
  if (today === n) officeStaffUids(ctx).then(to => notify(ctx, { to, kind: 'pass', title: `${p.studentName} has used ${n} passes today`, body: `Latest: ${toLabel(p)}`, link: `/${ctx.slug}/pass/history` })).catch(() => {});
}
// Escalation: at the limit tell the teacher; after the school's grace tell administrators; then auto-end if set.
const flagged = new Set();
function watchPasses(ctx, env, passes) {
  const eff = env.pol.eff;
  passes.filter(p => isOverdue(p) && (p.fromTeacherUid === ctx.me.uid || p.createdBy === ctx.me.uid || ctx.isAdmin)).forEach(p => {
    const over = overBy(p) / 60;
    if (!p.overdueNotified && !flagged.has(p.id + 'o') && (p.fromTeacherUid === ctx.me.uid || p.createdBy === ctx.me.uid)) {
      flagged.add(p.id + 'o'); updateDoc(passRef(ctx, p.id), { overdueNotified: true }).catch(() => {});
      if (p.fromTeacherUid && p.fromTeacherUid !== ctx.me.uid) notify(ctx, { to: [p.fromTeacherUid], kind: 'pass', title: `${p.studentName} is overdue`, body: `${toLabel(p)} · out since ${fmtTime(p.startAt)}`, link: `/${ctx.slug}/pass` }).catch(() => {});
      if (!eff.escalateAfter) officeStaffUids(ctx).then(to => notify(ctx, { to, kind: 'pass', title: `${p.studentName} is overdue`, body: `${toLabel(p)} · out since ${fmtTime(p.startAt)} (limit ${(p.minutes || 5) + (p.extraMinutes || 0)} min)`, link: `/${ctx.slug}/pass/hall` })).catch(() => {});
    }
    if (eff.escalateAfter && over >= eff.escalateAfter && !p.escalated && !flagged.has(p.id + 'e')) {
      flagged.add(p.id + 'e'); updateDoc(passRef(ctx, p.id), { escalated: true }).catch(() => {});
      officeStaffUids(ctx).then(to => notify(ctx, { to: [...to, p.fromTeacherUid].filter(Boolean), kind: 'pass', title: `${p.studentName} is ${Math.round(over)} min overdue`, body: `${toLabel(p)} · out since ${fmtTime(p.startAt)}`, link: `/${ctx.slug}/pass/hall` })).catch(() => {});
    }
    if (eff.autoEndAfter && over >= eff.autoEndAfter && !flagged.has(p.id + 'a')) {
      flagged.add(p.id + 'a'); updateDoc(passRef(ctx, p.id), { status: 'ended', endAt: serverTimestamp(), endedBy: 'auto', autoEnded: true, updatedAt: serverTimestamp() }).catch(() => {});
    }
  });
}
function passMenu(ctx, env, p) {
  const m = openModal({ size: 'sm', html: modalHeader({ title: p.studentName, subtitle: `${toLabel(p)} · left ${fmtTime(p.startAt)}`, icon: destOf(env.pol, p.destId).icon || 'ticket' }) + modalBody(`
    <div class="grid grid-cols-2 gap-2">
      <button class="btn btn-secondary" data-a="extend">${ico('timer', 'w-4 h-4')} +5 minutes</button><button class="btn btn-secondary" data-a="seen">${ico('eye', 'w-4 h-4')} Seen in hall</button>
      <button class="btn btn-secondary" data-a="print">${ico('printer', 'w-4 h-4')} Print pass</button><button class="btn btn-secondary" data-a="end">${ico('circle-stop', 'w-4 h-4')} End pass</button>
    </div>
    <label class="label mt-5" for="pm-note">Add a note</label><div class="flex gap-2"><input id="pm-note" class="input" maxlength="140" placeholder="e.g. With the nurse — will be late back"><button class="btn btn-primary" data-a="note">Add</button></div>
    ${(p.comments || []).length || (p.checkins || []).length ? `<div class="mt-5 space-y-2">${[...(p.comments || []).map(c => ({ ...c, kind: 'note' })), ...(p.checkins || []).map(c => ({ ...c, kind: 'seen' }))].sort((a, b) => a.at - b.at).map(c => `<div class="text-xs text-gray-400 flex gap-2">${ico(c.kind === 'seen' ? 'eye' : 'message-square', 'w-3.5 h-3.5 shrink-0 mt-0.5')}<span><span class="text-gray-200">${escapeHtml(c.byName || '')}</span> · ${escapeHtml(new Date(c.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))} — ${escapeHtml(c.kind === 'seen' ? 'seen ' + (c.where || '') : c.text)}</span></div>`).join('')}</div>` : ''}`) });
  m.el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    try {
      if (a === 'extend') { await updateDoc(passRef(ctx, p.id), { extraMinutes: (p.extraMinutes || 0) + 5, overdueNotified: false, comments: arrayUnion({ at: Date.now(), by: ctx.me.uid, byName: ctx.me.name, text: '+5 minutes' }) }); toast('5 more minutes'); m.close(); }
      if (a === 'seen') { await updateDoc(passRef(ctx, p.id), { checkins: arrayUnion({ at: Date.now(), by: ctx.me.uid, byName: ctx.me.name, where: 'Hallway' }) }); toast('Check-in recorded'); m.close(); }
      if (a === 'print') printPass(ctx, p, env.pol);
      if (a === 'end') { m.close(); endPass(ctx, p, false); }
      if (a === 'note') { const v = m.$('#pm-note').value.trim(); if (!v) return m.$('#pm-note').focus(); await updateDoc(passRef(ctx, p.id), { comments: arrayUnion({ at: Date.now(), by: ctx.me.uid, byName: ctx.me.name, text: v.slice(0, 140) }) }); toast('Note added'); m.close(); }
    } catch (ex) { toast(friendlyError(ex), 'error'); }
  });
  refreshIcons();
}
// Quick "I saw this student" check-in: pick a spot (or type one).
function seenModal(ctx, p) {
  const spots = ['Hallway', 'Restroom', 'Stairwell', 'Cafeteria', 'Library', 'Front office', 'Outside'];
  const m = openModal({ size: 'sm', html: modalHeader({ title: `Where did you see ${escapeHtml(p.studentName)}?`, icon: 'eye' }) + `<form novalidate>${modalBody(`<div class="flex flex-wrap gap-2 mb-4">${spots.map(x => `<button type="button" class="pill-btn" data-spot="${x}">${escapeHtml(x)}</button>`).join('')}</div><label class="label" for="sn-where">Or type it</label><input id="sn-where" class="input" maxlength="60" placeholder="e.g. B hallway by the gym">`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">Record</button>`)}</form>` });
  const save = async where => {
    if (!where) return m.$('#sn-where').focus();
    try { await updateDoc(passRef(ctx, p.id), { checkins: arrayUnion({ at: Date.now(), by: ctx.me.uid, byName: ctx.me.name, where: where.slice(0, 60) }) }); m.close(); toast('Check-in recorded'); } catch (er) { toast(friendlyError(er), 'error'); }
  };
  m.el.addEventListener('click', e => { const b = e.target.closest('[data-spot]'); if (b) save(b.dataset.spot); });
  m.$('form').addEventListener('submit', e => { e.preventDefault(); save(m.$('#sn-where').value.trim()); });
  refreshIcons();
}
async function sweepModal(ctx) {
  const F = await forms();
  const students = (await getDocs(collection(db, 'tenants', ctx.slug, 'students'))).docs.map(d => ({ uid: d.id, ...d.data() })).filter(s => s.status !== 'pending' && s.status !== 'rejected');
  F.formModal({ title: 'Student without a pass', subtitle: 'Logs it for the office. Administrators are notified.', icon: 'user-x', submit: 'Log it', env: { students },
    form: { sections: [{ fields: [{ id: 'students', type: 'students', label: 'Student (if you know)' }, { id: 'where', type: 'text', label: 'Where', required: true, placeholder: 'e.g. B hallway by the gym' }, { id: 'action', type: 'select', label: 'What you did', options: ['Sent back to class', 'Walked to the office', 'Called the office', 'Student left before I could help'] }, { id: 'note', type: 'text', label: 'Note', span: 'sm:col-span-2' }] }] },
    onSubmit: async d => {
      const st = (d.students || [])[0];
      await addDoc(collection(db, 'tenants', ctx.slug, 'hallSweeps'), { date: todayISO(), at: Date.now(), studentUid: st?.uid || '', studentName: st?.name || '', where: d.where, action: d.action || '', note: d.note || '', by: ctx.me.uid, byName: ctx.me.name, createdAt: serverTimestamp() });
      officeStaffUids(ctx).then(to => notify(ctx, { to, kind: 'pass', title: `${st?.name || 'A student'} was in the hall without a pass`, body: `${d.where}${d.action ? ' · ' + d.action : ''} · ${ctx.me.name}`, link: `/${ctx.slug}/pass/hall` })).catch(() => {});
      toast('Logged'); return true;
    } });
}

// ── New pass (staff): standard, late, check-out, appointment, group ──
async function newPassModal(ctx, env) {
  const F = await forms();
  const students = (await getDocs(collection(db, 'tenants', ctx.slug, 'students'))).docs.map(d => ({ uid: d.id, ...d.data() })).filter(s => s.status !== 'pending' && s.status !== 'rejected').sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
  const cur = currentCourse(env.courses, env.periods) || env.courses[0];
  const dests = enabledDests(env.pol);
  const tplKey = `ember_pass_tpl:${ctx.me.uid}`;
  const templates = (() => { try { return JSON.parse(ls(tplKey) || '[]'); } catch { return []; } })();
  const allCourses = (await getDocs(collection(db, 'tenants', ctx.slug, 'courses')).catch(() => ({ docs: [] }))).docs.map(d => ({ id: d.id, ...d.data() }));
  const form = { sections: [{ fields: [
    { id: 'type', type: 'chips', label: 'Kind of pass', required: true, options: [{ v: 'standard', l: 'Pass' }, { v: 'late', l: 'Late pass' }, { v: 'appointment', l: 'Request a student' }, { v: 'checkout', l: 'Early check-out' }] },
    { id: 'students', type: 'students', label: 'Student(s)', required: true },
    { id: 'together', type: 'yesno', label: 'Traveling together as a group?', showIf: { id: 'type', eq: 'standard' } },
    { id: 'dest', type: 'select', label: 'Going to', required: true, options: dests.map(d => ({ v: d.id, l: d.name })), showIf: { id: 'type', in: ['standard', 'appointment'] } },
    { id: 'toTeacher', type: 'select', label: 'Teacher', options: env.staff.filter(s => s.uid !== ctx.me.uid).map(s => ({ v: s.uid, l: displayNameOf(s) })), showIf: { id: 'dest', eq: 'room' } },
    { id: 'other', type: 'text', label: 'Where?', showIf: { id: 'dest', eq: 'other' } },
    { id: 'lateCourse', type: 'select', label: 'Class they’re late to', required: true, options: allCourses.map(c => ({ v: c.id, l: `${c.title || 'Class'}${c.ownerName ? ' · ' + c.ownerName : ''}` })), showIf: { id: 'type', eq: 'late' } },
    { id: 'lateReason', type: 'select', label: 'Reason', options: ['Excused — office', 'Excused — nurse', 'Excused — counselor', 'Bus late', 'Unexcused'], showIf: { id: 'type', eq: 'late' } },
    { id: 'recordTardy', type: 'yesno', label: 'Record a tardy when they arrive?', showIf: { id: 'type', eq: 'late' } },
    { id: 'from', type: 'select', label: 'From class', options: env.courses.map(c => ({ v: c.id, l: `${c.title || 'Class'}${c.room ? ' · Rm ' + c.room : ''}` })), showIf: { id: 'type', eq: 'standard' } },
    { id: 'minutes', type: 'number', label: 'Minutes', min: 1, maxN: 120, hint: 'Blank = the usual time.' },
    { id: 'when', type: 'chips', label: 'When', required: true, options: ['Now', 'Later today'], showIf: { id: 'type', in: ['standard', 'appointment', 'checkout'] } },
    { id: 'at', type: 'time', label: 'At', required: true, showIf: { id: 'when', eq: 'Later today' } },
    { id: 'note', type: 'text', label: 'Note', span: 'sm:col-span-2', placeholder: 'e.g. Bring your planner' },
    { id: 'saveTpl', type: 'text', label: 'Save as a template (name)', placeholder: 'Optional — e.g. “Library research”', showIf: { id: 'type', eq: 'standard' } },
  ] }] };
  const data = { type: 'standard', when: 'Now', from: cur?.id || '', dest: dests[0]?.id, recordTardy: 'Yes', together: 'No' };
  const m = F.formModal({ title: 'New pass', subtitle: 'Pass, late pass, request a student, or early check-out.', icon: 'ticket', form, env: { students }, data, submit: 'Send', onSubmit: async v => {
    const today = await getDocs(query(passCol(ctx), where('date', '==', todayISO()))).then(s => s.docs.map(x => ({ id: x.id, ...x.data() })));
    const type = v.type, scheduledFor = v.when === 'Later today' ? `${todayISO()}T${v.at}` : '';
    let d = type === 'late' ? { id: 'late', name: 'Class (late pass)', icon: 'alarm-clock', minutes: 5 } : type === 'checkout' ? destOf(env.pol, 'office') : destOf(env.pol, v.dest);
    const from = env.courses.find(c => c.id === v.from), toT = env.staff.find(s => s.uid === v.toTeacher), lateC = allCourses.find(c => c.id === v.lateCourse);
    if (type === 'standard' && !scheduledFor) {
      const warns = v.students.flatMap(s => staffChecks({ pol: env.pol, rules: env.myRules, keepApart: env.keepApart, passes: today, studentUid: s.uid, studentName: s.name, dest: d, fromTeacherUid: from?.ownerUid || ctx.me.uid }));
      const restr = v.students.flatMap(s => activeRestrictions(env.restrictions, s.uid).map(r => `${s.name}: ${r.mode === 'none' ? 'no passes' : r.mode === 'only' ? 'limited destinations' : 'needs approval'}${r.reason ? ' (' + r.reason + ')' : ''}.`));
      if ((warns.length || restr.length) && !await confirmDialog({ title: 'Send anyway?', message: [...new Set([...warns, ...restr])].join(' '), confirmLabel: 'Send anyway', danger: true })) return false;
    }
    const groupId = type === 'standard' && v.together === 'Yes' && v.students.length > 1 ? 'g' + Date.now().toString(36) : '';
    for (const s of v.students) {
      const st = students.find(x => x.uid === s.uid) || {};
      // Where the student is right now (for late/appointment/check-out passes the student's current teacher must know).
      const curC = type === 'standard' ? from : (st.enrolledCourseIds ? allCourses.filter(c => st.enrolledCourseIds.includes(c.id)) : []).find(c => env.periods.some(p => p.id === c.periodId && p.start <= nowHM() && nowHM() <= p.end)) || null;
      const p = {
        studentUid: s.uid, studentName: s.name, date: todayISO(), createdBy: ctx.me.uid, createdByName: ctx.me.name, createdByRole: 'staff', type: groupId ? 'group' : type, ...(groupId ? { groupId } : {}),
        fromCourseId: curC?.id || '', fromTitle: type === 'late' ? 'Front office' : curC?.title || '', fromTeacherUid: type === 'late' ? '' : (curC?.ownerUid || (type === 'standard' ? ctx.me.uid : '')), fromTeacherName: type === 'late' ? '' : (curC?.ownerName || (type === 'standard' ? ctx.me.name : '')), fromRoom: curC?.room || '',
        destId: d.id, destName: type === 'late' ? (lateC?.title || 'Class') : type === 'checkout' ? 'Front office — early check-out' : d.name, destKind: d.kind || '',
        destTeacherUid: type === 'late' ? (lateC?.ownerUid || '') : type === 'appointment' ? ctx.me.uid : (toT?.uid || ''), destTeacherName: type === 'late' ? (lateC?.ownerName || '') : type === 'appointment' ? ctx.me.name : (toT ? displayNameOf(toT) : ''), destRoom: type === 'late' ? (lateC?.room || '') : '', destOther: v.other || '',
        ...(type === 'late' ? { destCourseId: lateC?.id || '', destCourseTitle: lateC?.title || '', recordTardy: v.recordTardy === 'Yes', lateReason: v.lateReason || '' } : {}),
        note: [v.lateReason && type === 'late' ? v.lateReason : '', v.note].filter(Boolean).join(' · '), minutes: Number(v.minutes) || d.minutes || 5,
        status: type === 'appointment' && !scheduledFor ? 'pending' : scheduledFor ? 'scheduled' : 'active', scheduledFor,
        ...(type === 'appointment' ? {} : { approvedBy: ctx.me.uid, approvedByName: ctx.me.name }),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...(!scheduledFor && type !== 'appointment' ? { startAt: serverTimestamp() } : {}),
      };
      const ref = await addDoc(passCol(ctx), p);
      const label = type === 'late' ? `Late pass to ${p.destName}` : type === 'checkout' ? 'Early check-out at the front office' : toLabel(p);
      notify(ctx, { to: [s.uid], kind: 'pass', title: scheduledFor ? `${label} at ${new Date(scheduledFor).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : type === 'appointment' ? `${ctx.me.name} is asking for you` : `You have a pass: ${label}`, body: p.note || `From ${ctx.me.name}`, link: `/${ctx.slug}/pass` }).catch(() => {});
      if (['appointment', 'checkout'].includes(type) && p.fromTeacherUid) notify(ctx, { to: [p.fromTeacherUid], kind: 'pass', title: type === 'appointment' ? `${ctx.me.name} is asking for ${s.name}` : `${s.name} has an early check-out${scheduledFor ? ' at ' + new Date(scheduledFor).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}`, body: type === 'appointment' ? 'Send them from Ember Pass when it’s a good time.' : 'Please send them to the front office.', link: `/${ctx.slug}/pass` }).catch(() => {});
      if (p.status === 'active') { arrivalAlerts(ctx, { ...p, id: ref.id }, d); frequentCheck(ctx, env, today, { ...p, id: ref.id }); }
    }
    if (v.saveTpl && type === 'standard') { templates.unshift({ name: v.saveTpl, dest: v.dest, minutes: v.minutes || '', note: v.note || '', toTeacher: v.toTeacher || '' }); ls(tplKey, JSON.stringify(templates.slice(0, 8))); }
    toast(`${plural(v.students.length, 'pass', 'passes')} sent`); return true;
  } });
  // Templates: one click fills the form.
  if (templates.length) {
    const bar = document.createElement('div'); bar.className = 'flex flex-wrap items-center gap-2 mb-4';
    bar.innerHTML = `<span class="text-xs text-gray-500">${ico('bookmark', 'w-3.5 h-3.5 inline -mt-0.5')} Templates:</span>${templates.map((tp, i) => `<button type="button" class="pill-btn" data-tpl="${i}">${escapeHtml(tp.name)}</button>`).join('')}`;
    m.$('[data-sections]').prepend(bar); refreshIcons();
    bar.addEventListener('click', e => { const b = e.target.closest('[data-tpl]'); if (!b) return; const tp = templates[+b.dataset.tpl]; const set = (id, val) => { const el2 = m.$(`[data-input="${id}"]`); if (el2 && val !== undefined) { el2.value = val; el2.dispatchEvent(new Event('change', { bubbles: true })); } }; set('dest', tp.dest); set('minutes', tp.minutes); set('note', tp.note); set('toTeacher', tp.toTeacher); toast(`Template “${tp.name}” applied`, 'info'); });
  }
}

// ═══════════════════════════════════════════════════════════════
// KIOSK — /emberlms/kiosk on a classroom device.
// The device signs in with its own kiosk-only login (kiosks/{uid}), never the teacher's account, so a
// student who leaves the kiosk screen can't reach anything else: every other page sends a kiosk login
// back here, and the security rules only let it read that teacher's rosters and start/end passes after
// the student's ID is checked on the server. Leaving the kiosk needs the teacher's password.
// ═══════════════════════════════════════════════════════════════
const KIOSK_DEV = 'ember_kiosk_device';
const readDev = () => { try { return JSON.parse(ls(KIOSK_DEV) || 'null'); } catch { return null; } };
const isKioskEmail = e => /@kiosk\.emberlms\.local$/i.test(e || '');
const randStr = (n, set = 'abcdefghjkmnpqrstuvwxyz23456789') => Array.from(crypto.getRandomValues(new Uint32Array(n)), x => set[x % set.length]).join('');
const goFullscreen = () => { try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch (e) {} };
const leaveFullscreen = () => { try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {} };
const deviceLabel = () => { const u = navigator.userAgent; const kind = /CrOS/.test(u) ? 'Chromebook' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android tablet' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows PC' : 'Device'; return `${kind} · set up ${new Date().toLocaleDateString()}`; };
const kioskCard = (inner) => `<div class="kiosk kiosk-center"><div class="kiosk-card"><div class="flex items-center gap-3 mb-6">${ico('flame', 'w-8 h-8 text-[#F59E0B]')}<div><div class="text-[11px] uppercase tracking-[0.18em] text-[#F59E0B]">Ember Pass</div><div class="text-white text-lg">Kiosk</div></div></div>${inner}</div></div>`;
// The schools where this signed-in person is staff.
async function staffSchools(user) {
  const set = new Set([new URLSearchParams(location.search).get('school'), ls(`ember_last_tenant:${user.uid}`)].filter(Boolean));
  try { ((await getDoc(doc(db, 'userIndex', user.uid))).data()?.tenants || []).forEach(x => set.add(x)); } catch (e) {}
  const out = [];
  for (const slug of set) {
    try { const u = await getDoc(doc(db, 'tenants', slug, 'users', user.uid)); if (u.exists()) { const tn = await globalThis.__ember.getTenant(slug).catch(() => null); out.push({ slug, name: tn?.name || slug, me: u.data() }); } } catch (e) {}
  }
  return out;
}

export async function viewKiosk() {
  const t = routeTokenNow();
  const E = globalThis.__ember, user = E.auth.currentUser, dev = readDev(), params = new URLSearchParams(location.search);
  setTitle('Ember Pass kiosk');
  document.body.classList.remove('kiosk-on');
  // 1. Signed in as a kiosk device → run it.
  if (user && isKioskEmail(user.email)) {
    const k = await getDoc(doc(db, 'kiosks', user.uid)).catch(() => null);
    if (!live(t)) return;
    if (!k?.exists()) {
      render(kioskCard(`<h1 class="font-serif text-3xl text-white mb-2">This kiosk was turned off</h1><p class="text-sm text-gray-400 mb-6">The teacher removed this device. A teacher can set it up again.</p><button class="btn btn-primary btn-block py-3" id="kz-reset">${ico('rotate-ccw', 'w-4 h-4')} Set up again</button>`));
      refreshIcons();
      $('#kz-reset').addEventListener('click', async () => { ls(KIOSK_DEV, ''); await E.signOut(E.auth); navigate('/kiosk', { replace: true }); });
      return;
    }
    return runKiosk({ ...k.data(), kioskId: user.uid }, t);
  }
  // 2. A teacher just left the kiosk with their password → back to Ember Pass.
  const exitTo = sessionStorage.getItem('ember_kiosk_exit');
  if (user && exitTo) { sessionStorage.removeItem('ember_kiosk_exit'); return navigate(`/${exitTo}/pass`, { replace: true }); }
  // 3. This device is already a kiosk → sign it in (automatically, or with one tap when a teacher is signed in).
  if (dev && (!user || params.get('start') === '1')) return startKiosk(dev, t);
  if (dev && user) {
    render(kioskCard(`<h1 class="font-serif text-3xl text-white mb-2">${escapeHtml(dev.teacherName || 'Teacher')}’s kiosk</h1><p class="text-sm text-gray-400 mb-6">This device is set up as an Ember Pass kiosk. Starting it signs you out here — to leave the kiosk later, tap <b>Teacher</b> and enter your password.</p>
      <button class="btn btn-primary btn-block py-3" id="kz-start">${ico('play', 'w-4 h-4')} Start kiosk</button><button class="btn btn-ghost btn-block mt-2" id="kz-forget">${ico('trash-2', 'w-4 h-4')} Stop using this device as a kiosk</button>`));
    refreshIcons();
    $('#kz-start').addEventListener('click', () => { goFullscreen(); startKiosk(dev, t); });
    $('#kz-forget').addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Stop using this device as a kiosk?', confirmLabel: 'Remove', danger: true })) return;
      await deleteDoc(doc(db, 'kiosks', dev.kioskId)).catch(() => {}); ls(KIOSK_DEV, ''); toast('Kiosk removed from this device'); viewKiosk();
    });
    return;
  }
  // 4. Not set up yet: a teacher signs in and turns this device into their kiosk.
  if (!user) {
    render(kioskCard(`<h1 class="font-serif text-3xl text-white mb-2">Set up a kiosk</h1><p class="text-sm text-gray-400 mb-6">Students tap their name and type their student ID to get a hall pass. A teacher signs in once to set this device up — after that it opens straight into the kiosk, and students can't get into the teacher's account.</p>
      <button class="btn btn-primary btn-block py-3" id="kz-login">${ico('log-in', 'w-4 h-4')} Sign in as the teacher</button>`));
    refreshIcons();
    $('#kz-login').addEventListener('click', () => navigate(`/login?as=staff&next=${encodeURIComponent('/kiosk')}`));
    return;
  }
  render(kioskCard(skeletonRows(2, 'h-12')));
  const schools = await staffSchools(user);
  if (!live(t)) return;
  if (!schools.length) {
    render(kioskCard(`<h1 class="font-serif text-3xl text-white mb-2">Teachers only</h1><p class="text-sm text-gray-400 mb-6">Only a teacher can set up an Ember Pass kiosk. Sign in with a teacher account.</p><button class="btn btn-secondary btn-block" id="kz-out">${ico('log-out', 'w-4 h-4')} Switch account</button>`));
    refreshIcons(); $('#kz-out').addEventListener('click', async () => { await E.signOut(E.auth); navigate('/kiosk'); }); return;
  }
  const name = displayNameOf(schools[0].me) || user.displayName || 'Teacher';
  render(kioskCard(`<h1 class="font-serif text-3xl text-white mb-2">Make this device your kiosk</h1>
    <p class="text-sm text-gray-400 mb-5">This device gets its own kiosk login for <b class="text-white">${escapeHtml(name)}</b>'s classes. It can only show your class lists and start or end passes after a student types their ID. You'll be signed out here; to leave the kiosk, tap <b>Teacher</b> and enter your password.</p>
    ${schools.length > 1 ? `<label class="label" for="kz-school">School</label><select id="kz-school" class="input mb-5" data-icon="school">${schools.map(x => `<option value="${escapeHtml(x.slug)}">${escapeHtml(x.name)}</option>`).join('')}</select>` : `<p class="text-xs text-gray-500 mb-5">${ico('school', 'w-3.5 h-3.5 inline -mt-0.5')} ${escapeHtml(schools[0].name)}</p>`}
    <button class="btn btn-primary btn-block py-3" id="kz-setup">${ico('tablet-smartphone', 'w-4 h-4')} Start kiosk on this device</button><p class="form-error mt-3 hidden" id="kz-err"></p>`));
  refreshIcons();
  $('#kz-setup').addEventListener('click', e => {
    goFullscreen(); // needs the tap, so do it first
    const slug = $('#kz-school')?.value || schools[0].slug, sch = schools.find(x => x.slug === slug);
    withBusy(e.currentTarget, 'Setting up…', async () => {
      try {
        const email = `k${randStr(12)}@kiosk.emberlms.local`, password = randStr(28, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789');
        const kioskId = await E.createLogin(email, password);
        const teacherName = displayNameOf(sch.me) || name;
        await setDoc(doc(db, 'kiosks', kioskId), { slug, teacherUid: user.uid, teacherName, teacherEmail: user.email || '', label: deviceLabel(), createdAt: serverTimestamp() });
        const d = { slug, email, password, kioskId, teacherName, teacherEmail: user.email || '' };
        ls(KIOSK_DEV, JSON.stringify(d));
        await startKiosk(d, t);
      } catch (ex) { console.error(ex); showError($('#kz-err'), friendlyError(ex)); }
    });
  });
}
async function startKiosk(dev, t) {
  const E = globalThis.__ember;
  render(kioskCard(`<div class="text-center py-6">${ico('loader-circle', 'w-7 h-7 animate-spin mx-auto text-[#F59E0B]')}<p class="text-sm text-gray-400 mt-3">Starting the kiosk…</p></div>`)); refreshIcons();
  try { await E.signInWithEmailAndPassword(E.auth, dev.email, dev.password); if (live(t)) E.renderRoute(); } // the auth change re-renders /kiosk as the kiosk
  catch (ex) {
    console.error(ex);
    render(kioskCard(`<h1 class="font-serif text-3xl text-white mb-2">Couldn't start the kiosk</h1><p class="text-sm text-gray-400 mb-6">${escapeHtml(friendlyError(ex))} A teacher can set this device up again.</p><button class="btn btn-primary btn-block" id="kz-reset">${ico('rotate-ccw', 'w-4 h-4')} Set up again</button>`));
    refreshIcons(); $('#kz-reset').addEventListener('click', () => { ls(KIOSK_DEV, ''); viewKiosk(); });
  }
}

async function runKiosk(k, t) {
  const E = globalThis.__ember;
  const tenant = await E.getTenant(k.slug).catch(() => null);
  if (!live(t)) return;
  const ctx = { slug: k.slug, tenant: tenant || { name: '' }, me: { uid: k.kioskId, name: `${k.teacherName} (kiosk)` }, isKiosk: true, isAdmin: false };
  const [pol, courses, settings, myRules, restrictions, keepApart] = await Promise.all([
    loadPolicy(ctx), getDocs(query(collection(db, 'tenants', k.slug, 'courses'), where('ownerUid', '==', k.teacherUid))).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    (await sis()).getSettings(ctx).catch(() => null), teacherRules(ctx, k.teacherUid), loadRestrictions(ctx), loadKeepApart(ctx)]);
  if (!live(t)) return;
  setTitle(`Kiosk · ${k.teacherName}`, ctx.tenant.name);
  document.body.classList.add('kiosk-on');
  unsubs.push(() => document.body.classList.remove('kiosk-on'));
  const periods = settings?.periods || [];
  let course = currentCourse(courses, periods) || courses[0], roster = [], passes = [];
  render(`<div class="kiosk"><header class="kiosk-head"><div class="flex items-center gap-3">${ico('flame', 'w-8 h-8 text-[#F59E0B]')}<div><div class="text-[11px] uppercase tracking-[0.18em] text-[#F59E0B]">Ember Pass kiosk</div><div class="text-white text-lg">${escapeHtml(k.teacherName)}${ctx.tenant.name ? ` · <span class="text-gray-400">${escapeHtml(ctx.tenant.name)}</span>` : ''}</div></div></div>
      <div class="flex items-center gap-2">${courses.length > 1 ? `<select id="k-course" class="input !py-2 !w-auto" aria-label="Class" data-icon="book-open">${courses.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === course?.id ? 'selected' : ''}>${escapeHtml(c.title || 'Class')}</option>`).join('')}</select>` : `<span class="text-sm text-gray-300">${escapeHtml(course?.title || '')}</span>`}<button class="btn btn-ghost" id="k-teacher" title="Teacher">${ico('lock', 'w-4 h-4')} Teacher</button></div></header>
    <div class="kiosk-body"><div id="k-banner"></div><p class="text-center text-gray-400 mb-6">Tap your name and type your student ID to get a pass. Do the same when you’re back.</p><div id="k-grid" class="kiosk-grid">${skeletonRows(4, 'h-20')}</div></div>
    <button id="k-fs" class="kiosk-fs ${document.fullscreenElement ? 'hidden' : ''}" type="button">${ico('maximize', 'w-10 h-10 text-[#F59E0B] mx-auto mb-4')}<span class="block font-serif text-3xl text-white">Tap to start</span><span class="block text-sm text-gray-400 mt-2">Ember Pass kiosk · ${escapeHtml(k.teacherName)}</span></button></div>`);
  // Full screen: needs a tap, and comes back whenever someone presses Esc.
  const fs = $('#k-fs');
  fs.addEventListener('click', () => { goFullscreen(); fs.classList.add('hidden'); });
  const onFs = () => { if (!document.fullscreenElement && fs.isConnected) fs.classList.remove('hidden'); };
  document.addEventListener('fullscreenchange', onFs); unsubs.push(() => document.removeEventListener('fullscreenchange', onFs));
  const noMenu = e => e.preventDefault(); document.addEventListener('contextmenu', noMenu); unsubs.push(() => document.removeEventListener('contextmenu', noMenu));
  const banner = () => { const msg = pol.eff.frozen ? (pol.eff.freezeMessage || 'Passes are paused school-wide.') : myRules?.paused ? (myRules.pausedMessage || 'Passes are paused for this class.') : ''; $('#k-banner').innerHTML = msg ? `<div class="pass-banner is-paused mb-6">${ico('pause', 'w-5 h-5 shrink-0')}<div class="text-white">${escapeHtml(msg)}</div></div>` : ''; };
  banner();
  // Lockout after three wrong IDs (remembered on this device).
  const LOCK_KEY = `ember_kiosk_locks:${k.slug}`;
  const locks = (() => { try { return JSON.parse(ls(LOCK_KEY) || '{}'); } catch { return {}; } })();
  const lockedFor = uid => Math.max(0, (locks[uid] || 0) - Date.now());
  const saveLocks = () => ls(LOCK_KEY, JSON.stringify(Object.fromEntries(Object.entries(locks).filter(([, v]) => v > Date.now()))));
  const loadRoster = async () => {
    roster = course ? (await getDocs(collection(db, 'tenants', k.slug, 'courses', course.id, 'enrollments')).catch(() => ({ docs: [] }))).docs.map(d => ({ uid: d.id, name: d.data().studentName || d.data().username || 'Student' })).sort((a, b) => a.name.localeCompare(b.name)) : [];
    draw();
  };
  const draw = () => {
    const g = $('#k-grid'); if (!g) return;
    g.innerHTML = roster.length ? roster.map(s => { const p = passes.find(x => x.studentUid === s.uid && x.status === 'active'), lock = lockedFor(s.uid); return `<button class="kiosk-tile ${p ? 'is-out' : ''} ${p && isOverdue(p) ? 'is-late' : ''} ${lock ? 'is-locked' : ''}" data-k="${escapeHtml(s.uid)}">${avatar(s.name, null, 'w-12 h-12', 'text-base')}<span class="text-white text-base mt-2 text-center leading-tight">${escapeHtml(s.name)}</span>${lock ? `<span class="text-xs text-[#f08a8a] mt-1 flex items-center gap-1">${ico('lock', 'w-3.5 h-3.5')} Locked · ask your teacher</span>` : p ? `<span class="text-xs mt-1 flex items-center gap-1">${ico(destOf(pol, p.destId).icon, 'w-3.5 h-3.5')} ${escapeHtml(toLabel(p))} · ${timerHTML(p)}</span>` : `<span class="text-xs text-gray-500 mt-1">In class</span>`}</button>`; }).join('')
      : emptyState({ icon: 'users', title: courses.length ? 'No students in this class' : 'No classes yet', text: courses.length ? '' : `${k.teacherName} doesn't have any classes in Ember yet.` });
    refreshIcons();
  };
  unsubs.push(onSnapshot(query(passCol(ctx), where('date', '==', todayISO())), snap => { passes = snap.docs.map(d => ({ id: d.id, ...d.data() })); if (live(t)) draw(); }, e => console.warn(e)));
  startTicker();
  const lockTick = setInterval(() => { if (Object.values(locks).some(v => v && v <= Date.now() + 1500)) draw(); }, 5000); unsubs.push(() => clearInterval(lockTick));
  $('#k-course')?.addEventListener('change', e => { course = courses.find(c => c.id === e.target.value); loadRoster(); });
  // Teacher: password to leave the kiosk (or to switch it off).
  $('#k-teacher').addEventListener('click', () => {
    const m = openModal({ size: 'sm', html: modalHeader({ title: 'Teacher', subtitle: 'Enter your password to leave the kiosk.', icon: 'lock' }) + `<form novalidate>${modalBody(`
      <label class="label" for="kt-email">Email</label><input id="kt-email" type="email" class="input mb-4" autocomplete="off" value="${escapeHtml(k.teacherEmail || '')}">
      <label class="label" for="kt-pass">Password</label><input id="kt-pass" type="password" class="input" autocomplete="off"><p class="form-error mt-3 hidden" id="kt-err"></p>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">Leave kiosk</button>`)}</form>` });
    const idle = setTimeout(() => m.close(), 60000);
    setTimeout(() => (k.teacherEmail ? m.$('#kt-pass') : m.$('#kt-email')).focus(), 50);
    m.$('form').addEventListener('submit', e => {
      e.preventDefault();
      const email = m.$('#kt-email').value.trim(), pw = m.$('#kt-pass').value, err = m.$('#kt-err');
      if (!email || !pw) return showError(err, 'Enter your email and password.');
      withBusy(e.submitter || m.$('[type=submit]'), 'Checking…', async () => {
        try {
          // Check the password on a separate sign-in first, so the kiosk session is only replaced by a teacher.
          const cred = await E.signInWithEmailAndPassword(E.secondaryAuth, email, pw);
          const staff = await getDoc(doc(E.secondaryDb, 'tenants', k.slug, 'users', cred.user.uid)).catch(() => null);
          await E.signOut(E.secondaryAuth).catch(() => {});
          if (!staff?.exists()) return showError(err, 'Only a teacher at this school can leave the kiosk.');
          clearTimeout(idle); leaveFullscreen();
          sessionStorage.setItem('ember_kiosk_exit', k.slug);
          await E.signInWithEmailAndPassword(E.auth, email, pw); // the auth change sends the teacher to Ember Pass
        } catch (ex) { sessionStorage.removeItem('ember_kiosk_exit'); showError(err, ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(ex.code) ? 'That email or password isn’t right.' : friendlyError(ex)); }
      });
    });
    refreshIcons();
  });
  // Keypad. The server checks the ID (kioskChecks) — this device never sees anyone's student ID.
  const verify = (s, p) => new Promise(resolve => {
    let entry = '', tries = 0, done = false, busy = false;
    const m = openModal({ size: 'sm', html: modalHeader({ title: `${p ? 'Welcome back' : 'Hi'}, ${escapeHtml(s.name.split(' ')[0])}`, subtitle: `Type your student ID to ${p ? 'end your pass' : 'get a pass'}.`, icon: 'id-card' }) + modalBody(`
      <div class="kp-display" id="kp-show" aria-live="polite" aria-label="Student ID entered">&nbsp;</div>
      <p class="text-xs text-center mt-2 min-h-[1.1rem]" id="kp-msg"></p>
      <div class="kp-grid">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map(x => `<button type="button" class="kp-key ${x === 'ok' ? '!bg-[#F59E0B] !text-black font-semibold' : ''}" data-kp="${x}" aria-label="${x === 'del' ? 'Delete' : x === 'ok' ? 'Enter' : x}">${x === 'del' ? ico('delete', 'w-5 h-5 mx-auto') : x === 'ok' ? ico('check', 'w-5 h-5 mx-auto') : x}</button>`).join('')}</div>
      <p class="text-[11px] text-gray-500 text-center mt-3">Don't have a student ID yet? Ask your teacher for a pass.</p>`) });
    const show = () => { m.$('#kp-show').textContent = entry ? (entry.length > 4 ? `${entry.slice(0, 4)}-${entry.slice(4)}` : entry) : ' '; };
    const finish = ok => { if (done) return; done = true; clearTimeout(idle); m.close(); resolve(ok); };
    let idle = setTimeout(() => finish(null), 45000);
    const submit = async () => {
      if (!entry || busy) return;
      busy = true; m.$('#kp-msg').textContent = 'Checking…';
      const checkId = p ? `${p.id}_e${randStr(6)}` : doc(passCol(ctx)).id;
      try {
        await setDoc(doc(db, 'tenants', k.slug, 'kioskChecks', checkId), { studentUid: s.uid, code: entry, kiosk: k.kioskId, at: serverTimestamp(), ...(p ? { pass: p.id } : {}) });
        return finish(checkId);
      } catch (ex) {
        busy = false;
        if (ex.code !== 'permission-denied') { m.$('#kp-msg').innerHTML = `<span class="text-[#f08a8a]">${escapeHtml(friendlyError(ex))}</span>`; return; }
      }
      tries++; entry = ''; show();
      const box = m.$('#kp-show'); box.classList.remove('is-wrong'); void box.offsetWidth; box.classList.add('is-wrong');
      if (tries >= 3) { locks[s.uid] = Date.now() + 2 * 60000; saveLocks(); draw(); toast(`${s.name.split(' ')[0]} is locked for 2 minutes`, 'error'); return finish(null); }
      m.$('#kp-msg').innerHTML = `<span class="text-[#f08a8a]">That's not your ID. ${3 - tries} ${3 - tries === 1 ? 'try' : 'tries'} left.</span>`;
    };
    const press = x => { clearTimeout(idle); idle = setTimeout(() => finish(null), 45000); if (busy) return; if (x === 'del') entry = entry.slice(0, -1); else if (x === 'ok') return submit(); else if (entry.length < 12) entry += x; show(); };
    m.el.addEventListener('click', e => { const b = e.target.closest('[data-kp]'); if (b) press(b.dataset.kp); });
    m.el.addEventListener('keydown', e => { if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); press('del'); } else if (e.key === 'Enter') { e.preventDefault(); press('ok'); } });
    const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (!done) { done = true; clearTimeout(idle); resolve(null); } } }); obs.observe(document.body, { childList: true, subtree: true });
    // No text box on the keypad, so tablets never pop up their own keyboard; the dialog itself takes focus
    // (a physical keyboard still works through the keydown handler).
    const box = m.el.querySelector('[role=dialog]') || m.el; box.setAttribute('tabindex', '-1');
    refreshIcons(); setTimeout(() => { document.activeElement?.blur?.(); box.focus({ preventScroll: true }); }, 50);
  });
  $('#k-grid').addEventListener('click', async e => {
    const tile = e.target.closest('[data-k]'); if (!tile) return;
    if (!document.fullscreenElement) goFullscreen();
    const s = roster.find(x => x.uid === tile.dataset.k);
    if (lockedFor(s.uid)) return toast(`Too many wrong tries. Try again in ${Math.ceil(lockedFor(s.uid) / 60000)} min or ask your teacher.`, 'error');
    const p0 = passes.find(x => x.studentUid === s.uid && x.status === 'active');
    const checkId = await verify(s, p0);
    if (!checkId) return;
    if (p0) {
      try { await updateDoc(passRef(ctx, p0.id), { status: 'ended', endAt: serverTimestamp(), endedBy: k.kioskId, endCheck: checkId, updatedAt: serverTimestamp() }); toast(`Welcome back, ${s.name.split(' ')[0]}`); }
      catch (ex) { toast(friendlyError(ex), 'error'); }
      return;
    }
    const mine = passes.filter(x => x.studentUid === s.uid);
    const m = openModal({ size: 'lg', html: modalHeader({ title: `Hi ${escapeHtml(s.name.split(' ')[0])} — where are you going?`, icon: 'ticket' }) + modalBody(`<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">${enabledDests(pol).filter(d => d.kind !== 'room' && d.kind !== 'other').map(d => {
        const ev = evaluate({ pol, rules: myRules, restrictions, mine, dest: d, periods, studentUid: s.uid, teacherName: k.teacherName });
        const warn = staffChecks({ pol, rules: myRules, keepApart, passes, studentUid: s.uid, studentName: s.name, dest: d, fromTeacherUid: k.teacherUid });
        const why = [...ev.blocks, ...warn.filter(w => !w.startsWith('Keep apart'))][0] || (warn.length ? 'Not right now — ask your teacher.' : '');
        const blocked = !!(ev.blocks.length || warn.length);
        return `<button class="pass-dest card ${blocked ? 'is-blocked' : 'card-hover'} p-4 text-left" data-kd="${d.id}" ${blocked ? `disabled title="${escapeHtml(why)}"` : ''}>${iconTile(d.icon, blocked ? 'muted' : 'green')}<div class="text-white mt-3">${escapeHtml(d.name)}</div><div class="text-[11px] text-gray-500 mt-0.5">${blocked ? escapeHtml(why.length > 60 ? 'Ask your teacher' : why) : `${ev.minutes} min`}</div></button>`; }).join('')}</div>`) });
    const idle = setTimeout(() => m.close(), 45000);
    m.el.addEventListener('click', async ev2 => {
      const b = ev2.target.closest('[data-kd]'); if (!b || b.disabled) return;
      clearTimeout(idle);
      const d = destOf(pol, b.dataset.kd);
      try {
        await setDoc(doc(passCol(ctx), checkId), { studentUid: s.uid, studentName: s.name, date: todayISO(), createdBy: k.kioskId, createdByName: `${k.teacherName} (kiosk)`, createdByRole: 'kiosk', type: 'kiosk', kioskVerified: true,
          fromCourseId: course?.id || '', fromTitle: course?.title || '', fromTeacherUid: k.teacherUid, fromTeacherName: k.teacherName, fromRoom: course?.room || '', destId: d.id, destName: d.name, destKind: '', destTeacherUid: '', destTeacherName: '', destOther: '',
          note: '', minutes: (myRules?.minutes || {})[d.id] || d.minutes || 5, status: 'active', startAt: serverTimestamp(), approvedByName: 'Kiosk', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        m.close(); toast(`${s.name.split(' ')[0]} → ${d.name}`);
      } catch (ex) { m.close(); toast(ex.code === 'permission-denied' ? 'Passes aren’t available right now. Ask your teacher.' : friendlyError(ex), 'error'); }
    });
    refreshIcons();
  });
  loadRoster();
}
// Teacher side: open the kiosk on this device, copy its address, and manage kiosk devices.
async function kioskModal(ctx) {
  const url = location.origin + buildUrl('/kiosk');
  const m = openModal({ html: modalHeader({ title: 'Ember Pass kiosk', subtitle: 'Turn a classroom device into a sign-out station.', icon: 'tablet-smartphone' }) + modalBody(`
    <div class="space-y-3 text-sm text-gray-300">
      <div class="flex gap-3">${ico('shield-check', 'w-4 h-4 text-[#6ee06e] shrink-0 mt-0.5')}<span>The device gets its own kiosk login — not your account. Even if a student leaves the kiosk screen, they can't open your account or settings.</span></div>
      <div class="flex gap-3">${ico('id-card', 'w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5')}<span>Students tap their name and type their student ID. The ID is checked by the server; the kiosk never shows anyone's ID.</span></div>
      <div class="flex gap-3">${ico('lock', 'w-4 h-4 text-gray-400 shrink-0 mt-0.5')}<span>To leave the kiosk, tap <b>Teacher</b> and enter your password.</span></div>
    </div>
    <label class="label mt-5">Kiosk address (open it on any device)</label><div class="flex gap-2"><input class="input font-mono text-sm" readonly value="${escapeHtml(url)}" id="km-url"><button class="btn btn-secondary" id="km-copy" type="button">${ico('copy', 'w-4 h-4')}</button></div>
    <div class="mt-5"><h3 class="label">Your kiosk devices</h3><div id="km-list">${skeletonRows(1)}</div></div>`) + modalFooter(`<button data-close class="btn btn-secondary flex-1">Close</button><button class="btn btn-primary flex-1" id="km-start">${ico('play', 'w-4 h-4')} Start kiosk on this device</button>`) });
  m.$('[data-close]').addEventListener('click', () => m.close());
  m.$('#km-copy').addEventListener('click', () => globalThis.__ember.copyText(url, 'Kiosk address copied'));
  m.$('#km-start').addEventListener('click', () => { m.close(); navigate(`/kiosk?school=${encodeURIComponent(ctx.slug)}&start=1`); });
  const load = async () => {
    const list = await getDocs(query(collection(db, 'kiosks'), where('teacherUid', '==', ctx.me.uid))).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
    m.$('#km-list').innerHTML = list.length ? `<div class="card divide-y divide-white/[0.05]">${list.map(x => `<div class="flex items-center gap-3 px-4 py-2.5">${ico('tablet-smartphone', 'w-4 h-4 text-gray-500')}<span class="flex-1 text-sm text-white">${escapeHtml(x.label || 'Kiosk')}</span><button class="btn btn-ghost btn-sm" data-km-del="${escapeHtml(x.id)}">${ico('power', 'w-3.5 h-3.5')} Turn off</button></div>`).join('')}</div>` : `<p class="text-sm text-gray-500">None yet.</p>`;
    refreshIcons();
  };
  m.el.addEventListener('click', async e => { const b = e.target.closest('[data-km-del]'); if (!b) return; await deleteDoc(doc(db, 'kiosks', b.dataset.kmDel)).catch(ex => toast(friendlyError(ex), 'error')); toast('Kiosk turned off'); load(); });
  refreshIcons(); load();
}

// ── History (staff) with filters ───────────────────────────────────
async function historyTab(ctx, el, env) {
  const f = { from: todayISO(), to: todayISO(), q: '', dest: '', status: '', type: '' };
  el.innerHTML = `<div class="card p-4 mb-4 flex flex-wrap items-end gap-3"><div><label class="label" for="ph-from">From</label><input type="date" id="ph-from" class="input !py-2 !w-auto" value="${f.from}" max="${todayISO()}"></div><div><label class="label" for="ph-to">To</label><input type="date" id="ph-to" class="input !py-2 !w-auto" value="${f.to}" max="${todayISO()}"></div>
    <div class="flex-1 min-w-[160px]"><label class="label" for="ph-q">Student</label><input id="ph-q" class="input !py-2" placeholder="Search a name…"></div>
    <div><label class="label" for="ph-dest">Destination</label><select id="ph-dest" class="input !py-2 !w-auto" data-icon="map-pin"><option value="">All</option>${enabledDests(env.pol).map(d => `<option value="${d.id}" data-icon="${d.icon}">${escapeHtml(d.name)}</option>`).join('')}<option value="return" data-icon="undo-2">Return trips</option></select></div>
    <div><label class="label" for="ph-status">Status</label><select id="ph-status" class="input !py-2 !w-auto"><option value="">All</option><option value="overdue" data-icon="siren">Ran over</option><option value="ended" data-icon="circle-check">Back</option><option value="active" data-icon="footprints">Out now</option><option value="denied" data-icon="ban">Denied</option><option value="auto" data-icon="timer-off">Auto-ended</option></select></div>
    <div><label class="label" for="ph-type">Kind</label><select id="ph-type" class="input !py-2 !w-auto"><option value="">All</option>${Object.entries(TYPES).map(([k, [i, l]]) => `<option value="${k}" data-icon="${i}">${l}</option>`).join('')}</select></div>
    <button id="ph-csv" class="btn btn-secondary btn-sm">${ico('download', 'w-3.5 h-3.5')} CSV</button></div><div id="ph-list">${skeletonRows(4)}</div>`;
  refreshIcons();
  let all = [];
  const load = async () => {
    const list = (await getDocs(query(passCol(ctx), where('date', '>=', f.from)))).docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.date <= f.to);
    all = (ctx.isAdmin ? list : list.filter(p => p.fromTeacherUid === ctx.me.uid || p.createdBy === ctx.me.uid || p.destTeacherUid === ctx.me.uid)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    draw();
  };
  const filtered = () => all.filter(p => (!f.q || (p.studentName || '').toLowerCase().includes(f.q)) && (!f.dest || p.destId === f.dest) && (!f.type || (p.type || 'standard') === f.type)
    && (!f.status || (f.status === 'overdue' ? p.startAt && elapsedSec(p) > limitSec(p) : f.status === 'auto' ? p.autoEnded : p.status === f.status)));
  const draw = () => {
    const list = filtered();
    $('#ph-list').innerHTML = list.length ? `<div class="card overflow-x-auto"><table class="w-full text-sm pass-table"><thead><tr><th>Date</th><th>Student</th><th>From</th><th>To</th><th>Out</th><th>Back</th><th>Time</th><th>Status</th></tr></thead><tbody>${list.slice(0, 500).map(p => `<tr><td class="text-gray-500">${escapeHtml(p.date)}</td><td class="text-white">${escapeHtml(p.studentName || '')} ${typeChip(p)}</td><td>${escapeHtml(p.fromTitle || '—')}</td><td>${escapeHtml(toLabel(p))}</td><td>${escapeHtml(fmtTime(p.startAt) || '—')}</td><td>${escapeHtml(fmtTime(p.endAt) || '—')}${p.autoEnded ? ' <span class="text-[10px] text-gray-500">auto</span>' : ''}</td><td class="tabular-nums ${p.startAt && elapsedSec(p) > limitSec(p) ? 'text-[#f08a8a]' : ''}">${p.startAt ? mmss(elapsedSec(p)) : '—'}</td><td>${statusPill(p)}</td></tr>`).join('')}</tbody></table></div><p class="hint mt-2">${plural(list.length, 'pass', 'passes')}</p>`
      : emptyState({ icon: 'ticket', title: 'No passes match' });
    refreshIcons();
  };
  el.addEventListener('change', e => { const k = { 'ph-from': 'from', 'ph-to': 'to', 'ph-dest': 'dest', 'ph-status': 'status', 'ph-type': 'type' }[e.target.id]; if (!k) return; f[k] = e.target.value; if (k === 'from' || k === 'to') load(); else draw(); });
  el.addEventListener('input', e => { if (e.target.id === 'ph-q') { f.q = e.target.value.trim().toLowerCase(); draw(); } });
  $('#ph-csv').addEventListener('click', () => csv(`passes-${f.from}-to-${f.to}.csv`, filtered()));
  load();
}
function csv(name, list) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Student', 'Kind', 'From class', 'From teacher', 'Destination', 'Note', 'Status', 'Out', 'Back', 'Minutes out', 'Limit', 'Over limit', 'Auto-ended', 'Created by', 'Approved by'],
    ...list.map(p => [p.date, p.studentName, TYPES[p.type || 'standard']?.[1] || p.type, p.fromTitle, p.fromTeacherName, toLabel(p), p.note, p.status, fmtTime(p.startAt), fmtTime(p.endAt), p.startAt ? Math.round(elapsedSec(p) / 6) / 10 : '', (p.minutes || 5) + (p.extraMinutes || 0), p.startAt && elapsedSec(p) > limitSec(p) ? 'Yes' : '', p.autoEnded ? 'Yes' : '', p.createdByName, p.approvedByName || ''])];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Exported');
}

// ── Reports (admin) ─────────────────────────────────────────────────
async function reportsTab(ctx, el, env) {
  let days = 30;
  const draw = async () => {
    el.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-3 mb-5"><select id="pr-range" class="input !py-2 !w-auto" aria-label="Range" data-icon="calendar-range">${[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([v, l]) => `<option value="${v}" ${v === days ? 'selected' : ''}>${l}</option>`).join('')}</select><button id="pr-csv" class="btn btn-secondary btn-sm">${ico('download', 'w-3.5 h-3.5')} Export CSV</button></div><div id="pr-body">${skeletonRows(4, 'h-24')}</div>`;
    refreshIcons();
    $('#pr-range').addEventListener('change', e => { days = +e.target.value; draw(); });
    const from = new Date(); from.setDate(from.getDate() - days);
    const [list, sweeps] = await Promise.all([
      getDocs(query(passCol(ctx), where('date', '>=', toDateInput(from)))).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.startAt)),
      getDocs(query(collection(db, 'tenants', ctx.slug, 'hallSweeps'), where('date', '>=', toDateInput(from)))).then(s => s.docs.map(d => d.data())).catch(() => []),
    ]);
    const mins = list.map(p => elapsedSec(p) / 60), avg = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0;
    const late = list.filter(p => elapsedSec(p) > limitSec(p));
    const group = key => { const m = new Map(); list.forEach(p => { const k = key(p); if (!k) return; const x = m.get(k) || { n: 0, sec: 0, late: 0 }; x.n++; x.sec += elapsedSec(p); if (elapsedSec(p) > limitSec(p)) x.late++; m.set(k, x); }); return [...m.entries()].sort((a, b) => b[1].n - a[1].n); };
    const rank = (rows, extra = () => '') => rows.length ? `<div class="space-y-2">${rows.slice(0, 10).map(([k, x]) => `<div class="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3"><span class="text-sm text-gray-300 truncate" title="${escapeHtml(k)}">${escapeHtml(k)}</span><span class="h-2.5 rounded bg-white/[0.05] overflow-hidden"><span class="block h-full bg-[#D97706]" style="width:${(x.n / (rows[0][1].n || 1) * 100).toFixed(1)}%"></span></span><span class="text-xs text-gray-400 text-right tabular-nums whitespace-nowrap"><span class="text-white text-sm">${x.n}</span> · ${(x.sec / x.n / 60).toFixed(1)}m${extra(x)}</span></div>`).join('')}</div>` : '<p class="text-sm text-gray-500">No passes yet.</p>';
    const byDest = group(p => toLabel(p)), byStudent = group(p => p.studentName), byTeacher = group(p => p.fromTeacherName || (p.type === 'late' ? 'Front office (late)' : ''));
    const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const grid = DAYS.map(([k, l], di) => [l, hours.map(h => list.filter(p => { const d = new Date(ms(p.startAt)); return d.getDay() === di + 1 && d.getHours() === h; }).length)]);
    const maxCell = Math.max(1, ...grid.flatMap(r => r[1]));
    const frequent = byStudent.filter(([, x]) => x.n >= Math.max(3, days / 2));
    $('#pr-body').innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">${kpi('Passes', list.length)}${kpi('Average time out', `${avg.toFixed(1)}<span class="text-gray-500 text-lg"> min</span>`)}${kpi('Ran over the limit', `${late.length}<span class="text-gray-500 text-lg"> · ${list.length ? Math.round(late.length / list.length * 100) : 0}%</span>`)}${kpi('Found without a pass', sweeps.length)}</div>
      <div class="grid lg:grid-cols-2 gap-6 mb-6"><section class="card p-5"><h2 class="text-sm text-white font-medium mb-1">Where students go</h2><p class="text-xs text-gray-500 mb-4">Count · average minutes · ran over</p>${rank(byDest, x => ` · <span class="${x.late ? 'text-[#f08a8a]' : ''}">${x.late} over</span>`)}</section>
        <section class="card p-5"><h2 class="text-sm text-white font-medium mb-1">By class / teacher</h2><p class="text-xs text-gray-500 mb-4">Where passes start</p>${rank(byTeacher)}</section></div>
      <div class="grid lg:grid-cols-2 gap-6 mb-6"><section class="card p-5"><h2 class="text-sm text-white font-medium mb-1">Students with the most passes</h2><p class="text-xs text-gray-500 mb-4">${frequent.length ? `${plural(frequent.length, 'student')} averaging a pass every other school day or more` : 'Nobody stands out'}</p>${rank(byStudent)}</section>
        <section class="card p-5"><h2 class="text-sm text-white font-medium mb-4">When passes happen</h2><div class="pass-heat"><div></div>${hours.map(h => `<div class="text-[10px] text-gray-500 text-center">${h % 12 || 12}${h < 12 ? 'a' : 'p'}</div>`).join('')}${grid.map(([l, row]) => `<div class="text-[11px] text-gray-400">${l}</div>${row.map(n => `<div class="pass-heat-cell" style="--a:${(n / maxCell).toFixed(2)}" title="${n} passes">${n || ''}</div>`).join('')}`).join('')}</div></section></div>`;
    refreshIcons();
    $('#pr-csv').addEventListener('click', () => csv(`passes-last-${days}-days.csv`, list));
  };
  draw();
}

// ── Rules: teacher rules, student restrictions, keep-apart ───────────
async function rulesTab(ctx, el, env) {
  const pol = env.pol, canEditMine = ctx.isAdmin || (pol.eff.allowTeacherRules && !env.myRules.locked);
  const [allRules, students] = await Promise.all([
    ctx.isAdmin ? getDocs(collection(db, 'tenants', ctx.slug, 'passRules')).then(s => new Map(s.docs.map(d => [d.id, d.data()]))).catch(() => new Map()) : new Map([[ctx.me.uid, env.myRules]]),
    getDocs(collection(db, 'tenants', ctx.slug, 'students')).then(s => s.docs.map(d => ({ uid: d.id, ...d.data() })).filter(x => x.status !== 'pending' && x.status !== 'rejected')).catch(() => []),
  ]);
  const teachers = ctx.isAdmin ? env.staff : env.staff.filter(s => s.uid === ctx.me.uid);
  const restrictions = env.restrictions.filter(r => ctx.isAdmin || r.createdBy === ctx.me.uid);
  const groups = env.keepApart.filter(g => ctx.isAdmin || g.createdBy === ctx.me.uid);
  const sumRules = r => { if (!r) return 'School defaults'; const parts = []; if (r.paused) parts.push('Paused'); if (r.roomCapacity !== undefined && r.roomCapacity !== null && r.roomCapacity !== '') parts.push(`${r.roomCapacity} out at once`); if (r.dailyLimit) parts.push(`${r.dailyLimit}/day`); if ((r.instant || []).length) parts.push(`Instant: ${r.instant.map(id => destOf(pol, id).name).join(', ')}`); if ((r.disabled || []).length) parts.push(`Off: ${r.disabled.map(id => destOf(pol, id).name).join(', ')}`); if (r.blockFirstMin || r.blockLastMin) parts.push(`No passes first ${r.blockFirstMin || 0} / last ${r.blockLastMin || 0} min`); return parts.join(' · ') || 'School defaults'; };
  el.innerHTML = `
    ${pol.district && Object.keys(pol.district).length ? `<div class="mb-5 p-4 rounded-xl border border-[#8B5CF6]/30 bg-[#8B5CF6]/5 text-sm text-gray-300 flex gap-3">${ico('landmark', 'w-5 h-5 text-[#A78BFA] shrink-0')}<div>District policy applies to this school${pol.enforced.length ? `: <span class="text-white">${pol.enforced.map(k => (POLICY_FIELDS.find(f => f[0] === k)?.[1] || k).replace(/ \(.*\)/, '').replace(/…/, '#')).join(', ')}</span> ${pol.enforced.length === 1 ? 'is' : 'are'} set by the district` : ' as defaults'}.</div></div>` : ''}
    <section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]"><div><h2 class="text-white font-medium">${ctx.isAdmin ? 'Teacher & class rules' : 'My room rules'}</h2><p class="text-xs text-gray-500">${ctx.isAdmin ? 'Override the school settings for a specific teacher’s classes. Lock a teacher’s rules so they can’t change them.' : canEditMine ? 'Your rules apply to students who leave from your classes.' : 'Your administrator has set these rules for your room.'}</p></div></div>
      <div class="divide-y divide-white/[0.05]">${teachers.map(s => { const r = allRules.get(s.uid); return `<div class="flex flex-wrap items-center gap-3 px-5 py-3">${avatar(displayNameOf(s))}<div class="flex-1 min-w-0"><div class="text-sm text-white">${escapeHtml(displayNameOf(s))} ${r?.locked ? `<span class="pass-type">${ico('lock', 'w-3 h-3')} locked</span>` : ''}</div><div class="text-[11px] text-gray-500 truncate">${escapeHtml(sumRules(r))}</div></div>${ctx.isAdmin || (s.uid === ctx.me.uid && canEditMine) ? `<button class="btn btn-secondary btn-sm" data-trules="${escapeHtml(s.uid)}">${ico('sliders-horizontal', 'w-3.5 h-3.5')} Edit</button>` : ''}</div>`; }).join('')}</div></section>
    <section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]"><div><h2 class="text-white font-medium">Student restrictions</h2><p class="text-xs text-gray-500">No passes, approval required, only certain places, or a daily cap — with an end date. Students see a friendly message, not the reason you enter.</p></div><button class="btn btn-secondary btn-sm" data-add-restr>${ico('plus', 'w-3.5 h-3.5')} Restriction</button></div>
      ${restrictions.length ? `<div class="divide-y divide-white/[0.05]">${restrictions.map(r => `<div class="flex flex-wrap items-center gap-3 px-5 py-3">${iconTile(r.mode === 'none' ? 'ban' : r.mode === 'only' ? 'map-pin' : r.mode === 'approval' ? 'hourglass' : 'gauge', 'red')}<div class="flex-1 min-w-0"><div class="text-sm text-white">${escapeHtml(r.studentName || '')}</div><div class="text-[11px] text-gray-500">${escapeHtml({ none: 'No passes', approval: 'Every pass needs approval', only: `Only: ${(r.destIds || []).map(id => destOf(pol, id).name).join(', ')}`, cap: 'Daily cap' }[r.mode] || r.mode)}${r.perDay ? ` · max ${r.perDay}/day` : ''}${r.until ? ` · until ${escapeHtml(r.until)}` : ''}${r.reason ? ` · ${escapeHtml(r.reason)}` : ''} · by ${escapeHtml(r.createdByName || '')}</div></div>${r.until && r.until < todayISO() ? badge('Expired', 'muted') : ''}<button class="btn-icon danger" data-del-restr="${escapeHtml(r.id)}" aria-label="Remove">${ico('trash-2', 'w-4 h-4')}</button></div>`).join('')}</div>` : `<p class="text-sm text-gray-500 p-5">No restrictions.</p>`}</section>
    <section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]"><div><h2 class="text-white font-medium">Keep apart</h2><p class="text-xs text-gray-500">Students who shouldn’t be in the hallway at the same time — or shouldn’t be at the <b>same place</b> at the same time. You’re warned before approving; kiosk tiles are blocked. Students never see this.</p></div>${ctx.isAdmin || pol.eff.allowTeacherKeepApart ? `<button class="btn btn-secondary btn-sm" data-add-group>${ico('plus', 'w-3.5 h-3.5')} Group</button>` : ''}</div>
      ${groups.length ? `<div class="divide-y divide-white/[0.05]">${groups.map(g => `<div class="flex flex-wrap items-center gap-3 px-5 py-3">${ico('shield-ban', 'w-4 h-4 text-[#f08a8a] shrink-0')}<div class="flex-1 min-w-0"><div class="flex flex-wrap gap-1.5">${(g.uids || []).map(u => `<span class="badge badge-red">${escapeHtml(g.names?.[u] || 'Student')}</span>`).join('')}</div><div class="text-[11px] text-gray-500 mt-1">${g.scope === 'destination' ? 'Not at the same place at the same time' : 'Not in the hallway at the same time'}${g.createdByName ? ' · by ' + escapeHtml(g.createdByName) : ''}${g.note ? ' · ' + escapeHtml(g.note) : ''}</div></div>${g.legacy && !ctx.isAdmin ? '' : `<button class="btn-icon danger" data-del-group="${escapeHtml(g.id)}" aria-label="Remove group">${ico('trash-2', 'w-4 h-4')}</button>`}</div>`).join('')}</div>` : `<p class="text-sm text-gray-500 p-5">No groups.</p>`}</section>`;
  refreshIcons();
  el.onclick = async e => {
    const F = await forms();
    const tr = e.target.closest('[data-trules]');
    if (tr) {
      const uid = tr.dataset.trules, r = allRules.get(uid) || {}, who = env.staff.find(s => s.uid === uid);
      const dopts = enabledDests(pol).map(d => ({ v: d.id, l: d.name }));
      const fields = [
        { id: 'paused', type: 'yesno', label: 'Pause passes for this room' },
        { id: 'roomCapacity', type: 'number', label: 'Students out at once', min: 0, maxN: 30, hint: `Blank = school setting (${pol.eff.roomCapacity || 'no limit'})` },
        { id: 'dailyLimit', type: 'number', label: 'Passes per student per day', min: 1, maxN: 30, hint: `Blank = school setting (${pol.eff.dailyLimit})` },
        { id: 'blockFirstMin', type: 'number', label: 'No passes in the first … minutes', min: 0, maxN: 60 }, { id: 'blockLastMin', type: 'number', label: 'No passes in the last … minutes', min: 0, maxN: 60 },
        ...(pol.eff.allowTeacherInstant || ctx.isAdmin ? [{ id: 'instant', type: 'checks', label: 'Instant from this room (no approval)', options: dopts }] : []),
        { id: 'disabled', type: 'checks', label: 'Not allowed from this room', options: dopts },
        ...(ctx.isAdmin ? [{ id: 'locked', type: 'yesno', label: 'Lock these rules (teacher can’t change them)' }] : []),
      ];
      const nz = v => v === '' || v === undefined || v === null ? null : Number(v);
      return F.formModal({ title: `Rules for ${who ? displayNameOf(who) : 'this room'}`, icon: 'sliders-horizontal', form: { sections: [{ fields }] }, data: { paused: r.paused ? 'Yes' : 'No', roomCapacity: r.roomCapacity ?? '', dailyLimit: r.dailyLimit ?? '', blockFirstMin: r.blockFirstMin ?? '', blockLastMin: r.blockLastMin ?? '', instant: r.instant || [], disabled: r.disabled || [], locked: r.locked ? 'Yes' : 'No' }, onSubmit: async d => {
        await setDoc(TEACHER_DOC(ctx, uid), { paused: d.paused === 'Yes', pausedMessage: d.paused === 'Yes' ? `${who ? displayNameOf(who) : 'Your teacher'} has paused passes for this class.` : '', roomCapacity: nz(d.roomCapacity), dailyLimit: nz(d.dailyLimit), blockFirstMin: nz(d.blockFirstMin), blockLastMin: nz(d.blockLastMin), instant: d.instant || [], disabled: d.disabled || [], ...(ctx.isAdmin ? { locked: d.locked === 'Yes' } : {}), setBy: ctx.me.uid, setByName: ctx.me.name, updatedAt: serverTimestamp() }, { merge: true });
        if (uid === ctx.me.uid) Object.assign(env.myRules, { paused: d.paused === 'Yes' });
        toast('Rules saved'); rulesTab(ctx, el, env); return true;
      } });
    }
    if (e.target.closest('[data-add-restr]')) {
      return F.formModal({ title: 'Pass restriction', icon: 'ban', env: { students }, form: { sections: [{ fields: [
        { id: 'students', type: 'students', label: 'Student(s)', required: true },
        { id: 'mode', type: 'radio', label: 'Restriction', required: true, cols: 1, options: [{ v: 'none', l: 'No passes at all' }, { v: 'approval', l: 'Every pass needs teacher approval (no instant passes)' }, { v: 'only', l: 'Only certain destinations' }, { v: 'cap', l: 'Daily cap only' }] },
        { id: 'destIds', type: 'checks', label: 'Allowed destinations', required: true, options: enabledDests(pol).map(d => ({ v: d.id, l: d.name })), showIf: { id: 'mode', eq: 'only' } },
        { id: 'perDay', type: 'number', label: 'Max passes per day', min: 1, maxN: 20, required: true, showIf: { id: 'mode', eq: 'cap' } },
        { id: 'until', type: 'date', label: 'Ends on', hint: 'Blank = until removed' }, { id: 'reason', type: 'text', label: 'Reason (staff only)' },
      ] }] }, data: { mode: 'approval' }, submit: 'Add restriction', onSubmit: async d => {
        for (const s of d.students) await addDoc(collection(db, 'tenants', ctx.slug, 'passRestrictions'), { studentUid: s.uid, studentName: s.name, mode: d.mode, destIds: d.destIds || [], perDay: Number(d.perDay) || 0, until: d.until || '', reason: d.reason || '', createdBy: ctx.me.uid, createdByName: ctx.me.name, createdAt: serverTimestamp() });
        env.restrictions = await loadRestrictions(ctx); toast('Restriction added'); rulesTab(ctx, el, env); return true;
      } });
    }
    const dr = e.target.closest('[data-del-restr]');
    if (dr) { if (!await confirmDialog({ title: 'Remove this restriction?', confirmLabel: 'Remove', danger: true })) return; await deleteDoc(doc(db, 'tenants', ctx.slug, 'passRestrictions', dr.dataset.delRestr)).catch(ex => toast(friendlyError(ex), 'error')); env.restrictions = await loadRestrictions(ctx); return rulesTab(ctx, el, env); }
    if (e.target.closest('[data-add-group]')) {
      return F.formModal({ title: 'Keep these students apart', icon: 'shield-ban', env: { students }, form: { sections: [{ fields: [
        { id: 'students', type: 'students', label: 'Students (2 or more)', required: true },
        { id: 'scope', type: 'radio', label: 'Keep them apart', required: true, cols: 1, options: [{ v: 'hallway', l: 'Never out of class at the same time' }, { v: 'destination', l: 'Never at the same place at the same time (e.g. both in the restroom)' }] },
        { id: 'note', type: 'text', label: 'Private note (optional)', span: 'sm:col-span-2' },
      ] }], rules: [d => (d.students || []).length < 2 ? { id: 'students', msg: 'Pick at least two students.' } : null] }, data: { scope: 'destination' }, submit: 'Add group', onSubmit: async d => {
        await addDoc(collection(db, 'tenants', ctx.slug, 'passKeepApart'), { uids: d.students.map(s => s.uid), names: Object.fromEntries(d.students.map(s => [s.uid, s.name])), scope: d.scope, note: d.note || '', createdBy: ctx.me.uid, createdByName: ctx.me.name, createdAt: serverTimestamp() });
        env.keepApart = await loadKeepApart(ctx); toast('Group added'); rulesTab(ctx, el, env); return true;
      } });
    }
    const dg = e.target.closest('[data-del-group]');
    if (dg) {
      if (!await confirmDialog({ title: 'Remove this group?', confirmLabel: 'Remove', danger: true })) return;
      const g = env.keepApart.find(x => x.id === dg.dataset.delGroup);
      try {
        if (g.legacy) { const rest = env.keepApart.filter(x => x.legacy && x.id !== g.id).map(({ uids, names, note }) => ({ uids, names, note: note || '' })); await setDoc(doc(db, 'tenants', ctx.slug, 'passPrivate', 'encounters'), { groups: rest }); }
        else await deleteDoc(doc(db, 'tenants', ctx.slug, 'passKeepApart', g.id));
        env.keepApart = await loadKeepApart(ctx); rulesTab(ctx, el, env);
      } catch (ex) { toast(friendlyError(ex), 'error'); }
    }
  };
}

// ── School settings (admin) ─────────────────────────────────────────
function settingsTab(ctx, el, env) {
  const pol = env.pol, s = { ...SCHOOL_DEFAULTS, ...pol.school };
  const dests = pol.eff.destinations.map(d => ({ ...d }));
  let blackouts = (pol.school.blackouts || []).map(b => ({ ...b }));
  const locked = k => pol.enforced.includes(k);
  const row = (d, i) => `<tr data-i="${i}"><td><select class="input !py-1.5" data-k="icon" aria-label="Icon">${ICONS.map(x => `<option data-icon="${x}" ${x === d.icon ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
    <td><input class="input !py-1.5 min-w-[140px]" data-k="name" value="${escapeHtml(d.name)}" aria-label="Name"></td>
    <td><input class="input !py-1.5 w-16" type="number" min="1" max="120" data-k="minutes" value="${d.minutes}" aria-label="Minutes"></td>
    <td><input class="input !py-1.5 w-16" type="number" min="0" max="100" data-k="capacity" value="${d.capacity || 0}" aria-label="At once"></td>
    <td><input class="input !py-1.5 w-16" type="number" min="0" max="20" data-k="perDay" value="${d.perDay || 0}" aria-label="Per day"></td>
    <td><div class="flex gap-1"><input class="input !py-1.5 w-[104px]" type="time" data-k="openFrom" value="${d.openFrom || ''}" aria-label="Opens"><input class="input !py-1.5 w-[104px]" type="time" data-k="openTo" value="${d.openTo || ''}" aria-label="Closes"></div></td>
    <td class="text-center"><input type="checkbox" data-k="approval" ${d.approval ? 'checked' : ''} class="w-4 h-4 accent-[#F59E0B]" aria-label="Needs approval"></td>
    <td class="text-center"><input type="checkbox" data-k="enabled" ${d.enabled !== false ? 'checked' : ''} class="w-4 h-4 accent-[#F59E0B]" aria-label="Enabled"></td>
    <td>${DEFAULT_DESTS.some(x => x.id === d.id) ? '' : `<button type="button" class="btn-icon danger" data-del-dest="${i}" aria-label="Remove">${ico('trash-2', 'w-4 h-4')}</button>`}</td></tr>`;
  const draw = () => {
    el.innerHTML = `<section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]"><div><h2 class="text-white font-medium">Destinations</h2><p class="text-xs text-gray-500">“At once” = how many students can be there together · “Per day” = visits per student per day · 0 = no limit. Uncheck “Approve” to make a pass instant.</p></div><button type="button" class="btn btn-secondary btn-sm" data-add-dest>${ico('plus', 'w-3.5 h-3.5')} Destination</button></div>
        <div class="overflow-x-auto"><table class="w-full text-sm pass-table" id="ps-dests"><thead><tr><th>Icon</th><th>Name</th><th>Min</th><th>At once</th><th>Per day</th><th>Open hours</th><th class="text-center">Approve</th><th class="text-center">On</th><th></th></tr></thead><tbody>${dests.map(row).join('')}</tbody></table></div></section>
      <section class="card p-5 mb-6"><h2 class="text-white font-medium mb-4">Limits & alerts</h2><div class="grid sm:grid-cols-2 gap-x-6 gap-y-4">${POLICY_FIELDS.map(([k, l]) => `<div><label class="label" for="pp-${k}">${escapeHtml(l)}</label><input id="pp-${k}" data-pol="${k}" type="number" min="0" max="120" class="input !w-32" value="${s[k] ?? ''}" ${locked(k) ? 'disabled title="Set by the district"' : ''}>${locked(k) ? `<p class="hint mt-1">${ico('landmark', 'w-3 h-3 inline -mt-0.5')} Set by the district: ${escapeHtml(pol.eff[k])}</p>` : ''}</div>`).join('')}</div>
        <div class="mt-5 space-y-2">${[['allowTeacherRules', 'Teachers can set their own room rules'], ['allowTeacherInstant', 'Teachers can make destinations instant for their room'], ['allowTeacherKeepApart', 'Teachers can create keep-apart groups'], ['showCode', 'Show a live code on passes (anti-screenshot)']].map(([k, l]) => `<label class="check"><input type="checkbox" data-flag="${k}" ${s[k] !== false ? 'checked' : ''}> <span>${l}</span></label>`).join('')}</div></section>
      <section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]"><div><h2 class="text-white font-medium">No-pass times</h2><p class="text-xs text-gray-500">Times students can’t request passes (lunch, testing, class changes). Teachers can still send passes.</p></div><button type="button" class="btn btn-secondary btn-sm" data-add-bo>${ico('plus', 'w-3.5 h-3.5')} Time</button></div>
        ${blackouts.length ? `<div class="divide-y divide-white/[0.05]">${blackouts.map((b, i) => `<div class="flex flex-wrap items-center gap-2 px-5 py-3" data-bo="${i}"><input class="input !py-1.5 !w-44" data-b="label" value="${escapeHtml(b.label || '')}" placeholder="Label (e.g. Lunch)"><input class="input !py-1.5 !w-[110px]" type="time" data-b="from" value="${b.from || ''}"><span class="text-gray-500">to</span><input class="input !py-1.5 !w-[110px]" type="time" data-b="to" value="${b.to || ''}"><div class="flex gap-1">${DAYS.map(([k, l]) => `<label class="pill"><input type="checkbox" class="sr-only" data-bd="${k}" ${!b.days?.length || b.days.includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div><button type="button" class="btn-icon danger ml-auto" data-del-bo="${i}" aria-label="Remove">${ico('trash-2', 'w-4 h-4')}</button></div>`).join('')}</div>` : `<p class="text-sm text-gray-500 p-5">None.</p>`}
        ${(pol.district.blackouts || []).length ? `<p class="hint px-5 pb-4">${ico('landmark', 'w-3 h-3 inline -mt-0.5')} District no-pass times also apply: ${pol.district.blackouts.map(b => `${escapeHtml(b.label || '')} ${fmtHM(b.from)}–${fmtHM(b.to)}`).join(', ')}</p>` : ''}</section>
      <div class="sticky bottom-0 py-3 bg-[#0A0A0A]/90 backdrop-blur border-t border-white/[0.06]"><button class="btn btn-primary" id="ps-save">${ico('save', 'w-4 h-4')} Save settings</button></div>`;
    refreshIcons();
  };
  const read = () => {
    $$('#ps-dests tbody tr').forEach(tr => { const d = dests[+tr.dataset.i]; tr.querySelectorAll('[data-k]').forEach(inp => { const k = inp.dataset.k; d[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) || 0 : inp.value.trim(); }); });
    $$('[data-bo]').forEach(row => { const b = blackouts[+row.dataset.bo]; row.querySelectorAll('[data-b]').forEach(i => { b[i.dataset.b] = i.value.trim(); }); b.days = [...row.querySelectorAll('[data-bd]')].filter(x => x.checked).map(x => x.dataset.bd); });
  };
  draw();
  el.onclick = async e => {
    if (e.target.closest('[data-add-dest]')) { read(); dests.push({ id: 'd' + Date.now().toString(36), name: 'New destination', icon: 'map-pin', minutes: 5, approval: true, capacity: 0 }); return draw(); }
    const dd = e.target.closest('[data-del-dest]'); if (dd) { read(); dests.splice(+dd.dataset.delDest, 1); return draw(); }
    if (e.target.closest('[data-add-bo]')) { read(); blackouts.push({ label: 'Lunch', from: '11:30', to: '12:00', days: [] }); return draw(); }
    const db2 = e.target.closest('[data-del-bo]'); if (db2) { read(); blackouts.splice(+db2.dataset.delBo, 1); return draw(); }
    const sv = e.target.closest('#ps-save');
    if (sv) {
      read();
      const clean = dests.filter(d => d.name).map(d => ({ id: d.id, name: d.name, icon: d.icon || 'map-pin', minutes: Math.max(1, d.minutes || 5), capacity: Math.max(0, d.capacity || 0), perDay: Math.max(0, d.perDay || 0), approval: !!d.approval, enabled: d.enabled !== false, openFrom: d.openFrom || '', openTo: d.openTo || '', ...(d.kind ? { kind: d.kind } : {}), ...(d.alert ? { alert: d.alert } : {}) }));
      const patch = { destinations: clean, autoApprove: autoApproveIds(clean), blackouts: blackouts.filter(b => b.from && b.to) };
      $$('[data-pol]').forEach(i => { if (!i.disabled) patch[i.dataset.pol] = Math.max(0, Number(i.value) || 0); });
      $$('[data-flag]').forEach(i => { patch[i.dataset.flag] = i.checked; });
      withBusy(sv, 'Saving…', async () => {
        try { await setDoc(doc(db, 'tenants', ctx.slug, 'sis', 'passes'), patch, { merge: true }); Object.assign(pol.school, patch); env.pol = await loadPolicy(ctx); toast('Ember Pass settings saved'); }
        catch (ex) { toast(friendlyError(ex), 'error'); }
      });
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// DISTRICT POLICY (district admins)
// ═══════════════════════════════════════════════════════════════
export async function viewDistrictPassPolicy(dctx) {
  const t = dctx.t;
  setTitle('Ember Pass policy', dctx.district.name);
  render(districtShell(dctx, 'passes', { eyebrow: escapeHtml(dctx.district.name || dctx.districtId), title: 'Ember Pass policy', subtitle: 'Defaults for every school. Turn on “Enforce” to stop schools from changing a rule.' }, `<div id="dp" class="max-w-4xl">${skeletonRows(4, 'h-24')}</div>`));
  const snap = await getDoc(DISTRICT_DOC(dctx.districtId)).catch(() => null);
  if (!live(t)) return;
  const p = snap?.exists() ? snap.data() : {};
  const enforced = new Set(p.enforced || []);
  let blackouts = (p.blackouts || []).map(b => ({ ...b }));
  const el = $('#dp');
  const draw = () => {
    el.innerHTML = `<section class="card p-5 mb-6"><div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="text-white font-medium">District-wide pause</h2><p class="text-xs text-gray-500">Stops student passes at every school (e.g. a district emergency).</p></div><label class="check"><input type="checkbox" id="dp-frozen" ${p.frozen ? 'checked' : ''}> <span>Passes paused district-wide</span></label></div><input id="dp-msg" class="input mt-3" placeholder="Message students see" value="${escapeHtml(p.freezeMessage || '')}"></section>
      <section class="card overflow-hidden mb-6"><div class="px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium">Rules</h2><p class="text-xs text-gray-500">Blank = let each school decide.</p></div>
        <div class="divide-y divide-white/[0.05]">${POLICY_FIELDS.map(([k, l]) => `<div class="flex flex-wrap items-center gap-3 px-5 py-3"><label class="flex-1 min-w-[220px] text-sm text-gray-200" for="dp-${k}">${escapeHtml(l)}</label><input id="dp-${k}" data-dp="${k}" type="number" min="0" max="120" class="input !w-28" value="${p[k] ?? ''}"><label class="check text-xs"><input type="checkbox" data-enf="${k}" ${enforced.has(k) ? 'checked' : ''}> <span>Enforce</span></label></div>`).join('')}
          <div class="flex flex-wrap items-center gap-3 px-5 py-3"><label class="flex-1 min-w-[220px] text-sm text-gray-200" for="dp-maxMinutes">Longest pass any school can allow (minutes)</label><input id="dp-maxMinutes" type="number" min="0" max="120" class="input !w-28" value="${p.maxMinutes ?? ''}"><span class="text-xs text-gray-500 w-[74px]">always</span></div>
          <div class="flex flex-wrap items-center gap-3 px-5 py-3"><label class="flex-1 min-w-[220px] text-sm text-gray-200" for="dp-maxDailyLimit">Most passes a school can allow per day</label><input id="dp-maxDailyLimit" type="number" min="0" max="30" class="input !w-28" value="${p.maxDailyLimit ?? ''}"><span class="text-xs text-gray-500 w-[74px]">always</span></div>
          ${[['allowTeacherRules', 'Teachers can set room rules'], ['allowTeacherInstant', 'Teachers can make destinations instant'], ['allowTeacherKeepApart', 'Teachers can create keep-apart groups']].map(([k, l]) => `<div class="flex flex-wrap items-center gap-3 px-5 py-3"><span class="flex-1 min-w-[220px] text-sm text-gray-200">${l}</span><select data-dpb="${k}" class="input !py-2 !w-auto"><option value="" ${p[k] === undefined ? 'selected' : ''}>School decides</option><option value="yes" data-icon="check" ${p[k] === true ? 'selected' : ''}>Yes</option><option value="no" data-icon="x" ${p[k] === false ? 'selected' : ''}>No</option></select><label class="check text-xs"><input type="checkbox" data-enf="${k}" ${enforced.has(k) ? 'checked' : ''}> <span>Enforce</span></label></div>`).join('')}</div></section>
      <section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]"><div><h2 class="text-white font-medium">District no-pass times</h2><p class="text-xs text-gray-500">Apply at every school, on top of each school’s own.</p></div><button type="button" class="btn btn-secondary btn-sm" data-add-bo>${ico('plus', 'w-3.5 h-3.5')} Time</button></div>
        ${blackouts.length ? `<div class="divide-y divide-white/[0.05]">${blackouts.map((b, i) => `<div class="flex flex-wrap items-center gap-2 px-5 py-3" data-bo="${i}"><input class="input !py-1.5 !w-44" data-b="label" value="${escapeHtml(b.label || '')}" placeholder="Label"><input class="input !py-1.5 !w-[110px]" type="time" data-b="from" value="${b.from || ''}"><span class="text-gray-500">to</span><input class="input !py-1.5 !w-[110px]" type="time" data-b="to" value="${b.to || ''}"><button type="button" class="btn-icon danger ml-auto" data-del-bo="${i}" aria-label="Remove">${ico('trash-2', 'w-4 h-4')}</button></div>`).join('')}</div>` : `<p class="text-sm text-gray-500 p-5">None.</p>`}</section>
      <div class="sticky bottom-0 py-3 bg-[#0A0A0A]/90 backdrop-blur border-t border-white/[0.06]"><button class="btn btn-violet" id="dp-save">${ico('save', 'w-4 h-4')} Save district policy</button></div>`;
    refreshIcons();
  };
  const read = () => $$('[data-bo]').forEach(row => { const b = blackouts[+row.dataset.bo]; row.querySelectorAll('[data-b]').forEach(i => { b[i.dataset.b] = i.value.trim(); }); });
  draw();
  el.onclick = async e => {
    if (e.target.closest('[data-add-bo]')) { read(); blackouts.push({ label: 'District testing', from: '08:00', to: '10:00' }); return draw(); }
    const db2 = e.target.closest('[data-del-bo]'); if (db2) { read(); blackouts.splice(+db2.dataset.delBo, 1); return draw(); }
    const sv = e.target.closest('#dp-save'); if (!sv) return;
    read();
    const out = { frozen: $('#dp-frozen').checked, freezeMessage: $('#dp-msg').value.trim(), blackouts: blackouts.filter(b => b.from && b.to), enforced: $$('[data-enf]').filter(x => x.checked).map(x => x.dataset.enf), updatedAt: serverTimestamp() };
    $$('[data-dp]').forEach(i => { out[i.dataset.dp] = i.value === '' ? null : Number(i.value); });
    out.maxMinutes = $('#dp-maxMinutes').value === '' ? null : Number($('#dp-maxMinutes').value);
    out.maxDailyLimit = $('#dp-maxDailyLimit').value === '' ? null : Number($('#dp-maxDailyLimit').value);
    $$('[data-dpb]').forEach(i => { out[i.dataset.dpb] = i.value === '' ? null : i.value === 'yes'; });
    // Drop blanks so they don't override schools.
    Object.keys(out).forEach(k => { if (out[k] === null) delete out[k]; });
    withBusy(sv, 'Saving…', async () => { try { await setDoc(DISTRICT_DOC(dctx.districtId), out); toast('District policy saved'); } catch (ex) { toast(friendlyError(ex), 'error'); } });
  };
}
