// Ember Staff Hub — staff forms (referrals, call-outs, coverage, requests), the office review queue,
// and the notification center. Loaded on demand by app.js; helpers come from app.js via globalThis.__ember.
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
const {
  db, $, $$, ico, refreshIcons, escapeHtml, plural, displayNameOf, tsMillis, formatDate, formatDateTime, timeAgo, toDateInput,
  render, setTitle, showError, iconTile, badge, avatar, skeletonRows, emptyState, errorBox, dataTable, toast, withBusy, confirmDialog,
  buildUrl, navigate, live, pageHeader, tenantPage, myCourses, routeTokenNow, renderRoute, districtShell,
  notify, officeStaffUids, guardianUidsOf, notifItems, notifRow, notifUnread, markAllNotifsRead, NOTIF_KINDS,
  openModal, modalHeader, modalBody, modalFooter, copyText, createLogin, friendlyError, getTenant
} = globalThis.__ember;
const BUILD = new URL(import.meta.url).search;
const sisModule = () => import('./sis.js' + BUILD);

const todayISO = () => toDateInput(new Date());
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtHM = hm => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const fmtISO = iso => iso ? formatDate(iso + 'T12:00') : '';
const STATUS_ICON = { good: ['circle-check', 'st-good'], warning: ['triangle-alert', 'st-warning'], serious: ['circle-alert', 'st-serious'], critical: ['octagon-alert', 'st-critical'], info: ['circle-dot', 'text-gray-400'] };
const chip = (level, label) => `<span class="inline-flex items-center gap-1.5 text-xs text-gray-200 whitespace-nowrap">${ico(STATUS_ICON[level][0], 'w-3.5 h-3.5 ' + STATUS_ICON[level][1])}${escapeHtml(label)}</span>`;
const GRADES = ['PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

// ═══════════════════════════════════════════════════════════════
// FORM ENGINE
// A form is { sections: [{ title, hint, fields: [...] }] }. Field types:
//   text, textarea, number, date, time, phone, select, radio, chips, checks, yesno, dates, students, courses, periods, note
// Options may carry `extra` sub-fields (shown when the option is picked) and `other: true` adds a free-text "Other".
// Values live in a flat object: data[id]; option extras at data[`${id}|${option}|${subId}`]; other text at data[`${id}|other`].
// ═══════════════════════════════════════════════════════════════
const optVal = o => typeof o === 'string' ? o : o.v;
const optLabel = o => typeof o === 'string' ? o : (o.l || o.v);
const sid = s => String(s).replace(/[^a-z0-9]+/gi, '-');
const subKey = (f, o, x) => `${f}|${o}|${x}`;
function shown(field, data) {
  const c = field.showIf; if (!c) return true;
  const v = data[c.id];
  if (c.eq !== undefined) return Array.isArray(v) ? v.includes(c.eq) : v === c.eq;
  if (c.in) return Array.isArray(v) ? v.some(x => c.in.includes(x)) : c.in.includes(v);
  if (c.not !== undefined) return v !== undefined && v !== '' && v !== c.not;
  if (c.any) return Array.isArray(v) ? v.length > 0 : !!v;
  return true;
}
const allFields = form => form.sections.flatMap(s => s.fields);

function fieldHTML(f, data, env) {
  const id = `ff-${sid(f.id)}`, v = data[f.id], req = f.required ? '<span class="text-[#F59E0B]" aria-hidden="true"> *</span>' : '';
  const label = f.label ? `<label class="label" ${['radio', 'chips', 'checks', 'yesno', 'students', 'courses', 'periods', 'dates'].includes(f.type) ? '' : `for="${id}"`}>${escapeHtml(f.label)}${req}</label>` : '';
  const hint = f.hint ? `<p class="hint mt-1.5">${escapeHtml(f.hint)}</p>` : '';
  const attrs = `id="${id}" data-input="${escapeHtml(f.id)}" ${f.placeholder ? `placeholder="${escapeHtml(f.placeholder)}"` : ''}`;
  let body = '';
  switch (f.type) {
    case 'note': return `<div class="ff ${f.span || 'sm:col-span-2'}" data-field="${escapeHtml(f.id)}"><div class="p-3 rounded-lg border ${f.tone === 'warn' ? 'border-[#fab219]/30 bg-[#fab219]/5' : 'border-white/[0.08] bg-white/[0.02]'} text-xs text-gray-300 flex gap-2">${ico(f.tone === 'warn' ? 'triangle-alert' : 'info', 'w-4 h-4 shrink-0 ' + (f.tone === 'warn' ? 'st-warning' : 'text-gray-500'))}<span>${escapeHtml(f.text)}</span></div></div>`;
    case 'textarea': body = `<textarea ${attrs} rows="${f.rows || 4}" class="input" maxlength="${f.max || 5000}">${escapeHtml(v || '')}</textarea>`; break;
    case 'select': body = `<select ${attrs} class="input"><option value="">${escapeHtml(f.placeholder || 'Choose…')}</option>${(f.options || []).map(o => `<option value="${escapeHtml(optVal(o))}" ${v === optVal(o) ? 'selected' : ''}>${escapeHtml(optLabel(o))}</option>`).join('')}</select>`; break;
    case 'number': body = `<input ${attrs} type="number" inputmode="numeric" class="input" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.maxN !== undefined ? `max="${f.maxN}"` : ''} value="${escapeHtml(v ?? '')}">`; break;
    case 'date': body = `<input ${attrs} type="date" class="input" ${f.maxToday ? `max="${todayISO()}"` : ''} value="${escapeHtml(v || '')}">`; break;
    case 'time': body = `<input ${attrs} type="time" class="input" value="${escapeHtml(v || '')}">`; break;
    case 'phone': body = `<input ${attrs} type="tel" autocomplete="tel" class="input" value="${escapeHtml(v || '')}">`; break;
    case 'yesno': body = `<div class="segmented" role="radiogroup" aria-label="${escapeHtml(f.label)}" data-input="${escapeHtml(f.id)}">${['Yes', 'No'].map(o => `<label class="seg-opt"><input type="radio" name="${id}" value="${o}" class="sr-only" ${v === o ? 'checked' : ''}><span>${o}</span></label>`).join('')}</div>`; break;
    case 'chips': body = `<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="${escapeHtml(f.label)}" data-input="${escapeHtml(f.id)}">${(f.options || []).map(o => `<label class="pill"><input type="radio" name="${id}" value="${escapeHtml(optVal(o))}" class="sr-only" ${v === optVal(o) ? 'checked' : ''}><span>${escapeHtml(optLabel(o))}</span></label>`).join('')}</div>`; break;
    case 'radio': case 'checks': {
      const multi = f.type === 'checks', sel = multi ? (Array.isArray(v) ? v : []) : v;
      const opts = [...(f.options || []), ...(f.other ? [{ v: 'Other', extra: [{ id: 'text', type: 'text', placeholder: 'Describe…', required: true }] }] : [])];
      body = `<div class="${f.cols === 1 ? 'space-y-1.5' : 'grid sm:grid-cols-2 gap-x-6 gap-y-1.5'}" role="${multi ? 'group' : 'radiogroup'}" aria-label="${escapeHtml(f.label)}" data-input="${escapeHtml(f.id)}">${opts.map(o => {
        const ov = optVal(o), on = multi ? sel.includes(ov) : sel === ov;
        const extra = (o.extra || []).length ? `<div class="opt-extra ${on ? '' : 'hidden'} grid sm:grid-cols-2 gap-3 mt-2 mb-2 ml-6 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]" data-extra-for="${escapeHtml(ov)}">${o.extra.map(x => fieldHTML({ ...x, id: subKey(f.id, ov, x.id), span: x.span || (x.type === 'textarea' || x.type === 'dates' ? 'sm:col-span-2' : '') }, data, env)).join('')}</div>` : '';
        return `<div class="${(o.extra || []).length ? 'sm:col-span-2' : ''}"><label class="check"><input type="${multi ? 'checkbox' : 'radio'}" name="${id}" value="${escapeHtml(ov)}" ${on ? 'checked' : ''}> <span>${escapeHtml(optLabel(o))}${o.hint ? `<span class="block text-[11px] text-gray-500">${escapeHtml(o.hint)}</span>` : ''}</span></label>${extra}</div>`;
      }).join('')}</div>`;
      break;
    }
    case 'dates': {
      const list = Array.isArray(v) ? v : [];
      body = `<div data-input="${escapeHtml(f.id)}" data-dates='${escapeHtml(JSON.stringify(list))}'><div class="flex gap-2"><input type="date" class="input !w-auto" aria-label="Add a date" data-date-new><button type="button" class="btn btn-secondary btn-sm" data-date-add>${ico('plus', 'w-3.5 h-3.5')} Add date</button></div><div class="flex flex-wrap gap-1.5 mt-2" data-date-list>${list.map(d => dateChip(d)).join('')}</div></div>`;
      break;
    }
    case 'students': {
      const list = Array.isArray(v) ? v : [];
      body = `<div data-input="${escapeHtml(f.id)}" data-picked='${escapeHtml(JSON.stringify(list))}' class="stu-pick">
        <div class="flex flex-wrap gap-1.5 mb-2" data-picked-list>${list.map(p => stuChip(p)).join('')}</div>
        <div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">${ico('search', 'w-3.5 h-3.5')}</span><input type="search" class="input pl-9" placeholder="${escapeHtml(f.placeholder || 'Search students by name or ID…')}" data-stu-q aria-label="Search students" autocomplete="off"></div>
        <div class="stu-results hidden mt-1 card max-h-56 overflow-y-auto divide-y divide-white/[0.05]" data-stu-results></div></div>`;
      break;
    }
    case 'courses': {
      const sel = Array.isArray(v) ? v : [];
      const cs = env.courses || [];
      body = cs.length ? `<div class="grid sm:grid-cols-2 gap-x-6 gap-y-1.5" data-input="${escapeHtml(f.id)}">${cs.map(c => `<label class="check"><input type="checkbox" value="${escapeHtml(c.title || c.id)}" ${sel.includes(c.title || c.id) ? 'checked' : ''}> <span>${escapeHtml(c.title || 'Course')}${c.periodName ? `<span class="text-gray-500"> · ${escapeHtml(c.periodName)}</span>` : ''}</span></label>`).join('')}</div>` : `<p class="text-xs text-gray-500" data-input="${escapeHtml(f.id)}">You don't have any courses yet.</p>`;
      break;
    }
    case 'periods': {
      const sel = Array.isArray(v) ? v : [];
      body = `<div class="flex flex-wrap gap-1.5" data-input="${escapeHtml(f.id)}">${(env.periods || []).map(p => `<label class="pill"><input type="checkbox" value="${escapeHtml(p)}" class="sr-only" ${sel.includes(p) ? 'checked' : ''}><span>${escapeHtml(p)}</span></label>`).join('')}</div>`;
      break;
    }
    default: body = `<input ${attrs} type="text" class="input" maxlength="${f.max || 300}" value="${escapeHtml(v || '')}">`;
  }
  const wide = f.span || (['textarea', 'radio', 'checks', 'students', 'courses', 'dates', 'chips', 'periods'].includes(f.type) ? 'sm:col-span-2' : '');
  return `<div class="ff ${wide}" data-field="${escapeHtml(f.id)}">${label}${body}${hint}<p class="form-error mt-1.5 hidden" data-err-for="${escapeHtml(f.id)}"></p></div>`;
}
const dateChip = d => `<span class="badge badge-muted inline-flex items-center gap-1" data-date="${escapeHtml(d)}">${escapeHtml(fmtISO(d))}<button type="button" class="hover:text-white" aria-label="Remove ${escapeHtml(fmtISO(d))}" data-date-del>×</button></span>`;
const stuChip = p => `<span class="badge badge-amber inline-flex items-center gap-1" data-uid="${escapeHtml(p.uid)}">${escapeHtml(p.name)}${p.grade ? ` <span class="opacity-70">· ${escapeHtml(p.grade === 'K' || p.grade === 'PK' ? p.grade : 'Gr ' + p.grade)}</span>` : ''}<button type="button" class="hover:text-white" aria-label="Remove ${escapeHtml(p.name)}" data-stu-del>×</button></span>`;

function formHTML(form, data, env) {
  return form.sections.map((s, i) => `<section class="card p-5 sm:p-6" data-section="${i}" ${s.locked ? 'aria-disabled="true"' : ''}>
    <div class="flex items-start gap-3 mb-5"><span class="w-7 h-7 rounded-full bg-[#F59E0B]/15 text-[#F59E0B] text-xs font-semibold flex items-center justify-center shrink-0">${i + 1}</span><div><h2 class="font-serif text-xl text-white leading-tight">${escapeHtml(s.title)}</h2>${s.hint ? `<p class="text-xs text-gray-500 mt-1">${escapeHtml(s.hint)}</p>` : ''}</div></div>
    ${s.locked ? `<p class="text-sm text-gray-500">${escapeHtml(s.locked)}</p>` : `<div class="grid sm:grid-cols-2 gap-x-5 gap-y-5">${s.fields.map(f => fieldHTML(f, data, env)).join('')}</div>`}
  </section>`).join('');
}
// Read every field's current value out of the DOM.
function readValue(root, f) {
  const el = root.querySelector(`[data-input="${CSS.escape(f.id)}"]`);
  if (!el) return undefined;
  switch (f.type) {
    // Only this group's own options — nested option extras (e.g. "Tardy number") are separate fields.
    case 'radio': return el.querySelector(':scope > div > label > input:checked')?.value || '';
    case 'chips': case 'yesno': return el.querySelector(':scope > label > input:checked')?.value || '';
    case 'checks': return [...el.querySelectorAll(':scope > div > label > input:checked')].map(x => x.value);
    case 'courses': return [...el.querySelectorAll(':scope > label > input:checked')].map(x => x.value);
    case 'periods': return [...el.querySelectorAll(':scope > label > input:checked')].map(x => x.value);
    case 'dates': return JSON.parse(el.dataset.dates || '[]');
    case 'students': return JSON.parse(el.dataset.picked || '[]');
    case 'number': return el.value === '' ? '' : Number(el.value);
    default: return el.value.trim();
  }
}
function collect(root, form) {
  const data = {};
  const visit = f => {
    if (f.type === 'note') return;
    data[f.id] = readValue(root, f);
    const opts = [...(f.options || []), ...(f.other ? [{ v: 'Other', extra: [{ id: 'text', type: 'text' }] }] : [])];
    opts.forEach(o => (o.extra || []).forEach(x => visit({ ...x, id: subKey(f.id, optVal(o), x.id) })));
  };
  allFields(form).forEach(visit);
  return data;
}
// Returns [{ id, msg }]. Hidden fields and extras of unpicked options are skipped.
function validate(form, data) {
  const errs = [];
  const empty = v => v === undefined || v === '' || (Array.isArray(v) && !v.length);
  const check = (f, active) => {
    if (!active || f.type === 'note') return;
    const v = data[f.id];
    if (f.required && empty(v)) errs.push({ id: f.id, msg: f.requiredMsg || `${f.label || 'This field'} is required.` });
    if (f.minLen && typeof v === 'string' && v && v.length < f.minLen) errs.push({ id: f.id, msg: `Please write at least ${f.minLen} characters.` });
    if (f.type === 'number' && v !== '' && v !== undefined && ((f.min !== undefined && v < f.min) || (f.maxN !== undefined && v > f.maxN))) errs.push({ id: f.id, msg: `Enter a number between ${f.min ?? 0} and ${f.maxN ?? '∞'}.` });
    if (f.type === 'date' && f.maxToday && v && v > todayISO()) errs.push({ id: f.id, msg: "This date can't be in the future." });
    const picked = Array.isArray(v) ? v : [v];
    const opts = [...(f.options || []), ...(f.other ? [{ v: 'Other', extra: [{ id: 'text', type: 'text', required: true, label: 'Other' }] }] : [])];
    opts.forEach(o => (o.extra || []).forEach(x => check({ ...x, id: subKey(f.id, optVal(o), x.id), label: x.label || optLabel(o) }, picked.includes(optVal(o)))));
  };
  form.sections.filter(s => !s.locked).forEach(s => s.fields.forEach(f => check(f, shown(f, data))));
  (form.rules || []).forEach(r => { const m = r(data); if (m) errs.push(m); });
  return errs;
}
// Interactive bits: conditional fields, option extras, date lists, student search.
function bindForm(root, form, env) {
  const refresh = () => {
    const data = collect(root, form);
    allFields(form).forEach(f => { const el = root.querySelector(`[data-field="${CSS.escape(f.id)}"]`); if (el) el.classList.toggle('hidden', !shown(f, data)); });
    root.querySelectorAll('[data-extra-for]').forEach(x => {
      const group = x.closest('[data-input]'); const val = x.dataset.extraFor;
      const on = [...group.querySelectorAll(':scope > div > label input')].some(i => i.value === val && i.checked);
      x.classList.toggle('hidden', !on);
    });
    env.onChange?.(data);
  };
  // Clear a field's error as soon as the user changes it.
  const clearErr = e => { const ff = e.target.closest('.ff.has-error'); if (ff) { ff.classList.remove('has-error'); const p = ff.querySelector(':scope > [data-err-for]'); if (p) { p.textContent = ''; p.classList.add('hidden'); } } };
  root.addEventListener('input', clearErr);
  root.addEventListener('change', e => { clearErr(e); refresh(); });
  root.addEventListener('input', e => { if (e.target.matches('[data-stu-q]')) searchStudents(e.target); });
  root.addEventListener('click', e => {
    const add = e.target.closest('[data-date-add]');
    if (add) {
      const box = add.closest('[data-input]'), inp = box.querySelector('[data-date-new]');
      if (!inp.value) return inp.focus();
      const list = JSON.parse(box.dataset.dates || '[]'); if (!list.includes(inp.value)) list.push(inp.value); list.sort();
      box.dataset.dates = JSON.stringify(list); box.querySelector('[data-date-list]').innerHTML = list.map(dateChip).join(''); inp.value = ''; refresh(); return;
    }
    const del = e.target.closest('[data-date-del]');
    if (del) { const box = del.closest('[data-input]'); const list = JSON.parse(box.dataset.dates || '[]').filter(d => d !== del.parentElement.dataset.date); box.dataset.dates = JSON.stringify(list); del.parentElement.remove(); refresh(); return; }
    const pick = e.target.closest('[data-stu-pick]');
    if (pick) {
      const box = pick.closest('[data-input]'); const s = (env.students || []).find(x => x.uid === pick.dataset.stuPick); if (!s) return;
      const list = JSON.parse(box.dataset.picked || '[]');
      if (!list.some(p => p.uid === s.uid)) list.push({ uid: s.uid, name: displayNameOf(s), grade: s.gradeLevel ?? '' });
      box.dataset.picked = JSON.stringify(list); box.querySelector('[data-picked-list]').innerHTML = list.map(stuChip).join('');
      const q = box.querySelector('[data-stu-q]'); q.value = ''; box.querySelector('[data-stu-results]').classList.add('hidden'); q.focus();
      env.onStudents?.(list, root); refresh(); return;
    }
    const sdel = e.target.closest('[data-stu-del]');
    if (sdel) { const box = sdel.closest('[data-input]'); const list = JSON.parse(box.dataset.picked || '[]').filter(p => p.uid !== sdel.parentElement.dataset.uid); box.dataset.picked = JSON.stringify(list); sdel.parentElement.remove(); env.onStudents?.(list, root); refresh(); }
  });
  const searchStudents = inp => {
    const box = inp.closest('[data-input]'), res = box.querySelector('[data-stu-results]');
    const q = inp.value.trim().toLowerCase();
    if (!q) { res.classList.add('hidden'); return; }
    const picked = JSON.parse(box.dataset.picked || '[]').map(p => p.uid);
    const hits = (env.students || []).filter(s => !picked.includes(s.uid) && `${displayNameOf(s)} ${s.username || ''} ${s.studentNumber || ''}`.toLowerCase().includes(q)).slice(0, 12);
    res.innerHTML = hits.length ? hits.map(s => `<button type="button" class="w-full text-left flex items-center gap-3 px-3 py-2 hover:bg-white/[0.05]" data-stu-pick="${escapeHtml(s.uid)}">${avatar(displayNameOf(s))}<span class="min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(displayNameOf(s))}</span><span class="block text-[11px] text-gray-500">${escapeHtml([s.gradeLevel ? `Grade ${s.gradeLevel}` : '', s.studentNumber ? `ID ${s.studentNumber}` : s.username || ''].filter(Boolean).join(' · '))}</span></span></button>`).join('') : `<p class="text-xs text-gray-500 px-3 py-3">No students match “${escapeHtml(inp.value)}”.</p>`;
    res.classList.remove('hidden');
  };
  refresh();
  return refresh;
}
function showErrors(root, errs) {
  root.querySelectorAll('[data-err-for]').forEach(p => { p.textContent = ''; p.classList.add('hidden'); });
  root.querySelectorAll('.ff.has-error').forEach(x => x.classList.remove('has-error'));
  errs.forEach(e => {
    const p = root.querySelector(`[data-err-for="${CSS.escape(e.id)}"]`);
    if (p) { p.textContent = e.msg; p.classList.remove('hidden'); p.closest('.ff')?.classList.add('has-error'); }
  });
  const first = errs[0] && root.querySelector(`[data-field="${CSS.escape(errs[0].id)}"]`);
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
// Read-only rendering of a submitted form (screen and print share it).
function valueText(f, data, { print = false } = {}) {
  const v = data[f.id];
  const out = [];
  if (f.type === 'students') return (v || []).map(p => p.name).join(', ');
  if (f.type === 'dates') return (v || []).map(fmtISO).join(', ');
  if (f.type === 'date') return fmtISO(v);
  if (f.type === 'time') return fmtHM(v);
  const picked = Array.isArray(v) ? v : v ? [v] : [];
  if (['radio', 'checks', 'chips'].includes(f.type)) {
    const opts = [...(f.options || []), ...(f.other ? [{ v: 'Other', extra: [{ id: 'text', type: 'text' }] }] : [])];
    picked.forEach(pv => {
      const o = opts.find(x => optVal(x) === pv);
      const subs = (o?.extra || []).map(x => { const sv = valueText({ ...x, id: subKey(f.id, pv, x.id) }, data, { print }); return sv ? `${x.id === 'text' ? '' : (x.label || x.id) + ': '}${sv}` : ''; }).filter(Boolean);
      out.push(`${pv === 'Other' && subs.length ? 'Other' : optLabel(o || pv)}${subs.length ? ` (${subs.join('; ')})` : ''}`);
    });
    return out.join(print ? '; ' : '\n');
  }
  return Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v);
}
function readonlyHTML(form, data) {
  return form.sections.map((s, i) => {
    const rows = s.fields.filter(f => f.type !== 'note' && shown(f, data)).map(f => [f, valueText(f, data)]).filter(([, t]) => t);
    return `<section class="card p-5 sm:p-6"><h2 class="font-serif text-lg text-white mb-4 flex items-center gap-3"><span class="w-6 h-6 rounded-full bg-white/[0.06] text-gray-400 text-[11px] font-semibold flex items-center justify-center">${i + 1}</span>${escapeHtml(s.title)}</h2>
      ${rows.length ? `<dl class="grid sm:grid-cols-2 gap-x-6 gap-y-4">${rows.map(([f, t]) => `<div class="${['textarea', 'checks', 'radio', 'students'].includes(f.type) ? 'sm:col-span-2' : ''}"><dt class="text-[11px] uppercase tracking-wider text-gray-500 mb-1">${escapeHtml(f.label || '')}</dt><dd class="text-sm text-gray-200 whitespace-pre-wrap">${escapeHtml(t)}</dd></div>`).join('')}</dl>` : `<p class="text-sm text-gray-500">${escapeHtml(s.emptyText || 'Nothing recorded.')}</p>`}</section>`;
  }).join('');
}
function printHTML(title, subtitle, form, data, footer = '') {
  return `<div class="pf"><div class="pf-head"><div><div class="pf-title">${escapeHtml(title)}</div><div class="pf-sub">${escapeHtml(subtitle)}</div></div><div class="pf-sub">Printed ${escapeHtml(new Date().toLocaleString())}</div></div>
    ${form.sections.map(s => { const rows = s.fields.filter(f => f.type !== 'note' && shown(f, data)); return `<div class="pf-sec"><div class="pf-sec-t">${escapeHtml(s.title)}</div><table>${rows.map(f => `<tr><th>${escapeHtml(f.label || '')}</th><td>${escapeHtml(valueText(f, data, { print: true })) || '<span class="pf-blank"></span>'}</td></tr>`).join('')}</table></div>`; }).join('')}
    ${footer}</div>`;
}
function printNow(html) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = html;
  const done = () => { root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

// ═══════════════════════════════════════════════════════════════
// FORM DEFINITIONS
// ═══════════════════════════════════════════════════════════════
const SUB_PLANS = ['In the sub folder in my classroom', 'Posted in Ember (course module or announcement)', 'Emailed to the front office', "I'll send them before school starts", 'Use my emergency sub plans on file'];
const DUTIES = ['Morning / arrival duty', 'Hall duty', 'Lunch duty', 'Bus duty', 'Dismissal / car line', 'After-school club or coaching', 'IEP / 504 meeting', 'Parent conference', 'Department / PLC meeting', 'None'];
const REQUESTS = {
  callout: {
    title: 'Call out', long: 'Call out / staff absence', icon: 'phone-off', tone: 'red', group: 'Time off & coverage',
    blurb: "Let the office know you'll be out, what needs covering, and where your sub plans are.",
    summary: d => `${d.absenceType || 'Absence'} · ${d.absenceType === 'Multiple days' ? `${fmtISO(d.startDate)} – ${fmtISO(d.endDate)}` : fmtISO(d.date)}${d.reason ? ' · ' + (d.reason === 'Other' ? d['reason|Other|text'] || 'Other' : d.reason) : ''}`,
    when: d => d.absenceType === 'Multiple days' ? d.startDate : d.date,
    actions: [['approved', 'Approve', 'good'], ['acknowledged', 'Acknowledge', 'info'], ['denied', 'Deny', 'critical']],
    sections: [
      { title: 'Absence', hint: 'When will you be out?', fields: [
        { id: 'absenceType', type: 'radio', label: 'Type of absence', required: true, options: ['Full day', 'Half day — morning', 'Half day — afternoon', 'Partial day (specific times)', 'Multiple days'] },
        { id: 'date', type: 'date', label: 'Date', required: true, showIf: { id: 'absenceType', not: 'Multiple days' } },
        { id: 'startDate', type: 'date', label: 'First day out', required: true, showIf: { id: 'absenceType', eq: 'Multiple days' } },
        { id: 'endDate', type: 'date', label: 'Last day out', required: true, showIf: { id: 'absenceType', eq: 'Multiple days' } },
        { id: 'leaveTime', type: 'time', label: 'Leaving at', required: true, showIf: { id: 'absenceType', eq: 'Partial day (specific times)' } },
        { id: 'returnTime', type: 'time', label: 'Returning at', showIf: { id: 'absenceType', eq: 'Partial day (specific times)' }, hint: 'Leave blank if you won’t be back today.' },
        { id: 'reason', type: 'radio', label: 'Reason', required: true, other: true, options: ['Personal illness', 'Family illness / caregiving', 'Medical or dental appointment', 'Personal day', 'Bereavement', 'Jury duty / court', 'Professional development', 'School business / field trip', 'Religious observance', 'Military leave', 'FMLA / extended leave', 'Emergency'] },
        { id: 'privateNote', type: 'textarea', label: 'Private note for your administrator', rows: 2, hint: 'Optional. Only administrators can see this.' },
      ] },
      { title: 'Coverage', hint: 'What needs to happen while you’re out?', fields: [
        { id: 'subNeeded', type: 'yesno', label: 'Do you need a substitute?', required: true },
        { id: 'classes', type: 'courses', label: 'Classes affected' },
        { id: 'duties', type: 'checks', label: 'Duties or meetings that need coverage', options: DUTIES },
        { id: 'subPlans', type: 'radio', label: 'Where are your sub plans?', required: true, options: SUB_PLANS, showIf: { id: 'subNeeded', eq: 'Yes' } },
        { id: 'subNotes', type: 'textarea', label: 'Notes for the substitute', rows: 3, placeholder: 'Seating charts, student helpers, students with medical needs, technology, dismissal procedures…', showIf: { id: 'subNeeded', eq: 'Yes' } },
        { id: 'preferredSub', type: 'text', label: 'Preferred substitute (if any)', showIf: { id: 'subNeeded', eq: 'Yes' } },
      ] },
      { title: 'Contact & confirmation', fields: [
        { id: 'reachable', type: 'radio', label: 'Can the office reach you?', required: true, options: ['Yes — by phone', 'Yes — by email', 'Only in an emergency', 'No'] },
        { id: 'phone', type: 'phone', label: 'Best phone number', showIf: { id: 'reachable', in: ['Yes — by phone', 'Only in an emergency'] } },
        { id: 'ack', type: 'checks', label: 'Confirmation', required: true, requiredMsg: 'Please confirm before submitting.', cols: 1, options: ['I understand this absence must also be entered in the district’s absence/leave system if required.'] },
      ] },
    ],
  },
  sub: {
    title: 'Request a sub', long: 'Request a substitute (planned)', icon: 'user-round-plus', tone: 'amber', group: 'Time off & coverage',
    blurb: 'Plan ahead for PD, meetings, testing, field trips and other scheduled time away from class.',
    summary: d => `${d.reason === 'Other' ? d['reason|Other|text'] || 'Other' : d.reason || 'Substitute'} · ${(d.dates || []).map(fmtISO).join(', ')}`,
    when: d => (d.dates || [])[0],
    actions: [['approved', 'Approve', 'good'], ['denied', 'Deny', 'critical']],
    sections: [
      { title: 'Event', fields: [
        { id: 'reason', type: 'radio', label: 'Reason', required: true, other: true, options: ['Professional development / training', 'Field trip', 'IEP / 504 / ESE meeting', 'Testing / proctoring', 'Coaching / athletic event', 'Curriculum or committee work', 'District meeting', 'Planned personal leave'] },
        { id: 'eventName', type: 'text', label: 'Event or meeting name', placeholder: 'e.g. AP Summer Institute' },
        { id: 'eventLocation', type: 'text', label: 'Location' },
        { id: 'dates', type: 'dates', label: 'Date(s)', required: true },
        { id: 'duration', type: 'radio', label: 'Time needed', required: true, options: ['Full day', 'Morning only', 'Afternoon only', 'Specific periods'] },
        { id: 'periods', type: 'periods', label: 'Periods', required: true, showIf: { id: 'duration', eq: 'Specific periods' } },
      ] },
      { title: 'Coverage & funding', fields: [
        { id: 'classes', type: 'courses', label: 'Classes affected' },
        { id: 'coverageType', type: 'radio', label: 'Coverage type', required: true, options: ['Certified substitute', 'Internal coverage (a colleague on planning)', 'Either is fine'] },
        { id: 'preferredSub', type: 'text', label: 'Preferred substitute' },
        { id: 'funding', type: 'select', label: 'Who pays for the substitute?', required: true, options: ['School budget', 'District / PD funds', 'Title I', 'Title II', 'Title IV', 'ESE', 'Athletics', 'Grant (other)', 'Not sure'] },
        { id: 'budgetCode', type: 'text', label: 'Budget / account code', hint: 'If you know it.' },
        { id: 'subPlans', type: 'radio', label: 'Where will your sub plans be?', required: true, options: SUB_PLANS },
        { id: 'subNotes', type: 'textarea', label: 'Notes for the substitute', rows: 3 },
      ] },
    ],
  },
  coverage: {
    title: 'Request a break', long: 'Break / classroom coverage', icon: 'hand', tone: 'amber', group: 'Time off & coverage', urgent: true,
    blurb: 'Need someone to step into your room? Administrators are alerted right away.',
    summary: d => `${d.reason === 'Other' ? d['reason|Other|text'] || 'Coverage' : d.reason || 'Coverage'} · Room ${d.room || '?'} · ${d.urgency || ''}${d.urgency === 'Later today' && d.laterTime ? ' ' + fmtHM(d.laterTime) : ''} · ${d.duration || ''}`,
    when: () => todayISO(),
    actions: [['in_progress', 'On my way', 'warning'], ['done', 'Covered', 'good'], ['denied', "Can't cover", 'critical']],
    sections: [
      { title: 'What do you need?', fields: [
        { id: 'urgency', type: 'chips', label: 'When', required: true, options: ['Right now', 'In 5 minutes', 'In 15 minutes', 'Later today'] },
        { id: 'laterTime', type: 'time', label: 'At what time?', required: true, showIf: { id: 'urgency', eq: 'Later today' } },
        { id: 'duration', type: 'chips', label: 'For how long', required: true, options: ['5 minutes', '10 minutes', '15 minutes', '30 minutes', 'Rest of the period', 'Rest of the day'] },
        { id: 'reason', type: 'radio', label: 'Reason', required: true, other: true, options: ['Restroom break', 'Feeling unwell / medical', 'Personal or family call', 'Student emergency in my room', 'I need an administrator in my room', 'Meeting / pulled out of class'] },
      ] },
      { title: 'Where', fields: [
        { id: 'room', type: 'text', label: 'Room', required: true, placeholder: 'e.g. 214' },
        { id: 'period', type: 'select', label: 'Period', options: [] },
        { id: 'studentCount', type: 'number', label: 'Students in the room', min: 0, maxN: 60 },
        { id: 'notes', type: 'textarea', label: 'Anything the person covering should know?', rows: 2, placeholder: 'What the class is working on, students who need support…' },
      ] },
    ],
  },
  maintenance: {
    title: 'Maintenance & tech', long: 'Maintenance & technology request', icon: 'wrench', tone: 'blue', group: 'Building',
    blurb: 'Broken projector, no Wi‑Fi, room too hot, leaking sink — send it to the right people.',
    summary: d => `${d.category === 'Other' ? d['category|Other|text'] || 'Other' : d.category || 'Request'} · ${d.location || ''} · ${(d.priority || '').split(' —')[0]}`,
    when: () => todayISO(),
    actions: [['in_progress', 'Working on it', 'warning'], ['done', 'Fixed', 'good'], ['denied', 'Close', 'critical']],
    sections: [
      { title: 'The problem', fields: [
        { id: 'category', type: 'radio', label: 'Category', required: true, other: true, options: ['Computer / laptop / Chromebook', 'Projector, display or interactive board', 'Printer / copier', 'Network / Wi‑Fi', 'Account, password or software', 'Heating / air conditioning', 'Plumbing / leak', 'Electrical / lighting', 'Furniture', 'Doors, locks or keys', 'Custodial / cleaning / spill', 'Pests', 'Safety hazard'] },
        { id: 'priority', type: 'radio', label: 'Priority', required: true, cols: 1, options: ['Low — whenever you can', 'Normal — within a week', 'High — it’s affecting instruction', 'Urgent — safety issue (also call the office)'] },
        { id: 'description', type: 'textarea', label: 'Describe the problem', required: true, minLen: 10, rows: 4 },
        { id: 'since', type: 'date', label: 'When did it start?', maxToday: true },
      ] },
      { title: 'Location & access', fields: [
        { id: 'location', type: 'text', label: 'Room / location', required: true },
        { id: 'assetTag', type: 'text', label: 'Device or asset tag', hint: 'Usually a sticker with a barcode.' },
        { id: 'bestTime', type: 'checks', label: 'Best time to come by', options: ['Before school', 'During my planning period', 'Lunch', 'After school', 'Any time'] },
        { id: 'photoLink', type: 'text', label: 'Link to a photo (optional)' },
      ] },
    ],
  },
  fieldtrip: {
    title: 'Field trip', long: 'Field trip request', icon: 'bus', tone: 'teal', group: 'Building',
    blurb: 'Destination, transportation, chaperones, costs and safety — everything the office needs to approve a trip.',
    summary: d => `${d.tripName || 'Field trip'} · ${d.destination || ''} · ${fmtISO(d.date)}`,
    when: d => d.date,
    actions: [['approved', 'Approve', 'good'], ['denied', 'Deny', 'critical']],
    sections: [
      { title: 'Trip', fields: [
        { id: 'tripName', type: 'text', label: 'Trip name', required: true },
        { id: 'destination', type: 'text', label: 'Destination', required: true },
        { id: 'address', type: 'text', label: 'Address', span: 'sm:col-span-2' },
        { id: 'date', type: 'date', label: 'Date', required: true },
        { id: 'departTime', type: 'time', label: 'Departure', required: true },
        { id: 'returnTime', type: 'time', label: 'Return', required: true },
        { id: 'classes', type: 'courses', label: 'Classes going' },
        { id: 'grades', type: 'chips', label: 'Grade level', options: GRADES },
        { id: 'studentCount', type: 'number', label: 'Number of students', required: true, min: 1, maxN: 1000 },
        { id: 'purpose', type: 'textarea', label: 'Educational purpose / standards addressed', required: true, minLen: 20 },
      ] },
      { title: 'Logistics', fields: [
        { id: 'transport', type: 'radio', label: 'Transportation', required: true, other: true, options: ['School bus', 'Charter bus', 'Walking', 'Parent drivers (approved volunteers)'] },
        { id: 'chaperoneCount', type: 'number', label: 'Number of chaperones', required: true, min: 0 },
        { id: 'chaperones', type: 'textarea', label: 'Chaperone names', rows: 2, hint: 'Volunteers must be cleared through the district before the trip.' },
        { id: 'costPerStudent', type: 'number', label: 'Cost per student ($)', min: 0 },
        { id: 'funding', type: 'select', label: 'Funding', options: ['Students pay', 'School budget', 'PTA / PTO', 'Grant', 'Fundraiser', 'Free'] },
        { id: 'lunch', type: 'radio', label: 'Lunch', options: ['Students bring lunch', 'Cafeteria sack lunches', 'Purchase on site', 'Not needed'] },
        { id: 'safety', type: 'checks', label: 'Safety checklist', cols: 1, options: ['Nurse notified about student medications', 'IEP / 504 accommodations planned for', 'Permission slips sent home', 'Emergency contact list will travel with the group', 'Rain / cancellation plan in place'] },
        { id: 'subNeeded', type: 'yesno', label: 'Will you need a substitute?' },
        { id: 'notes', type: 'textarea', label: 'Other notes', rows: 2 },
      ] },
    ],
  },
  parentcontact: {
    title: 'Parent contact log', long: 'Parent / guardian contact log', icon: 'phone-call', tone: 'violet', group: 'Students',
    blurb: 'Document every family conversation. Flag it for administration when they should know.',
    summary: d => `${(d.students || []).map(s => s.name).join(', ')} · ${d.method || ''} · ${d.outcome || ''}`,
    when: d => d.date, log: true,
    actions: [['acknowledged', 'Mark reviewed', 'good']],
    sections: [
      { title: 'Contact', fields: [
        { id: 'students', type: 'students', label: 'Student(s)', required: true },
        { id: 'date', type: 'date', label: 'Date', required: true, maxToday: true },
        { id: 'time', type: 'time', label: 'Time' },
        { id: 'method', type: 'radio', label: 'How', required: true, options: ['Phone call', 'Email', 'Text / app message', 'In-person conference', 'Virtual meeting', 'Note home', 'Home visit'] },
        { id: 'initiatedBy', type: 'radio', label: 'Who reached out', required: true, options: ['I contacted the family', 'The family contacted me'] },
        { id: 'contactWith', type: 'text', label: 'Who you spoke with', placeholder: 'Name' },
        { id: 'relationship', type: 'select', label: 'Relationship', options: ['Mother', 'Father', 'Guardian', 'Grandparent', 'Foster parent', 'Other relative', 'Other'] },
        { id: 'interpreter', type: 'yesno', label: 'Was an interpreter used?' },
      ] },
      { title: 'Conversation', fields: [
        { id: 'reasons', type: 'checks', label: 'Topics', required: true, other: true, options: ['Academic progress', 'Missing work', 'Behavior', 'Attendance / tardies', 'Positive news', 'Health / wellness', 'IEP / 504'] },
        { id: 'outcome', type: 'radio', label: 'Outcome', required: true, options: ['Reached — resolved', 'Reached — follow-up needed', 'Left a voicemail', 'No answer', 'Wrong or disconnected number'] },
        { id: 'summary', type: 'textarea', label: 'Summary', required: true, minLen: 10, rows: 4 },
        { id: 'followUp', type: 'date', label: 'Follow-up date', required: true, showIf: { id: 'outcome', eq: 'Reached — follow-up needed' } },
        { id: 'flag', type: 'yesno', label: 'Flag this for administration?' },
      ] },
    ],
  },
};
const REQUEST_STATUS = {
  submitted: ['warning', 'Submitted'], acknowledged: ['good', 'Acknowledged'], approved: ['good', 'Approved'], denied: ['critical', 'Denied'],
  in_progress: ['warning', 'In progress'], done: ['good', 'Done'], cancelled: ['info', 'Cancelled'], logged: ['info', 'Logged'],
};
const statusChip = st => chip(...(REQUEST_STATUS[st] ? [REQUEST_STATUS[st][0], REQUEST_STATUS[st][1]] : ['info', st || '—']));

// ── Discipline referral (Behavioral Documentation) ─────────────────────
const LOCATIONS = ['Classroom', 'Restroom', 'Parking lot', 'Auditorium', 'Field trip / assembly', 'Gym / fitness center / locker room', 'Hallway', 'LMC (library media center)', 'Office area', 'Cafeteria (lunch room)', 'Outside (school grounds)', 'Bus / bus loop'];
const CLASSROOM_BEHAVIORS = [
  { v: 'Tardy', extra: [{ id: 'count', type: 'chips', label: 'Tardy number', required: true, options: ['1', '2', '3', '4'] }] },
  'Cell phone / inappropriate telecommunications', 'Disruptive to class / non-compliance', 'Cheating / minor academic dishonesty',
  'Electronic devices / minor technology violation', 'Infringement of personal space (non-fighting)', 'Inappropriate clothing / attire',
  'Personal display of affection', 'Inappropriate language',
];
const OFFICE_BEHAVIORS = [
  'Abusive / aggressive language / verbal attack', 'Physical attack on staff', 'Forgery / major academic dishonesty', 'Repeated tardiness (5 or more tardies)',
  'Fighting / physical aggression / safety violation', 'Sexual assault', 'Skipped detentions', 'Cell phone (office managed)', 'Drugs / look-alike',
  { v: 'Chronic classroom behaviors', extra: [{ id: 'describe', type: 'textarea', label: 'Please describe', required: true, rows: 2 }] },
  'Left class without a pass', 'Weapons / look-alike', 'Alcohol', 'Tobacco / vaping', 'Theft', 'Battery', 'Threats / intimidating acts / bullying',
  'Truancy / truancy pick-up', 'Vandalism / graffiti',
];
const CRITICAL_BEHAVIORS = ['Physical attack on staff', 'Sexual assault', 'Weapons / look-alike', 'Battery', 'Drugs / look-alike'];
const HIGH_BEHAVIORS = ['Fighting / physical aggression / safety violation', 'Threats / intimidating acts / bullying', 'Abusive / aggressive language / verbal attack', 'Alcohol', 'Theft', 'Vandalism / graffiti'];
const dated = (label = 'Date(s)') => [{ id: 'dates', type: 'dates', label, required: true }];
function referralForm({ settings, courses, canOffice, isNew }) {
  return {
    rules: [
      d => { const n = (d.classroomBehaviors || []).length + (d.officeBehaviors || []).length; return n ? null : { id: 'classroomBehaviors', msg: 'Check at least one problem behavior.' }; },
      d => { const n = (d.classroomBehaviors || []).length + (d.officeBehaviors || []).length; return n > 1 && !d.primary ? { id: 'primary', msg: 'Multiple behaviors are checked — choose the primary behavior for our records.' } : null; },
      d => (d.classroomActions || []).filter(a => a !== 'Parent contact').length >= 2 && !(d.classroomActions || []).includes('Parent contact') ? { id: 'classroomActions', msg: 'Parent contact is required when multiple redirects are needed.' } : null,
    ],
    sections: [
      { title: 'Behavioral record', hint: 'Who, when and where.', fields: [
        { id: 'students', type: 'students', label: "Student's name", required: true, hint: 'Add more than one student only if they were involved in the same incident.' },
        { id: 'referrer', type: 'text', label: 'Referring person', required: true },
        { id: 'referrerRole', type: 'select', label: 'Role', options: ['Teacher', 'Substitute', 'Administrator', 'Counselor', 'Paraprofessional', 'Bus driver', 'Cafeteria staff', 'Coach', 'Security / SRO', 'Other staff'] },
        { id: 'grade', type: 'chips', label: 'Grade', required: true, options: GRADES, hint: 'Filled in from the student’s record when you pick them.' },
        { id: 'date', type: 'date', label: 'Date of behavior', required: true, maxToday: true },
        { id: 'time', type: 'time', label: 'Time of behavior', required: true },
        { id: 'period', type: 'select', label: 'Period', options: [...(settings?.periods || []).map(p => p.name), 'Before school', 'Passing period', 'Lunch', 'After school', 'Bus'] },
        { id: 'course', type: 'select', label: 'Class (if in a class)', options: courses.map(c => c.title || c.id) },
        { id: 'location', type: 'radio', label: 'Location', required: true, other: true, options: LOCATIONS },
      ] },
      { title: 'Problem behavior', hint: 'If multiple behaviors are checked, identify the primary behavior for our records.', fields: [
        { id: 'classroomBehaviors', type: 'checks', label: 'Classroom managed (referrals)', other: true, options: CLASSROOM_BEHAVIORS },
        { id: 'officeBehaviors', type: 'checks', label: 'Office managed', other: true, options: OFFICE_BEHAVIORS },
        { id: 'primary', type: 'select', label: 'Primary behavior', options: [], hint: 'Required when more than one behavior is checked.' },
        { id: 'description', type: 'textarea', label: 'Description of behavior', required: true, minLen: 30, rows: 6, placeholder: 'Describe objectively what you saw and heard: what happened before, during and after; exact words if language was used; who else was present.' },
      ] },
      { title: 'Possible reason & others involved', fields: [
        { id: 'reasons', type: 'checks', label: 'Possible reason for behavior', required: true, options: ['Seeking peer attention', 'Seeking adult attention', 'Obtain object / activity', 'Avoid peer(s)', 'Avoid adult(s)', 'Avoid task / activity', 'Anger from previous situation', 'Unknown'] },
        { id: 'others', type: 'checks', label: 'Others involved', required: true, options: ['None', 'Peer(s)', 'Teacher(s)', 'Support staff', 'Substitute', 'Unknown'] },
        { id: 'othersNames', type: 'text', label: 'Names of others involved / witnesses', span: 'sm:col-span-2', showIf: { id: 'others', in: ['Peer(s)', 'Teacher(s)', 'Support staff', 'Substitute'] } },
        { id: 'injury', type: 'yesno', label: 'Was anyone injured?' },
        { id: 'injuryNote', type: 'text', label: 'Injury details / nurse visit', showIf: { id: 'injury', eq: 'Yes' } },
      ] },
      { title: 'Actions taken — classroom', hint: 'What you did before writing this referral.', fields: [
        { id: 'classroomActions', type: 'checks', label: 'Classroom (referrals)', options: [
          'Verbal warning / behavior correction',
          { v: 'Conference / re-teach expectations', extra: dated('Date(s)') },
          { v: 'Parent contact', hint: 'Required when multiple redirects are needed', extra: [
            { id: 'date', type: 'date', label: 'Date', required: true, maxToday: true },
            { id: 'method', type: 'select', label: 'How', options: ['Phone call', 'Email', 'Text / app message', 'In person', 'Note home', 'Voicemail left'] },
            { id: 'who', type: 'text', label: 'Who was contacted', required: true },
            { id: 'outcome', type: 'textarea', label: 'Outcome of conversation', required: true, rows: 2 },
          ] },
          { v: 'Time with teacher', extra: dated('Date(s)') },
          { v: 'Loss of privilege(s)', extra: [...dated('Date(s)'), { id: 'which', type: 'text', label: 'Which privilege(s)' }] },
          { v: 'Referral to', extra: [
            { id: 'to', type: 'select', label: 'Referred to', required: true, options: ['School counselor', 'Social worker', 'School psychologist', 'Nurse', 'ESE / case manager', 'MTSS / RtI team', 'Administrator', 'School resource officer', 'Other'] },
            { id: 'date', type: 'date', label: 'Date', required: true },
          ] },
          { v: 'Request for RtI problem-solving team', extra: [{ id: 'attachment', type: 'text', label: 'Link to documentation (please attach)', placeholder: 'Paste a link to the RtI documentation' }] },
        ] },
        { id: 'comments', type: 'textarea', label: 'Comments', rows: 3 },
      ] },
      canOffice ? { title: 'Office managed — administration only', hint: 'Completed by an administrator. Saving notifies the referring staff member.', fields: [
        { id: 'considered', type: 'checks', label: 'Determination', options: ['Considered bullying', 'Considered harassment', 'Considered discrimination'] },
        { id: 'basis', type: 'checks', label: 'By', showIf: { id: 'considered', any: true }, options: ['Sex', 'Sexual orientation', 'Race', 'Nationality', 'Ancestry', 'Pregnancy', 'Marital status', 'Disability', 'Religion', 'Gender identity'] },
        { id: 'officeActions', type: 'checks', label: 'Office actions', options: [
          { v: 'Detention(s)', extra: [{ id: 'when', type: 'chips', label: 'When', required: true, options: ['Before school', 'After school', 'Lunch', 'Saturday'] }, ...dated('Date(s)')] },
          { v: 'Conference / re-teach expectations', extra: dated('Date(s)') },
          { v: 'Restorative justice', extra: [{ id: 'type', type: 'select', label: 'Type', options: ['Restorative conversation', 'Mediation', 'Restorative circle', 'Restitution', 'Community service'] }, { id: 'date', type: 'date', label: 'Date' }] },
          { v: 'Probation contacted', extra: [{ id: 'officer', type: 'text', label: 'Probation officer' }, { id: 'date', type: 'date', label: 'Date', required: true }] },
          { v: 'Parent contact / conference', extra: [{ id: 'date', type: 'date', label: 'Date', required: true }, { id: 'who', type: 'text', label: 'Who was contacted', required: true }, { id: 'method', type: 'select', label: 'How', options: ['Phone call', 'Email', 'In-person conference', 'Virtual meeting', 'Letter home'] }] },
          { v: 'In-school suspension', extra: [{ id: 'days', type: 'number', label: 'Number of day(s)', required: true, min: 0, maxN: 30 }, { id: 'periods', type: 'text', label: 'Period(s) or time' }, { id: 'start', type: 'date', label: 'Starting' }] },
          { v: 'Out-of-school suspension', extra: [{ id: 'days', type: 'number', label: 'Number of day(s)', required: true, min: 1, maxN: 30 }, { id: 'start', type: 'date', label: 'Starting', required: true }, { id: 'returnOn', type: 'date', label: 'Return on', required: true }] },
          { v: 'Parking permit revoked', extra: [{ id: 'until', type: 'date', label: 'Until' }] },
          { v: 'Computer access suspended', extra: [{ id: 'for', type: 'text', label: 'Suspended for', required: true, placeholder: 'e.g. 10 school days' }] },
          { v: 'Bus suspension', extra: [{ id: 'days', type: 'number', label: 'Number of day(s)', required: true, min: 1, maxN: 180 }] },
          { v: 'Referred to police', extra: [{ id: 'date', type: 'date', label: 'Date', required: true }, { id: 'case', type: 'text', label: 'Case / report number' }] },
          { v: 'Arrested', extra: [{ id: 'charge', type: 'text', label: 'Charge (optional)' }] },
          { v: 'Recommended for pre-expulsion conference', extra: [{ id: 'date', type: 'date', label: 'Conference date' }] },
          { v: 'Recommended for expulsion', extra: [{ id: 'date', type: 'date', label: 'Date' }] },
          { v: 'No further action', hint: 'Handled by the classroom actions above' },
        ] },
        { id: 'adminName', type: 'text', label: 'Administrator', required: true },
        { id: 'adminDate', type: 'date', label: 'Date', required: true },
        { id: 'adminPhone', type: 'phone', label: 'Phone number' },
        { id: 'status', type: 'chips', label: 'Referral status', required: true, options: ['Open', 'Under review', 'Resolved'] },
        { id: 'shareWithFamily', type: 'yesno', label: "Share with the student's family in Ember?", hint: 'Parents and the student see the behavior, date, location and actions on the Discipline tab and get a notification. Teacher descriptions and internal notes are never shared.' },
        { id: 'familyNote', type: 'textarea', label: 'Note for the family', rows: 2, showIf: { id: 'shareWithFamily', eq: 'Yes' }, placeholder: 'Optional: what happens next, expectations, how to reach you.' },
        { id: 'adminNotes', type: 'textarea', label: 'Internal notes', rows: 3, hint: 'Only administrators and safety staff can see these.' },
      ] } : { title: 'Office managed — administration only', locked: isNew ? 'An administrator completes this part after you submit. You’ll get a notification when they do.' : 'Waiting for an administrator to review this referral.', fields: [] },
    ],
  };
}
const referralBehaviors = d => [...(d.classroomBehaviors || []), ...(d.officeBehaviors || [])].map(b => b === 'Other' ? (d['classroomBehaviors|Other|text'] || d['officeBehaviors|Other|text'] || 'Other') : b);
function referralSeverity(d, office = {}) {
  const all = [...(d.classroomBehaviors || []), ...(d.officeBehaviors || [])];
  const acts = office.officeActions || [];
  if (all.some(b => CRITICAL_BEHAVIORS.includes(b)) || acts.some(a => ['Arrested', 'Referred to police', 'Recommended for expulsion'].includes(a))) return 'critical';
  if (all.some(b => HIGH_BEHAVIORS.includes(b)) || acts.includes('Out-of-school suspension') || acts.includes('Recommended for pre-expulsion conference')) return 'high';
  if ((d.officeBehaviors || []).length) return 'medium';
  return 'low';
}
const SEV = { low: ['good', 'Low'], medium: ['warning', 'Medium'], high: ['serious', 'High'], critical: ['critical', 'Critical'] };
const REF_STATUS = { open: ['warning', 'Open'], 'under review': ['warning', 'Under review'], resolved: ['good', 'Resolved'], closed: ['good', 'Resolved'] };
const refStatusChip = st => chip(...(REF_STATUS[(st || 'open').toLowerCase()] || ['info', st]));

// ═══════════════════════════════════════════════════════════════
// STAFF HUB (side menu + pages)
// ═══════════════════════════════════════════════════════════════
// Staff Hub pages live inside the one school menu (app.js SCHOOL_MENU) under 'hub-*' keys.
function hubPage(ctx, active, content, crumb = null) {
  return tenantPage(ctx, `hub-${active}`, content, null, { crumbs: crumb ? [{ label: crumb }] : [] });
}
async function formEnv(ctx) {
  const [courses, sis] = await Promise.all([myCourses(ctx).catch(() => []), sisModule()]);
  const settings = await sis.getSettings(ctx).catch(() => null);
  const pName = id => settings?.periods.find(p => p.id === id)?.name || '';
  let students = [];
  try { students = (await getDocs(collection(db, 'tenants', ctx.slug, 'students'))).docs.map(d => ({ uid: d.id, ...d.data() })).filter(s => s.status !== 'pending' && s.status !== 'rejected').sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b))); } catch (e) { console.warn(e); }
  return { courses: courses.map(c => ({ ...c, periodName: pName(c.periodId) })), settings, students, periods: (settings?.periods || []).map(p => p.name) };
}

