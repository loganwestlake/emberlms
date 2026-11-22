// District → People: create accounts for any school in the district, by category. Each category maps to
// an Ember role plus staff capabilities (Services = IEP/504/ELL, Health, Records, Safety).
import { doc, setDoc, getDocs, collection, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
const {
  db, $, ico, refreshIcons, escapeHtml, plural, displayNameOf, render, setTitle, iconTile, badge, avatar, skeletonRows, emptyState, errorBox,
  toast, copyText, openModal, modalHeader, modalBody, modalFooter, buildUrl, live, districtShell, getDistrictSchools, createLogin, ensureStudentId, gradYearFor,
  cleanUsername, suggestUsername, reserveUsername, createUsernameLogin, usernameTaken, validUsername
} = globalThis.__ember;
const BUILD = new URL(import.meta.url).search;
const forms = () => import('./staff.js' + BUILD);

export const PEOPLE_CATEGORIES = [
  { id: 'student', label: 'Students', icon: 'graduation-cap', tone: 'amber', desc: 'View schedules, grades, and attendance.' },
  { id: 'parent', label: 'Parents & Guardians', icon: 'users', tone: 'violet', desc: "Check their child's grades, attendance, and contact info." },
  { id: 'teacher', label: 'Teachers & Substitutes', icon: 'presentation', tone: 'green', desc: 'Take attendance, enter grades, and view rosters.', role: 'teacher', caps: [], titles: ['Teacher', 'Substitute', 'Long-term substitute', 'Paraprofessional'] },
  { id: 'admin', label: 'Administrators', icon: 'shield-check', tone: 'red', desc: 'Manage schedules, discipline, and school reports.', role: 'admin', caps: [], titles: ['Principal', 'Assistant principal', 'Dean of students', 'Curriculum coordinator'] },
  { id: 'counselor', label: 'Counselors & SPED Staff', icon: 'heart-handshake', tone: 'blue', desc: 'Track graduation credits, schedules, IEPs, and 504 plans.', role: 'teacher', caps: ['services', 'records'], titles: ['School counselor', 'SPED / ESE teacher', 'ESE specialist', 'School psychologist', 'Social worker', '504 coordinator'] },
  { id: 'nurse', label: 'Nurses', icon: 'briefcase-medical', tone: 'red', desc: 'Log clinic visits, medications, immunizations, and medical alerts.', role: 'teacher', caps: ['health'], titles: ['School nurse', 'Health aide', 'Clinic assistant'] },
  { id: 'office', label: 'Office Staff & Registrars', icon: 'building-2', tone: 'teal', desc: 'Handle enrollments, daily attendance, and parent contacts.', role: 'teacher', caps: ['records'], titles: ['Registrar', 'Attendance clerk', 'Front office', 'Data entry clerk'] },
  { id: 'support', label: 'Support Staff', sub: 'Food, Bus, Library, Athletics', icon: 'bus', tone: 'muted', desc: 'Manage lunch accounts, bus routes, books/devices, and sports eligibility.', role: 'teacher', caps: [], titles: ['Food service', 'Transportation', 'Library / media', 'Athletics'] },
  { id: 'it', label: 'IT & Data Staff', icon: 'server-cog', tone: 'violet', desc: 'Manage permissions, integrations, and state reporting.', role: 'admin', caps: [], titles: ['IT specialist', 'Data coordinator', 'State reporting'] },
];
const CAT = Object.fromEntries(PEOPLE_CATEGORIES.map(c => [c.id, c]));
const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const genPassword = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; return Array.from(crypto.getRandomValues(new Uint32Array(10)), x => a[x % a.length]).join(''); };
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
const slugName = v => (v || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
// Older staff records have no category: work it out from role + capabilities.
const categoryOf = u => u.category || (u.role === 'admin' ? 'admin' : (u.caps || []).includes('health') ? 'nurse' : (u.caps || []).includes('services') ? 'counselor' : (u.caps || []).includes('records') ? 'office' : 'teacher');

function credentials(title, who, lines, note) {
  const text = lines.map(([k, v]) => `${k}: ${v}`).join('\n');
  const m = openModal({ size: 'sm', html: `<div class="p-6 sm:p-7"><div class="tile tile-green tile-lg mb-4">${ico('key-round', 'w-5 h-5')}</div><h2 class="font-serif text-2xl text-white mb-1">${escapeHtml(title)}</h2><p class="text-sm text-gray-400 mb-5">Share these sign-in details with ${escapeHtml(who)}. The password is shown only once.</p>
    <div class="card p-4 space-y-2 font-mono text-sm" data-creds>${lines.map(([k, v]) => `<div><span class="text-gray-500 text-xs font-sans">${escapeHtml(k)}</span><br><span class="text-white break-all">${escapeHtml(v)}</span></div>`).join('')}</div>${note ? `<p class="hint mt-3">${escapeHtml(note)}</p>` : ''}
    <div class="flex gap-3 mt-6"><button class="btn btn-secondary flex-1" data-copy>${ico('copy', 'w-4 h-4')} Copy</button><button class="btn btn-primary flex-1" data-close>Done</button></div></div>` });
  m.$('[data-copy]').addEventListener('click', () => copyText(text, 'Sign-in details copied'));
  m.$('[data-close]').addEventListener('click', () => m.close());
  // Refresh the page behind only once the sign-in details are closed (so they can be copied first).
  const done = afterCreds; afterCreds = null;
  if (done) { const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); done(); } }); obs.observe(document.body, { childList: true, subtree: true }); }
  refreshIcons();
}
let afterCreds = null;

