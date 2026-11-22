// Workspace: role dashboards for the Health Office (nurse), Counseling & SPED, Front Office & Registrar,
// Food Service, Transportation, Library, Athletics and IT & Data. Every record is timestamped and
// keeps a history of who did what and when.
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs, onSnapshot, serverTimestamp, arrayUnion, increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
const {
  db, $, $$, ico, refreshIcons, escapeHtml, plural, displayNameOf, tsMillis, toDateInput, render, setTitle, iconTile, badge, avatar,
  skeletonRows, emptyState, errorBox, toast, withBusy, confirmDialog, openModal, modalHeader, modalBody, modalFooter, buildUrl, navigate, live, unsubs,
  pageHeader, tenantPage, routeTokenNow, friendlyError, notify, guardianUidsOf, workAreas
} = globalThis.__ember;
const BUILD = new URL(import.meta.url).search;
const forms = () => import('./staff.js' + BUILD);

// ── Areas ───────────────────────────────────────────────────────────
export const AREAS = {
  clinic: { label: 'Health Office', icon: 'heart-pulse', tone: 'red', who: 'Nurse' },
  counseling: { label: 'Counseling & SPED', icon: 'heart-handshake', tone: 'blue', who: 'Counselor' },
  office: { label: 'Front Office', icon: 'building-2', tone: 'teal', who: 'Registrar' },
  food: { label: 'Food Service', icon: 'utensils', tone: 'amber', who: 'Food service' },
  transport: { label: 'Transportation', icon: 'bus', tone: 'amber', who: 'Transportation' },
  library: { label: 'Library & Devices', icon: 'library', tone: 'violet', who: 'Library' },
  athletics: { label: 'Athletics', icon: 'trophy', tone: 'green', who: 'Athletics' },
  it: { label: 'IT & Data', icon: 'server-cog', tone: 'violet', who: 'IT' },
};

// ── Helpers ─────────────────────────────────────────────────────────
const today = () => toDateInput(new Date());
const pad = n => String(n).padStart(2, '0');
const nowHM = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ms = v => v ? (typeof v === 'number' ? v : tsMillis(v)) : 0;
export const schoolYear = (iso = today()) => { const [y, m] = iso.split('-').map(Number); return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`; };
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; };
const fmt12 = hm => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return `${pad(((h + 11) % 12) + 1)}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtStamp = v => { const t = ms(v); return t ? new Date(t).toLocaleString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
const minsBetween = (a, b) => { if (!a || !b) return ''; const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); const d = (h2 * 60 + m2) - (h1 * 60 + m1); return d >= 0 ? `${d} min` : ''; };
const daysUntil = iso => iso ? Math.round((new Date(iso + 'T12:00') - new Date(today() + 'T12:00')) / 86400000) : null;
const money = n => `$${(Number(n) || 0).toFixed(2)}`;
const col = (ctx, name) => collection(db, 'tenants', ctx.slug, name);
const dref = (ctx, name, id) => doc(db, 'tenants', ctx.slug, name, id);
const stamp = (ctx, action) => ({ at: Date.now(), by: ctx.me.uid, byName: ctx.me.name, action });
const join = v => Array.isArray(v) ? v.join(', ') : (v || '');
const kpi = (label, value, tone = '', sub = '') => `<div class="card p-4"><div class="text-xs text-gray-400 mb-1.5">${label}</div><div class="stat-value ${tone === 'bad' ? 'text-[#f08a8a]' : tone === 'good' ? 'text-[#6ee06e]' : ''}">${value}</div>${sub ? `<div class="text-[11px] text-gray-500 mt-1">${sub}</div>` : ''}</div>`;
function csv(name, header, rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Exported');
}
let studentsCache = null;
async function students(ctx) {
  if (studentsCache?.slug === ctx.slug && Date.now() - studentsCache.at < 60000) return studentsCache.list;
  const list = (await getDocs(col(ctx, 'students'))).docs.map(d => ({ uid: d.id, ...d.data() })).filter(s => s.status !== 'pending' && s.status !== 'rejected').sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
  studentsCache = { slug: ctx.slug, at: Date.now(), list };
  return list;
}
const gradeOf = (list, uid) => list.find(s => s.uid === uid)?.gradeLevel ?? '';
const timeline = log => (log || []).length ? `<ol class="space-y-1.5 mt-2">${[...log].sort((a, b) => a.at - b.at).map(l => `<li class="text-xs text-gray-400 flex gap-2">${ico('clock', 'w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-500')}<span><span class="text-gray-200">${escapeHtml(new Date(l.at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }))}</span> · ${escapeHtml(l.action)} · ${escapeHtml(l.byName || '')}</span></li>`).join('')}</ol>` : '<p class="text-xs text-gray-500">No history.</p>';
const subTabs = (ctx, area, tabs, cur) => `<div class="segmented mb-6 flex-wrap" role="tablist">${tabs.map(([k, l, i]) => `<a href="${buildUrl(`/${ctx.slug}/work/${area}/${k}`)}" class="seg-link" role="tab" aria-pressed="${k === cur}">${ico(i, 'w-3.5 h-3.5')} ${l}</a>`).join('')}</div>`;