export async function viewStaff(ctx, sub, id) {
  if (sub === 'new' && id === 'referral') return viewReferralForm(ctx);
  if (sub === 'new' && REQUESTS[id]) return viewRequestForm(ctx, id);
  if (sub === 'requests' && id) return viewRequest(ctx, id);
  return viewHubHome(ctx);
}

async function viewHubHome(ctx) {
  const t = routeTokenNow();
  setTitle('Staff Hub', ctx.tenant.name);
  const card = (k, title, blurb, icon, tone, href, extra = '') => `<a href="${href}" ${extra} class="card card-hover p-4 flex items-start gap-3">${iconTile(icon, tone)}<span class="min-w-0"><span class="block text-sm text-white">${escapeHtml(title)}</span><span class="block text-xs text-gray-500 mt-0.5">${escapeHtml(blurb)}</span></span></a>`;
  const base = `/${ctx.slug}/staff`;
  render(hubPage(ctx, 'overview', pageHeader({ eyebrow: 'Staff Hub', title: 'Forms & requests', subtitle: 'Everything you send to the office, in one place. You’ll get a notification when something you sent is reviewed.' }) + `
    <div class="max-w-6xl">
      <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-10">
        ${card('referral', 'Discipline referral', 'Full behavioral documentation for the office.', 'flag', 'red', buildUrl(`${base}/new/referral`))}
        ${Object.entries(REQUESTS).map(([k, f]) => card(k, f.long, f.blurb, f.icon, f.tone, buildUrl(`${base}/new/${k}`))).join('')}
        ${card('plans', 'Lesson plans', 'Write weekly plans and submit them for review.', 'clipboard-check', 'violet', buildUrl(`/${ctx.slug}/planning`))}
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3"><h2 class="font-serif text-xl text-white">My submissions</h2>
        <div class="segmented" role="tablist"><button data-f="open" aria-pressed="true">Open</button><button data-f="all" aria-pressed="false">All</button></div></div>
      <div id="hub-list">${skeletonRows(4)}</div>
    </div>`));
  let filter = 'open', rows = [];
  const draw = () => {
    $$('[data-f]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === filter)));
    const shownRows = rows.filter(r => filter === 'all' || r.open);
    $('#hub-list').innerHTML = shownRows.length ? dataTable(
      [{ label: 'Form', cls: 'col-span-12 sm:col-span-6' }, { label: 'Submitted', cls: 'col-span-6 sm:col-span-3' }, { label: 'Status', cls: 'col-span-6 sm:col-span-3' }],
      shownRows.map(r => ({ cells: [
        `<a href="${r.href}" class="flex items-center gap-3 min-w-0">${iconTile(r.icon, r.tone)}<span class="min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(r.title)}</span><span class="block text-[11px] text-gray-500 truncate">${escapeHtml(r.summary)}</span></span></a>`,
        `<span class="text-xs text-gray-400">${escapeHtml(timeAgo(r.createdAt))}</span>`, r.chip] })))
      : emptyState({ icon: 'inbox', title: filter === 'open' ? 'Nothing waiting' : 'No submissions yet', text: 'Forms you send to the office will show up here with their status.' });
    refreshIcons();
  };
  $('#main').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } });
  try {
    const [reqs, refs] = await Promise.all([
      getDocs(query(collection(db, 'tenants', ctx.slug, 'requests'), where('submittedBy', '==', ctx.me.uid))),
      getDocs(query(collection(db, 'tenants', ctx.slug, 'incidents'), where('reportedBy', '==', ctx.me.uid))),
    ]);
    if (!live(t)) return;
    rows = [
      ...reqs.docs.map(d => { const r = d.data(), f = REQUESTS[r.type] || {}; return { title: f.long || r.type, summary: r.summary || '', icon: f.icon || 'file', tone: f.tone || 'muted', href: buildUrl(`${base}/requests/${d.id}`), createdAt: r.createdAt, open: ['submitted', 'in_progress'].includes(r.status), chip: statusChip(r.status) }; }),
      ...refs.docs.map(d => { const r = d.data(); return { title: r.form === 'referral' ? 'Discipline referral' : r.isConcern ? 'Concern' : 'Incident report', summary: `${(r.studentNames || []).join(', ')} · ${r.type || ''}`, icon: 'flag', tone: 'red', href: buildUrl(`/${ctx.slug}/referrals/${d.id}`), createdAt: r.createdAt, open: !['resolved', 'closed'].includes((r.status || 'open').toLowerCase()), chip: refStatusChip(r.status) }; }),
    ].sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    draw();
  } catch (e) { console.error(e); if (live(t)) { $('#hub-list').innerHTML = errorBox(e); refreshIcons(); } }
}