export async function viewDistrictPeople(dctx) {
  const t = dctx.t;
  setTitle('People', dctx.district.name);
  render(districtShell(dctx, 'people', { eyebrow: escapeHtml(dctx.district.name || dctx.districtId), title: 'People', subtitle: 'Create accounts for any school in the district. Each category comes with the right access.', actions: `<button id="pp-add" class="btn btn-violet">${ico('user-plus', 'w-4 h-4')} Add user</button>` },
    `<div class="max-w-6xl"><div id="pp-cats" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8"></div><div id="pp-list">${skeletonRows(5)}</div></div>`));
  let schools = [], people = [], f = { school: '', cat: '', q: '' };
  const counts = () => { const c = {}; people.forEach(p => { c[p.cat] = (c[p.cat] || 0) + 1; }); c.student = schools.reduce((a, s) => a + (s._studentCount || 0), 0); return c; };
  const drawCats = () => {
    const c = counts();
    $('#pp-cats').innerHTML = PEOPLE_CATEGORIES.map(x => `<button class="card card-hover p-4 text-left flex gap-3" data-cat="${x.id}">${iconTile(x.icon, x.tone)}<div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-2"><span class="text-white">${escapeHtml(x.label)}</span><span class="text-xs text-gray-500 tabular-nums">${c[x.id] || 0}</span></div>${x.sub ? `<div class="text-[11px] text-gray-500">${escapeHtml(x.sub)}</div>` : ''}<p class="text-xs text-gray-400 mt-1">${escapeHtml(x.desc)}</p><span class="text-[11px] text-[#A78BFA] mt-2 inline-flex items-center gap-1">${ico('plus', 'w-3 h-3')} Add</span></div></button>`).join('');
    refreshIcons();
  };
  const drawList = () => {
    const ql = f.q.toLowerCase();
    const shown = people.filter(p => (!f.school || p.school.id === f.school) && (!f.cat || p.cat === f.cat) && (!ql || `${p.name} ${p.email} ${p.title}`.toLowerCase().includes(ql)));
    $('#pp-list').innerHTML = `<div class="flex flex-wrap items-center gap-3 mb-3"><h2 class="label !mb-0 flex-1">Staff & families</h2>
        <input id="pp-q" type="search" class="input !py-2 !w-56" placeholder="Search name or email…" value="${escapeHtml(f.q)}" aria-label="Search people">
        <select id="pp-school" class="input !py-2 !w-auto" aria-label="School" data-icon="school"><option value="">All schools</option>${schools.map(s => `<option value="${escapeHtml(s.id)}" ${f.school === s.id ? 'selected' : ''}>${escapeHtml(s.name || s.id)}</option>`).join('')}</select>
        <select id="pp-cat" class="input !py-2 !w-auto" aria-label="Category" data-icon="tags"><option value="">All categories</option>${PEOPLE_CATEGORIES.filter(c => c.id !== 'student').map(c => `<option value="${c.id}" data-icon="${c.icon}" ${f.cat === c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}</select></div>
      ${shown.length ? `<div class="card divide-y divide-white/[0.05] overflow-hidden">${shown.slice(0, 300).map(p => `<div class="flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 py-3">${avatar(p.name)}<div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(p.name)}${p.title ? ` <span class="text-xs text-gray-500">· ${escapeHtml(p.title)}</span>` : ''}</div><div class="text-[11px] text-gray-500 truncate">${escapeHtml(p.email || '')}</div></div>${badge(escapeHtml(CAT[p.cat]?.label || p.cat), 'muted')}<span class="text-xs text-gray-400 w-40 truncate text-right">${escapeHtml(p.school.name || p.school.id)}</span></div>`).join('')}</div><p class="hint mt-2">${plural(shown.length, 'person', 'people')}${shown.length > 300 ? ' · showing the first 300' : ''}. Students are listed under <a class="text-[#A78BFA] hover:underline" href="${buildUrl(`/district/${dctx.districtId}/students`)}">Students</a>.</p>`
        : emptyState({ icon: 'users', title: 'No one here yet', text: 'Add staff and families with “Add user”.' })}`;
    refreshIcons();
  };
  const load = async () => {
    schools = await getDistrictSchools(dctx.districtId);
    const lists = await Promise.all(schools.map(async s => {
      const [u, g] = await Promise.all([getDocs(collection(db, 'tenants', s.id, 'users')).catch(() => ({ docs: [] })), getDocs(collection(db, 'tenants', s.id, 'guardians')).catch(() => ({ docs: [] }))]);
      return [...u.docs.map(d => { const x = d.data(); return { uid: d.id, name: displayNameOf(x), email: x.email || '', title: x.title || '', cat: categoryOf(x), school: s }; }),
        ...g.docs.map(d => { const x = d.data(); return { uid: d.id, name: x.name || displayNameOf(x), email: x.email || '', title: x.relationship || '', cat: 'parent', school: s }; })];
    }));
    people = lists.flat().sort((a, b) => a.name.localeCompare(b.name));
  };
  try { await load(); } catch (e) { if (live(t)) { $('#pp-list').innerHTML = errorBox(e); refreshIcons(); } return; }
  if (!live(t)) return;
  drawCats(); drawList();
  $('#pp-list').addEventListener('change', e => { if (e.target.id === 'pp-school') f.school = e.target.value; if (e.target.id === 'pp-cat') f.cat = e.target.value; drawList(); });
  $('#pp-list').addEventListener('input', e => { if (e.target.id === 'pp-q') { f.q = e.target.value; const pos = e.target.selectionStart; drawList(); const q = $('#pp-q'); q.focus(); q.setSelectionRange(pos, pos); } });
  const refresh = async () => { await load(); if (live(t)) { drawCats(); drawList(); } };
  $('#pp-cats').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) addUser(dctx, schools, b.dataset.cat, refresh); });
  $('#pp-add').addEventListener('click', () => pickCategory(dctx, schools, refresh));
}

// School admins use the same forms for their own school (no join code needed).
export function openAddUser({ slug, name, by }, catId = null, done = () => {}, only = null, preset = {}) {
  const dctx = { district: { id: by }, districtId: by }, schools = [{ id: slug, name }];
  return catId ? addUser(dctx, schools, catId, done, preset) : pickCategory(dctx, schools, done, only);
}
export function pickCategory(dctx, schools, done, only = null) {
  const m = openModal({ size: 'lg', html: modalHeader({ title: 'Add user', subtitle: 'What kind of account?', icon: 'user-plus', tone: 'violet' }) + modalBody(`<div class="grid sm:grid-cols-2 gap-2">${PEOPLE_CATEGORIES.filter(x => !only || only.includes(x.id)).map(x => `<button class="flex items-start gap-3 p-3 rounded-xl border border-white/[0.08] hover:border-[#8B5CF6]/50 hover:bg-white/[0.03] text-left" data-pick="${x.id}">${iconTile(x.icon, x.tone)}<span class="min-w-0"><span class="block text-sm text-white">${escapeHtml(x.label)}</span><span class="block text-[11px] text-gray-500">${escapeHtml(x.desc)}</span></span></button>`).join('')}</div>`) });
  m.el.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) { m.close(); addUser(dctx, schools, b.dataset.pick, done); } });
  refreshIcons();
}

async function addUser(dctx, schools, catId, done, preset = {}) {
  const cat = CAT[catId], F = await forms();
  if (!schools.length) return toast('Add a school to the district first.', 'error');
  const schoolField = { id: 'school', type: 'select', label: 'School', required: true, options: schools.map(s => ({ v: s.id, l: s.name || s.id })) };
  const access = cat.caps?.length ? `Access: ${cat.caps.map(c => ({ services: 'IEP / 504 / ELL', health: 'Health records', records: 'Student records & enrollment', safety: 'Discipline log' }[c])).join(', ')}.` : cat.role === 'admin' ? 'Full administrator access to this school.' : '';
  let fields, onSubmit;
  if (catId === 'student') {
    fields = [schoolField, { id: 'first', type: 'text', label: 'First name', required: true }, { id: 'last', type: 'text', label: 'Last name', required: true },
      { id: 'grade', type: 'select', label: 'Grade', required: true, options: GRADES.map(g => ({ v: g, l: `${g === 'K' ? 'Kindergarten' : 'Grade ' + g} · class of ${gradYearFor(g)}` })) },
      { id: 'username', type: 'text', label: 'Username', hint: 'Suggested from their name (firstname.lastname).' }, { id: 'password', type: 'text', label: 'Temporary password', required: true }];
    onSubmit = async d => {
      const username = cleanUsername(d.username || await suggestUsername(d.school, d.first, d.last));
      if (!validUsername(username)) throw new Error('Usernames are 3–30 letters, numbers, dots, dashes or underscores.');
      const email = `${username}@${d.school}.emberlms.local`;
      let uid; try { uid = await createLogin(email, d.password); } catch (ex) { if (ex.code === 'auth/email-already-in-use') throw new Error('That username is already taken at this school.'); throw ex; }
      const rec = { username, firstName: d.first, lastName: d.last, displayName: `${d.first} ${d.last}`.trim(), gradeLevel: d.grade, email, role: 'student', status: 'approved', tempPassword: d.password, enrolledCourseIds: [], approvedBy: 'district', createdBy: dctx.district.id || dctx.districtId, createdAt: serverTimestamp() };
      await setDoc(doc(db, 'tenants', d.school, 'students', uid), rec);
      const id = await ensureStudentId(d.school, uid, rec).catch(() => '');
      const sc = schools.find(s => s.id === d.school);
      credentials('Student account created', rec.displayName, [['School', sc?.name || d.school], ['Username', username], ['Password', d.password], ...(id ? [['Student ID', id]] : [])], 'Students sign in from the Student tab with their school, username and password.');
      return true;
    };
  } else {
    const isParent = catId === 'parent';
    fields = [schoolField, { id: 'first', type: 'text', label: 'First name', required: true }, { id: 'last', type: 'text', label: 'Last name', required: true },
      ...(isParent ? [{ id: 'relationship', type: 'select', label: 'Relationship', options: ['Mother', 'Father', 'Guardian', 'Grandparent', 'Foster parent', 'Stepparent', 'Other relative', 'Other'] }] : [{ id: 'title', type: 'select', label: 'Title / role', required: true, options: cat.titles }]),
      { id: 'username', type: 'text', label: 'Username', required: true, hint: 'They sign in with the school + this username. Suggested from their name.' }, { id: 'password', type: 'text', label: 'Temporary password', required: true },
      { id: 'contactEmail', type: 'text', label: 'Contact email (optional)', hint: 'For your records only — not used to sign in.' }, { id: 'phone', type: 'phone', label: 'Phone' },
      ...(isParent ? [{ id: 'students', type: 'students', label: 'Their student(s)', required: true, span: 'sm:col-span-2' }] : []),
      ...(access ? [{ id: 'note', type: 'note', text: access }] : [])];
    onSubmit = async d => {
      const full = `${d.first} ${d.last}`.trim(), sc = schools.find(s => s.id === d.school);
      const { uid, username } = await createUsernameLogin(d.school, d.username, d.password, isParent ? 'parent' : 'staff');
      const loginEmail = `${username}@${d.school}.emberlms.local`;
      if (isParent) {
        const b = writeBatch(db);
        b.set(doc(db, 'tenants', d.school, 'guardians', uid), { userId: uid, username, name: full, displayName: full, email: loginEmail, contactEmail: d.contactEmail || '', phone: d.phone || '', relationship: d.relationship || '', category: 'parent', createdBy: dctx.districtId || 'admin', createdAt: serverTimestamp() });
        d.students.forEach(st => b.set(doc(db, 'tenants', d.school, 'guardianLinks', `${uid}_${st.uid}`), { guardianUid: uid, studentUid: st.uid, linkedBy: dctx.districtId || 'admin', createdAt: serverTimestamp() }));
        await b.commit();
      } else await setDoc(doc(db, 'tenants', d.school, 'users', uid), { userId: uid, username, role: cat.role, caps: cat.caps, category: catId, email: loginEmail, contactEmail: d.contactEmail || '', displayName: full, title: d.title || '', phone: d.phone || '', createdBy: dctx.districtId || 'admin', createdAt: serverTimestamp() });
      await reserveUsername(d.school, username, { uid, email: loginEmail, kind: isParent ? 'parent' : 'staff' });
      credentials(isParent ? 'Parent account created' : `${cat.label.replace(/s( &|$)/, '$1')} added`, full, [['School', sc?.name || d.school], ['Username', username], ['Password', d.password]],
        `${isParent ? `Linked to ${d.students.map(x => x.name).join(', ')}. ` : ''}Sign in at ${location.host}${buildUrl('/login')} → ${isParent ? 'Parent' : 'Staff'} → pick the school → username and password.`);
      return true;
    };
  }
  const rules = [d => d.contactEmail && !isEmail(d.contactEmail) ? { id: 'contactEmail', msg: 'Enter a valid email address.' } : null, d => d.password && d.password.length < 8 ? { id: 'password', msg: 'Use at least 8 characters.' } : null,
    d => d.username !== undefined && !validUsername(cleanUsername(d.username)) ? { id: 'username', msg: '3–30 letters, numbers, dots, dashes or underscores.' } : null];
  // The student picker needs that school's students; reload them when the school changes.
  const env = { students: [] };
  const m = F.formModal({ title: `Add ${cat.label.toLowerCase().replace(/ &.*$/, '').replace(/s$/, '')}`, subtitle: cat.desc, icon: cat.icon, form: { sections: [{ fields }], rules }, env, data: { school: schools[0].id, password: genPassword(), title: cat.titles?.[0] || '', ...preset }, submit: 'Create account', onSubmit: async d => { afterCreds = done; const ok = await onSubmit(d); if (!ok) afterCreds = null; return ok; } });
  // Suggest firstname.lastname (free at that school) as names are typed, until the username is edited by hand.
  const uIn = m.$('[data-input="username"]');
  if (uIn) {
    let touched = false, tm;
    uIn.addEventListener('input', () => { touched = true; });
    const sug = () => { if (touched) return; clearTimeout(tm); tm = setTimeout(async () => { const f = m.$('[data-input="first"]')?.value.trim(), l = m.$('[data-input="last"]')?.value.trim(); if (f) uIn.value = await suggestUsername(m.$('[data-input="school"]').value, f, l); }, 250); };
    ['first', 'last', 'school'].forEach(k => m.$(`[data-input="${k}"]`)?.addEventListener(k === 'school' ? 'change' : 'input', sug));
  }
  if (catId === 'parent') {
    const sel = m.$('[data-input="school"]');
    const loadStudents = async () => { const s = await getDocs(collection(db, 'tenants', sel.value, 'students')).catch(() => ({ docs: [] })); env.students.splice(0, env.students.length, ...s.docs.map(x => ({ uid: x.id, ...x.data() })).filter(x => x.status !== 'pending' && x.status !== 'rejected')); };
    sel.addEventListener('change', loadStudents); loadStudents();
  }
}