// ── Generic timestamped logbook ─────────────────────────────────────
// cfg: { name, title, icon, fields, cols: [[label, rec => html]], addLabel, defaults, filter: rec => bool, extra(rec) }
async function logbook(ctx, el, cfg) {
  const F = await forms(), kids = cfg.students === false ? [] : await students(ctx);
  let from = cfg.from || toDateInput(new Date(Date.now() - 30 * 86400000)), to = today(), q = '', recs = [];
  el.innerHTML = `<section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-white/[0.06]"><div class="flex items-center gap-3 flex-1 min-w-[200px]">${iconTile(cfg.icon, cfg.tone || 'amber')}<div><h2 class="text-white font-medium">${escapeHtml(cfg.title)}</h2>${cfg.hint ? `<p class="text-xs text-gray-500">${escapeHtml(cfg.hint)}</p>` : ''}</div></div>
      <input type="date" class="input !py-1.5 !w-auto" data-lb="from" value="${from}" aria-label="From"><span class="text-gray-500 text-xs">to</span><input type="date" class="input !py-1.5 !w-auto" data-lb="to" value="${to}" aria-label="To">
      <input type="search" class="input !py-1.5 !w-44" data-lb="q" placeholder="Search…" aria-label="Search"><button class="btn btn-secondary btn-sm" data-lb="csv">${ico('download', 'w-3.5 h-3.5')} CSV</button><button class="btn btn-primary btn-sm" data-lb="add">${ico('plus', 'w-3.5 h-3.5')} ${escapeHtml(cfg.addLabel || 'Add')}</button></div>
    <div data-lb="body">${skeletonRows(3)}</div></section>`;
  const body = el.querySelector('[data-lb="body"]');
  const shown = () => recs.filter(r => (r.date || '') >= from && (r.date || '') <= to && (!q || JSON.stringify(r).toLowerCase().includes(q)) && (!cfg.filter || cfg.filter(r)))
    .sort((a, b) => `${b.date}${b.time || b.checkIn || ''}`.localeCompare(`${a.date}${a.time || a.checkIn || ''}`));
  const draw = () => {
    const list = shown();
    body.innerHTML = list.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr>${cfg.cols.map(c => `<th>${escapeHtml(c[0])}</th>`).join('')}<th></th></tr></thead><tbody>${list.map(r => `<tr data-lb-open="${escapeHtml(r.id)}">${cfg.cols.map(c => `<td>${c[1](r) ?? ''}</td>`).join('')}<td class="text-right">${ico('chevron-right', 'w-4 h-4 text-gray-600')}</td></tr>`).join('')}</tbody></table></div><p class="hint px-5 py-2">${plural(list.length, 'record')}</p>`
      : `<div class="p-6">${emptyState({ icon: cfg.icon, title: 'Nothing logged in this range', text: '' })}</div>`;
    refreshIcons();
  };
  const fieldsFor = () => cfg.fields(kids);
  const open = r => {
    const m = openModal({ size: 'lg', align: 'top', html: modalHeader({ title: escapeHtml(cfg.detailTitle ? cfg.detailTitle(r) : (r.studentName || cfg.title)), subtitle: `${fmtDate(r.date)}${r.time ? ' · ' + fmt12(r.time) : ''} · ${escapeHtml(schoolYear(r.date || today()))}`, icon: cfg.icon }) + modalBody(`
      <dl class="grid sm:grid-cols-2 gap-x-6 gap-y-3">${fieldsFor().filter(f => f.type !== 'note' && f.id !== 'students').map(f => { const v = r[f.id]; return v === undefined || v === '' || (Array.isArray(v) && !v.length) ? '' : `<div><dt class="text-[11px] uppercase tracking-wider text-gray-500">${escapeHtml(f.label)}</dt><dd class="text-sm text-gray-200 mt-0.5 whitespace-pre-wrap">${escapeHtml(f.type === 'date' ? fmtDate(v) : f.type === 'time' ? fmt12(v) : join(v))}</dd></div>`; }).join('')}</dl>
      ${cfg.extra ? cfg.extra(r) : ''}
      <h3 class="label mt-6">History</h3>${timeline(r.log)}`) + modalFooter(`<button class="btn btn-ghost" data-lb-del>${ico('trash-2', 'w-4 h-4')} Delete</button><span class="flex-1"></span><button class="btn btn-secondary" data-close>Close</button><button class="btn btn-primary" data-lb-edit>${ico('pencil', 'w-4 h-4')} Edit</button>`) });
    m.$('[data-close]').addEventListener('click', () => m.close());
    m.$('[data-lb-edit]').addEventListener('click', () => { m.close(); edit(r); });
    m.$('[data-lb-del]').addEventListener('click', async () => { if (!await confirmDialog({ title: 'Delete this record?', confirmLabel: 'Delete', danger: true })) return; try { await deleteDoc(dref(ctx, cfg.name, r.id)); m.close(); toast('Deleted'); } catch (ex) { toast(friendlyError(ex), 'error'); } });
    refreshIcons();
  };
  const edit = (r = null) => {
    const data = r ? { ...r, students: r.studentUid ? [{ uid: r.studentUid, name: r.studentName, grade: r.grade ?? '' }] : [] } : { date: today(), time: nowHM(), ...(cfg.defaults ? cfg.defaults() : {}) };
    F.formModal({ title: r ? `Edit · ${cfg.title}` : cfg.addLabel || `Add · ${cfg.title}`, icon: cfg.icon, env: { students: kids }, form: { sections: [{ fields: fieldsFor() }] }, data, submit: r ? 'Save' : 'Add', onSubmit: async d => {
      const st = (d.students || [])[0];
      const rec = { ...d, ...(st ? { studentUid: st.uid, studentName: st.name, grade: gradeOf(kids, st.uid) } : {}), schoolYear: schoolYear(d.date || today()), updatedAt: serverTimestamp() };
      delete rec.students;
      if (r) await updateDoc(dref(ctx, cfg.name, r.id), { ...rec, log: arrayUnion(stamp(ctx, 'Edited')) });
      else { const ref = await addDoc(col(ctx, cfg.name), { ...rec, createdBy: ctx.me.uid, createdByName: ctx.me.name, createdAt: serverTimestamp(), log: [stamp(ctx, 'Created')] }); cfg.afterAdd?.({ id: ref.id, ...rec }); }
      toast(r ? 'Saved' : 'Added'); return true;
    } });
  };
  unsubs.push(onSnapshot(col(ctx, cfg.name), s => { recs = s.docs.map(d => ({ id: d.id, ...d.data() })); if (body.isConnected) draw(); }, e => { body.innerHTML = errorBox(e); refreshIcons(); }));
  el.addEventListener('change', e => { const k = e.target.dataset.lb; if (k === 'from') from = e.target.value; if (k === 'to') to = e.target.value; if (k) draw(); });
  el.addEventListener('input', e => { if (e.target.dataset.lb === 'q') { q = e.target.value.trim().toLowerCase(); draw(); } });
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-lb]');
    if (b?.dataset.lb === 'add') return edit();
    if (b?.dataset.lb === 'csv') return csv(`${cfg.name}-${from}-to-${to}.csv`, ['School Year', 'Date', ...cfg.cols.map(c => c[0]), 'Logged by', 'Logged at'], shown().map(r => [r.schoolYear, fmtDate(r.date), ...cfg.cols.map(c => String(c[1](r) ?? '').replace(/<[^>]+>/g, '')), r.createdByName, fmtStamp(r.createdAt)]));
    const row = e.target.closest('[data-lb-open]'); if (row) open(recs.find(x => x.id === row.dataset.lbOpen));
  });
  return { edit };
}

// ── Inventory (numbered items, stock counts, every change logged) ───
const PREFIX = { clinic: 'MED', food: 'FS', transport: 'TR', library: 'LIB', athletics: 'ATH', it: 'IT', office: 'OFF', counseling: 'CS' };
async function inventory(ctx, el, area, cfg = {}) {
  const F = await forms();
  let items = [], q = '', show = 'all';
  el.innerHTML = `<section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-white/[0.06]"><div class="flex items-center gap-3 flex-1 min-w-[200px]">${iconTile('boxes', 'amber')}<div><h2 class="text-white font-medium">${escapeHtml(cfg.title || 'Inventory')}</h2><p class="text-xs text-gray-500">Every item has a number. Each count change is logged with the time and who made it.</p></div></div>
    <div class="segmented" role="group">${[['all', 'All'], ['low', 'Low stock'], ['out', 'Checked out / in use']].map(([k, l]) => `<button data-inv-show="${k}" aria-pressed="${k === 'all'}">${l}</button>`).join('')}</div>
    <input type="search" class="input !py-1.5 !w-44" data-inv="q" placeholder="Search # or name…" aria-label="Search inventory"><button class="btn btn-secondary btn-sm" data-inv="csv">${ico('download', 'w-3.5 h-3.5')} CSV</button><button class="btn btn-primary btn-sm" data-inv="add">${ico('plus', 'w-3.5 h-3.5')} Item</button></div><div data-inv="body">${skeletonRows(3)}</div></section>`;
  const body = el.querySelector('[data-inv="body"]');
  const low = i => i.lowAt !== undefined && i.lowAt !== '' && Number(i.qty) <= Number(i.lowAt);
  const expSoon = i => i.expires && daysUntil(i.expires) <= 30;
  const list = () => items.filter(i => (!q || `${i.number} ${i.name} ${i.category} ${i.location} ${i.assignedTo || ''}`.toLowerCase().includes(q)) && (show === 'all' || (show === 'low' ? low(i) || expSoon(i) : i.assignedTo))).sort((a, b) => (a.number || '').localeCompare(b.number || ''));
  const draw = () => {
    const l = list();
    body.innerHTML = l.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Item #</th><th>Name</th><th>Category</th><th class="text-right">On hand</th><th>Location</th>${cfg.assign ? '<th>Assigned to</th>' : ''}<th>Expires</th><th>Updated</th><th></th></tr></thead><tbody>${l.map(i => `<tr data-inv-open="${escapeHtml(i.id)}" class="${low(i) ? 'is-low' : ''}"><td class="font-mono text-[#F59E0B]">${escapeHtml(i.number)}</td><td class="text-white">${escapeHtml(i.name)}</td><td>${escapeHtml(i.category || '')}</td>
      <td class="text-right tabular-nums"><span class="inline-flex items-center gap-1"><button class="qty-btn" data-inv-adj="${escapeHtml(i.id)}" data-d="-1" aria-label="Use one">−</button><b class="${low(i) ? 'text-[#f08a8a]' : 'text-white'} w-10 inline-block text-center">${Number(i.qty) || 0}</b><button class="qty-btn" data-inv-adj="${escapeHtml(i.id)}" data-d="1" aria-label="Add one">+</button></span>${low(i) ? `<div class="text-[10px] text-[#f08a8a]">low (≤${escapeHtml(i.lowAt)})</div>` : ''}</td>
      <td>${escapeHtml(i.location || '')}</td>${cfg.assign ? `<td>${escapeHtml(i.assignedTo || '—')}</td>` : ''}<td class="${expSoon(i) ? 'text-[#fcd34d]' : ''}">${escapeHtml(fmtDate(i.expires))}</td><td class="text-[11px] text-gray-500">${escapeHtml(fmtStamp(i.updatedAt))}</td><td class="text-right">${ico('chevron-right', 'w-4 h-4 text-gray-600')}</td></tr>`).join('')}</tbody></table></div><p class="hint px-5 py-2">${plural(l.length, 'item')} · ${items.reduce((a, i) => a + (Number(i.qty) || 0), 0)} units</p>`
      : `<div class="p-6">${emptyState({ icon: 'boxes', title: 'No items', text: 'Add your first item — it gets a number automatically.' })}</div>`;
    refreshIcons();
  };
  const fields = [
    { id: 'name', type: 'text', label: 'Item name', required: true }, { id: 'category', type: 'select', label: 'Category', options: cfg.categories || ['Supplies', 'Equipment', 'Other'] },
    { id: 'qty', type: 'number', label: 'Quantity on hand', min: 0, maxN: 100000, required: true }, { id: 'lowAt', type: 'number', label: 'Warn when at or below', min: 0, maxN: 100000 },
    { id: 'location', type: 'text', label: 'Location', placeholder: 'e.g. Cabinet B, shelf 2' }, { id: 'expires', type: 'date', label: 'Expires' },
    ...(cfg.assign ? [{ id: 'assignedTo', type: 'text', label: 'Assigned to', placeholder: 'Student or staff name' }, { id: 'serial', type: 'text', label: 'Serial / tag number' }] : []),
    { id: 'notes', type: 'textarea', label: 'Notes', rows: 2, span: 'sm:col-span-2' },
  ];
  const nextNumber = () => { const p = PREFIX[area] || 'INV'; const max = items.reduce((a, i) => Math.max(a, Number(String(i.number || '').split('-')[1]) || 0), 0); return `${p}-${String(max + 1).padStart(4, '0')}`; };
  const edit = (i = null) => F.formModal({ title: i ? `Edit ${i.number}` : 'Add an item', subtitle: i ? i.name : `It will be numbered ${nextNumber()}.`, icon: 'boxes', form: { sections: [{ fields }] }, data: i ? { ...i } : { qty: 1 }, submit: i ? 'Save' : 'Add item', onSubmit: async d => {
    const rec = { ...d, qty: Number(d.qty) || 0, lowAt: d.lowAt === '' || d.lowAt === undefined ? '' : Number(d.lowAt), area, updatedAt: serverTimestamp() };
    if (i) { await updateDoc(dref(ctx, 'inventory', i.id), { ...rec, log: arrayUnion(stamp(ctx, `Edited${Number(i.qty) !== rec.qty ? ` · count ${i.qty} → ${rec.qty}` : ''}`)) }); }
    else await addDoc(col(ctx, 'inventory'), { ...rec, number: nextNumber(), createdBy: ctx.me.uid, createdAt: serverTimestamp(), log: [stamp(ctx, `Added · count ${rec.qty}`)] });
    toast(i ? 'Saved' : 'Item added'); return true;
  } });
  const open = i => {
    const m = openModal({ html: modalHeader({ title: `${escapeHtml(i.number)} · ${escapeHtml(i.name)}`, subtitle: `${Number(i.qty) || 0} on hand${i.location ? ' · ' + escapeHtml(i.location) : ''}`, icon: 'boxes' }) + modalBody(`<div class="flex flex-wrap items-end gap-2 mb-5"><div><label class="label" for="inv-n">Adjust count</label><input id="inv-n" type="number" class="input !w-28" value="1" min="1"></div><input id="inv-why" class="input flex-1 min-w-[160px]" placeholder="Reason (e.g. used, received order)"><button class="btn btn-secondary" data-adj="-1">${ico('minus', 'w-4 h-4')} Remove</button><button class="btn btn-primary" data-adj="1">${ico('plus', 'w-4 h-4')} Add</button></div>
      ${i.notes ? `<p class="text-sm text-gray-300 whitespace-pre-wrap mb-4">${escapeHtml(i.notes)}</p>` : ''}<h3 class="label">History</h3>${timeline(i.log)}`) + modalFooter(`<button class="btn btn-ghost" data-del>${ico('trash-2', 'w-4 h-4')} Delete</button><span class="flex-1"></span><button class="btn btn-secondary" data-edit>${ico('pencil', 'w-4 h-4')} Edit</button>`) });
    m.el.addEventListener('click', async e => {
      const a = e.target.closest('[data-adj]');
      if (a) { const n = Math.max(1, Number(m.$('#inv-n').value) || 1) * Number(a.dataset.adj); await adjust(i, n, m.$('#inv-why').value.trim()); m.close(); }
      if (e.target.closest('[data-edit]')) { m.close(); edit(i); }
      if (e.target.closest('[data-del]') && await confirmDialog({ title: `Delete ${i.number}?`, confirmLabel: 'Delete', danger: true })) { await deleteDoc(dref(ctx, 'inventory', i.id)).catch(ex => toast(friendlyError(ex), 'error')); m.close(); }
    });
    refreshIcons();
  };
  const adjust = async (i, n, why = '') => {
    const next = Math.max(0, (Number(i.qty) || 0) + n);
    try { await updateDoc(dref(ctx, 'inventory', i.id), { qty: next, updatedAt: serverTimestamp(), log: arrayUnion(stamp(ctx, `${n > 0 ? '+' : ''}${n} → ${next}${why ? ' · ' + why : ''}`)) }); } catch (ex) { toast(friendlyError(ex), 'error'); }
  };
  unsubs.push(onSnapshot(query(col(ctx, 'inventory'), where('area', '==', area)), s => { items = s.docs.map(d => ({ id: d.id, ...d.data() })); if (body.isConnected) draw(); }, e => { body.innerHTML = errorBox(e); refreshIcons(); }));
  el.addEventListener('input', e => { if (e.target.dataset.inv === 'q') { q = e.target.value.trim().toLowerCase(); draw(); } });
  el.addEventListener('click', e => {
    const sh = e.target.closest('[data-inv-show]'); if (sh) { show = sh.dataset.invShow; el.querySelectorAll('[data-inv-show]').forEach(b => b.setAttribute('aria-pressed', String(b === sh))); return draw(); }
    const adj = e.target.closest('[data-inv-adj]'); if (adj) { e.stopPropagation(); return adjust(items.find(x => x.id === adj.dataset.invAdj), Number(adj.dataset.d), adj.dataset.d === '-1' ? 'used' : 'added'); }
    const b = e.target.closest('[data-inv]'); if (b?.dataset.inv === 'add') return edit();
    if (b?.dataset.inv === 'csv') return csv(`inventory-${area}.csv`, ['Item #', 'Name', 'Category', 'On hand', 'Low at', 'Location', 'Assigned to', 'Serial', 'Expires', 'Last updated'], list().map(i => [i.number, i.name, i.category, i.qty, i.lowAt, i.location, i.assignedTo || '', i.serial || '', fmtDate(i.expires), fmtStamp(i.updatedAt)]));
    const row = e.target.closest('[data-inv-open]'); if (row) open(items.find(x => x.id === row.dataset.invOpen));
  });
  return { lowCount: () => items.filter(low).length };
}

// ═══════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════
export async function viewWork(ctx, area, tab) {
  const t = routeTokenNow();
  const mine = workAreas(ctx);
  if (!mine.length) return navigate(`/${ctx.slug}`, { replace: true });
  if (!mine.includes(area)) return navigate(`/${ctx.slug}/work/${mine[0]}`, { replace: true });
  const A = AREAS[area];
  setTitle(A.label, ctx.tenant.name);
  render(tenantPage(ctx, 'work', `${mine.length > 1 ? `<div class="segmented mb-5 flex-wrap max-w-6xl" role="tablist" aria-label="Workspace">${mine.map(k => `<a href="${buildUrl(`/${ctx.slug}/work/${k}`)}" class="seg-link" role="tab" aria-pressed="${k === area}">${ico(AREAS[k].icon, 'w-3.5 h-3.5')} ${AREAS[k].label}</a>`).join('')}</div>` : ''}
    ${pageHeader({ eyebrow: `${escapeHtml(ctx.tenant.name)} · ${schoolYear()}`, title: A.label, subtitle: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), actions: `<div id="wk-actions" class="flex flex-wrap gap-2"></div>` })}
    <div class="max-w-6xl" id="wk">${skeletonRows(4, 'h-24')}</div>`));
  const el = $('#wk');
  try { await ({ clinic: clinicView, counseling: counselingView, office: officeView, food: foodView, transport: transportView, library: libraryView, athletics: athleticsView, it: itView })[area](ctx, el, tab, t); }
  catch (e) { console.error(e); if (live(t)) { el.innerHTML = errorBox(e); refreshIcons(); } }
}