function formShell(ctx, active, crumb, header, formId) {
  return hubPage(ctx, active, pageHeader(header) + `<form id="${formId}" class="max-w-4xl space-y-5" novalidate><div class="space-y-5" data-sections>${skeletonRows(5, 'h-40')}</div>
    <div class="sticky bottom-0 z-10 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 bg-[#0A0A0A]/90 backdrop-blur flex flex-wrap items-center gap-3 border-t border-white/[0.06]">
      <button type="submit" class="btn btn-primary">${ico('send', 'w-4 h-4')} Submit</button><a href="${buildUrl(`/${ctx.slug}/staff`)}" class="btn btn-ghost">Cancel</a>
      <span class="text-xs text-gray-500 ml-auto"><span class="text-[#F59E0B]">*</span> required</span><p class="form-error w-full hidden" data-form-error role="alert"></p></div></form>`, crumb);
}

async function viewRequestForm(ctx, type) {
  const t = routeTokenNow(), def = REQUESTS[type];
  setTitle(def.long, ctx.tenant.name);
  render(formShell(ctx, type, def.title, { eyebrow: 'Staff Hub', title: escapeHtml(def.long), subtitle: escapeHtml(def.blurb) }, 'req-form'));
  const env = await formEnv(ctx);
  if (!live(t)) return;
  const form = { sections: def.sections.map(s => ({ ...s, fields: s.fields.map(f => f.id === 'period' && type === 'coverage' ? { ...f, options: env.periods } : f) })) };
  const defaults = { date: todayISO(), ...(type === 'coverage' ? { room: env.courses.find(c => c.room)?.room || '' } : {}) };
  const root = $('#req-form');
  root.querySelector('[data-sections]').innerHTML = formHTML(form, defaults, env);
  refreshIcons();
  bindForm(root, form, env);
  root.addEventListener('submit', e => {
    e.preventDefault();
    const data = collect(root, form), errs = validate(form, data);
    showErrors(root, errs);
    const fe = root.querySelector('[data-form-error]');
    if (errs.length) return showError(fe, `Please fix ${plural(errs.length, 'item')} above.`);
    showError(fe, '');
    withBusy(root.querySelector('[type=submit]'), 'Submitting…', async () => {
      try {
        const summary = def.summary(data);
        const ref = await addDoc(collection(db, 'tenants', ctx.slug, 'requests'), {
          type, data, summary, when: def.when?.(data) || todayISO(), status: def.log ? 'logged' : 'submitted', urgent: !!def.urgent,
          submittedBy: ctx.me.uid, submittedByName: ctx.me.name, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        if (!def.log || data.flag === 'Yes') {
          officeStaffUids(ctx).then(to => notify(ctx, { to, kind: def.urgent ? 'coverage' : 'request', title: `${def.urgent ? '🔔 ' : ''}${def.long} from ${ctx.me.name}`, body: summary, link: `/${ctx.slug}/staff/requests/${ref.id}` })).catch(e => console.warn(e));
        }
        toast(def.log ? 'Contact logged' : def.urgent ? 'Request sent — administrators were alerted' : 'Submitted to the office');
        navigate(`/${ctx.slug}/staff/requests/${ref.id}`);
      } catch (ex) { console.error(ex); showError(fe, ex.message); }
    });
  });
}

async function viewRequest(ctx, id) {
  const t = routeTokenNow();
  render(hubPage(ctx, 'overview', `<div class="max-w-4xl">${skeletonRows(5, 'h-32')}</div>`, 'Request'));
  let snap;
  try { snap = await getDoc(doc(db, 'tenants', ctx.slug, 'requests', id)); }
  catch (e) { if (live(t)) render(hubPage(ctx, 'overview', emptyState({ icon: 'lock', title: "You can't open this request", text: 'Only the person who sent it and administrators can see it.' }))); return; }
  if (!live(t)) return;
  if (!snap.exists()) return render(hubPage(ctx, 'overview', emptyState({ icon: 'file-x', title: 'Request not found' })));
  const r = { id: snap.id, ...snap.data() }, def = REQUESTS[r.type];
  if (!def) return render(hubPage(ctx, 'overview', errorBox(new Error('Unknown request type'))));
  setTitle(def.long, ctx.tenant.name);
  const mine = r.submittedBy === ctx.me.uid;
  const canDecide = ctx.isAdmin;
  const open = ['submitted', 'in_progress'].includes(r.status);
  const decision = r.decision ? `<section class="card p-5 sm:p-6 border-l-2 ${REQUEST_STATUS[r.status]?.[0] === 'critical' ? 'border-l-[#d03b3b]' : 'border-l-[#0ca30c]'}"><div class="flex items-center justify-between gap-3 mb-1"><h2 class="text-sm text-white font-medium">Office response</h2>${statusChip(r.status)}</div><p class="text-xs text-gray-500">${escapeHtml(r.decision.byName || 'Administrator')} · ${escapeHtml(timeAgo(r.decision.at))}</p>${r.decision.note ? `<p class="text-sm text-gray-300 mt-3 whitespace-pre-wrap">${escapeHtml(r.decision.note)}</p>` : ''}</section>` : '';
  const panel = canDecide ? `<section class="card p-5 sm:p-6"><h2 class="text-sm text-white font-medium mb-3">${open ? 'Respond' : 'Update response'}</h2>
      <label class="label" for="dec-note">Note to ${escapeHtml(r.submittedByName || 'the requester')}</label><textarea id="dec-note" rows="2" class="input mb-3" placeholder="Optional"></textarea>
      <div class="flex flex-wrap gap-2">${def.actions.map(([st, label, lvl]) => `<button type="button" class="btn ${lvl === 'critical' ? 'btn-secondary' : lvl === 'good' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-decide="${st}">${escapeHtml(label)}</button>`).join('')}</div></section>` : '';
  render(hubPage(ctx, mine ? r.type : 'overview', pageHeader({ eyebrow: escapeHtml(def.long), title: escapeHtml(r.summary || def.long), subtitle: `${escapeHtml(r.submittedByName || '')} · submitted ${escapeHtml(formatDateTime(r.createdAt))}`,
      actions: `<div class="flex items-center gap-2">${statusChip(r.status)}<button class="btn btn-secondary btn-sm" data-print>${ico('printer', 'w-3.5 h-3.5')} Print</button>${mine && open ? `<button class="btn btn-ghost btn-sm" data-cancel>Cancel request</button>` : ''}</div>` })
    + `<div class="max-w-4xl space-y-5">${r.urgent && open ? `<div class="p-3 rounded-lg border border-[#fab219]/30 bg-[#fab219]/5 text-sm text-gray-200 flex gap-2">${ico('bell-ring', 'w-4 h-4 st-warning shrink-0 mt-0.5')} Administrators were alerted. This page updates when someone responds.</div>` : ''}${decision}${panel}${readonlyHTML(def, r.data || {})}</div>`, def.title));
  refreshIcons();
  $('#main').addEventListener('click', async e => {
    if (e.target.closest('[data-print]')) return printNow(printHTML(def.long, `${ctx.tenant.name} · ${r.submittedByName || ''} · ${formatDateTime(r.createdAt)} · ${REQUEST_STATUS[r.status]?.[1] || r.status}`, def, r.data || {}));
    if (e.target.closest('[data-cancel]')) {
      if (!await confirmDialog({ title: 'Cancel this request?', confirmLabel: 'Cancel request', danger: true })) return;
      try { await updateDoc(doc(db, 'tenants', ctx.slug, 'requests', id), { status: 'cancelled', updatedAt: serverTimestamp() }); toast('Request cancelled', 'info'); renderRoute(); } catch (ex) { toast(ex.message, 'error'); }
      return;
    }
    const b = e.target.closest('[data-decide]'); if (!b) return;
    const st = b.dataset.decide, note = $('#dec-note').value.trim();
    withBusy(b, 'Saving…', async () => {
      try {
        await updateDoc(doc(db, 'tenants', ctx.slug, 'requests', id), { status: st, decision: { by: ctx.me.uid, byName: ctx.me.name, note, at: new Date() }, updatedAt: serverTimestamp() });
        notify(ctx, { to: [r.submittedBy], kind: r.type === 'coverage' ? 'coverage' : 'decision', title: `${def.long}: ${REQUEST_STATUS[st]?.[1] || st}`, body: `${ctx.me.name}${note ? ': “' + note.slice(0, 160) + '”' : ''} · ${r.summary || ''}`, link: `/${ctx.slug}/staff/requests/${id}` }).catch(e2 => console.warn(e2));
        toast('Response sent'); renderRoute();
      } catch (ex) { toast(ex.message, 'error'); }
    });
  });
}

// ── Referral: new + view/office review ───────────────────────────────
async function viewReferralForm(ctx) {
  const t = routeTokenNow();
  setTitle('Discipline referral', ctx.tenant.name);
  render(formShell(ctx, 'referral', 'Discipline referral', { eyebrow: 'Behavioral documentation', title: 'Discipline referral', subtitle: 'Behavioral record. Administrators and safety staff are notified as soon as you submit.' }, 'ref-form'));
  const env = await formEnv(ctx);
  if (!live(t)) return;
  const canOffice = ctx.can('safety');
  const form = referralForm({ settings: env.settings, courses: env.courses, canOffice, isNew: true });
  const root = $('#ref-form');
  const defaults = { referrer: ctx.me.name, referrerRole: ctx.isAdmin ? 'Administrator' : 'Teacher', date: todayISO(), time: nowHM(), adminName: canOffice ? ctx.me.name : '', adminDate: todayISO(), status: 'Open' };
  const pre = new URLSearchParams(location.search).get('student');
  if (pre) { const s = env.students.find(x => x.uid === pre); if (s) { defaults.students = [{ uid: s.uid, name: displayNameOf(s), grade: s.gradeLevel ?? '' }]; if (s.gradeLevel) defaults.grade = String(s.gradeLevel); } }
  root.querySelector('[data-sections]').innerHTML = formHTML(form, defaults, env);
  refreshIcons();
  const primarySel = () => root.querySelector('[data-input="primary"]');
  env.onChange = data => {
    const opts = referralBehaviors(data), sel = primarySel(), cur = sel.value;
    sel.innerHTML = `<option value="">${opts.length > 1 ? 'Choose the primary behavior…' : opts.length ? opts[0] : 'Check a behavior above'}</option>${opts.length > 1 ? opts.map(o => `<option ${o === cur ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('') : ''}`;
    root.querySelector('[data-field="primary"]').classList.toggle('hidden', opts.length < 2);
  };
  env.onStudents = (list, r) => { const g = list[0]?.grade; if (g !== undefined && g !== '') { const inp = r.querySelector(`[data-input="grade"] input[value="${CSS.escape(String(g))}"]`); if (inp) inp.checked = true; } };
  bindForm(root, form, env);
  root.addEventListener('submit', e => {
    e.preventDefault();
    const data = collect(root, form), errs = validate(form, data);
    showErrors(root, errs);
    const fe = root.querySelector('[data-form-error]');
    if (errs.length) return showError(fe, `Please fix ${plural(errs.length, 'item')} above.`);
    showError(fe, '');
    withBusy(root.querySelector('[type=submit]'), 'Submitting…', async () => {
      try {
        const officeIds = ['considered', 'basis', 'officeActions', 'adminName', 'adminDate', 'adminPhone', 'status', 'shareWithFamily', 'familyNote', 'adminNotes'];
        const teacher = {}, office = {};
        Object.entries(data).forEach(([k, v]) => (officeIds.includes(k.split('|')[0]) ? office : teacher)[k] = v);
        const doc0 = buildIncident(teacher, canOffice ? office : null);
        const ref = await addDoc(collection(db, 'tenants', ctx.slug, 'incidents'), { ...doc0, form: 'referral', referral: teacher, office: canOffice ? office : null, isConcern: false, reportedBy: ctx.me.uid, reportedByName: ctx.me.name, createdAt: serverTimestamp() });
        const who = (teacher.students || []).map(s => s.name).join(', ');
        officeStaffUids(ctx, 'safety').then(to => notify(ctx, { to, kind: 'referral', title: `New referral: ${who}`, body: `${doc0.type} · ${doc0.location} · ${fmtISO(doc0.date)} · from ${ctx.me.name}`, link: `/${ctx.slug}/referrals/${ref.id}` })).catch(e2 => console.warn(e2));
        if (ctx.tenant.districtId && (doc0.severity === 'high' || doc0.severity === 'critical')) notify(ctx, { toDistrict: ctx.tenant.districtId, kind: 'referral', title: `${SEV[doc0.severity][1]} referral at ${ctx.tenant.name}`, body: `${doc0.type} · ${fmtISO(doc0.date)}`, link: `/${ctx.slug}/referrals/${ref.id}` }).catch(e2 => console.warn(e2));
        if (canOffice) await syncFamilyRecords(ctx, ref.id, teacher, office);
        if (canOffice && office.shareWithFamily === 'Yes') notifyFamily(ctx, teacher, office, ref.id);
        toast('Referral submitted'); navigate(`/${ctx.slug}/referrals/${ref.id}`);
      } catch (ex) { console.error(ex); showError(fe, ex.message); }
    });
  });
}
function buildIncident(teacher, office) {
  const behaviors = referralBehaviors(teacher);
  const loc = teacher.location === 'Other' ? (teacher['location|Other|text'] || 'Other') : teacher.location;
  return {
    date: teacher.date, time: teacher.time || '', type: teacher.primary || behaviors[0] || 'Referral', behaviors, severity: referralSeverity(teacher, office || {}),
    status: (office?.status || 'Open').toLowerCase(), location: loc || '', description: teacher.description || '',
    studentUids: (teacher.students || []).map(s => s.uid), studentNames: (teacher.students || []).map(s => s.name), updatedAt: serverTimestamp(),
  };
}
function officeSummary(office) {
  const acts = (office.officeActions || []).map(a => {
    if (a === 'Out-of-school suspension') return `Out-of-school suspension (${office['officeActions|Out-of-school suspension|days'] || '?'} day(s), return ${fmtISO(office['officeActions|Out-of-school suspension|returnOn'])})`;
    if (a === 'In-school suspension') return `In-school suspension (${office['officeActions|In-school suspension|days'] || '?'} day(s))`;
    if (a === 'Detention(s)') return `Detention (${office['officeActions|Detention(s)|when'] || ''} ${(office['officeActions|Detention(s)|dates'] || []).map(fmtISO).join(', ')})`.replace(' )', ')');
    return a;
  });
  return acts.join('; ');
}
// Family-safe copy of a referral (behavior, date, location, actions, contact) — never the teacher's
// description or the office's internal notes. Removed again if the office stops sharing it.
async function syncFamilyRecords(ctx, id, teacher, office) {
  const share = office.shareWithFamily === 'Yes';
  const behaviors = referralBehaviors(teacher);
  await Promise.allSettled((teacher.students || []).map(st => {
    const ref = doc(db, 'tenants', ctx.slug, 'disciplineRecords', `${id}_${st.uid}`);
    if (!share) return deleteDoc(ref);
    const loc = teacher.location === 'Other' ? (teacher['location|Other|text'] || 'Other') : teacher.location;
    return setDoc(ref, { incidentId: id, studentUid: st.uid, studentName: st.name, date: teacher.date || '', location: loc || '', behavior: teacher.primary || behaviors[0] || 'Behavior referral', behaviors,
      actions: officeSummary(office), summary: office.familyNote || '', status: (office.status || 'Open').toLowerCase(), adminName: office.adminName || '', adminPhone: office.adminPhone || '', sharedBy: ctx.me.uid, sharedAt: serverTimestamp() });
  }));
}
function notifyFamily(ctx, teacher, office, id) {
  const sids = (teacher.students || []).map(s => s.uid);
  const what = teacher.primary || referralBehaviors(teacher)[0] || 'Behavior referral';
  const body = `${what} on ${fmtISO(teacher.date)}${officeSummary(office) ? ' · Action: ' + officeSummary(office) : ''}. Contact ${office.adminName || 'the school office'}${office.adminPhone ? ' at ' + office.adminPhone : ''} with questions.`;
  sids.forEach(sid => {
    const name = (teacher.students || []).find(s => s.uid === sid)?.name || 'Your student';
    notify(ctx, { to: [sid], kind: 'referral', title: 'Discipline referral', body, link: `/${ctx.slug}/record/me/discipline` }).catch(e => console.warn(e));
    guardianUidsOf(ctx, [sid]).then(to => notify(ctx, { to, kind: 'referral', title: `Discipline referral for ${name}`, body, link: `/${ctx.slug}/record/${sid}/discipline` })).catch(e => console.warn(e));
  });
}

export async function viewReferral(ctx, id) {
  const t = routeTokenNow();
  const officeView = ctx.can('safety');
  const page = (content, crumb) => officeView
    ? tenantPage(ctx, 'sis-safety', content, null, { crumbs: [{ label: crumb || 'Referral' }] })
    : hubPage(ctx, 'overview', content, crumb || 'Referral');
  render(page(`<div class="max-w-4xl">${skeletonRows(5, 'h-32')}</div>`));
  let snap;
  try { snap = await getDoc(doc(db, 'tenants', ctx.slug, 'incidents', id)); }
  catch (e) { if (live(t)) render(page(emptyState({ icon: 'lock', title: "You can't open this referral", text: 'Referrals are visible to the staff member who wrote them, administrators and safety staff.' }))); return; }
  if (!live(t)) return;
  if (!snap.exists()) return render(page(emptyState({ icon: 'file-x', title: 'Referral not found' })));
  const x = { id: snap.id, ...snap.data() };
  if (x.form !== 'referral') return legacyIncident(ctx, x, page);
  const env = officeView ? await formEnv(ctx) : { courses: [], students: [], periods: [], settings: null };
  if (!live(t)) return;
  const teacherForm = referralForm({ settings: env.settings, courses: env.courses, canOffice: false, isNew: false });
  teacherForm.sections = teacherForm.sections.slice(0, 4);
  const officeForm = referralForm({ settings: env.settings, courses: env.courses, canOffice: true, isNew: false });
  officeForm.sections = officeForm.sections.slice(4);
  officeForm.rules = [];
  const who = (x.studentNames || []).join(', ') || 'Student';
  setTitle(`Referral · ${who}`, ctx.tenant.name);
  const sev = SEV[x.severity] || SEV.low;
  const officeData = x.office || {};
  const officeDone = !!x.office;
  render(page(pageHeader({ eyebrow: 'Discipline referral', title: escapeHtml(who), subtitle: `${escapeHtml(x.type || '')} · ${escapeHtml(fmtISO(x.date))}${x.time ? ' ' + escapeHtml(fmtHM(x.time)) : ''} · ${escapeHtml(x.location || '')} · referred by ${escapeHtml(x.reportedByName || '')}`,
      actions: `<div class="flex flex-wrap items-center gap-3">${refStatusChip(x.status)}${chip(sev[0], sev[1] + ' severity')}<button class="btn btn-secondary btn-sm" data-print>${ico('printer', 'w-3.5 h-3.5')} Print</button></div>` })
    + `<div class="max-w-4xl space-y-5">
        ${readonlyHTML(teacherForm, x.referral || {})}
        ${officeView ? `<form id="office-form" class="space-y-5" novalidate><div data-sections>${formHTML(officeForm, { adminName: ctx.me.name, adminDate: todayISO(), status: 'Under review', ...officeData }, env)}</div>
            <div class="sticky bottom-0 z-10 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 bg-[#0A0A0A]/90 backdrop-blur flex flex-wrap items-center gap-3 border-t border-white/[0.06]"><button type="submit" class="btn btn-primary">${ico('save', 'w-4 h-4')} Save office action</button><span class="text-xs text-gray-500">${officeDone ? `Last updated ${escapeHtml(timeAgo(x.updatedAt))}` : 'Not reviewed yet'}</span><p class="form-error w-full hidden" data-form-error role="alert"></p></div></form>`
          : officeDone ? readonlyHTML({ sections: officeForm.sections.map(s => ({ ...s, fields: s.fields.filter(f => f.id !== 'adminNotes') })) }, officeData)
          : `<section class="card p-5 sm:p-6"><h2 class="font-serif text-lg text-white mb-2">Office managed — administration only</h2><p class="text-sm text-gray-500">Waiting for an administrator to review this referral. You’ll get a notification when they do.</p></section>`}
      </div>`, 'Referral'));
  refreshIcons();
  $('#main').addEventListener('click', e => {
    if (!e.target.closest('[data-print]')) return;
    const both = { sections: [...teacherForm.sections, ...(officeDone || officeView ? officeForm.sections.map(s => ({ ...s, fields: s.fields.filter(f => f.id !== 'adminNotes' && f.id !== 'shareWithFamily') })) : [])] };
    printNow(printHTML('Discipline Referral — Behavioral Documentation', `${ctx.tenant.name} · Referral #${x.id.slice(0, 6).toUpperCase()}`, both, { ...(x.referral || {}), ...officeData },
      `<div class="pf-sign"><div>Administrator signature</div><div>Parent/guardian signature</div><div>Student signature</div></div>`));
  });
  if (!officeView) return;
  const root = $('#office-form');
  bindForm(root, officeForm, env);
  root.addEventListener('submit', e => {
    e.preventDefault();
    const data = collect(root, officeForm), errs = validate(officeForm, data);
    showErrors(root, errs);
    const fe = root.querySelector('[data-form-error]');
    if (errs.length) return showError(fe, `Please fix ${plural(errs.length, 'item')} above.`);
    withBusy(root.querySelector('[type=submit]'), 'Saving…', async () => {
      try {
        const sevNow = referralSeverity(x.referral || {}, data);
        await updateDoc(doc(db, 'tenants', ctx.slug, 'incidents', id), { office: data, status: (data.status || 'Open').toLowerCase(), severity: sevNow, updatedAt: serverTimestamp(), updatedBy: ctx.me.uid });
        await syncFamilyRecords(ctx, id, x.referral || {}, data);
        const actions = officeSummary(data);
        notify(ctx, { to: [x.reportedBy], kind: 'referral', title: `Your referral for ${who} was ${data.status === 'Resolved' ? 'resolved' : 'reviewed'}`, body: `${ctx.me.name}${actions ? ' · ' + actions : ''}`, link: `/${ctx.slug}/referrals/${id}` }).catch(e2 => console.warn(e2));
        if (data.shareWithFamily === 'Yes' && x.office?.shareWithFamily !== 'Yes') notifyFamily(ctx, x.referral || {}, data, id);
        if (ctx.tenant.districtId && sevNow === 'critical' && x.severity !== 'critical') notify(ctx, { toDistrict: ctx.tenant.districtId, kind: 'referral', title: `Critical referral at ${ctx.tenant.name}`, body: `${x.type} · ${actions}`, link: `/${ctx.slug}/referrals/${id}` }).catch(e2 => console.warn(e2));
        toast('Office action saved'); renderRoute();
      } catch (ex) { console.error(ex); showError(fe, ex.message); }
    });
  });
}
function legacyIncident(ctx, x, page) {
  render(page(pageHeader({ eyebrow: x.isConcern ? 'Concern' : 'Incident', title: escapeHtml((x.studentNames || []).join(', ') || x.type || 'Incident'), subtitle: `${escapeHtml(x.type || '')} · ${escapeHtml(fmtISO(x.date))} · ${escapeHtml(x.location || '')}`, actions: refStatusChip(x.status) })
    + `<div class="max-w-3xl card p-6"><p class="text-sm text-gray-300 whitespace-pre-wrap">${escapeHtml(x.description || '')}</p><p class="text-xs text-gray-500 mt-4">Reported by ${escapeHtml(x.reportedByName || '')}</p>${ctx.can('safety') ? `<button class="btn btn-secondary btn-sm mt-4" data-open-legacy>${ico('pencil', 'w-3.5 h-3.5')} Edit in the incident log</button>` : ''}</div>`));
  refreshIcons();
  $('[data-open-legacy]')?.addEventListener('click', async () => (await sisModule()).openIncidentModal(ctx, x));
}

// ═══════════════════════════════════════════════════════════════
// OFFICE: staff request queue
// ═══════════════════════════════════════════════════════════════
export async function viewRequestQueue(ctx) {
  const t = routeTokenNow();
  setTitle('Staff requests', ctx.tenant.name);
  let status = new URLSearchParams(location.search).get('status') || 'open', type = '';
  render(tenantPage(ctx, 'staff-requests', pageHeader({ eyebrow: 'Office', title: 'Staff requests', subtitle: 'Call-outs, subs, coverage, maintenance, field trips and flagged parent contacts from your staff.' }) + `
    <div class="max-w-6xl"><div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div class="segmented" role="tablist"><button data-st="open">Open</button><button data-st="today">Today</button><button data-st="all">All</button></div>
      <select id="rq-type" class="input !py-2 !w-auto" aria-label="Form type"><option value="">All forms</option>${Object.entries(REQUESTS).map(([k, f]) => `<option value="${k}">${escapeHtml(f.long)}</option>`).join('')}</select></div>
      <div id="rq-kpis" class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6"></div><div id="rq-list">${skeletonRows(5)}</div></div>`));
  let all = [];
  const draw = () => {
    $$('[data-st]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.st === status)));
    const open = r => ['submitted', 'in_progress'].includes(r.status) || (r.type === 'parentcontact' && r.status === 'logged' && r.data?.flag === 'Yes');
    const list = all.filter(r => (!type || r.type === type) && (status === 'all' || (status === 'open' ? open(r) : r.when === todayISO() || toDateInput(new Date(tsMillis(r.createdAt))) === todayISO())));
    const k = (label, v, sub, lvl) => `<div class="card p-5"><div class="text-xs text-gray-400 mb-2">${label}</div><div class="stat-value">${v}</div><div class="mt-1 text-xs text-gray-500 flex items-center gap-1.5">${lvl ? ico(STATUS_ICON[lvl][0], 'w-3.5 h-3.5 ' + STATUS_ICON[lvl][1]) : ''}${sub}</div></div>`;
    const cov = all.filter(r => r.type === 'coverage' && open(r)).length, outToday = all.filter(r => r.type === 'callout' && r.status !== 'cancelled' && r.status !== 'denied' && (r.when === todayISO() || (r.data?.startDate <= todayISO() && r.data?.endDate >= todayISO()))).length;
    $('#rq-kpis').innerHTML = k('Waiting for you', all.filter(open).length, 'Open requests', all.filter(open).length ? 'warning' : 'good') + k('Coverage needed now', cov, cov ? 'Teachers waiting' : 'None', cov ? 'serious' : 'good') + k('Staff out today', outToday, 'From call-outs') + k('Maintenance open', all.filter(r => r.type === 'maintenance' && open(r)).length, 'Work orders');
    $('#rq-list').innerHTML = list.length ? dataTable(
      [{ label: 'Request', cls: 'col-span-12 sm:col-span-6' }, { label: 'From', cls: 'col-span-6 sm:col-span-3' }, { label: 'Status', cls: 'col-span-6 sm:col-span-3' }],
      list.map(r => { const f = REQUESTS[r.type] || {}; return { cells: [
        `<a href="${buildUrl(`/${ctx.slug}/staff/requests/${r.id}`)}" class="flex items-center gap-3 min-w-0">${iconTile(f.icon || 'file', f.tone || 'muted')}<span class="min-w-0"><span class="block text-sm text-white truncate">${r.urgent && open(r) ? '<span class="text-[#fab219]">● </span>' : ''}${escapeHtml(f.long || r.type)}</span><span class="block text-[11px] text-gray-500 truncate">${escapeHtml(r.summary || '')}</span></span></a>`,
        `<span class="text-xs text-gray-300 truncate block">${escapeHtml(r.submittedByName || '')}<span class="block text-[11px] text-gray-500">${escapeHtml(timeAgo(r.createdAt))}</span></span>`, statusChip(r.status)] }; }))
      : emptyState({ icon: 'inbox', tone: 'teal', title: status === 'open' ? 'All caught up' : 'Nothing here', text: 'Requests from staff will appear here.' });
    refreshIcons();
  };
  $('#main').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if (b) { status = b.dataset.st; draw(); } });
  $('#rq-type').addEventListener('change', e => { type = e.target.value; draw(); });
  try {
    const snap = await getDocs(collection(db, 'tenants', ctx.slug, 'requests'));
    if (!live(t)) return;
    all = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.urgent && ['submitted', 'in_progress'].includes(b.status)) - (a.urgent && ['submitted', 'in_progress'].includes(a.status)) || tsMillis(b.createdAt) - tsMillis(a.createdAt));
    draw();
  } catch (e) { console.error(e); if (live(t)) { $('#rq-list').innerHTML = errorBox(e); refreshIcons(); } }
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICATION CENTER (school pages, family pages and the district)
// ═══════════════════════════════════════════════════════════════
function notifCenterBody() {
  return `<div class="max-w-3xl"><div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="segmented" role="tablist"><button data-nf="all">All</button><button data-nf="unread">Unread</button></div>
      <div class="flex items-center gap-2"><select id="nf-kind" class="input !py-2 !w-auto" aria-label="Category"><option value="">All categories</option>${[...new Set(Object.values(NOTIF_KINDS).map(k => k[2]))].map(l => `<option>${escapeHtml(l)}</option>`).join('')}</select>
      <button class="btn btn-secondary btn-sm" data-nf-readall>${ico('check-check', 'w-3.5 h-3.5')} Mark all read</button><button class="btn btn-ghost btn-sm" data-nf-clear>Clear read</button></div></div>
    <div id="nf-list" class="card divide-y divide-white/[0.05] overflow-hidden"></div></div>`;
}
function mountNotifCenter() {
  let f = 'all', kind = '';
  const draw = () => {
    const el = $('#nf-list'); if (!el) return document.removeEventListener('ember:notifications', draw);
    $$('[data-nf]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.nf === f)));
    const list = notifItems().filter(n => (f === 'all' || notifUnread(n)) && (!kind || (NOTIF_KINDS[n.kind] || NOTIF_KINDS.system)[2] === kind));
    el.innerHTML = list.length ? list.map(n => notifRow(n)).join('') : `<div class="p-10 text-center">${ico('bell-off', 'w-8 h-8 text-gray-600 mx-auto mb-3')}<p class="text-sm text-gray-400">${f === 'unread' ? 'You’re all caught up.' : 'No notifications yet.'}</p></div>`;
    refreshIcons();
  };
  document.addEventListener('ember:notifications', draw);
  $('#main').addEventListener('click', async e => {
    const b = e.target.closest('[data-nf]'); if (b) { f = b.dataset.nf; return draw(); }
    if (e.target.closest('[data-nf-readall]')) { await markAllNotifsRead(); return; }
    if (e.target.closest('[data-nf-clear]')) {
      const read = notifItems().filter(n => !notifUnread(n) && !n.toDistrict);
      if (!read.length) return toast('Nothing to clear', 'info');
      await Promise.allSettled(read.map(n => deleteDoc(doc(db, 'notifications', n.id))));
      toast(`Cleared ${plural(read.length, 'notification')}`);
    }
  });
  $('#nf-kind').addEventListener('change', e => { kind = e.target.value; draw(); });
  draw();
}
export function viewNotifications(ctx) {
  setTitle('Notifications', ctx.tenant.name);
  render(tenantPage(ctx, 'notifications', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'Notifications', subtitle: 'Updates about referrals, requests, grades, attendance and more.' }) + notifCenterBody()));
  refreshIcons();
  mountNotifCenter();
}
export function viewDistrictNotifications(dctx) {
  setTitle('Notifications', dctx.district.name);
  render(districtShell(dctx, 'notifications', { eyebrow: escapeHtml(dctx.district.name || dctx.districtId), title: 'Notifications', subtitle: 'Serious referrals and other alerts from every school in your district.' }, notifCenterBody()));
  refreshIcons();
  mountNotifCenter();
}