// ═══════════════════════════════════════════════════════════════
// HEALTH OFFICE (nurse)
// ═══════════════════════════════════════════════════════════════
const REASONS = ['Headache', 'Stomach ache', 'Nausea / vomiting', 'Fever', 'Injury', 'Sore throat', 'Cough / cold', 'Dizziness', 'Menstrual', 'Toothache', 'Rash / skin', 'Eye problem', 'Asthma', 'Diabetes check', 'Allergic reaction', 'Scheduled medication', 'Anxiety / stress', 'Other'];
const TREATMENTS = ['Rest', 'Ice pack', 'Heat pack', 'Bandage / first aid', 'Medication given', 'Temperature taken', 'Blood sugar checked', 'Inhaler / nebulizer', 'Snack / water', 'Called parent', 'Counseling referral', 'Other'];
const DISPOSITIONS = ['RETURN CLASS', 'SENT HOME', 'PARENT PICKED UP', 'STAYED / RESTING', 'EMS / 911', 'REFERRED TO COUNSELOR'];
async function clinicView(ctx, el, tab, t) {
  tab = tab || 'visits';
  const tabs = [['visits', 'Office Visits', 'stethoscope'], ['conditions', 'Health Conditions', 'heart-pulse'], ['ihp', 'IHP Forms', 'file-heart'], ['injuries', 'Injuries', 'bandage'], ['meds', 'Medications', 'pill'], ['inventory', 'Inventory', 'boxes']];
  el.innerHTML = `<div id="cl-kpi" class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">${skeletonRows(1, 'h-20')}</div>${subTabs(ctx, 'clinic', tabs, tab)}<div id="cl-body"></div>`;
  const body = $('#cl-body');
  const kids = await students(ctx);
  if (!live(t)) return;
  // Live KPIs from today's visits, meds and supplies.
  let visits = [], meds = [], invLow = 0;
  const kpis = () => { const tv = visits.filter(v => v.date === today()); $('#cl-kpi') && ($('#cl-kpi').innerHTML = kpi('In the office now', tv.filter(v => v.status !== 'done').length, tv.some(v => v.status !== 'done') ? '' : 'good') + kpi('Visits today', tv.length) + kpi('Sent home today', tv.filter(v => /SENT HOME|PARENT PICKED/.test(v.disposition || '')).length) + kpi('Medications given today', meds.filter(m => m.date === today()).length) + kpi('Low / expiring supplies', invLow, invLow ? 'bad' : 'good')); };
  unsubs.push(onSnapshot(col(ctx, 'clinicVisits'), s => { visits = s.docs.map(d => ({ id: d.id, ...d.data() })); kpis(); }));
  unsubs.push(onSnapshot(col(ctx, 'medLog'), s => { meds = s.docs.map(d => d.data()); kpis(); }));
  unsubs.push(onSnapshot(query(col(ctx, 'inventory'), where('area', '==', 'clinic')), s => { invLow = s.docs.map(d => d.data()).filter(i => (i.lowAt !== '' && i.lowAt !== undefined && Number(i.qty) <= Number(i.lowAt)) || (i.expires && daysUntil(i.expires) <= 30)).length; kpis(); }));
  $('#wk-actions').innerHTML = `<button class="btn btn-primary" id="cl-signin">${ico('log-in', 'w-4 h-4')} Sign in a student</button>`;
  $('#cl-signin').addEventListener('click', () => signInStudent(ctx, kids));
  refreshIcons();
  if (tab === 'visits') return clinicVisits(ctx, body, kids, t);
  if (tab === 'conditions') return healthConditions(ctx, body, kids, t);
  if (tab === 'ihp') return logbook(ctx, body, { name: 'ihp', title: 'Individual Health Plans (IHP)', icon: 'file-heart', tone: 'red', addLabel: 'New IHP', hint: 'Plans for students with chronic conditions. Review dates within 30 days are flagged.', from: '2000-01-01',
    fields: () => [{ id: 'students', type: 'students', label: 'Student', required: true }, { id: 'plan', type: 'select', label: 'Plan type', required: true, options: ['Asthma', 'Diabetes', 'Seizures', 'Severe allergy / anaphylaxis', 'Cardiac', 'Bleeding disorder', 'Migraine', 'Other'] },
      { id: 'status', type: 'chips', label: 'Status', required: true, options: ['Draft', 'Active', 'Expired'] }, { id: 'date', type: 'date', label: 'Effective date', required: true }, { id: 'review', type: 'date', label: 'Review by', required: true },
      { id: 'symptoms', type: 'textarea', label: 'Signs & symptoms to watch for', rows: 2, span: 'sm:col-span-2' }, { id: 'daily', type: 'textarea', label: 'Daily care at school', rows: 2, span: 'sm:col-span-2' },
      { id: 'emergency', type: 'textarea', label: 'Emergency action steps', rows: 3, required: true, span: 'sm:col-span-2' }, { id: 'medications', type: 'text', label: 'Medications at school', span: 'sm:col-span-2' },
      { id: 'contact', type: 'text', label: 'Emergency contact' }, { id: 'physician', type: 'text', label: 'Physician & phone' }, { id: 'signed', type: 'yesno', label: 'Parent signature on file?' }, { id: 'signedOn', type: 'date', label: 'Signed on', showIf: { id: 'signed', eq: 'Yes' } }],
    defaults: () => ({ status: 'Active', review: toDateInput(new Date(Date.now() + 365 * 86400000)) }),
    detailTitle: r => `${r.studentName} · ${r.plan} IHP`,
    cols: [['Student', r => `<span class="text-white">${escapeHtml(r.studentName || '')}</span>`], ['Plan', r => escapeHtml(r.plan || '')], ['Status', r => badge(escapeHtml(r.status || ''), r.status === 'Active' ? 'green' : r.status === 'Expired' ? 'red' : 'muted')], ['Effective', r => fmtDate(r.date)], ['Review by', r => { const d = daysUntil(r.review); return `<span class="${d !== null && d <= 30 ? 'text-[#fcd34d]' : ''}">${fmtDate(r.review)}${d !== null && d <= 30 ? ` · ${d < 0 ? 'overdue' : d + ' days'}` : ''}</span>`; }], ['Signed', r => escapeHtml(r.signed || '')]],
    extra: r => `<button class="btn btn-secondary btn-sm mt-5" data-print-ihp>${ico('printer', 'w-3.5 h-3.5')} Print IHP</button>` });
  if (tab === 'injuries') return logbook(ctx, body, { name: 'injuries', title: 'Injury reports', icon: 'bandage', tone: 'red', addLabel: 'Report an injury',
    fields: () => [{ id: 'students', type: 'students', label: 'Student', required: true }, { id: 'date', type: 'date', label: 'Date', required: true }, { id: 'time', type: 'time', label: 'Time', required: true },
      { id: 'location', type: 'select', label: 'Where', required: true, options: ['Classroom', 'Hallway', 'Playground', 'Gym / PE', 'Cafeteria', 'Athletic field', 'Bus', 'Stairs', 'Restroom', 'Parking lot', 'Off campus / field trip', 'Other'] },
      { id: 'bodyPart', type: 'checks', label: 'Body part', options: ['Head', 'Face', 'Eye', 'Mouth / teeth', 'Neck', 'Back', 'Chest', 'Abdomen', 'Arm', 'Hand / wrist', 'Finger', 'Leg', 'Knee', 'Ankle / foot'] },
      { id: 'kind', type: 'select', label: 'Type of injury', required: true, options: ['Bump / bruise', 'Cut / scrape', 'Sprain / strain', 'Possible fracture', 'Head injury', 'Burn', 'Bite / sting', 'Nosebleed', 'Other'] },
      { id: 'how', type: 'textarea', label: 'How it happened', required: true, rows: 2, span: 'sm:col-span-2' }, { id: 'firstAid', type: 'checks', label: 'First aid given', options: TREATMENTS.slice(0, 9) },
      { id: 'outcome', type: 'select', label: 'Outcome', options: DISPOSITIONS }, { id: 'parentNotified', type: 'time', label: 'Parent notified at' }, { id: 'reportedBy', type: 'text', label: 'Reported / witnessed by' },
      { id: 'reportFiled', type: 'yesno', label: 'Accident report filed?' }, { id: 'followUp', type: 'textarea', label: 'Follow-up', rows: 2, span: 'sm:col-span-2' }],
    cols: [['Date', r => fmtDate(r.date)], ['Time', r => fmt12(r.time)], ['Student', r => `<span class="text-white">${escapeHtml(r.studentName || '')}</span>`], ['Where', r => escapeHtml(r.location || '')], ['Injury', r => escapeHtml(r.kind || '')], ['Body part', r => escapeHtml(join(r.bodyPart))], ['Parent notified', r => fmt12(r.parentNotified)], ['Outcome', r => escapeHtml(r.outcome || '')]] });
  if (tab === 'meds') return medications(ctx, body, kids, t);
  if (tab === 'inventory') return inventory(ctx, body, 'clinic', { title: 'Health office supplies', categories: ['First aid', 'Medication (stock)', 'Equipment', 'PPE', 'Hygiene', 'Other'] });
}
function signInStudent(ctx, kids, preset = null) {
  forms().then(F => F.formModal({ title: 'Sign in a student', subtitle: `Check-in time is recorded automatically (${fmt12(nowHM())}).`, icon: 'log-in', env: { students: kids },
    form: { sections: [{ fields: [{ id: 'students', type: 'students', label: 'Student', required: true }, { id: 'referredBy', type: 'select', label: 'Referred by', options: ['Self', 'Teacher', 'Front office', 'Administrator', 'Coach', 'Bus driver', 'Parent', 'Other'] },
      { id: 'referredName', type: 'text', label: 'Referring person', placeholder: 'e.g. Mr. Smith' }, { id: 'reasons', type: 'checks', label: 'Reason for visit', required: true, options: REASONS, span: 'sm:col-span-2' }, { id: 'complaint', type: 'text', label: 'In their words', span: 'sm:col-span-2' }] }] },
    data: preset || { referredBy: 'Teacher' }, submit: 'Check in', onSubmit: async d => {
      const st = d.students[0], now = new Date();
      await addDoc(col(ctx, 'clinicVisits'), { studentUid: st.uid, studentName: st.name, grade: gradeOf(kids, st.uid), date: today(), schoolYear: schoolYear(), school: ctx.tenant.name, checkIn: nowHM(now), checkInAt: now.getTime(), inOffice: '', timeOut: '', status: 'waiting',
        referredBy: d.referredBy || '', referredName: d.referredName || '', reasons: d.reasons || [], complaint: d.complaint || '', treatments: [], disposition: '', examinedBy: '', createdBy: ctx.me.uid, createdByName: ctx.me.name, createdAt: serverTimestamp(), log: [stamp(ctx, `Checked in at ${fmt12(nowHM(now))}`)] });
      toast(`${st.name} checked in`); return true;
    } }));
}
async function clinicVisits(ctx, el, kids, t) {
  let visits = [], from = toDateInput(new Date(Date.now() - 30 * 86400000)), to = today(), q = '';
  el.innerHTML = `<section class="mb-6"><h2 class="label">In the office now</h2><div id="cv-now"></div></section>
    <section class="card overflow-hidden"><div class="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium flex-1">Office visits</h2>
      <input type="date" class="input !py-1.5 !w-auto" id="cv-from" value="${from}" aria-label="From"><span class="text-gray-500 text-xs">to</span><input type="date" class="input !py-1.5 !w-auto" id="cv-to" value="${to}" aria-label="To">
      <input type="search" id="cv-q" class="input !py-1.5 !w-44" placeholder="Search student…" aria-label="Search"><button class="btn btn-secondary btn-sm" id="cv-csv">${ico('download', 'w-3.5 h-3.5')} CSV</button></div><div id="cv-list"></div></section>`;
  const shown = () => visits.filter(v => v.date >= from && v.date <= to && (!q || (v.studentName || '').toLowerCase().includes(q))).sort((a, b) => `${b.date}${b.checkIn}`.localeCompare(`${a.date}${a.checkIn}`));
  const draw = () => {
    const now = visits.filter(v => v.status !== 'done').sort((a, b) => (a.checkInAt || 0) - (b.checkInAt || 0));
    $('#cv-now').innerHTML = now.length ? `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">${now.map(v => `<div class="card p-4 ${v.status === 'waiting' ? 'border-[#fab219]/40' : 'border-[#0ca30c]/40'}"><div class="flex items-center gap-3">${avatar(v.studentName)}<div class="flex-1 min-w-0"><div class="text-white truncate">${escapeHtml(v.studentName)}</div><div class="text-[11px] text-gray-500">${escapeHtml(join(v.reasons))}</div></div>${badge(v.status === 'waiting' ? 'Waiting' : 'Being seen', v.status === 'waiting' ? 'amber' : 'green')}</div>
        <div class="grid grid-cols-3 gap-2 mt-3 text-center text-[11px]"><div><div class="text-gray-500">Check in</div><div class="text-white tabular-nums">${fmt12(v.checkIn)}</div></div><div><div class="text-gray-500">In office</div><div class="text-white tabular-nums">${fmt12(v.inOffice) || '—'}</div></div><div><div class="text-gray-500">Waiting</div><div class="text-white tabular-nums" data-since="${v.checkInAt || 0}">—</div></div></div>
        <div class="flex gap-2 mt-3">${v.status === 'waiting' ? `<button class="btn btn-secondary btn-sm flex-1" data-cv-seen="${v.id}">${ico('stethoscope', 'w-3.5 h-3.5')} Seen now</button>` : ''}<button class="btn btn-primary btn-sm flex-1" data-cv-out="${v.id}">${ico('log-out', 'w-3.5 h-3.5')} Time out</button></div></div>`).join('')}</div>`
      : `<p class="text-sm text-gray-500 card p-5">No one is in the health office.</p>`;
    const l = shown();
    $('#cv-list').innerHTML = l.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table visit-table"><thead><tr><th>School Year</th><th>Date</th><th>Student</th><th>School</th><th>Check In</th><th>In Office</th><th>Time Out</th><th>Examined By</th><th>Referred By</th><th>Reason for Visit</th><th>Treatment</th><th>Disposition</th></tr></thead><tbody>${l.map(v => `<tr data-cv-open="${v.id}"><td>${escapeHtml(v.schoolYear || schoolYear(v.date))}</td><td>${fmtDate(v.date)}</td><td class="text-white">${escapeHtml(v.studentName)}</td><td>${escapeHtml(v.school || ctx.tenant.name)}</td><td class="tabular-nums">${fmt12(v.checkIn)}</td><td class="tabular-nums">${fmt12(v.inOffice)}</td><td class="tabular-nums">${fmt12(v.timeOut)}</td><td>${escapeHtml(v.examinedBy || '')}</td><td>${escapeHtml([v.referredBy, v.referredName].filter(Boolean).join(' · '))}</td><td>${escapeHtml(join(v.reasons))}</td><td>${escapeHtml(join(v.treatments))}</td><td class="font-medium ${/SENT|EMS|PICKED/.test(v.disposition || '') ? 'text-[#fcd34d]' : 'text-gray-200'}">${escapeHtml(v.disposition || (v.status === 'done' ? '' : 'IN OFFICE'))}</td></tr>`).join('')}</tbody></table></div><p class="hint px-5 py-2">${plural(l.length, 'visit')}</p>`
      : `<div class="p-6">${emptyState({ icon: 'stethoscope', title: 'No visits in this range' })}</div>`;
    tick(); refreshIcons();
  };
  const tick = () => $$('[data-since]').forEach(x => { const s = Number(x.dataset.since); if (s) x.textContent = `${Math.floor((Date.now() - s) / 60000)} min`; });
  const iv = setInterval(tick, 15000); unsubs.push(() => clearInterval(iv));
  unsubs.push(onSnapshot(col(ctx, 'clinicVisits'), s => { visits = s.docs.map(d => ({ id: d.id, ...d.data() })); if (live(t)) draw(); }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  el.addEventListener('change', e => { if (e.target.id === 'cv-from') from = e.target.value; if (e.target.id === 'cv-to') to = e.target.value; if (/cv-(from|to)/.test(e.target.id)) draw(); });
  el.addEventListener('input', e => { if (e.target.id === 'cv-q') { q = e.target.value.trim().toLowerCase(); draw(); } });
  el.addEventListener('click', async e => {
    const seen = e.target.closest('[data-cv-seen]');
    if (seen) { try { await updateDoc(dref(ctx, 'clinicVisits', seen.dataset.cvSeen), { inOffice: nowHM(), inOfficeAt: Date.now(), status: 'in', examinedBy: ctx.me.name, log: arrayUnion(stamp(ctx, `Seen at ${fmt12(nowHM())}`)) }); } catch (ex) { toast(friendlyError(ex), 'error'); } return; }
    const out = e.target.closest('[data-cv-out]'); if (out) return checkOut(ctx, visits.find(v => v.id === out.dataset.cvOut), kids);
    if (e.target.closest('#cv-csv')) return csv(`office-visits-${from}-to-${to}.csv`, ['School Year', 'Date', 'Student', 'Grade', 'School', 'Check In', 'In Office', 'Time Out', 'Minutes', 'Examined By', 'Referred By', 'Reason for Visit', 'Treatment', 'Temperature', 'Disposition', 'Parent contacted', 'Notes'],
      shown().map(v => [v.schoolYear, fmtDate(v.date), v.studentName, v.grade, v.school, fmt12(v.checkIn), fmt12(v.inOffice), fmt12(v.timeOut), minsBetween(v.checkIn, v.timeOut), v.examinedBy, [v.referredBy, v.referredName].filter(Boolean).join(' · '), join(v.reasons), join(v.treatments), v.temp || '', v.disposition, v.parentContact || '', v.notes || '']));
    const row = e.target.closest('[data-cv-open]'); if (row) visitDetail(ctx, visits.find(v => v.id === row.dataset.cvOpen), kids);
  });
}
function checkOut(ctx, v, kids) {
  forms().then(F => F.formModal({ title: `Time out · ${v.studentName}`, subtitle: `Checked in ${fmt12(v.checkIn)}. Time out is recorded when you save.`, icon: 'log-out', env: { students: kids },
    form: { sections: [{ fields: [{ id: 'examinedBy', type: 'text', label: 'Examined by', required: true }, { id: 'temp', type: 'text', label: 'Temperature (°F)', placeholder: 'e.g. 98.6' },
      { id: 'treatments', type: 'checks', label: 'Treatment', required: true, options: TREATMENTS, span: 'sm:col-span-2' },
      { id: 'medGiven', type: 'text', label: 'Medication given (name & dose)', showIf: { id: 'treatments', in: ['Medication given'] }, span: 'sm:col-span-2' },
      { id: 'disposition', type: 'radio', label: 'Disposition', required: true, options: DISPOSITIONS, span: 'sm:col-span-2' },
      { id: 'parentContact', type: 'text', label: 'Parent contacted (who, how, time)', span: 'sm:col-span-2' }, { id: 'notes', type: 'textarea', label: 'Nurse notes', rows: 2, span: 'sm:col-span-2' }] }] },
    data: { examinedBy: v.examinedBy || ctx.me.name, disposition: 'RETURN CLASS' }, submit: 'Record time out', onSubmit: async d => {
      const out = nowHM();
      await updateDoc(dref(ctx, 'clinicVisits', v.id), { examinedBy: d.examinedBy, temp: d.temp || '', treatments: d.treatments || [], medGiven: d.medGiven || '', disposition: d.disposition, parentContact: d.parentContact || '', notes: d.notes || '', inOffice: v.inOffice || v.checkIn, timeOut: out, timeOutAt: Date.now(), status: 'done', log: arrayUnion(stamp(ctx, `Time out ${fmt12(out)} · ${d.disposition}`)) });
      if ((d.treatments || []).includes('Medication given') && d.medGiven) await addDoc(col(ctx, 'medLog'), { studentUid: v.studentUid, studentName: v.studentName, date: today(), time: out, schoolYear: schoolYear(), medication: d.medGiven, route: '', givenBy: ctx.me.name, visitId: v.id, createdBy: ctx.me.uid, createdAt: serverTimestamp(), log: [stamp(ctx, 'Given during office visit')] });
      if (/SENT HOME|PICKED|EMS/.test(d.disposition)) guardianUidsOf(ctx, [v.studentUid]).then(to => notify(ctx, { to, kind: 'system', title: `${v.studentName} left school from the health office`, body: `${d.disposition} at ${fmt12(out)} · ${join(v.reasons)}`, link: `/${ctx.slug}/record/${v.studentUid}/health` })).catch(() => {});
      toast(`${v.studentName}: ${d.disposition.toLowerCase()}`); return true;
    } }));
}
function visitDetail(ctx, v, kids) {
  const row = (k, val) => val ? `<div><dt class="text-[11px] uppercase tracking-wider text-gray-500">${k}</dt><dd class="text-sm text-gray-100 mt-0.5">${escapeHtml(val)}</dd></div>` : `<div><dt class="text-[11px] uppercase tracking-wider text-gray-500">${k}</dt><dd class="text-sm text-gray-600 mt-0.5">—</dd></div>`;
  const m = openModal({ size: 'lg', align: 'top', html: modalHeader({ title: escapeHtml(v.studentName), subtitle: `Office visit · ${fmtDate(v.date)}`, icon: 'stethoscope', tone: 'red' }) + modalBody(`
    <dl class="visit-sheet grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">${row('School Year', v.schoolYear)}${row('Date', fmtDate(v.date))}${row('School', v.school || ctx.tenant.name)}${row('Check In', fmt12(v.checkIn))}${row('In Office', fmt12(v.inOffice))}${row('Time Out', fmt12(v.timeOut))}
      ${row('Examined By', v.examinedBy)}${row('Referred By', [v.referredBy, v.referredName].filter(Boolean).join(' · '))}${row('Grade', v.grade ? String(v.grade) : '')}${row('Reason for Visit', join(v.reasons))}${row('Treatment', join(v.treatments))}${row('Disposition', v.disposition)}
      ${row('Temperature', v.temp ? v.temp + ' °F' : '')}${row('Medication given', v.medGiven)}${row('Parent contacted', v.parentContact)}</dl>
    ${v.complaint ? `<p class="text-sm text-gray-300 mt-4"><span class="text-gray-500">Complaint:</span> “${escapeHtml(v.complaint)}”</p>` : ''}${v.notes ? `<p class="text-sm text-gray-300 mt-2 whitespace-pre-wrap"><span class="text-gray-500">Notes:</span> ${escapeHtml(v.notes)}</p>` : ''}
    <h3 class="label mt-6">Timeline</h3>${timeline(v.log)}`) + modalFooter(`<button class="btn btn-ghost" data-del>${ico('trash-2', 'w-4 h-4')} Delete</button><span class="flex-1"></span><a class="btn btn-secondary" href="${buildUrl(`/${ctx.slug}/record/${v.studentUid}/health`)}">${ico('heart-pulse', 'w-4 h-4')} Health record</a>${v.status === 'done' ? '' : `<button class="btn btn-primary" data-out>${ico('log-out', 'w-4 h-4')} Time out</button>`}`) });
  m.$('[data-out]')?.addEventListener('click', () => { m.close(); checkOut(ctx, v, kids); });
  m.$('[data-del]').addEventListener('click', async () => { if (await confirmDialog({ title: 'Delete this visit?', confirmLabel: 'Delete', danger: true })) { await deleteDoc(dref(ctx, 'clinicVisits', v.id)).catch(ex => toast(friendlyError(ex), 'error')); m.close(); } });
  refreshIcons();
}
async function healthConditions(ctx, el, kids, t) {
  el.innerHTML = skeletonRows(3);
  const docs = (await getDocs(col(ctx, 'health'))).docs.map(d => ({ uid: d.id, ...d.data() }));
  if (!live(t)) return;
  const name = uid => displayNameOf(kids.find(s => s.uid === uid) || {}) || 'Student';
  const rows = docs.flatMap(h => [...(h.conditions || []).map(c => ({ uid: h.uid, kind: 'Condition', name: c.name, detail: c.notes || '', sev: '' })), ...(h.allergies || []).map(a => ({ uid: h.uid, kind: 'Allergy', name: a.name, detail: [a.reaction, a.epipen === 'Yes' ? 'EpiPen' : ''].filter(Boolean).join(' · '), sev: a.severity || '' }))]);
  const severe = rows.filter(r => /Severe|Life/.test(r.sev));
  let q = '';
  const draw = () => {
    const l = rows.filter(r => !q || `${name(r.uid)} ${r.name}`.toLowerCase().includes(q)).sort((a, b) => name(a.uid).localeCompare(name(b.uid)));
    el.querySelector('#hc-list').innerHTML = l.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Student</th><th>Grade</th><th>Type</th><th>Condition / allergy</th><th>Severity</th><th>Details</th></tr></thead><tbody>${l.map(r => `<tr data-hc="${escapeHtml(r.uid)}"><td class="text-white">${escapeHtml(name(r.uid))}</td><td>${escapeHtml(String(gradeOf(kids, r.uid)))}</td><td>${escapeHtml(r.kind)}</td><td>${escapeHtml(r.name)}</td><td>${r.sev ? badge(escapeHtml(r.sev), /Life|Severe/.test(r.sev) ? 'red' : 'amber') : ''}</td><td class="text-gray-400">${escapeHtml(r.detail)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="p-6">${emptyState({ icon: 'heart-pulse', title: 'No conditions on file', text: 'Add them from a student’s Health Info.' })}</div>`;
    refreshIcons();
  };
  el.innerHTML = `${severe.length ? `<div class="mb-5 p-4 rounded-xl border border-[#d03b3b]/40 bg-[#d03b3b]/10 flex gap-3">${ico('octagon-alert', 'w-5 h-5 st-critical shrink-0')}<div><div class="text-white">${plural(new Set(severe.map(s => s.uid)).size, 'student')} with severe or life-threatening allergies</div><div class="text-xs text-gray-300 mt-1">${severe.map(s => `${escapeHtml(name(s.uid))} (${escapeHtml(s.name)})`).join(' · ')}</div></div></div>` : ''}
    <section class="card overflow-hidden"><div class="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium flex-1">Health conditions & allergies · ${plural(new Set(rows.map(r => r.uid)).size, 'student')}</h2><input type="search" id="hc-q" class="input !py-1.5 !w-48" placeholder="Search…" aria-label="Search"><button class="btn btn-secondary btn-sm" id="hc-csv">${ico('download', 'w-3.5 h-3.5')} CSV</button></div><div id="hc-list"></div></section>`;
  draw();
  el.addEventListener('input', e => { if (e.target.id === 'hc-q') { q = e.target.value.trim().toLowerCase(); draw(); } });
  el.addEventListener('click', e => { if (e.target.closest('#hc-csv')) return csv('health-conditions.csv', ['Student', 'Grade', 'Type', 'Name', 'Severity', 'Details'], rows.map(r => [name(r.uid), gradeOf(kids, r.uid), r.kind, r.name, r.sev, r.detail])); const r = e.target.closest('[data-hc]'); if (r) navigate(`/${ctx.slug}/record/${r.dataset.hc}/health`); });
}
async function medications(ctx, el, kids, t) {
  el.innerHTML = `<div id="md-supply"></div><div id="md-log"></div>`;
  // Student medicine on hand: count goes down with every dose given (logged).
  const box = $('#md-supply'), F = await forms();
  let supply = [];
  box.innerHTML = `<section class="card overflow-hidden mb-6"><div class="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-white/[0.06]"><div class="flex items-center gap-3 flex-1">${iconTile('pill', 'red')}<div><h2 class="text-white font-medium">Student medications on hand</h2><p class="text-xs text-gray-500">Doses left, schedule and expiration. “Give dose” logs it and counts down.</p></div></div><button class="btn btn-primary btn-sm" id="md-add">${ico('plus', 'w-3.5 h-3.5')} Medication</button></div><div id="md-sbody">${skeletonRows(2)}</div></section>`;
  const draw = () => {
    $('#md-sbody').innerHTML = supply.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Student</th><th>Medication</th><th>Dose</th><th>Schedule</th><th class="text-right">Doses left</th><th>Expires</th><th>Last given</th><th></th></tr></thead><tbody>${[...supply].sort((a, b) => (a.studentName || '').localeCompare(b.studentName || '')).map(s => { const low = Number(s.count) <= Number(s.lowAt || 5), exp = s.expires && daysUntil(s.expires) <= 30; return `<tr><td class="text-white">${escapeHtml(s.studentName)}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.dose || '')}</td><td>${escapeHtml(s.schedule || '')}${s.time ? ' · ' + fmt12(s.time) : ''}</td><td class="text-right tabular-nums ${low ? 'text-[#f08a8a]' : 'text-white'}">${Number(s.count) || 0}${low ? ' · low' : ''}</td><td class="${exp ? 'text-[#fcd34d]' : ''}">${fmtDate(s.expires)}</td><td class="text-[11px] text-gray-500">${escapeHtml(fmtStamp(s.lastGivenAt))}</td><td class="text-right whitespace-nowrap"><button class="btn btn-secondary btn-sm" data-md-give="${s.id}">${ico('syringe', 'w-3.5 h-3.5')} Give dose</button> <button class="btn-icon" data-md-edit="${s.id}" aria-label="Edit">${ico('pencil', 'w-4 h-4')}</button></td></tr>`; }).join('')}</tbody></table></div>` : `<div class="p-6">${emptyState({ icon: 'pill', title: 'No medications on file' })}</div>`;
    refreshIcons();
  };
  const fields = [{ id: 'students', type: 'students', label: 'Student', required: true }, { id: 'name', type: 'text', label: 'Medication', required: true }, { id: 'dose', type: 'text', label: 'Dose', required: true, placeholder: 'e.g. 200 mg / 1 tablet' },
    { id: 'route', type: 'select', label: 'Route', options: ['By mouth', 'Inhaled', 'Injection', 'Topical', 'Eye drops', 'Nasal', 'Other'] }, { id: 'schedule', type: 'select', label: 'When', options: ['Daily', 'As needed (PRN)', 'Before lunch', 'Emergency only', 'Other'] }, { id: 'time', type: 'time', label: 'Scheduled time' },
    { id: 'count', type: 'number', label: 'Doses on hand', required: true, min: 0, maxN: 1000 }, { id: 'lowAt', type: 'number', label: 'Warn at', min: 0, maxN: 100 }, { id: 'expires', type: 'date', label: 'Expires' }, { id: 'authorized', type: 'yesno', label: 'Doctor & parent authorization on file?' }];
  const edit = (s = null) => F.formModal({ title: s ? `Edit · ${s.name}` : 'Add a student medication', icon: 'pill', env: { students: kids }, form: { sections: [{ fields }] }, data: s ? { ...s, students: [{ uid: s.studentUid, name: s.studentName }] } : { count: 30, lowAt: 5, schedule: 'Daily', route: 'By mouth' }, onSubmit: async d => {
    const st = d.students[0], rec = { ...d, studentUid: st.uid, studentName: st.name, count: Number(d.count) || 0, lowAt: Number(d.lowAt) || 0, updatedAt: serverTimestamp() }; delete rec.students;
    if (s) await updateDoc(dref(ctx, 'medSupply', s.id), { ...rec, log: arrayUnion(stamp(ctx, `Edited · ${s.count} → ${rec.count} doses`)) }); else await addDoc(col(ctx, 'medSupply'), { ...rec, createdAt: serverTimestamp(), log: [stamp(ctx, `Received · ${rec.count} doses`)] });
    toast('Saved'); return true;
  } });
  unsubs.push(onSnapshot(col(ctx, 'medSupply'), s => { supply = s.docs.map(d => ({ id: d.id, ...d.data() })); if (live(t)) draw(); }));
  box.addEventListener('click', async e => {
    if (e.target.closest('#md-add')) return edit();
    const ed = e.target.closest('[data-md-edit]'); if (ed) return edit(supply.find(x => x.id === ed.dataset.mdEdit));
    const g = e.target.closest('[data-md-give]');
    if (g) {
      const s = supply.find(x => x.id === g.dataset.mdGive); if ((Number(s.count) || 0) <= 0) return toast('None left — ask the family for more.', 'error');
      withBusy(g, '…', async () => { const tm = nowHM(); try {
        await updateDoc(dref(ctx, 'medSupply', s.id), { count: increment(-1), lastGivenAt: Date.now(), log: arrayUnion(stamp(ctx, `Dose given at ${fmt12(tm)} · ${Number(s.count) - 1} left`)) });
        await addDoc(col(ctx, 'medLog'), { studentUid: s.studentUid, studentName: s.studentName, date: today(), time: tm, schoolYear: schoolYear(), medication: s.name, dose: s.dose || '', route: s.route || '', givenBy: ctx.me.name, supplyId: s.id, createdBy: ctx.me.uid, createdAt: serverTimestamp(), log: [stamp(ctx, `Given at ${fmt12(tm)}`)] });
        toast(`${s.name} given to ${s.studentName}`);
      } catch (ex) { toast(friendlyError(ex), 'error'); } });
    }
  });
  return logbook(ctx, $('#md-log'), { name: 'medLog', title: 'Medication administration log', icon: 'clipboard-list', tone: 'red', addLabel: 'Log a dose',
    fields: () => [{ id: 'students', type: 'students', label: 'Student', required: true }, { id: 'medication', type: 'text', label: 'Medication', required: true }, { id: 'dose', type: 'text', label: 'Dose' }, { id: 'route', type: 'select', label: 'Route', options: ['By mouth', 'Inhaled', 'Injection', 'Topical', 'Eye drops', 'Nasal', 'Other'] }, { id: 'date', type: 'date', label: 'Date', required: true }, { id: 'time', type: 'time', label: 'Time given', required: true }, { id: 'givenBy', type: 'text', label: 'Given by', required: true }, { id: 'notes', type: 'text', label: 'Notes', span: 'sm:col-span-2' }],
    defaults: () => ({ givenBy: ctx.me.name, route: 'By mouth' }),
    cols: [['Date', r => fmtDate(r.date)], ['Time', r => fmt12(r.time)], ['Student', r => `<span class="text-white">${escapeHtml(r.studentName || '')}</span>`], ['Medication', r => escapeHtml(r.medication || '')], ['Dose', r => escapeHtml(r.dose || '')], ['Route', r => escapeHtml(r.route || '')], ['Given by', r => escapeHtml(r.givenBy || '')]] });
}

// ═══════════════════════════════════════════════════════════════
// COUNSELING & SPED
// ═══════════════════════════════════════════════════════════════
async function counselingView(ctx, el, tab, t) {
  tab = tab || 'caseload';
  const kids = await students(ctx);
  if (!live(t)) return;
  const iep = kids.filter(s => s.iep), p504 = kids.filter(s => s.plan504), ell = kids.filter(s => s.ell);
  el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">${kpi('IEP', iep.length)}${kpi('504 plans', p504.length)}${kpi('ELL', ell.length)}${kpi('Credit check: behind', '<span id="cs-behind">…</span>')}</div>
    ${subTabs(ctx, 'counseling', [['caseload', 'Caseload', 'users'], ['sessions', 'Sessions', 'messages-square'], ['credits', 'Graduation credits', 'graduation-cap'], ['meetings', 'IEP / 504 meetings', 'calendar-check']], tab)}<div id="cs-body"></div>`;
  const body = $('#cs-body');
  // Credits earned vs. expected (6 per completed high-school year).
  const hist = (await getDocs(col(ctx, 'academicHistory')).catch(() => ({ docs: [] }))).docs.map(d => d.data());
  const credits = {}; hist.forEach(h => { if (!['F', 'NC', 'W'].includes(String(h.finalGrade || '').toUpperCase())) credits[h.studentUid] = (credits[h.studentUid] || 0) + (Number(h.credits) || 0); });
  const hs = kids.filter(s => Number(s.gradeLevel) >= 9).map(s => ({ ...s, earned: credits[s.uid] || 0, expected: (Number(s.gradeLevel) - 9) * 6 }));
  const behind = hs.filter(s => s.earned < s.expected);
  $('#cs-behind').textContent = behind.length;
  $('#wk-actions').innerHTML = `<button class="btn btn-primary" id="cs-new">${ico('plus', 'w-4 h-4')} Log a session</button>`;
  refreshIcons();
  const sessions = { name: 'counselingSessions', title: 'Counseling sessions', icon: 'messages-square', tone: 'blue', addLabel: 'Log a session', hint: 'Confidential — counselors and SPED staff only.',
    fields: () => [{ id: 'students', type: 'students', label: 'Student', required: true }, { id: 'date', type: 'date', label: 'Date', required: true }, { id: 'time', type: 'time', label: 'Check in', required: true }, { id: 'timeOut', type: 'time', label: 'Check out' },
      { id: 'type', type: 'select', label: 'Type', required: true, options: ['Academic', 'College & career', 'Schedule change', 'Social-emotional', 'Crisis', 'Attendance', 'Parent conference', 'Group session', 'Other'] },
      { id: 'referredBy', type: 'select', label: 'Referred by', options: ['Self', 'Teacher', 'Parent', 'Administrator', 'Nurse', 'Other'] }, { id: 'notes', type: 'textarea', label: 'Notes', rows: 3, span: 'sm:col-span-2' }, { id: 'followUp', type: 'date', label: 'Follow up on' }, { id: 'parentContacted', type: 'yesno', label: 'Parent contacted?' }],
    cols: [['Date', r => fmtDate(r.date)], ['Check in', r => fmt12(r.time)], ['Check out', r => fmt12(r.timeOut)], ['Student', r => `<span class="text-white">${escapeHtml(r.studentName || '')}</span>`], ['Type', r => escapeHtml(r.type || '')], ['Referred by', r => escapeHtml(r.referredBy || '')], ['Follow up', r => { const d = daysUntil(r.followUp); return r.followUp ? `<span class="${d !== null && d <= 0 ? 'text-[#fcd34d]' : ''}">${fmtDate(r.followUp)}</span>` : ''; }]] };
  $('#cs-new').addEventListener('click', async () => { if (tab !== 'sessions') return navigate(`/${ctx.slug}/work/counseling/sessions`); });
  if (tab === 'sessions') { const lb = await logbook(ctx, body, sessions); $('#cs-new').onclick = () => lb.edit(); return; }
  if (tab === 'meetings') return logbook(ctx, body, { name: 'planMeetings', title: 'IEP / 504 meetings', icon: 'calendar-check', tone: 'blue', addLabel: 'Schedule a meeting', from: '2000-01-01',
    fields: () => [{ id: 'students', type: 'students', label: 'Student', required: true }, { id: 'plan', type: 'chips', label: 'Plan', required: true, options: ['IEP', '504', 'ELL', 'Other'] }, { id: 'kind', type: 'select', label: 'Meeting', required: true, options: ['Annual review', 'Initial eligibility', 'Re-evaluation', 'Amendment', 'Transition', 'Other'] },
      { id: 'date', type: 'date', label: 'Date', required: true }, { id: 'time', type: 'time', label: 'Time' }, { id: 'attendees', type: 'text', label: 'Attendees', span: 'sm:col-span-2' }, { id: 'status', type: 'chips', label: 'Status', options: ['Scheduled', 'Held', 'Rescheduled', 'Cancelled'] }, { id: 'outcome', type: 'textarea', label: 'Outcome / notes', rows: 2, span: 'sm:col-span-2' }],
    defaults: () => ({ status: 'Scheduled', plan: 'IEP' }), filter: () => true,
    cols: [['Date', r => fmtDate(r.date)], ['Time', r => fmt12(r.time)], ['Student', r => `<span class="text-white">${escapeHtml(r.studentName || '')}</span>`], ['Plan', r => escapeHtml(r.plan || '')], ['Meeting', r => escapeHtml(r.kind || '')], ['Status', r => badge(escapeHtml(r.status || ''), r.status === 'Held' ? 'green' : r.status === 'Cancelled' ? 'muted' : 'blue')]] });
  if (tab === 'credits') {
    body.innerHTML = `<section class="card overflow-hidden"><div class="px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium">Graduation credit check</h2><p class="text-xs text-gray-500">Credits earned from Academic History vs. expected (6 per completed year of high school, 24 to graduate).</p></div>
      ${hs.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Student</th><th>Grade</th><th class="text-right">Earned</th><th class="text-right">Expected</th><th>Progress to 24</th><th>Status</th></tr></thead><tbody>${[...hs].sort((a, b) => (a.earned - a.expected) - (b.earned - b.expected)).map(s => `<tr data-go="${s.uid}"><td class="text-white">${escapeHtml(displayNameOf(s))}</td><td>${escapeHtml(String(s.gradeLevel))}</td><td class="text-right tabular-nums">${s.earned}</td><td class="text-right tabular-nums">${s.expected}</td><td><span class="block h-2 w-32 rounded bg-white/[0.06] overflow-hidden"><span class="block h-full ${s.earned < s.expected ? 'bg-[#d03b3b]' : 'bg-[#0ca30c]'}" style="width:${Math.min(100, s.earned / 24 * 100)}%"></span></span></td><td>${s.earned < s.expected ? badge(`${s.expected - s.earned} behind`, 'red') : badge('On track', 'green')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="p-6">${emptyState({ icon: 'graduation-cap', title: 'No high-school students yet' })}</div>`}</section>`;
    body.addEventListener('click', e => { const r = e.target.closest('[data-go]'); if (r) navigate(`/${ctx.slug}/record/${r.dataset.go}/graduation`); });
    return refreshIcons();
  }
  const rows = kids.filter(s => s.iep || s.plan504 || s.ell);
  body.innerHTML = `<section class="card overflow-hidden"><div class="px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium">Caseload · ${plural(rows.length, 'student')}</h2></div>${rows.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Student</th><th>ID</th><th>Grade</th><th>Plans</th><th class="text-right">Credits</th></tr></thead><tbody>${rows.map(s => `<tr data-go="${s.uid}"><td class="text-white">${escapeHtml(displayNameOf(s))}</td><td class="font-mono text-xs">${escapeHtml(s.studentNumber || '')}</td><td>${escapeHtml(String(s.gradeLevel ?? ''))}</td><td>${[s.iep ? badge('IEP', 'violet') : '', s.plan504 ? badge('504', 'blue') : '', s.ell ? badge('ELL', 'muted') : ''].join(' ')}</td><td class="text-right tabular-nums">${credits[s.uid] || 0}</td></tr>`).join('')}</tbody></table></div>` : `<div class="p-6">${emptyState({ icon: 'users', title: 'No students on a plan', text: 'Mark IEP / 504 / ELL from a student’s Services tab.' })}</div>`}</section>`;
  body.addEventListener('click', e => { const r = e.target.closest('[data-go]'); if (r) navigate(`/${ctx.slug}/record/${r.dataset.go}/services`); });
  refreshIcons();
}

// ═══════════════════════════════════════════════════════════════
// FRONT OFFICE & REGISTRAR
// ═══════════════════════════════════════════════════════════════
async function officeView(ctx, el, tab, t) {
  tab = tab || 'desk';
  const kids = await students(ctx);
  const att = (await getDocs(query(col(ctx, 'attendance'), where('date', '==', today()))).catch(() => ({ docs: [] }))).docs.map(d => d.data());
  if (!live(t)) return;
  const absent = att.filter(a => a.code && a.code !== 'P'), tardy = att.filter(a => a.code === 'T');
  const newKids = kids.filter(s => ms(s.createdAt) > Date.now() - 30 * 86400000);
  const pending = (await getDocs(query(col(ctx, 'students'), where('status', '==', 'pending'))).catch(() => ({ docs: [] }))).size;
  el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">${kpi('Enrolled', kids.length)}${kpi('Absent today', new Set(absent.filter(a => a.code !== 'T').map(a => a.studentUid)).size, absent.length ? 'bad' : 'good')}${kpi('Tardy today', new Set(tardy.map(a => a.studentUid)).size)}${kpi('New this month', newKids.length)}${kpi('Waiting for approval', pending, pending ? 'bad' : '')}</div>
    ${subTabs(ctx, 'office', [['desk', 'Sign in / out', 'door-open'], ['attendance', 'Today’s attendance', 'calendar-check'], ['enroll', 'Enrollment', 'user-plus'], ['contacts', 'Parent contacts', 'phone'], ['inventory', 'Inventory', 'boxes']], tab)}<div id="of-body"></div>`;
  const body = $('#of-body');
  if (tab === 'desk') return logbook(ctx, body, { name: 'frontOffice', title: 'Sign in / sign out', icon: 'door-open', tone: 'teal', addLabel: 'New sign in / out', hint: 'Late arrivals, early dismissals and visitors — times are recorded automatically.', from: today(),
    fields: () => [{ id: 'kind', type: 'chips', label: 'Type', required: true, options: ['Late arrival', 'Early dismissal', 'Visitor', 'Volunteer', 'Return to campus'] }, { id: 'students', type: 'students', label: 'Student', showIf: { id: 'kind', in: ['Late arrival', 'Early dismissal', 'Return to campus'] } },
      { id: 'visitor', type: 'text', label: 'Visitor name', showIf: { id: 'kind', in: ['Visitor', 'Volunteer'] } }, { id: 'date', type: 'date', label: 'Date', required: true }, { id: 'time', type: 'time', label: 'Time in / out', required: true },
      { id: 'reason', type: 'select', label: 'Reason', options: ['Appointment (medical)', 'Appointment (dental)', 'Illness', 'Family emergency', 'Overslept / traffic', 'Bus late', 'Court / legal', 'Meeting', 'Delivery', 'Other'] },
      { id: 'by', type: 'text', label: 'Signed out / dropped off by', placeholder: 'Parent or guardian name' }, { id: 'idChecked', type: 'yesno', label: 'Photo ID checked?' }, { id: 'excused', type: 'yesno', label: 'Excused?' }, { id: 'notes', type: 'text', label: 'Notes', span: 'sm:col-span-2' }],
    defaults: () => ({ kind: 'Late arrival', idChecked: 'Yes' }),
    detailTitle: r => r.studentName || r.visitor || r.kind,
    cols: [['Time', r => fmt12(r.time)], ['Date', r => fmtDate(r.date)], ['Type', r => badge(escapeHtml(r.kind || ''), /Late/.test(r.kind) ? 'amber' : /Early/.test(r.kind) ? 'blue' : 'muted')], ['Who', r => `<span class="text-white">${escapeHtml(r.studentName || r.visitor || '')}</span>`], ['Reason', r => escapeHtml(r.reason || '')], ['By', r => escapeHtml(r.by || '')], ['ID', r => escapeHtml(r.idChecked || '')], ['Excused', r => escapeHtml(r.excused || '')]] });
  if (tab === 'contacts') return logbook(ctx, body, { name: 'parentContacts', title: 'Parent contact log', icon: 'phone', tone: 'teal', addLabel: 'Log a contact',
    fields: () => [{ id: 'students', type: 'students', label: 'Student', required: true }, { id: 'date', type: 'date', label: 'Date', required: true }, { id: 'time', type: 'time', label: 'Time', required: true }, { id: 'who', type: 'text', label: 'Parent / guardian', required: true },
      { id: 'method', type: 'select', label: 'How', options: ['Phone call', 'Voicemail', 'Email', 'Text / app', 'In person', 'Letter home'] }, { id: 'reason', type: 'select', label: 'Reason', options: ['Attendance', 'Enrollment / records', 'Health', 'Behavior', 'Transportation', 'Billing / lunch', 'General'] }, { id: 'outcome', type: 'textarea', label: 'Outcome', rows: 2, span: 'sm:col-span-2' }],
    cols: [['Date', r => fmtDate(r.date)], ['Time', r => fmt12(r.time)], ['Student', r => `<span class="text-white">${escapeHtml(r.studentName || '')}</span>`], ['Contact', r => escapeHtml(r.who || '')], ['How', r => escapeHtml(r.method || '')], ['Reason', r => escapeHtml(r.reason || '')]] });
  if (tab === 'inventory') return inventory(ctx, body, 'office', { title: 'Office supplies', categories: ['Paper & printing', 'Forms', 'Visitor badges', 'Equipment', 'Other'] });
  if (tab === 'enroll') {
    body.innerHTML = `<section class="card overflow-hidden"><div class="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium flex-1">Enrolled in the last 30 days</h2><a class="btn btn-primary btn-sm" href="${buildUrl(`/${ctx.slug}/${ctx.isAdmin ? 'admin/' : ''}students`)}">${ico('user-plus', 'w-3.5 h-3.5')} Enroll a student</a><button class="btn btn-secondary btn-sm" id="en-csv">${ico('download', 'w-3.5 h-3.5')} Roster CSV</button></div>
      ${newKids.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Enrolled</th><th>Student</th><th>ID</th><th>Grade</th><th>Courses</th><th>Contacts</th></tr></thead><tbody>${newKids.sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).map(s => `<tr data-go="${s.uid}"><td>${escapeHtml(fmtStamp(s.createdAt))}</td><td class="text-white">${escapeHtml(displayNameOf(s))}</td><td class="font-mono text-xs">${escapeHtml(s.studentNumber || '')}</td><td>${escapeHtml(String(s.gradeLevel ?? ''))}</td><td>${(s.enrolledCourseIds || []).length}</td><td>${(s.contacts || []).length ? badge('On file', 'green') : badge('Missing', 'red')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="p-6">${emptyState({ icon: 'user-plus', title: 'No new students this month' })}</div>`}</section>`;
    body.addEventListener('click', e => { const r = e.target.closest('[data-go]'); if (r) navigate(`/${ctx.slug}/record/${r.dataset.go}/info`); if (e.target.closest('#en-csv')) csv('enrollment.csv', ['Student ID', 'Name', 'Grade', 'Enrolled', 'Contacts'], kids.map(s => [s.studentNumber || '', displayNameOf(s), s.gradeLevel ?? '', fmtStamp(s.createdAt), (s.contacts || []).length])); });
    return refreshIcons();
  }
  // Today's attendance
  const byStudent = {}; absent.forEach(a => { (byStudent[a.studentUid] ||= { name: a.studentName, list: [] }).list.push(a); });
  body.innerHTML = `<section class="card overflow-hidden"><div class="px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium">Absences & tardies today · ${plural(Object.keys(byStudent).length, 'student')}</h2></div>${Object.keys(byStudent).length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Student</th><th>Classes</th><th>Codes</th><th>Notes</th></tr></thead><tbody>${Object.entries(byStudent).map(([uid, x]) => `<tr data-go="${uid}"><td class="text-white">${escapeHtml(x.name || '')}</td><td>${escapeHtml(x.list.map(a => a.courseTitle).join(', '))}</td><td>${x.list.map(a => badge(escapeHtml(a.code), a.code === 'T' ? 'amber' : 'red')).join(' ')}</td><td class="text-gray-400">${escapeHtml(x.list.map(a => a.note).filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="p-6">${emptyState({ icon: 'calendar-check', tone: 'green', title: 'No absences recorded yet today' })}</div>`}</section>`;
  body.addEventListener('click', e => { const r = e.target.closest('[data-go]'); if (r) navigate(`/${ctx.slug}/record/${r.dataset.go}/attendance`); });
  refreshIcons();
}

// ═══════════════════════════════════════════════════════════════
// FOOD SERVICE — lunch accounts, point of sale, meals served
// ═══════════════════════════════════════════════════════════════
const PRICE = { Paid: 3.25, Reduced: 0.40, Free: 0, 'Universal / CEP': 0 };
async function foodView(ctx, el, tab, t) {
  tab = tab || 'pos';
  const kids = await students(ctx);
  if (!live(t)) return;
  let accts = {}, tx = [];
  el.innerHTML = `<div id="fd-kpi" class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6"></div>${subTabs(ctx, 'food', [['pos', 'Serve a meal', 'utensils'], ['accounts', 'Lunch accounts', 'wallet'], ['tx', 'Transactions', 'receipt'], ['inventory', 'Inventory', 'boxes']], tab)}<div id="fd-body"></div>`;
  const bal = uid => Number(accts[uid]?.balance || 0);
  const status = s => s.lunch || 'Paid';
  const kpis = () => { const tt = tx.filter(x => x.date === today()); const meals = tt.filter(x => x.kind === 'meal'); $('#fd-kpi').innerHTML = kpi('Meals served today', meals.length) + kpi('Free / reduced today', meals.filter(m => m.status !== 'Paid').length) + kpi('Sales today', money(meals.reduce((a, m) => a + (m.amount || 0), 0))) + kpi('Deposits today', money(tt.filter(x => x.kind === 'deposit').reduce((a, m) => a + (m.amount || 0), 0))) + kpi('Negative balances', kids.filter(s => bal(s.uid) < 0).length, kids.some(s => bal(s.uid) < 0) ? 'bad' : 'good'); };
  unsubs.push(onSnapshot(col(ctx, 'lunchAccounts'), s => { accts = Object.fromEntries(s.docs.map(d => [d.id, d.data()])); kpis(); draw(); }));
  unsubs.push(onSnapshot(col(ctx, 'lunchTx'), s => { tx = s.docs.map(d => ({ id: d.id, ...d.data() })); kpis(); draw(); }));
  const body = $('#fd-body');
  if (tab === 'inventory') return inventory(ctx, body, 'food', { title: 'Kitchen inventory', categories: ['Produce', 'Dairy', 'Frozen', 'Dry goods', 'Beverages', 'Paper & utensils', 'Equipment'] });
  const post = async (s, kind, amount, meal = '') => {
    const now = new Date(), uid = s.uid, delta = kind === 'meal' ? -amount : amount;
    await setDoc(dref(ctx, 'lunchAccounts', uid), { studentUid: uid, studentName: displayNameOf(s), balance: increment(delta), updatedAt: serverTimestamp() }, { merge: true });
    await addDoc(col(ctx, 'lunchTx'), { studentUid: uid, studentName: displayNameOf(s), kind, meal, status: status(s), amount, balanceAfter: bal(uid) + delta, date: today(), time: nowHM(now), at: now.getTime(), schoolYear: schoolYear(), by: ctx.me.uid, byName: ctx.me.name });
  };
  let q = '';
  function draw() {
    if (!body.isConnected) return;
    if (tab === 'pos') {
      const l = kids.filter(s => !q || `${displayNameOf(s)} ${s.studentNumber || ''}`.toLowerCase().includes(q)).slice(0, 40);
      const served = new Set(tx.filter(x => x.date === today() && x.kind === 'meal').map(x => `${x.studentUid}|${x.meal}`));
      body.innerHTML = `<div class="flex flex-wrap gap-3 mb-4"><input id="fd-q" type="search" class="input flex-1 min-w-[220px]" placeholder="Type a name or student ID…" value="${escapeHtml(q)}" aria-label="Find student"><select id="fd-meal" class="input !w-auto" data-icon="utensils" aria-label="Meal">${['Lunch', 'Breakfast', 'Snack'].map(m => `<option>${m}</option>`).join('')}</select></div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">${l.map(s => { const b = bal(s.uid), p = PRICE[status(s)] ?? PRICE.Paid; return `<div class="card p-4"><div class="flex items-center gap-3">${avatar(displayNameOf(s))}<div class="flex-1 min-w-0"><div class="text-white truncate">${escapeHtml(displayNameOf(s))}</div><div class="text-[11px] text-gray-500">${escapeHtml(s.studentNumber || '')} · ${escapeHtml(status(s))}</div></div><div class="text-right"><div class="text-[10px] text-gray-500">Balance</div><div class="tabular-nums ${b < 0 ? 'text-[#f08a8a]' : 'text-white'}">${money(b)}</div></div></div>
          <div class="flex gap-2 mt-3"><button class="btn btn-primary btn-sm flex-1" data-serve="${s.uid}" ${served.has(`${s.uid}|${$('#fd-meal')?.value || 'Lunch'}`) ? 'disabled' : ''}>${ico('utensils', 'w-3.5 h-3.5')} Serve · ${money(p)}</button><button class="btn btn-secondary btn-sm" data-deposit="${s.uid}">${ico('plus', 'w-3.5 h-3.5')} Deposit</button></div></div>`; }).join('')}</div>`;
      const qi = $('#fd-q'); qi.focus(); qi.setSelectionRange(q.length, q.length);
    } else if (tab === 'accounts') {
      body.innerHTML = `<section class="card overflow-hidden"><div class="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium flex-1">Lunch accounts</h2><button class="btn btn-secondary btn-sm" id="fd-csv">${ico('download', 'w-3.5 h-3.5')} CSV</button></div><div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Student</th><th>ID</th><th>Meal status</th><th class="text-right">Balance</th><th>Last activity</th><th></th></tr></thead><tbody>${[...kids].sort((a, b) => bal(a.uid) - bal(b.uid)).map(s => `<tr><td class="text-white">${escapeHtml(displayNameOf(s))}</td><td class="font-mono text-xs">${escapeHtml(s.studentNumber || '')}</td><td>${badge(escapeHtml(status(s)), status(s) === 'Paid' ? 'muted' : 'green')}</td><td class="text-right tabular-nums ${bal(s.uid) < 0 ? 'text-[#f08a8a]' : bal(s.uid) < 5 ? 'text-[#fcd34d]' : ''}">${money(bal(s.uid))}</td><td class="text-[11px] text-gray-500">${escapeHtml(fmtStamp(accts[s.uid]?.updatedAt))}</td><td class="text-right"><button class="btn btn-secondary btn-sm" data-deposit="${s.uid}">${ico('plus', 'w-3.5 h-3.5')} Deposit</button></td></tr>`).join('')}</tbody></table></div></section>`;
    } else {
      const l = [...tx].sort((a, b) => b.at - a.at).slice(0, 300);
      body.innerHTML = `<section class="card overflow-hidden"><div class="px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium">Transactions</h2></div>${l.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Date</th><th>Time</th><th>Student</th><th>Type</th><th>Status</th><th class="text-right">Amount</th><th class="text-right">Balance after</th><th>By</th></tr></thead><tbody>${l.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${fmt12(x.time)}</td><td class="text-white">${escapeHtml(x.studentName)}</td><td>${escapeHtml(x.kind === 'meal' ? x.meal : 'Deposit')}</td><td>${escapeHtml(x.status || '')}</td><td class="text-right tabular-nums ${x.kind === 'deposit' ? 'text-[#6ee06e]' : ''}">${x.kind === 'deposit' ? '+' : '−'}${money(x.amount)}</td><td class="text-right tabular-nums">${money(x.balanceAfter)}</td><td>${escapeHtml(x.byName || '')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="p-6">${emptyState({ icon: 'receipt', title: 'No transactions yet' })}</div>`}</section>`;
    }
    refreshIcons();
  }
  draw();
  body.addEventListener('input', e => { if (e.target.id === 'fd-q') { q = e.target.value.trim().toLowerCase(); draw(); } });
  body.addEventListener('change', e => { if (e.target.id === 'fd-meal') draw(); });
  body.addEventListener('click', async e => {
    const sv = e.target.closest('[data-serve]');
    if (sv) { const s = kids.find(x => x.uid === sv.dataset.serve), meal = $('#fd-meal')?.value || 'Lunch'; const amt = meal === 'Breakfast' ? Math.min(PRICE[status(s)] ?? 2, 2) : (PRICE[status(s)] ?? PRICE.Paid); return withBusy(sv, '…', async () => { try { await post(s, 'meal', amt, meal); toast(`${meal} served to ${displayNameOf(s)}`); } catch (ex) { toast(friendlyError(ex), 'error'); } }); }
    const dp = e.target.closest('[data-deposit]');
    if (dp) { const s = kids.find(x => x.uid === dp.dataset.deposit); const F = await forms(); return F.formModal({ title: `Deposit · ${displayNameOf(s)}`, subtitle: `Balance ${money(bal(s.uid))}`, icon: 'wallet', form: { sections: [{ fields: [{ id: 'amount', type: 'number', label: 'Amount ($)', required: true, min: 0.01, maxN: 500 }, { id: 'method', type: 'select', label: 'Paid by', options: ['Cash', 'Check', 'Online', 'Other'] }] }] }, data: { amount: 20, method: 'Cash' }, submit: 'Add deposit', onSubmit: async d => { await post(s, 'deposit', Number(d.amount)); toast('Deposit added'); return true; } }); }
    if (e.target.closest('#fd-csv')) csv('lunch-accounts.csv', ['Student ID', 'Student', 'Meal status', 'Balance'], kids.map(s => [s.studentNumber || '', displayNameOf(s), status(s), bal(s.uid).toFixed(2)]));
  });
}

// ═══════════════════════════════════════════════════════════════
// TRANSPORTATION
// ═══════════════════════════════════════════════════════════════
async function transportView(ctx, el, tab, t) {
  tab = tab || 'buses';
  const kids = await students(ctx);
  if (!live(t)) return;
  const buses = {}; kids.forEach(s => ['am', 'pm'].forEach(leg => { const b = s.bus?.[leg]?.bus; if (b) { const x = (buses[b] ||= { bus: b, am: 0, pm: 0, routes: new Set(), driver: '' }); x[leg]++; if (s.bus[leg].route) x.routes.add(s.bus[leg].route); if (s.bus.driver) x.driver = s.bus.driver; } }));
  const riders = kids.filter(s => s.bus?.am?.bus || s.bus?.pm?.bus).length;
  el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">${kpi('Buses', Object.keys(buses).length)}${kpi('Riders', riders)}${kpi('Walkers / car riders', kids.length - riders)}${kpi('Bus log today', '<span id="tr-today">…</span>')}</div>
    ${subTabs(ctx, 'transport', [['buses', 'Buses', 'bus'], ['log', 'Bus log', 'clipboard-list'], ['inventory', 'Inventory', 'boxes']], tab)}<div id="tr-body"></div>`;
  getDocs(query(col(ctx, 'busLog'), where('date', '==', today()))).then(s => { const x = $('#tr-today'); if (x) x.textContent = s.size; }).catch(() => {});
  const body = $('#tr-body');
  if (tab === 'log') return logbook(ctx, body, { name: 'busLog', title: 'Bus log', icon: 'bus', tone: 'amber', addLabel: 'Log an event', students: true,
    fields: () => [{ id: 'bus', type: 'text', label: 'Bus #', required: true }, { id: 'date', type: 'date', label: 'Date', required: true }, { id: 'time', type: 'time', label: 'Time', required: true }, { id: 'leg', type: 'chips', label: 'Run', options: ['AM', 'PM', 'Field trip', 'Activity'] },
      { id: 'kind', type: 'select', label: 'Event', required: true, options: ['Late arrival', 'Late departure', 'Breakdown', 'Accident', 'Student behavior', 'Student left on bus', 'Missed stop', 'Substitute driver', 'Inspection', 'Fuel / mileage', 'Other'] },
      { id: 'minutesLate', type: 'number', label: 'Minutes late', min: 0, maxN: 300 }, { id: 'students', type: 'students', label: 'Student involved (optional)' }, { id: 'mileage', type: 'number', label: 'Odometer / mileage', min: 0, maxN: 9999999 }, { id: 'notes', type: 'textarea', label: 'Details', rows: 2, span: 'sm:col-span-2' }],
    defaults: () => ({ leg: new Date().getHours() < 12 ? 'AM' : 'PM' }),
    cols: [['Date', r => fmtDate(r.date)], ['Time', r => fmt12(r.time)], ['Bus', r => `<span class="font-mono text-white">${escapeHtml(r.bus || '')}</span>`], ['Run', r => escapeHtml(r.leg || '')], ['Event', r => escapeHtml(r.kind || '')], ['Late', r => r.minutesLate ? `${r.minutesLate} min` : ''], ['Student', r => escapeHtml(r.studentName || '')]] });
  if (tab === 'inventory') return inventory(ctx, body, 'transport', { title: 'Transportation inventory', categories: ['Parts', 'Tires', 'Fluids', 'Safety equipment', 'First aid', 'Radios', 'Other'], assign: true });
  const list = Object.values(buses).sort((a, b) => String(a.bus).localeCompare(String(b.bus), undefined, { numeric: true }));
  body.innerHTML = `<section class="card overflow-hidden"><div class="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium flex-1">Buses & riders</h2>${ctx.can('records') ? `<a class="btn btn-secondary btn-sm" href="${buildUrl(`/${ctx.slug}/office/busing`)}">${ico('route', 'w-3.5 h-3.5')} Bus routes & stops</a>` : ''}</div>
    ${list.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Bus #</th><th>Routes</th><th>Driver</th><th class="text-right">AM riders</th><th class="text-right">PM riders</th></tr></thead><tbody>${list.map(b => `<tr><td class="font-mono text-white">${escapeHtml(b.bus)}</td><td>${escapeHtml([...b.routes].join(', '))}</td><td>${escapeHtml(b.driver)}</td><td class="text-right tabular-nums">${b.am}</td><td class="text-right tabular-nums">${b.pm}</td></tr>`).join('')}</tbody></table></div>` : `<div class="p-6">${emptyState({ icon: 'bus', title: 'No bus assignments yet', text: 'Assign buses from Student Info → Busing or Bulk updates.' })}</div>`}</section>`;
  refreshIcons();
}

// ═══════════════════════════════════════════════════════════════
// LIBRARY & DEVICES — numbered items, check out / check in, overdue
// ═══════════════════════════════════════════════════════════════
async function libraryView(ctx, el, tab, t) {
  tab = tab || 'circulation';
  const kids = await students(ctx);
  if (!live(t)) return;
  let outs = [], items = [];
  el.innerHTML = `<div id="lb-kpi" class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6"></div>${subTabs(ctx, 'library', [['circulation', 'Check out / in', 'arrow-left-right'], ['inventory', 'Books & devices', 'boxes']], tab)}<div id="lb-body"></div>`;
  const kp = () => { const open = outs.filter(o => !o.returnedAt); $('#lb-kpi') && ($('#lb-kpi').innerHTML = kpi('Items', items.length) + kpi('Checked out', open.length) + kpi('Overdue', open.filter(o => o.due < today()).length, open.some(o => o.due < today()) ? 'bad' : 'good') + kpi('Returned today', outs.filter(o => o.returnedOn === today()).length)); };
  unsubs.push(onSnapshot(col(ctx, 'checkouts'), s => { outs = s.docs.map(d => ({ id: d.id, ...d.data() })); kp(); draw(); }));
  unsubs.push(onSnapshot(query(col(ctx, 'inventory'), where('area', '==', 'library')), s => { items = s.docs.map(d => ({ id: d.id, ...d.data() })); kp(); draw(); }));
  const body = $('#lb-body');
  if (tab === 'inventory') return inventory(ctx, body, 'library', { title: 'Books & devices', categories: ['Book', 'Chromebook', 'Laptop', 'Tablet', 'Hotspot', 'Charger', 'Calculator', 'Headphones', 'Other'], assign: true });
  function draw() {
    if (!body.isConnected || tab !== 'circulation') return;
    const open = outs.filter(o => !o.returnedAt).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
    body.innerHTML = `<section class="card p-5 mb-6"><h2 class="text-white font-medium mb-3">Check out</h2><form id="lb-out" class="grid sm:grid-cols-4 gap-3 items-end" novalidate>
        <div class="sm:col-span-1"><label class="label" for="lb-item">Item # or title</label><input id="lb-item" class="input font-mono" list="lb-items" placeholder="LIB-0001"><datalist id="lb-items">${items.filter(i => Number(i.qty) > 0).map(i => `<option value="${escapeHtml(i.number)}">${escapeHtml(i.name)}</option>`).join('')}</datalist></div>
        <div class="sm:col-span-1"><label class="label" for="lb-stu">Student name or ID</label><input id="lb-stu" class="input" list="lb-stus"><datalist id="lb-stus">${kids.map(s => `<option value="${escapeHtml(s.studentNumber || displayNameOf(s))}">${escapeHtml(displayNameOf(s))}</option>`).join('')}</datalist></div>
        <div><label class="label" for="lb-due">Due</label><input id="lb-due" type="date" class="input" value="${toDateInput(new Date(Date.now() + 14 * 86400000))}"></div><button class="btn btn-primary">${ico('arrow-right-from-line', 'w-4 h-4')} Check out</button></form><p class="form-error hidden mt-2" id="lb-err"></p></section>
      <section class="card overflow-hidden"><div class="px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium">Checked out · ${open.length}</h2></div>${open.length ? `<div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Item #</th><th>Item</th><th>Student</th><th>Checked out</th><th>Due</th><th></th></tr></thead><tbody>${open.map(o => `<tr class="${o.due < today() ? 'is-low' : ''}"><td class="font-mono text-[#F59E0B]">${escapeHtml(o.itemNumber)}</td><td class="text-white">${escapeHtml(o.itemName)}</td><td>${escapeHtml(o.studentName)}</td><td class="text-[11px] text-gray-400">${escapeHtml(fmtStamp(o.outAt))}</td><td class="${o.due < today() ? 'text-[#f08a8a]' : ''}">${fmtDate(o.due)}${o.due < today() ? ' · overdue' : ''}</td><td class="text-right"><button class="btn btn-secondary btn-sm" data-return="${o.id}">${ico('arrow-left-to-line', 'w-3.5 h-3.5')} Check in</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="p-6">${emptyState({ icon: 'library', title: 'Nothing checked out' })}</div>`}</section>`;
    refreshIcons();
  }
  draw();
  body.addEventListener('submit', async e => {
    if (e.target.id !== 'lb-out') return; e.preventDefault();
    const iv = $('#lb-item').value.trim().toLowerCase(), sv = $('#lb-stu').value.trim().toLowerCase(), err = $('#lb-err');
    const it = items.find(i => (i.number || '').toLowerCase() === iv) || items.find(i => (i.name || '').toLowerCase() === iv);
    const st = kids.find(s => (s.studentNumber || '').toLowerCase() === sv) || kids.find(s => displayNameOf(s).toLowerCase() === sv);
    if (!it) return globalThis.__ember.showError(err, 'No item with that number.'); if (!st) return globalThis.__ember.showError(err, 'No student with that name or ID.');
    if ((Number(it.qty) || 0) <= 0) return globalThis.__ember.showError(err, `${it.number} is already checked out.`);
    globalThis.__ember.showError(err, '');
    try {
      await addDoc(col(ctx, 'checkouts'), { itemId: it.id, itemNumber: it.number, itemName: it.name, studentUid: st.uid, studentName: displayNameOf(st), due: $('#lb-due').value, outAt: Date.now(), outOn: today(), by: ctx.me.uid, byName: ctx.me.name, schoolYear: schoolYear() });
      await updateDoc(dref(ctx, 'inventory', it.id), { qty: increment(-1), assignedTo: displayNameOf(st), updatedAt: serverTimestamp(), log: arrayUnion(stamp(ctx, `Checked out to ${displayNameOf(st)} · due ${fmtDate($('#lb-due').value)}`)) });
      toast(`${it.number} → ${displayNameOf(st)}`);
    } catch (ex) { toast(friendlyError(ex), 'error'); }
  });
  body.addEventListener('click', async e => {
    const r = e.target.closest('[data-return]'); if (!r) return;
    const o = outs.find(x => x.id === r.dataset.return);
    try { await updateDoc(dref(ctx, 'checkouts', o.id), { returnedAt: Date.now(), returnedOn: today(), returnedBy: ctx.me.name }); await updateDoc(dref(ctx, 'inventory', o.itemId), { qty: increment(1), assignedTo: '', updatedAt: serverTimestamp(), log: arrayUnion(stamp(ctx, `Checked in from ${o.studentName}${o.due < today() ? ' (late)' : ''}`)) }); toast(`${o.itemNumber} checked in`); } catch (ex) { toast(friendlyError(ex), 'error'); }
  });
}

// ═══════════════════════════════════════════════════════════════
// ATHLETICS — rosters & eligibility, equipment
// ═══════════════════════════════════════════════════════════════
async function athleticsView(ctx, el, tab, t) {
  tab = tab || 'roster';
  const kids = await students(ctx);
  if (!live(t)) return;
  el.innerHTML = `<div id="at-kpi" class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6"></div>${subTabs(ctx, 'athletics', [['roster', 'Rosters & eligibility', 'trophy'], ['events', 'Games & practices', 'calendar'], ['inventory', 'Equipment', 'boxes']], tab)}<div id="at-body"></div>`;
  const eligible = a => a.physical && daysUntil(a.physical) > -365 && a.consent === 'Yes' && a.academic !== 'Ineligible';
  unsubs.push(onSnapshot(col(ctx, 'athletes'), s => { const l = s.docs.map(d => d.data()); $('#at-kpi') && ($('#at-kpi').innerHTML = kpi('Athletes', new Set(l.map(a => a.studentUid)).size) + kpi('Sports', new Set(l.map(a => a.sport)).size) + kpi('Eligible', l.filter(eligible).length, 'good') + kpi('Not eligible', l.filter(a => !eligible(a)).length, l.some(a => !eligible(a)) ? 'bad' : '')); }));
  const body = $('#at-body');
  if (tab === 'inventory') return inventory(ctx, body, 'athletics', { title: 'Athletic equipment', categories: ['Balls', 'Uniforms', 'Protective gear', 'Training', 'Field / court', 'Medical', 'Other'], assign: true });
  if (tab === 'events') return logbook(ctx, body, { name: 'athleticEvents', title: 'Games & practices', icon: 'calendar', tone: 'green', addLabel: 'Add an event', students: false, from: toDateInput(new Date(Date.now() - 60 * 86400000)),
    fields: () => [{ id: 'sport', type: 'text', label: 'Sport / team', required: true }, { id: 'kind', type: 'chips', label: 'Type', required: true, options: ['Game', 'Practice', 'Tournament', 'Tryout'] }, { id: 'date', type: 'date', label: 'Date', required: true }, { id: 'time', type: 'time', label: 'Start', required: true }, { id: 'opponent', type: 'text', label: 'Opponent' }, { id: 'location', type: 'text', label: 'Location' }, { id: 'result', type: 'text', label: 'Result / score' }, { id: 'busNeeded', type: 'yesno', label: 'Bus needed?' }],
    defaults: () => ({ kind: 'Game' }), detailTitle: r => `${r.sport} · ${r.kind}`,
    cols: [['Date', r => fmtDate(r.date)], ['Time', r => fmt12(r.time)], ['Sport', r => `<span class="text-white">${escapeHtml(r.sport || '')}</span>`], ['Type', r => escapeHtml(r.kind || '')], ['Opponent', r => escapeHtml(r.opponent || '')], ['Location', r => escapeHtml(r.location || '')], ['Result', r => escapeHtml(r.result || '')]] });
  return logbook(ctx, body, { name: 'athletes', title: 'Rosters & eligibility', icon: 'trophy', tone: 'green', addLabel: 'Add an athlete', from: '2000-01-01', hint: 'Eligible = physical within the last year, parent consent on file, and academically eligible.',
    fields: () => [{ id: 'students', type: 'students', label: 'Student', required: true }, { id: 'sport', type: 'select', label: 'Sport', required: true, options: ['Football', 'Volleyball', 'Cross country', 'Swimming', 'Golf', 'Basketball', 'Soccer', 'Wrestling', 'Baseball', 'Softball', 'Track & field', 'Tennis', 'Cheer', 'Lacrosse', 'Other'] },
      { id: 'level', type: 'chips', label: 'Level', options: ['Varsity', 'JV', 'Middle school', 'Club'] }, { id: 'season', type: 'chips', label: 'Season', options: ['Fall', 'Winter', 'Spring'] }, { id: 'date', type: 'date', label: 'Joined', required: true },
      { id: 'physical', type: 'date', label: 'Physical exam date' }, { id: 'consent', type: 'yesno', label: 'Parent consent on file?' }, { id: 'academic', type: 'chips', label: 'Academic eligibility', options: ['Eligible', 'Probation', 'Ineligible'] }, { id: 'jersey', type: 'text', label: 'Jersey #' }, { id: 'notes', type: 'text', label: 'Notes', span: 'sm:col-span-2' }],
    defaults: () => ({ level: 'Varsity', academic: 'Eligible', consent: 'Yes' }), detailTitle: r => `${r.studentName} · ${r.sport}`,
    cols: [['Student', r => `<span class="text-white">${escapeHtml(r.studentName || '')}</span>`], ['Sport', r => escapeHtml(r.sport || '')], ['Level', r => escapeHtml(r.level || '')], ['Jersey', r => escapeHtml(r.jersey || '')], ['Physical', r => { const d = daysUntil(r.physical); return r.physical ? `<span class="${d < -365 ? 'text-[#f08a8a]' : ''}">${fmtDate(r.physical)}${d < -365 ? ' · expired' : ''}</span>` : '<span class="text-[#f08a8a]">Missing</span>'; }], ['Consent', r => escapeHtml(r.consent || '')], ['Eligible', r => eligible(r) ? badge('Eligible', 'green') : badge('Not eligible', 'red')]] });
}

// ═══════════════════════════════════════════════════════════════
// IT & DATA — permissions, devices, state-reporting exports
// ═══════════════════════════════════════════════════════════════
async function itView(ctx, el, tab, t) {
  tab = tab || 'permissions';
  const [staffSnap, kids] = await Promise.all([getDocs(col(ctx, 'users')), students(ctx)]);
  if (!live(t)) return;
  const staff = staffSnap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
  el.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">${kpi('Staff accounts', staff.length)}${kpi('Administrators', staff.filter(s => s.role === 'admin').length)}${kpi('Students', kids.length)}${kpi('Students missing an ID', kids.filter(s => !s.studentNumber).length, kids.some(s => !s.studentNumber) ? 'bad' : 'good')}</div>
    ${subTabs(ctx, 'it', [['permissions', 'Permissions', 'key-round'], ['devices', 'Devices', 'laptop'], ['reports', 'State reporting', 'file-spreadsheet']], tab)}<div id="it-body"></div>`;
  const body = $('#it-body');
  if (tab === 'devices') return inventory(ctx, body, 'it', { title: 'Device & asset inventory', categories: ['Chromebook', 'Laptop', 'Desktop', 'Tablet', 'Projector', 'Interactive panel', 'Printer', 'Network', 'Hotspot', 'Other'], assign: true });
  if (tab === 'reports') {
    const reports = [['students', 'Student demographics', 'Student ID, name, grade, DOB, gender, ELL / IEP / 504, meal status'], ['attendance', 'Attendance (date range)', 'Every attendance mark with date, class and code'], ['discipline', 'Discipline incidents', 'Incidents and referrals with dates, types and actions'], ['clinic', 'Health office visits', 'Visit counts with reasons and dispositions'], ['staff', 'Staff roster', 'Name, title, category, role and access']];
    body.innerHTML = `<section class="card p-5 mb-4"><div class="flex flex-wrap items-end gap-3"><div><label class="label" for="rp-from">From</label><input type="date" id="rp-from" class="input !w-auto" value="${schoolYear().slice(0, 4)}-08-01"></div><div><label class="label" for="rp-to">To</label><input type="date" id="rp-to" class="input !w-auto" value="${today()}"></div><p class="hint flex-1">CSV files open in Excel or Google Sheets and can be reformatted for your state's upload.</p></div></section>
      <div class="grid sm:grid-cols-2 gap-3">${reports.map(([k, l, d]) => `<button class="card card-hover p-4 text-left flex gap-3" data-rep="${k}">${iconTile('file-spreadsheet', 'violet')}<span><span class="block text-white">${l}</span><span class="block text-xs text-gray-500 mt-0.5">${d}</span></span></button>`).join('')}</div>`;
    body.addEventListener('click', async e => {
      const b = e.target.closest('[data-rep]'); if (!b) return;
      const from = $('#rp-from').value, to = $('#rp-to').value;
      await withBusy(b, 'Exporting…', async () => { try {
        if (b.dataset.rep === 'students') csv('state-students.csv', ['Student ID', 'Last name', 'First name', 'Grade', 'Graduation year', 'Date of birth', 'Gender', 'ELL', 'IEP', '504', 'Meal status', 'Enrolled'], kids.map(s => [s.studentNumber || '', s.lastName || '', s.firstName || displayNameOf(s), s.gradeLevel ?? '', s.gradYear || '', s.dob || '', s.gender || '', s.ell ? 'Y' : 'N', s.iep ? 'Y' : 'N', s.plan504 ? 'Y' : 'N', s.lunch || '', fmtStamp(s.createdAt)]));
        if (b.dataset.rep === 'attendance') { const a = (await getDocs(query(col(ctx, 'attendance'), where('date', '>=', from)))).docs.map(d => d.data()).filter(x => x.date <= to); const id = Object.fromEntries(kids.map(s => [s.uid, s.studentNumber || ''])); csv(`state-attendance-${from}-${to}.csv`, ['Date', 'Student ID', 'Student', 'Class', 'Code', 'Note'], a.map(x => [x.date, id[x.studentUid] || '', x.studentName, x.courseTitle, x.code, x.note || ''])); }
        if (b.dataset.rep === 'discipline') { const a = (await getDocs(col(ctx, 'incidents'))).docs.map(d => d.data()).filter(x => (x.date || '') >= from && (x.date || '') <= to); csv(`state-discipline-${from}-${to}.csv`, ['Date', 'Students', 'Type', 'Location', 'Severity', 'Status', 'Office actions'], a.map(x => [x.date, (x.studentNames || []).join('; '), x.type, x.location, x.severity || '', x.status || '', (x.office?.officeActions || []).join('; ')])); }
        if (b.dataset.rep === 'clinic') { const a = (await getDocs(col(ctx, 'clinicVisits'))).docs.map(d => d.data()).filter(x => x.date >= from && x.date <= to); csv(`health-visits-${from}-${to}.csv`, ['Date', 'Grade', 'Check in', 'Time out', 'Reason', 'Treatment', 'Disposition'], a.map(x => [x.date, x.grade, fmt12(x.checkIn), fmt12(x.timeOut), join(x.reasons), join(x.treatments), x.disposition])); }
        if (b.dataset.rep === 'staff') csv('staff-roster.csv', ['Name', 'Email', 'Title', 'Category', 'Role', 'Access'], staff.map(s => [displayNameOf(s), s.email || '', s.title || '', s.category || '', s.role, (s.caps || []).join('; ')]));
      } catch (ex) { toast(friendlyError(ex), 'error'); } });
    });
    return refreshIcons();
  }
  const CAPS = [['services', 'IEP / 504 / ELL'], ['health', 'Health'], ['records', 'Records'], ['safety', 'Discipline']];
  const draw = () => {
    body.innerHTML = `<section class="card overflow-hidden"><div class="px-5 py-4 border-b border-white/[0.06]"><h2 class="text-white font-medium">Staff permissions</h2><p class="text-xs text-gray-500">Turn access on or off. Every change is saved immediately and recorded.</p></div><div class="overflow-x-auto"><table class="w-full text-sm work-table"><thead><tr><th>Name</th><th>Title</th><th>Role</th>${CAPS.map(c => `<th class="text-center">${c[1]}</th>`).join('')}<th>Last change</th></tr></thead><tbody>${staff.map(s => `<tr><td class="text-white">${escapeHtml(displayNameOf(s))}<div class="text-[11px] text-gray-500">${escapeHtml(s.email || '')}</div></td><td>${escapeHtml(s.title || '')}</td><td>${s.role === 'admin' ? badge('Admin', 'red') : badge('Staff', 'muted')}</td>${CAPS.map(([k]) => `<td class="text-center">${s.role === 'admin' ? ico('check', 'w-4 h-4 inline text-gray-500') : `<input type="checkbox" class="w-4 h-4 accent-[#8B5CF6]" data-cap="${k}" data-uid="${s.uid}" ${(s.caps || []).includes(k) ? 'checked' : ''} aria-label="${escapeHtml(displayNameOf(s))} ${k}" ${ctx.isAdmin ? '' : 'disabled'}>`}</td>`).join('')}<td class="text-[11px] text-gray-500">${escapeHtml((s.capLog || []).slice(-1)[0] ? `${fmtStamp(s.capLog.slice(-1)[0].at)} · ${s.capLog.slice(-1)[0].byName}` : '')}</td></tr>`).join('')}</tbody></table></div></section>`;
    refreshIcons();
  };
  draw();
  body.addEventListener('change', async e => {
    const c = e.target.closest('[data-cap]'); if (!c) return;
    const s = staff.find(x => x.uid === c.dataset.uid), caps = new Set(s.caps || []);
    c.checked ? caps.add(c.dataset.cap) : caps.delete(c.dataset.cap);
    try { const entry = stamp(ctx, `${c.checked ? 'Granted' : 'Removed'} ${c.dataset.cap}`); await updateDoc(dref(ctx, 'users', s.uid), { caps: [...caps], capLog: arrayUnion(entry) }); s.caps = [...caps]; s.capLog = [...(s.capLog || []), entry]; draw(); toast('Permission updated'); }
    catch (ex) { c.checked = !c.checked; toast(friendlyError(ex), 'error'); }
  });
}
// Print an open IHP (or any record dialog) on its own.
document.addEventListener('click', e => {
  const b = e.target.closest('[data-print-ihp]'); if (!b) return;
  const dlg = b.closest('[role=dialog]') || b.closest('.modal') || document.body;
  let root = document.getElementById('print-root'); if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = `<div class="pf disc-print"><h1 style="font-size:20px;margin-bottom:8px">Individual Health Plan</h1>${dlg.innerHTML}</div>`; root.querySelectorAll('button').forEach(x => x.remove());
  const done = () => { root.innerHTML = ''; removeEventListener('afterprint', done); }; addEventListener('afterprint', done); setTimeout(() => print(), 50);
});