// ═══════════════════════════════════════════════════════════════
// PEOPLE: administrators and parents (Admin → People)
// ═══════════════════════════════════════════════════════════════
const WORDS = ['maple', 'river', 'comet', 'cedar', 'harbor', 'falcon', 'meadow', 'summit', 'aspen', 'canyon', 'willow', 'orbit', 'prairie', 'lantern', 'ember', 'quartz'];
const genPassword = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${1000 + Math.floor(Math.random() * 9000)}-${WORDS[Math.floor(Math.random() * WORDS.length)]}`;
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
const ADMIN_TITLES = ['Principal', 'Assistant principal', 'Dean of students', 'Office manager', 'Registrar', 'Counselor', 'Athletic director', 'Curriculum coordinator', 'District administrator', 'Other'];
const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Grandparent', 'Foster parent', 'Stepparent', 'Aunt / uncle', 'Other relative', 'Other'];
// A modal built from the form engine. onSubmit(data, modal) returns true to close.
export function formModal({ title, subtitle = '', icon = 'user-plus', form, data = {}, env = {}, submit = 'Save', onSubmit }) {
  const m = openModal({ size: 'lg', align: 'top', html: modalHeader({ title, subtitle, icon }) + `<form novalidate>${modalBody(`<div class="space-y-5" data-sections>${form.sections.map(sec => `<div class="grid sm:grid-cols-2 gap-x-5 gap-y-5">${sec.fields.map(f => fieldHTML(f, data, env)).join('')}</div>`).join('<hr class="border-white/[0.06]">')}</div><p class="form-error mt-4 hidden" data-form-error role="alert"></p>`)}
    ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${escapeHtml(submit)}</button>`)}</form>` });
  const root = m.$('form');
  bindForm(root, form, env);
  root.addEventListener('submit', e => {
    e.preventDefault();
    const d = collect(root, form), errs = validate(form, d);
    showErrors(root, errs);
    const fe = root.querySelector('[data-form-error]');
    if (errs.length) return showError(fe, `Please fix ${plural(errs.length, 'item')}.`);
    showError(fe, '');
    withBusy(root.querySelector('[type=submit]'), 'Saving…', async () => {
      try { if (await onSubmit(d, m)) m.close(); }
      catch (ex) { console.error(ex); showError(fe, ex.code === 'auth/email-already-in-use' ? 'That email already has an Ember login.' : friendlyError(ex)); }
    });
  });
  return m;
}
function credentialsModal(title, who, email, password, note) {
  const m = openModal({ size: 'sm', html: `<div class="p-6 sm:p-7"><div class="tile tile-green tile-lg mb-4">${ico('key-round', 'w-5 h-5')}</div><h2 class="font-serif text-2xl text-white mb-1">${escapeHtml(title)}</h2><p class="text-sm text-gray-400 mb-5">Share these sign-in details with ${escapeHtml(who)}. This password is shown only once.</p>
    <div class="card p-4 space-y-2 font-mono text-sm"><div><span class="text-gray-500 text-xs font-sans">Web address</span><br><span class="text-white break-all">${escapeHtml(location.origin + buildUrl('/login'))}</span></div><div><span class="text-gray-500 text-xs font-sans">Email</span><br><span class="text-white">${escapeHtml(email)}</span></div><div><span class="text-gray-500 text-xs font-sans">Temporary password</span><br><span class="text-[#F59E0B]">${escapeHtml(password)}</span></div></div>
    ${note ? `<p class="hint mt-3">${escapeHtml(note)}</p>` : ''}
    <div class="flex gap-3 mt-6"><button class="btn btn-secondary flex-1" data-copy-creds>${ico('copy', 'w-4 h-4')} Copy</button><button class="btn btn-primary flex-1" data-close>Done</button></div></div>` });
  m.$('[data-copy-creds]').addEventListener('click', () => copyText(`Sign in to Ember: ${location.origin + buildUrl('/login')}\nEmail: ${email}\nTemporary password: ${password}`, 'Sign-in details copied'));
  refreshIcons();
}

export async function viewAdministrators(ctx) {
  const t = routeTokenNow();
  setTitle('Administrators', ctx.tenant.name);
  render(tenantPage(ctx, 'admin-admins', pageHeader({ eyebrow: 'People', title: 'Administrators', subtitle: 'Administrators can see and manage everything in this school.', actions: `<button id="adm-add" class="btn btn-primary">${ico('user-plus')} Add administrator</button>` })
    + `<div class="max-w-5xl"><div id="adm-list">${skeletonRows(3)}</div><p class="hint mt-4">${ico('info', 'w-3.5 h-3.5 inline -mt-0.5')} Removing someone takes away their access to this school. Their login itself isn't deleted — they simply won't see ${escapeHtml(ctx.tenant.name)} anymore.</p></div>`));
  let staff = [], tenant = ctx.tenant;
  const col = collection(db, 'tenants', ctx.slug, 'users');
  const load = async () => {
    try {
      const [snap, tn] = await Promise.all([getDocs(col), getTenant(ctx.slug, { fresh: true }).catch(() => ctx.tenant)]);
      if (!live(t)) return;
      tenant = tn || ctx.tenant;
      staff = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
      draw();
    } catch (e) { console.error(e); if (live(t)) { $('#adm-list').innerHTML = errorBox(e); refreshIcons(); } }
  };
  const admins = () => staff.filter(x => x.role === 'admin');
  const draw = () => {
    const list = admins();
    $('#adm-list').innerHTML = list.length ? dataTable(
      [{ label: 'Administrator', cls: 'col-span-12 sm:col-span-5' }, { label: 'Title', cls: 'col-span-6 sm:col-span-3' }, { label: 'Phone', cls: 'col-span-6 sm:col-span-2' }, { label: '', cls: 'col-span-12 sm:col-span-2 text-right' }],
      list.map(a => { const owner = a.uid === tenant.ownerUid, me = a.uid === ctx.me.uid; return { cells: [
        `<div class="flex items-center gap-3">${avatar(displayNameOf(a), a.photoURL)}<div class="min-w-0"><div class="text-sm text-white truncate">${escapeHtml(displayNameOf(a))} ${owner ? badge('Owner', 'amber') : ''} ${me ? badge('You', 'muted') : ''} ${a.districtAdmin ? badge('District', 'violet') : ''}</div><div class="text-xs text-gray-500 truncate">${escapeHtml(a.email || '')}</div></div></div>`,
        `<span class="text-sm text-gray-300">${escapeHtml(a.title || '—')}</span>`,
        `<span class="text-xs text-gray-400">${escapeHtml(a.phone || '—')}</span>`,
        `<div class="flex justify-end gap-1"><button class="btn-icon" data-edit="${a.uid}" aria-label="Edit ${escapeHtml(displayNameOf(a))}" title="Edit">${ico('pencil', 'w-4 h-4')}</button>${owner ? '' : `<button class="btn-icon" data-demote="${a.uid}" aria-label="Make ${escapeHtml(displayNameOf(a))} a teacher" title="Make teacher">${ico('user-minus', 'w-4 h-4')}</button><button class="btn-icon danger" data-remove="${a.uid}" aria-label="Remove ${escapeHtml(displayNameOf(a))}" title="Remove from school">${ico('trash-2', 'w-4 h-4')}</button>`}</div>`] }; }))
      : emptyState({ icon: 'shield-check', title: 'No administrators', text: 'Add one so someone can manage the school.' });
    refreshIcons();
  };
  const openAdd = () => {
    const teachers = staff.filter(x => x.role !== 'admin');
    const form = { sections: [{ fields: [
      { id: 'mode', type: 'radio', label: 'Who?', required: true, cols: 1, options: [...(teachers.length ? [{ v: 'promote', l: 'Someone already on staff here' }] : []), { v: 'new', l: 'Someone new — create a login for them' }] },
      { id: 'who', type: 'select', label: 'Staff member', required: true, options: teachers.map(x => ({ v: x.uid, l: `${displayNameOf(x)}${x.email ? ' · ' + x.email : ''}` })), showIf: { id: 'mode', eq: 'promote' }, span: 'sm:col-span-2' },
      { id: 'name', type: 'text', label: 'Full name', required: true, showIf: { id: 'mode', eq: 'new' } },
      { id: 'email', type: 'text', label: 'Email', required: true, placeholder: 'name@school.org', showIf: { id: 'mode', eq: 'new' } },
      { id: 'title', type: 'select', label: 'Title', options: ADMIN_TITLES },
      { id: 'phone', type: 'phone', label: 'Phone' },
      { id: 'password', type: 'text', label: 'Temporary password', required: true, showIf: { id: 'mode', eq: 'new' }, hint: 'They can change it under Account → Profile after signing in.' },
    ] }], rules: [d => d.mode === 'new' && d.email && !isEmail(d.email) ? { id: 'email', msg: 'Enter a valid email address.' } : null, d => d.mode === 'new' && d.password && d.password.length < 8 ? { id: 'password', msg: 'Use at least 8 characters.' } : null] };
    formModal({ title: 'Add administrator', subtitle: ctx.tenant.name, icon: 'shield-check', form, data: { mode: teachers.length ? 'promote' : 'new', password: genPassword() }, submit: 'Add administrator', onSubmit: async d => {
      if (d.mode === 'promote') {
        await updateDoc(doc(col, d.who), { role: 'admin', title: d.title || '', phone: d.phone || '', promotedBy: ctx.me.uid, updatedAt: serverTimestamp() });
        const p = staff.find(x => x.uid === d.who);
        notify(ctx, { to: [d.who], kind: 'system', title: `You're now an administrator at ${ctx.tenant.name}`, body: `Added by ${ctx.me.name}. Look for Admin in the left menu.`, link: `/${ctx.slug}/admin` }).catch(() => {});
        toast(`${displayNameOf(p)} is now an administrator`);
      } else {
        const email = d.email.toLowerCase();
        const uid = await createLogin(email, d.password);
        await setDoc(doc(col, uid), { userId: uid, role: 'admin', email, displayName: d.name, title: d.title || '', phone: d.phone || '', createdBy: ctx.me.uid, createdAt: serverTimestamp() });
        credentialsModal('Administrator added', d.name, email, d.password, 'Ask them to change this password after their first sign-in.');
      }
      load(); return true;
    } });
  };
  const openEdit = a => {
    const form = { sections: [{ fields: [
      { id: 'name', type: 'text', label: 'Full name', required: true },
      { id: 'title', type: 'select', label: 'Title', options: ADMIN_TITLES },
      { id: 'phone', type: 'phone', label: 'Phone' },
      { id: 'note', type: 'note', text: `Email: ${a.email || '—'} (people change their own email from their account).` },
    ] }] };
    formModal({ title: `Edit ${displayNameOf(a)}`, icon: 'pencil', form, data: { name: displayNameOf(a), title: a.title || '', phone: a.phone || '' }, onSubmit: async d => {
      await updateDoc(doc(col, a.uid), { displayName: d.name, title: d.title || '', phone: d.phone || '', updatedAt: serverTimestamp() });
      toast('Saved'); load(); return true;
    } });
  };
  $('#adm-add').addEventListener('click', openAdd);
  $('#main').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit]'); if (ed) return openEdit(staff.find(x => x.uid === ed.dataset.edit));
    const dm = e.target.closest('[data-demote]'), rm = e.target.closest('[data-remove]');
    if (!dm && !rm) return;
    const a = staff.find(x => x.uid === (dm || rm).dataset[dm ? 'demote' : 'remove']);
    if (admins().length <= 1) return toast('A school needs at least one administrator.', 'error');
    const self = a.uid === ctx.me.uid;
    if (!await confirmDialog({ title: dm ? `Make ${displayNameOf(a)} a teacher?` : `Remove ${displayNameOf(a)} from ${ctx.tenant.name}?`, message: dm ? 'They keep their courses but lose administrator access.' + (self ? ' You will lose admin access immediately.' : '') : 'They lose all access to this school, including any courses they teach.' + (self ? ' You will be signed out of this school.' : ''), confirmLabel: dm ? 'Make teacher' : 'Remove', danger: true })) return;
    try {
      if (dm) await updateDoc(doc(col, a.uid), { role: 'teacher', updatedAt: serverTimestamp() });
      else await deleteDoc(doc(col, a.uid));
      toast(dm ? 'Changed to teacher' : 'Removed');
      if (self) return navigate(`/${ctx.slug}`, { replace: true });
      load();
    } catch (ex) { toast(friendlyError(ex), 'error'); }
  });
  load();
}

export async function viewParents(ctx) {
  const t = routeTokenNow();
  setTitle('Parents & guardians', ctx.tenant.name);
  render(tenantPage(ctx, 'admin-parents', pageHeader({ eyebrow: 'People', title: 'Parents & guardians', subtitle: 'Create family logins, link them to students, and fix accounts.', actions: `<button id="par-add" class="btn btn-primary">${ico('user-plus')} Add parent</button>` })
    + `<div class="max-w-6xl"><div id="par-kpis" class="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6"></div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3"><div class="segmented" role="tablist"><button data-pt="parents" aria-pressed="true">Parent accounts</button><button data-pt="missing" aria-pressed="false">Students without a parent</button></div>
        <div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">${ico('search', 'w-3.5 h-3.5')}</span><input id="par-q" type="search" placeholder="Search name, email or student…" class="input !py-2 pl-9 w-64" aria-label="Search"></div></div>
      <div id="par-list">${skeletonRows(5)}</div>
      <p class="hint mt-4">${ico('info', 'w-3.5 h-3.5 inline -mt-0.5')} Parents can also sign themselves up at <span class="font-mono text-gray-300">${escapeHtml(location.origin + buildUrl('/signup?role=guardian'))}</span> with a student's Family Access code (Student records → Family).</p></div>`));
  let parents = [], links = [], students = [], tab = 'parents', q = '';
  const gcol = collection(db, 'tenants', ctx.slug, 'guardians'), lcol = collection(db, 'tenants', ctx.slug, 'guardianLinks');
  const load = async () => {
    try {
      const [g, l, st] = await Promise.all([getDocs(gcol), getDocs(lcol), getDocs(collection(db, 'tenants', ctx.slug, 'students'))]);
      if (!live(t)) return;
      parents = g.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
      links = l.docs.map(d => ({ id: d.id, ...d.data() }));
      students = st.docs.map(d => ({ uid: d.id, ...d.data() })).filter(x => x.status !== 'pending' && x.status !== 'rejected').sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
      draw();
    } catch (e) { console.error(e); if (live(t)) { $('#par-list').innerHTML = errorBox(e); refreshIcons(); } }
  };
  const kidsOf = uid => links.filter(l => l.guardianUid === uid).map(l => students.find(s => s.uid === l.studentUid) || { uid: l.studentUid, displayName: 'Former student', missing: true });
  const linked = () => new Set(links.map(l => l.studentUid));
  const draw = () => {
    $$('[data-pt]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pt === tab)));
    const withParent = students.filter(s => linked().has(s.uid)).length;
    const k = (label, v, sub, lvl) => `<div class="card p-5"><div class="text-xs text-gray-400 mb-2">${label}</div><div class="stat-value">${v}</div><div class="mt-1 text-xs text-gray-500 flex items-center gap-1.5">${lvl ? ico(STATUS_ICON[lvl][0], 'w-3.5 h-3.5 ' + STATUS_ICON[lvl][1]) : ''}${sub}</div></div>`;
    $('#par-kpis').innerHTML = k('Parent accounts', parents.length, `${links.length} student links`) + k('Students with a parent', `${withParent}<span class="text-gray-500 text-lg">/${students.length}</span>`, students.length ? `${Math.round(withParent / students.length * 100)}% connected` : '', students.length && withParent === students.length ? 'good' : null)
      + k('Missing a parent', students.length - withParent, students.length - withParent ? 'Families who can’t see grades or attendance' : 'Every student is connected', students.length - withParent ? 'warning' : 'good');
    const ql = q.toLowerCase();
    if (tab === 'parents') {
      const list = parents.filter(p => !ql || `${displayNameOf(p)} ${p.email || ''} ${kidsOf(p.uid).map(displayNameOf).join(' ')}`.toLowerCase().includes(ql));
      $('#par-list').innerHTML = list.length ? dataTable(
        [{ label: 'Parent / guardian', cls: 'col-span-12 sm:col-span-4' }, { label: 'Students', cls: 'col-span-12 sm:col-span-4' }, { label: 'Phone', cls: 'col-span-6 sm:col-span-2' }, { label: '', cls: 'col-span-6 sm:col-span-2 text-right' }],
        list.map(p => { const kids = kidsOf(p.uid); return { cells: [
          `<div class="flex items-center gap-3">${avatar(displayNameOf(p))}<div class="min-w-0"><div class="text-sm text-white truncate">${escapeHtml(displayNameOf(p))}${p.relationship ? ` <span class="text-xs text-gray-500">· ${escapeHtml(p.relationship)}</span>` : ''}</div><div class="text-xs text-gray-500 truncate">${escapeHtml(p.email || 'No email on file')}</div></div></div>`,
          kids.length ? `<div class="flex flex-wrap gap-1">${kids.map(k2 => k2.missing ? badge('Former student', 'muted') : `<a href="${buildUrl(`/${ctx.slug}/record/${k2.uid}`)}" class="badge badge-amber hover:opacity-80">${escapeHtml(displayNameOf(k2))}</a>`).join('')}</div>` : `<span class="text-xs text-[#fab219]">${ico('triangle-alert', 'w-3.5 h-3.5 inline -mt-0.5')} Not linked to a student</span>`,
          `<span class="text-xs text-gray-400">${escapeHtml(p.phone || '—')}</span>`,
          `<div class="flex justify-end gap-1"><button class="btn-icon" data-pedit="${p.uid}" aria-label="Edit ${escapeHtml(displayNameOf(p))}" title="Edit & links">${ico('pencil', 'w-4 h-4')}</button><button class="btn-icon danger" data-pdel="${p.uid}" aria-label="Remove ${escapeHtml(displayNameOf(p))}" title="Remove">${ico('trash-2', 'w-4 h-4')}</button></div>`] }; }))
        : emptyState({ icon: 'users', title: parents.length ? 'No matches' : 'No parent accounts yet', text: parents.length ? '' : 'Add parents here, or give families a Family Access code to sign up themselves.', action: parents.length ? '' : `<button class="btn btn-primary" data-padd>${ico('user-plus')} Add parent</button>` });
    } else {
      const list = students.filter(s => !linked().has(s.uid) && (!ql || displayNameOf(s).toLowerCase().includes(ql)));
      $('#par-list').innerHTML = list.length ? dataTable(
        [{ label: 'Student', cls: 'col-span-12 sm:col-span-6' }, { label: 'Grade', cls: 'col-span-4 sm:col-span-2' }, { label: '', cls: 'col-span-8 sm:col-span-4 text-right' }],
        list.map(s2 => ({ cells: [
          `<a href="${buildUrl(`/${ctx.slug}/record/${s2.uid}/family`)}" class="flex items-center gap-3">${avatar(displayNameOf(s2))}<span class="text-sm text-white truncate">${escapeHtml(displayNameOf(s2))}</span></a>`,
          `<span class="text-xs text-gray-400">${escapeHtml(s2.gradeLevel ? `Grade ${s2.gradeLevel}` : '—')}</span>`,
          `<div class="flex justify-end gap-2"><a href="${buildUrl(`/${ctx.slug}/record/${s2.uid}/family`)}" class="btn btn-ghost btn-sm">Family code</a><button class="btn btn-secondary btn-sm" data-padd="${s2.uid}">${ico('user-plus', 'w-3.5 h-3.5')} Add parent</button></div>`] })))
        : emptyState({ icon: 'circle-check', tone: 'green', title: 'Every student has a parent account', text: '' });
    }
    refreshIcons();
  };
  const studentPick = ids => ids.map(id => students.find(s2 => s2.uid === id)).filter(Boolean).map(s2 => ({ uid: s2.uid, name: displayNameOf(s2), grade: s2.gradeLevel ?? '' }));
  const openAdd = (studentId = null) => {
    const form = { sections: [{ fields: [
      { id: 'students', type: 'students', label: 'Student(s)', required: true },
      { id: 'name', type: 'text', label: 'Parent / guardian name', required: true },
      { id: 'relationship', type: 'select', label: 'Relationship', options: RELATIONSHIPS },
      { id: 'email', type: 'text', label: 'Email (their sign-in)', required: true, placeholder: 'parent@example.com' },
      { id: 'phone', type: 'phone', label: 'Phone' },
      { id: 'password', type: 'text', label: 'Temporary password', required: true, hint: 'Share it with the family. They can change it after signing in.' },
    ] }], rules: [d => d.email && !isEmail(d.email) ? { id: 'email', msg: 'Enter a valid email address.' } : null, d => d.password && d.password.length < 8 ? { id: 'password', msg: 'Use at least 8 characters.' } : null] };
    formModal({ title: 'Add a parent or guardian', subtitle: 'Creates their Ember login and links it to the student.', form, env: { students }, data: { students: studentPick(studentId ? [studentId] : []), password: genPassword() }, submit: 'Create parent account', onSubmit: async d => {
      const email = d.email.toLowerCase();
      if (parents.some(p => (p.email || '').toLowerCase() === email)) throw new Error('A parent with that email is already in this school — edit them to link another student.');
      let uid;
      try { uid = await createLogin(email, d.password); }
      catch (ex) { if (ex.code === 'auth/email-already-in-use') throw new Error('That email already has an Ember login (maybe from another school). Give this family the student’s Family Access code instead — they can link it from their own account.'); throw ex; }
      const batch = writeBatch(db);
      batch.set(doc(gcol, uid), { userId: uid, name: d.name, displayName: d.name, email, phone: d.phone || '', relationship: d.relationship || '', createdBy: ctx.me.uid, createdAt: serverTimestamp() });
      d.students.forEach(st => batch.set(doc(lcol, `${uid}_${st.uid}`), { guardianUid: uid, studentUid: st.uid, linkedBy: ctx.me.uid, createdAt: serverTimestamp() }));
      await batch.commit();
      credentialsModal('Parent account created', d.name, email, d.password, `Linked to ${d.students.map(x => x.name).join(', ')}.`);
      load(); return true;
    } });
  };
  const openEdit = p => {
    const form = { sections: [{ fields: [
      { id: 'name', type: 'text', label: 'Name', required: true },
      { id: 'relationship', type: 'select', label: 'Relationship', options: RELATIONSHIPS },
      { id: 'phone', type: 'phone', label: 'Phone' },
      { id: 'note', type: 'note', text: `Sign-in email: ${p.email || '—'}` },
      { id: 'students', type: 'students', label: 'Linked students', hint: 'Remove a student to unlink them; search to link another.' },
    ] }] };
    const before = kidsOf(p.uid).filter(k2 => !k2.missing).map(k2 => k2.uid);
    formModal({ title: `Edit ${displayNameOf(p)}`, icon: 'pencil', form, env: { students }, data: { name: displayNameOf(p), relationship: p.relationship || '', phone: p.phone || '', students: studentPick(before) }, onSubmit: async d => {
      const after = (d.students || []).map(x => x.uid);
      const batch = writeBatch(db);
      batch.update(doc(gcol, p.uid), { name: d.name, displayName: d.name, phone: d.phone || '', relationship: d.relationship || '', userId: p.uid, updatedAt: serverTimestamp() });
      after.filter(id => !before.includes(id)).forEach(id => batch.set(doc(lcol, `${p.uid}_${id}`), { guardianUid: p.uid, studentUid: id, linkedBy: ctx.me.uid, createdAt: serverTimestamp() }));
      before.filter(id => !after.includes(id)).forEach(id => batch.delete(doc(lcol, `${p.uid}_${id}`)));
      await batch.commit();
      toast('Saved'); load(); return true;
    } });
  };
  $('#par-add').addEventListener('click', () => openAdd());
  $('#par-q').addEventListener('input', e => { q = e.target.value.trim(); draw(); });
  $('#main').addEventListener('click', async e => {
    const tb = e.target.closest('[data-pt]'); if (tb) { tab = tb.dataset.pt; return draw(); }
    const ad = e.target.closest('[data-padd]'); if (ad) return openAdd(ad.dataset.padd || null);
    const ed = e.target.closest('[data-pedit]'); if (ed) return openEdit(parents.find(x => x.uid === ed.dataset.pedit));
    const dl = e.target.closest('[data-pdel]');
    if (dl) {
      const p = parents.find(x => x.uid === dl.dataset.pdel);
      if (!await confirmDialog({ title: `Remove ${displayNameOf(p)}?`, message: 'They lose access to every student in this school. Their login itself isn’t deleted.', confirmLabel: 'Remove', danger: true })) return;
      try {
        const batch = writeBatch(db);
        links.filter(l => l.guardianUid === p.uid).forEach(l => batch.delete(doc(lcol, l.id)));
        batch.delete(doc(gcol, p.uid));
        await batch.commit(); toast('Parent removed'); load();
      } catch (ex) { toast(friendlyError(ex), 'error'); }
    }
  });
  load();
}
