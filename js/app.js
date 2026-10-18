// Ember LMS — app shell, LMS and shared helpers.
// SIS features live in ./sis.js and load on demand.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, collectionGroup, query, where, orderBy, limit,
  onSnapshot, getDocs, serverTimestamp, arrayUnion, arrayRemove,
  writeBatch, getCountFromServer, deleteField, increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
// Cache-busting: index.html loads app.js?v=…, and lazy modules are requested with the same version.
const BUILD = new URL(import.meta.url).search;
const BASE_PATH = '/emberlms';
const APP_NAME = 'Ember LMS';
const RESERVED = ['login', 'signup', 'picker', 'onboard', 'api', 'assets', 'district'];
const GRADIENTS = ['grad-amber', 'grad-violet', 'grad-teal', 'grad-rose', 'grad-blue', 'grad-emerald'];
const ITEM_TYPES = [
  { type: 'page',       label: 'Page',       icon: 'file-text',      desc: 'Rich text content — readings, notes, instructions' },
  { type: 'assignment', label: 'Assignment', icon: 'clipboard-list', desc: 'Collect and grade student work' },
  { type: 'quiz',       label: 'Quiz',       icon: 'list-checks',    desc: 'Auto-graded multiple choice' },
  { type: 'link',       label: 'Link',       icon: 'link',           desc: 'An external website or resource' },
];
const GRADED_TYPES = ['assignment', 'quiz'];

// Firebase web config is public by design. Real protection comes from Firestore security rules —
// every role check in this file is for UX only and must be mirrored in your rules.
const firebaseConfig = {
  apiKey: "AIzaSyDHMgZklzO2Uu7v8Lm248DuU4QJ2RaCp44",
  authDomain: "ember-lms.firebaseapp.com",
  projectId: "ember-lms",
  messagingSenderId: "198763545245",
  appId: "1:198763545245:web:58b4d76df1181600fd0a74"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// A second auth instance lets teachers create student logins without being signed out themselves.
const secondaryApp = initializeApp(firebaseConfig, 'Secondary');
const secondaryAuth = getAuth(secondaryApp);

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ico = (name, cls = 'w-4 h-4') => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
function refreshIcons() { try { window.lucide?.createIcons(); } catch (e) { /* icons are decorative */ } }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); }
const gradOf = c => GRADIENTS.includes(c?.gradient) ? c.gradient : pickGradient(c?.title);
function pickGradient(seed) {
  const s = String(seed || ''); let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}
function randInt(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
function genPassword() {
  const w = ['ember', 'flame', 'glow', 'spark', 'warm', 'light', 'sun', 'dusk', 'ash', 'coal', 'pine', 'river', 'maple', 'cedar', 'comet', 'orbit'];
  return w[randInt(w.length)] + (randInt(9000) + 1000);
}
function genCode() { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let o = ''; for (let i = 0; i < 6; i++) o += c[randInt(c.length)]; return o; }
function genUsername(first, last, existing = []) {
  const taken = new Set(existing);
  const base = (slugify(first + (last ? last[0] : '')) || 'student').replace(/-/g, '_').slice(0, 17);
  let c = base, i = 1;
  while (taken.has(c) || c.length < 3) { c = base + i; i++; }
  return c;
}
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function initials(name) { return String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'; }
function plural(n, w, p = w + 's') { return `${n} ${n === 1 ? w : p}`; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function safeUrl(u) {
  try { const url = new URL(String(u || '').trim()); return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  return safeUrl(s);
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function displayNameOf(d) {
  return d?.displayName || [d?.firstName, d?.lastName].filter(Boolean).join(' ') || d?.username || (d?.email ? d.email.split('@')[0] : '') || 'User';
}
function safeNext(n) { return n && n.startsWith('/') && !n.startsWith('//') ? n : null; }
function ss(key, val) {
  try { if (val === undefined) return sessionStorage.getItem(key); sessionStorage.setItem(key, val); } catch { return null; }
}

// Dates
function toDate(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : (ts.seconds != null ? new Date(ts.seconds * 1000) : new Date(ts));
  return isNaN(d) ? null : d;
}
const tsMillis = ts => toDate(ts)?.getTime() || 0;
const recency = ts => tsMillis(ts) || Date.now() + 1; // pending server timestamps sort as "newest"
function formatDate(ts) { const d = toDate(ts); return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
function formatDateTime(ts) { const d = toDate(ts); return d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
function timeAgo(ts) {
  const d = toDate(ts); if (!d) return 'just now';
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(d);
}
const pad2 = n => String(n).padStart(2, '0');
function toDateInput(ts) { const d = toDate(ts); return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : ''; }
function toDateTimeInput(ts) { const d = toDate(ts); return d ? `${toDateInput(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ''; }

// ISO weeks (stored as "2026-W42"). A date picker is used in the UI because <input type="week"> is unsupported in Firefox & Safari.
function isoWeekOf(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${pad2(weekNo)}`;
}
const currentISOWeek = () => isoWeekOf(new Date());
function weekMonday(week) {
  const m = String(week || '').match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const y = +m[1], w = +m[2];
  const jan4 = new Date(y, 0, 4);
  return new Date(y, 0, 4 - (jan4.getDay() || 7) + 1 + (w - 1) * 7);
}
function describeWeek(week) { const m = String(week || '').match(/^(\d{4})-W(\d{2})$/); return m ? `Week ${+m[2]}, ${m[1]}` : (week || ''); }
function weekDateRange(week) {
  const mon = weekMonday(week); if (!mon) return '';
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  const fmt = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(mon)} – ${fmt(fri)}`;
}
function shiftWeek(week, n) { const mon = weekMonday(week); if (!mon) return week; mon.setDate(mon.getDate() + 7 * n); return isoWeekOf(mon); }

// HTML sanitising — every piece of rich text goes through this on save AND on render.
if (window.DOMPurify) {
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A' && node.getAttribute('href')) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
  });
}
function sanitize(html) { return window.DOMPurify ? DOMPurify.sanitize(html || '', { ADD_ATTR: ['target'] }) : escapeHtml(html || ''); }
function isEmptyRichText(html) {
  const d = document.createElement('div'); d.innerHTML = html || '';
  return !d.textContent.trim() && !d.querySelector('img, iframe, video');
}

function friendlyError(e) {
  const code = String(e?.code || '').replace(/^firestore\//, '');
  const map = {
    'permission-denied': "You don't have permission to do that.",
    'unavailable': 'Network unavailable — check your connection and try again.',
    'not-found': 'That item no longer exists.',
    'failed-precondition': 'This query needs a Firestore index — check the browser console for a link to create it.',
    'auth/network-request-failed': 'Network error — check your connection.',
    'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
    'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups for this site and try again.',
    'auth/email-already-in-use': 'That email is already in use. Try signing in instead.',
    'auth/weak-password': 'That password is too weak.',
    'auth/invalid-email': 'That email address is invalid.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/user-disabled': 'This account has been disabled.',
  };
  return map[code] || e?.message || 'Something went wrong.';
}

// ═══════════════════════════════════════════════════════════════
// UI KIT
// ═══════════════════════════════════════════════════════════════
const appEl = document.getElementById('app');
function render(html) {
  appEl.innerHTML = html;
  refreshIcons();
  const main = $('#main'); if (main) main.scrollTop = 0;
}
function setTitle(...parts) { document.title = [...parts.filter(Boolean), APP_NAME].join(' · '); }
function showError(el, msg) { if (!el) return; el.textContent = msg || ''; el.classList.toggle('hidden', !msg); }

const GOOGLE_SVG = `<svg class="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;
const DIVIDER = `<div class="flex items-center gap-4 my-6"><div class="flex-1 h-px bg-white/[0.08]"></div><span class="text-[10px] text-gray-500 uppercase tracking-widest">or</span><div class="flex-1 h-px bg-white/[0.08]"></div></div>`;

function logo({ size = 'text-xl', accent = 'amber' } = {}) {
  const c = accent === 'violet' ? 'text-[#8B5CF6]' : 'text-[#F59E0B]';
  return `<a href="${buildUrl('/')}" class="font-serif ${size} inline-flex items-center gap-2 shrink-0" aria-label="${APP_NAME} home">${ico('flame', 'w-[1.1em] h-[1.1em] ' + c)}<span><span class="${c}">Ember</span> <span class="text-white">LMS</span></span></a>`;
}
function iconTile(name, tone = 'amber', size = '') { return `<div class="tile tile-${tone} ${size}">${ico(name, size ? 'w-5 h-5' : 'w-4 h-4')}</div>`; }
function badge(text, tone = 'muted') { return `<span class="badge badge-${tone}">${text}</span>`; }
function avatar(name, photo, size = 'w-8 h-8', text = 'text-[11px]') {
  const src = safeUrl(photo);
  return src
    ? `<img src="${escapeHtml(src)}" alt="" referrerpolicy="no-referrer" class="${size} rounded-full border border-white/15 object-cover shrink-0">`
    : `<div class="${size} rounded-full bg-gradient-to-br from-white/15 to-white/5 border border-white/10 flex items-center justify-center ${text} text-white font-medium shrink-0" aria-hidden="true">${escapeHtml(initials(name))}</div>`;
}
const spinner = (cls = 'py-20') => `<div class="flex items-center justify-center ${cls} text-gray-500" role="status">${ico('loader-circle', 'w-6 h-6 animate-spin')}<span class="sr-only">Loading…</span></div>`;
function loadingScreen() {
  return `<div class="min-h-[100dvh] flex flex-col items-center justify-center gap-4 text-gray-500" role="status">
    <div class="animate-pulse">${ico('flame', 'w-8 h-8 text-[#F59E0B]')}</div><span class="sr-only">Loading…</span></div>`;
}
const skeletonRows = (n = 4, h = 'h-12') => `<div class="space-y-2">${Array.from({ length: n }, () => `<div class="skeleton ${h}"></div>`).join('')}</div>`;
const skeletonCards = (n = 3) => Array.from({ length: n }, () => `<div class="card overflow-hidden"><div class="skeleton h-24 rounded-none"></div><div class="p-5 space-y-3"><div class="skeleton h-3 w-1/3"></div><div class="skeleton h-5 w-2/3"></div><div class="skeleton h-3 w-1/2"></div></div></div>`).join('');
function emptyState({ icon = 'inbox', title, text = '', action = '', tone = 'muted' }) {
  return `<div class="border border-dashed border-white/10 rounded-xl px-6 py-12 text-center">
    <div class="tile tile-${tone} tile-lg mx-auto mb-4">${ico(icon, 'w-5 h-5')}</div>
    <h3 class="font-serif text-xl text-white mb-1">${title}</h3>
    ${text ? `<p class="text-gray-500 text-sm max-w-sm mx-auto">${text}</p>` : ''}
    ${action ? `<div class="mt-6">${action}</div>` : ''}
  </div>`;
}
function errorBox(e) {
  return `<div class="card p-6 flex items-start gap-4 border-red-500/20">
    ${iconTile('triangle-alert', 'red')}
    <div class="flex-1 min-w-0"><p class="text-white text-sm font-medium mb-1">Couldn't load this</p><p class="text-sm text-gray-400">${escapeHtml(friendlyError(e))}</p></div>
    <button data-retry class="btn btn-secondary btn-sm">${ico('refresh-cw', 'w-3.5 h-3.5')} Retry</button>
  </div>`;
}
function passwordField(id, { autocomplete = 'current-password', label = 'Password', value = '', mono = false } = {}) {
  return `<label for="${id}" class="label">${label}</label>
    <div class="relative">
      <input id="${id}" type="password" autocomplete="${autocomplete}" value="${escapeHtml(value)}" class="input pr-11 ${mono ? 'font-mono text-sm' : ''}" required />
      <button type="button" data-toggle-pass="${id}" class="btn-icon absolute right-2 top-1/2 -translate-y-1/2" aria-label="Show password">${ico('eye')}</button>
    </div>`;
}
function dataTable(cols, rows) {
  const head = cols.map(c => `<div class="${c.cls}">${c.label}</div>`).join('');
  const body = rows.map(r => `<div class="grid grid-cols-12 gap-x-3 gap-y-2 px-4 sm:px-5 py-3 items-center hover:bg-white/[0.02] group transition-colors" ${r.attrs || ''}>${r.cells.map((c, i) => `<div class="${cols[i].cls} min-w-0">${c}</div>`).join('')}</div>`).join('');
  return `<div class="card overflow-hidden">
    <div class="hidden sm:grid grid-cols-12 gap-3 px-5 py-3 border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-gray-500">${head}</div>
    <div class="divide-y divide-white/[0.04]">${body}</div></div>`;
}

// Toasts
function toast(msg, type = 'success') {
  let host = $('#toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'fixed z-[90] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-stretch sm:items-end pointer-events-none';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const [icon, color] = { success: ['circle-check', 'text-emerald-400'], error: ['circle-x', 'text-red-400'], info: ['info', 'text-[#F59E0B]'] }[type] || ['info', 'text-gray-300'];
  const t = document.createElement('div');
  t.className = 'toast pointer-events-auto flex items-center gap-3 bg-[#1A1A1A] border border-white/10 rounded-xl px-4 py-3 shadow-2xl text-sm text-white sm:max-w-sm';
  t.innerHTML = `${ico(icon, 'w-4 h-4 shrink-0 ' + color)}<span>${escapeHtml(msg)}</span>`;
  host.appendChild(t);
  while (host.children.length > 3) host.firstElementChild.remove();
  refreshIcons();
  setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 260); }, type === 'error' ? 5000 : 2800);
}
async function copyText(text, msg = 'Copied to clipboard') {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(msg); } catch { toast('Copy failed — select the text and copy manually.', 'error'); }
    ta.remove();
  }
}
async function withBusy(btn, label, fn) {
  // Re-entrancy guard: Ctrl+Enter / requestSubmit() and double clicks can fire while the button is already busy.
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${ico('loader-circle', 'w-4 h-4 animate-spin')} ${escapeHtml(label)}`;
  refreshIcons();
  try { return await fn(); }
  finally { delete btn.dataset.busy; if (btn.isConnected) { btn.disabled = false; btn.innerHTML = orig; refreshIcons(); } }
}

// Modals: Esc to close, focus trap, focus restore, scroll lock.
const openModals = [];
function openModal({ html, size = 'md', align = 'center', dismissible = true, onClose } = {}) {
  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-3xl' };
  const prevFocus = document.activeElement;
  const ov = document.createElement('div');
  ov.className = `fixed inset-0 z-[60] flex ${align === 'top' ? 'items-start' : 'items-center'} justify-center bg-black/60 modal-overlay px-3 sm:px-6 py-6 sm:py-10 overflow-y-auto`;
  ov.innerHTML = `<div role="dialog" aria-modal="true" class="modal-panel bg-[#141414] border border-white/[0.08] rounded-2xl w-full ${sizes[size] || sizes.md} shadow-2xl ${align === 'top' ? 'my-auto sm:my-4' : ''}">${html}</div>`;
  document.body.appendChild(ov);
  document.body.classList.add('overflow-hidden');
  refreshIcons();
  let closed = false;
  const api = {
    el: ov, dismissible,
    $: s => ov.querySelector(s),
    $$: s => [...ov.querySelectorAll(s)],
    close() {
      if (closed) return; closed = true;
      const i = openModals.indexOf(api); if (i >= 0) openModals.splice(i, 1);
      ov.remove();
      document.removeEventListener('keydown', onKey, true);
      if (!openModals.length) document.body.classList.remove('overflow-hidden');
      onClose?.();
      if (prevFocus?.isConnected) prevFocus.focus?.();
    }
  };
  const onKey = e => {
    if (openModals[openModals.length - 1] !== api) return;
    if (e.key === 'Escape' && api.dismissible) {
      if (ov.querySelector('.ql-tooltip.ql-editing')) return; // let Quill close its link tooltip first
      e.preventDefault(); e.stopPropagation(); api.close();
    } else if (e.key === 'Tab') {
      const f = [...ov.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select,textarea,[contenteditable=true],[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('mousedown', e => { if (api.dismissible && e.target === ov) api.close(); });
  ov.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => api.close()));
  openModals.push(api);
  setTimeout(() => {
    if (ov.contains(document.activeElement) && document.activeElement.matches('input, textarea, select, [contenteditable="true"]')) return; // never steal focus from someone already typing
    const f = ov.querySelector('[autofocus]') || ov.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([disabled]), textarea');
    (f || ov.querySelector('[role=dialog]')).focus?.();
  }, 40);
  return api;
}
function closeAllModals() { [...openModals].reverse().forEach(m => m.close()); }
function modalHeader({ title, subtitle = '', icon = null, tone = 'amber' }) {
  return `<div class="px-5 sm:px-8 pt-6 sm:pt-7 pb-5 flex items-start justify-between gap-4 border-b border-white/[0.06]">
    <div class="flex items-center gap-3 min-w-0">
      ${icon ? iconTile(icon, tone) : ''}
      <div class="min-w-0"><h2 class="font-serif text-2xl text-white truncate">${title}</h2>${subtitle ? `<p class="text-gray-500 text-sm mt-0.5">${subtitle}</p>` : ''}</div>
    </div>
    <button type="button" data-close class="btn-icon -mr-2 -mt-1" aria-label="Close">${ico('x', 'w-5 h-5')}</button>
  </div>`;
}
const modalBody = (html, cls = '') => `<div class="px-5 sm:px-8 py-6 ${cls}">${html}</div>`;
const modalFooter = html => `<div class="px-5 sm:px-8 pb-6 sm:pb-7 flex flex-col-reverse sm:flex-row gap-3">${html}</div>`;

function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let ok = false;
    const m = openModal({
      size: 'sm', onClose: () => resolve(ok), html: `
      <div class="p-6 sm:p-7">
        <div class="flex items-start gap-4">
          ${iconTile(danger ? 'triangle-alert' : 'circle-help', danger ? 'red' : 'amber')}
          <div class="min-w-0"><h2 class="font-serif text-xl text-white mb-1">${escapeHtml(title)}</h2>${message ? `<p class="text-sm text-gray-400 leading-relaxed">${escapeHtml(message)}</p>` : ''}</div>
        </div>
        <div class="flex gap-3 mt-6"><button data-close class="btn btn-secondary flex-1">Cancel</button><button data-ok autofocus class="btn ${danger ? 'btn-danger' : 'btn-primary'} flex-1">${escapeHtml(confirmLabel)}</button></div>
      </div>` });
    m.$('[data-ok]').addEventListener('click', () => { ok = true; m.close(); });
  });
}
function promptDialog({ title, label = '', value = '', placeholder = '', confirmLabel = 'Save', type = 'text' }) {
  return new Promise(resolve => {
    let result = null;
    const m = openModal({
      size: 'sm', onClose: () => resolve(result), html: `
      <form class="p-6 sm:p-7" novalidate>
        <h2 class="font-serif text-xl text-white mb-4">${escapeHtml(title)}</h2>
        ${label ? `<label class="label" for="prompt-input">${escapeHtml(label)}</label>` : ''}
        <input id="prompt-input" type="${type}" class="input" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" autofocus />
        <div class="flex gap-3 mt-6"><button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${escapeHtml(confirmLabel)}</button></div>
      </form>` });
    const input = m.$('#prompt-input');
    setTimeout(() => input.select(), 50);
    m.$('form').addEventListener('submit', e => { e.preventDefault(); const v = input.value.trim(); if (!v) return input.focus(); result = v; m.close(); });
  });
}

// Rich text editor (toolbar defined in config so several editors can never collide on a shared id)
function mountEditor(host, { html = '', toolbar = 'full', placeholder = 'Start writing…' } = {}) {
  const toolbars = {
    full: [[{ header: [1, 2, 3, false] }], ['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['blockquote', 'link', 'image'], ['clean']],
    basic: [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link', 'clean']],
  };
  if (!window.Quill) {
    host.innerHTML = `<textarea class="input border-0 min-h-[200px]" placeholder="${escapeHtml(placeholder)}"></textarea>`;
    const ta = host.querySelector('textarea');
    const d = document.createElement('div'); d.innerHTML = sanitize(html); ta.value = d.textContent;
    return { getHTML: () => ta.value.trim() ? `<p>${escapeHtml(ta.value).replace(/\n/g, '<br>')}</p>` : '' };
  }
  const quill = new Quill(host, {
    theme: 'snow', placeholder,
    modules: {
      toolbar: {
        container: toolbars[toolbar] || toolbars.full,
        handlers: {
          // Embedding base64 images would blow past Firestore's 1 MB document limit — ask for a URL instead.
          image: async function () {
            const url = await promptDialog({ title: 'Insert image', label: 'Image URL', placeholder: 'https://…', confirmLabel: 'Insert', type: 'url' });
            const safe = url && normalizeUrl(url);
            if (!safe) { if (url) toast('That doesn\'t look like a valid image URL.', 'error'); return; }
            const range = quill.getSelection(true);
            quill.insertEmbed(range ? range.index : quill.getLength(), 'image', safe, 'user');
          }
        }
      }
    }
  });
  if (html) quill.clipboard.dangerouslyPasteHTML(sanitize(html));
  return { quill, getHTML: () => { const h = sanitize(quill.root.innerHTML); return isEmptyRichText(h) ? '' : h; } };
}

// ═══════════════════════════════════════════════════════════════
// ROUTER (client-side: no full page reloads)
// ═══════════════════════════════════════════════════════════════
function getAppSegments() {
  let p = decodeURIComponent(window.location.pathname);
  if (BASE_PATH && p.startsWith(BASE_PATH)) p = p.slice(BASE_PATH.length);
  return p.split('/').filter(Boolean);
}
function buildUrl(rel = '/') {
  const c = rel.startsWith('/') ? rel : '/' + rel;
  const [path, qs] = c.split('?');
  const j = (BASE_PATH + path).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
  return (j || '/') + (qs ? '?' + qs : '');
}
function currentAppPath() {
  let p = location.pathname;
  if (BASE_PATH && p.startsWith(BASE_PATH)) p = p.slice(BASE_PATH.length);
  return (p || '/') + location.search;
}
function navigate(path, { replace = false } = {}) {
  const url = buildUrl(path);
  if (url !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState'](null, '', url);
  renderRoute();
}
function parseRoute() {
  const sp = ss('ember_redirect_path');
  if (sp) { try { sessionStorage.removeItem('ember_redirect_path'); history.replaceState(null, '', sp); } catch (e) {} }
  const segs = getAppSegments();
  if (segs.length === 0) return { type: 'landing', tenant: null, segments: [] };
  const first = segs[0];
  if (RESERVED.includes(first)) return { type: first, tenant: null, segments: segs.slice(1) };
  return { type: 'tenant', tenant: first, segments: segs.slice(1) };
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
let currentUser = null;
let authReady = false;
const unsubs = [];
let routeToken = 0;
let viewAsStudent = ss('ember_view_as_student') === '1';
let signupWizard = null;
let suppressAuthRouting = false;
let redirectAfterSignOut = false;
const live = t => t === routeToken; // false once the user has navigated elsewhere

function clearSubs() { unsubs.splice(0).forEach(u => { try { u(); } catch (e) {} }); } // emptied in place: lazy modules hold this array
function setViewAsStudent(val) { viewAsStudent = val; ss('ember_view_as_student', val ? '1' : '0'); renderRoute(); }
function closeSidebar() { document.body.classList.remove('sidebar-open'); }
async function authFlow(fn) { suppressAuthRouting = true; try { return await fn(); } finally { suppressAuthRouting = false; } }

// ═══════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════
const tenantCache = new Map();
async function getTenant(slug, { fresh = false } = {}) {
  if (!fresh && tenantCache.has(slug)) return tenantCache.get(slug);
  const s = await getDoc(doc(db, 'tenants', slug));
  const t = s.exists() ? { id: s.id, ...s.data() } : null;
  if (t) tenantCache.set(slug, t);
  return t;
}
async function getRoleInTenant(slug, uid) {
  if (!uid) return null;
  const [t, s, g] = await Promise.allSettled([
    getDoc(doc(db, 'tenants', slug, 'users', uid)),
    getDoc(doc(db, 'tenants', slug, 'students', uid)),
    getDoc(doc(db, 'tenants', slug, 'guardians', uid)),
  ]);
  if (t.status === 'fulfilled' && t.value.exists()) return { role: t.value.data().role === 'admin' ? 'admin' : 'teacher', data: t.value.data() };
  if (s.status === 'fulfilled' && s.value.exists()) return { role: 'student', data: s.value.data() };
  if (g.status === 'fulfilled' && g.value.exists()) return { role: 'guardian', data: g.value.data() };
  return null;
}
let schoolsCache = null, schoolsCacheAt = 0;
async function searchSchools(q) {
  if (!schoolsCache || Date.now() - schoolsCacheAt > 300000) {
    // Schools AND independent teachers' classrooms (older classrooms may have no type field, so read them all).
    const snap = await getDocs(collection(db, 'tenants'));
    schoolsCache = snap.docs.map(d => ({ slug: d.id, name: d.data().name || d.id, type: d.data().type === 'school' ? 'school' : 'personal', districtId: d.data().districtId || null }));
    schoolsCacheAt = Date.now();
  }
  const ql = q.toLowerCase().trim();
  const starts = s => s.name.toLowerCase().startsWith(ql) ? 0 : 1;
  return schoolsCache
    .filter(s => !ql || s.name.toLowerCase().includes(ql) || s.slug.includes(ql.replace(/\s+/g, '-')))
    .sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name))
    .slice(0, 20);
}
async function countOf(q) {
  try { return (await getCountFromServer(q)).data().count; }
  catch { try { return (await getDocs(q)).size; } catch { return 0; } }
}
async function batchDelete(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach(r => b.delete(r));
    await b.commit();
  }
}
async function swapPositions(a, b) {
  let pa = a.position ?? 0, pb = b.position ?? 0;
  if (pa === pb) pb = pa + 1;
  const batch = writeBatch(db);
  batch.update(a.ref, { position: pb });
  batch.update(b.ref, { position: pa });
  await batch.commit();
}
async function maybeMigrateTenant(tenantSnap, userDocId, userDocData) {
  const data = tenantSnap.data();
  const updates = {};
  if (!data.type) updates.type = 'school';
  if (Object.keys(updates).length) { try { await updateDoc(tenantSnap.ref, updates); tenantCache.delete(tenantSnap.id); } catch (e) {} }
  if (data.ownerUid === userDocId && userDocData.role !== 'admin') {
    try { await updateDoc(doc(db, 'tenants', tenantSnap.id, 'users', userDocId), { role: 'admin' }); } catch (e) {}
  }
}
const isPermErr = e => e?.code === 'permission-denied';
function ls(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch { return null; } }
// Remember which tenant a user belongs to, so routing never needs a collection-group query.
function rememberTenant(uid, slug) {
  if (!uid || ls(`ember_last_tenant:${uid}`) === slug) return;
  ls(`ember_last_tenant:${uid}`, slug);
  setDoc(doc(db, 'userIndex', uid), { tenants: arrayUnion(slug) }, { merge: true }).catch(() => {});
}
const studentDest = (slug, st) => st === 'approved' ? `/${slug}` : st === 'pending' ? `/${slug}/pending` : `/${slug}/rejected`;
async function destinationIn(slug, uid) {
  const r = await getRoleInTenant(slug, uid);
  if (!r) return null;
  return r.role === 'student' ? studentDest(slug, r.data.status) : `/${slug}`;
}
async function resolveDestinationForUser(user) {
  if (!user) return null;
  const uid = user.uid;
  try {
    const dSnap = await getDocs(query(collection(db, 'districts'), where('adminUids', 'array-contains', uid), limit(1)));
    if (!dSnap.empty) return `/district/${dSnap.docs[0].id}`;
  } catch (e) { if (!isPermErr(e)) console.warn('district lookup failed', e); }

  // Students: the school is encoded in their login (username@school.emberlms.local).
  const m = /^[^@]+@([a-z0-9-]+)\.emberlms\.local$/.exec(user.email || '');
  if (m) { const d = await destinationIn(m[1], uid); if (d) return d; }

  // Staff: last-used tenant, then the userIndex document.
  const candidates = new Set();
  const last = ls(`ember_last_tenant:${uid}`); if (last) candidates.add(last);
  try { const ix = await getDoc(doc(db, 'userIndex', uid)); (ix.data()?.tenants || []).forEach(t => candidates.add(t)); } catch (e) {}
  for (const slug of candidates) { const d = await destinationIn(slug, uid); if (d) return d; }

  // Legacy fallback: collection-group queries (require the {path=**} rules in firestore.rules).
  const fromStaffSnap = async (snap) => {
    const first = snap.docs[0];
    const tenantRef = first.ref.parent.parent;
    const tenantSnap = await getDoc(tenantRef);
    if (tenantSnap.exists()) await maybeMigrateTenant(tenantSnap, first.id, first.data());
    rememberTenant(uid, tenantRef.id);
    return `/${tenantRef.id}`;
  };
  try {
    const byUid = await getDocs(query(collectionGroup(db, 'users'), where('userId', '==', uid), limit(1)));
    if (!byUid.empty) return await fromStaffSnap(byUid);
    if (user.email) {
      const byEmail = await getDocs(query(collectionGroup(db, 'users'), where('email', '==', user.email), limit(1)));
      if (!byEmail.empty) return await fromStaffSnap(byEmail);
    }
  } catch (e) { if (!isPermErr(e)) console.warn('teacher lookup failed', e); }
  try {
    const g = await getDocs(query(collectionGroup(db, 'guardians'), where('userId', '==', uid), limit(1)));
    if (!g.empty) { const slug = g.docs[0].ref.parent.parent.id; rememberTenant(uid, slug); return `/${slug}`; }
  } catch (e) { if (!isPermErr(e)) console.warn('guardian lookup failed', e); }
  if (user.email) {
    try {
      const sSnap = await getDocs(query(collectionGroup(db, 'students'), where('email', '==', user.email), limit(1)));
      if (!sSnap.empty) {
        const first = sSnap.docs[0];
        return studentDest(first.ref.parent.parent.id, first.data().status);
      }
    } catch (e) { if (!isPermErr(e)) console.warn('student lookup failed', e); }
  }
  return null;
}

// Join codes live in /joinCodes/{CODE} (get-only) and /tenants/{t}/private/settings,
// never on the tenant doc, which must stay publicly listable for school search.
async function getJoinCode(slug, tenant) {
  try { const s = await getDoc(doc(db, 'tenants', slug, 'private', 'settings')); if (s.exists() && s.data().joinCode) return s.data().joinCode; } catch (e) {}
  return tenant?.joinCode || '';
}
async function setJoinCode(slug, oldCode = '') {
  const code = genCode();
  const b = writeBatch(db);
  b.set(doc(db, 'joinCodes', code), { tenantId: slug, createdAt: serverTimestamp() });
  b.set(doc(db, 'tenants', slug, 'private', 'settings'), { joinCode: code }, { merge: true });
  b.update(doc(db, 'tenants', slug), { joinCode: deleteField() });
  await b.commit();
  if (oldCode) deleteDoc(doc(db, 'joinCodes', oldCode)).catch(() => {});
  tenantCache.delete(slug);
  return code;
}
async function lookupJoinCode(code) {
  try {
    const s = await getDoc(doc(db, 'joinCodes', code));
    if (s.exists()) { const t = await getTenant(s.data().tenantId); if (t) return t; }
  } catch (e) {}
  const snap = await getDocs(query(collection(db, 'tenants'), where('joinCode', '==', code), limit(1))); // legacy codes
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}
async function goToAccount(user = currentUser) {
  const dest = await resolveDestinationForUser(user);
  navigate(dest && dest !== '/login' ? dest : '/signup');
}

// ═══════════════════════════════════════════════════════════════
// LANDING
// ═══════════════════════════════════════════════════════════════
function viewLanding() {
  setTitle();
  const signedIn = !!currentUser;
  const features = [
    { icon: 'layers', title: 'Modules & items', desc: 'Pages, assignments, quizzes and links — organised into clean, reorderable modules.' },
    { icon: 'list-checks', title: 'Auto-graded quizzes', desc: 'Build multiple-choice quizzes in seconds. Scores land in the gradebook instantly.' },
    { icon: 'award', title: 'Gradebook', desc: 'Grade submissions with feedback, see every student at a glance, export to CSV.' },
    { icon: 'users', title: 'Student accounts', desc: 'Usernames and passwords — no student email needed. Add a whole class in one paste.' },
    { icon: 'clipboard-check', title: 'Lesson plan reviews', desc: 'Teachers submit weekly plans. Admins approve or request changes with comments.' },
    { icon: 'building-2', title: 'Schools & districts', desc: 'District admins oversee schools. School admins oversee teachers. Data never crosses tenants.' },
  ];
  const steps = [
    { n: '01', title: 'Create your space', desc: 'Start a personal classroom or join your school with a 6-character code.' },
    { n: '02', title: 'Add your students', desc: 'Paste a class list — usernames and passwords are generated for you.' },
    { n: '03', title: 'Teach', desc: 'Build modules, post announcements, grade work. Students see it the moment they log in.' },
  ];
  const primaryCta = signedIn
    ? `<button data-goto-account class="btn btn-primary btn-lg">Go to my account ${ico('arrow-right')}</button>`
    : `<a href="${buildUrl('/signup')}" class="btn btn-primary btn-lg">Get started — free ${ico('arrow-right')}</a>`;
  const secondaryCta = signedIn
    ? `<a href="${buildUrl('/signup')}" class="btn btn-secondary btn-lg">Create another account</a>`
    : `<a href="${buildUrl('/login')}" class="btn btn-secondary btn-lg">Sign in</a>`;

  // A lightweight product preview built from the real design tokens.
  const preview = `
    <div class="relative mx-auto max-w-5xl">
      <div class="absolute -inset-x-10 -top-10 -bottom-10 bg-gradient-to-b from-[#F59E0B]/10 via-[#8B5CF6]/5 to-transparent blur-3xl pointer-events-none"></div>
      <div class="relative rounded-2xl border border-white/10 bg-[#0D0D0D] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] overflow-hidden" aria-hidden="true">
        <div class="flex items-center gap-1.5 px-4 h-9 border-b border-white/[0.06] bg-[#111]">
          <span class="w-2.5 h-2.5 rounded-full bg-white/10"></span><span class="w-2.5 h-2.5 rounded-full bg-white/10"></span><span class="w-2.5 h-2.5 rounded-full bg-white/10"></span>
          <span class="ml-3 text-[10px] text-gray-600 font-mono">emberlms / lincoln-high</span>
        </div>
        <div class="flex text-left">
          <div class="hidden sm:block w-44 border-r border-white/[0.06] bg-[#070707] p-4 space-y-1.5">
            <div class="text-[9px] uppercase tracking-widest text-gray-600 mb-3">Classroom</div>
            ${['Dashboard', 'Students', 'Announcements', 'Lesson Plans'].map((x, i) => `<div class="text-[11px] px-2 py-1.5 rounded ${i === 0 ? 'bg-white/[0.06] text-white border-l-2 border-[#F59E0B]' : 'text-gray-500'}">${x}</div>`).join('')}
          </div>
          <div class="flex-1 p-4 sm:p-6">
            <div class="text-[10px] text-[#F59E0B] uppercase tracking-widest mb-1">Lincoln High</div>
            <div class="font-serif text-lg sm:text-xl text-white mb-4">Good morning, Ms. Rivera</div>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
              ${[['grad-amber', 'BIO 101', 'Biology'], ['grad-violet', 'ENG 2', 'English Literature'], ['grad-teal', 'ALG 1', 'Algebra I']].map(([g, c, t], i) => `
                <div class="rounded-lg border border-white/[0.08] bg-[#141414] overflow-hidden ${i === 2 ? 'hidden md:block' : ''}">
                  <div class="${g} h-10 sm:h-12 relative"><div class="absolute inset-0 grad-pattern opacity-40"></div></div>
                  <div class="p-2.5 sm:p-3"><div class="text-[9px] text-gray-500">${c}</div><div class="text-[11px] sm:text-xs text-white font-serif">${t}</div>
                  <div class="mt-2 h-1 rounded-full bg-white/[0.06]"><div class="h-1 rounded-full bg-[#F59E0B]" style="width:${[72, 45, 88][i]}%"></div></div></div>
                </div>`).join('')}
            </div>
            <div class="mt-3 rounded-lg border border-white/[0.08] bg-[#141414] p-3 flex items-center gap-3">
              <div class="w-6 h-6 rounded-md bg-[#F59E0B]/15 border border-[#F59E0B]/25"></div>
              <div class="flex-1"><div class="text-[11px] text-white">Lab report: Photosynthesis</div><div class="text-[9px] text-gray-500">18 of 24 submitted · 6 need grading</div></div>
              <span class="badge badge-amber">Grade</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  render(`
    <div class="min-h-[100dvh] relative overflow-hidden view-enter">
      <div class="glow top-0 left-1/2 -translate-x-1/2 w-[900px] h-[700px] bg-[#F59E0B]/10"></div>
      <div class="glow top-40 right-0 w-[500px] h-[500px] bg-[#8B5CF6]/10"></div>

      <nav class="relative z-20 max-w-6xl mx-auto px-5 sm:px-6 py-5 sm:py-6 flex justify-between items-center gap-3">
        ${logo()}
        <div class="flex items-center gap-2 sm:gap-3 text-sm">
          ${signedIn ? `
            <span class="hidden md:inline text-xs text-gray-500 truncate max-w-[200px]">${escapeHtml(currentUser.email || '')}</span>
            <button data-signout class="btn btn-ghost btn-sm">Sign out</button>
            <button data-goto-account class="btn btn-primary btn-sm">My account</button>
          ` : `
            <a href="${buildUrl('/login')}" class="btn btn-ghost btn-sm">Sign in</a>
            <a href="${buildUrl('/signup')}" class="btn btn-primary btn-sm">Get started</a>
          `}
        </div>
      </nav>

      <section class="relative z-10 max-w-5xl mx-auto px-5 sm:px-6 pt-10 sm:pt-16 pb-16 sm:pb-20 text-center">
        <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] text-xs text-gray-400 mb-8">
          <span class="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse"></span> Built for teachers, loved by students
        </div>
        <h1 class="font-serif text-5xl sm:text-6xl md:text-7xl text-white leading-[1.05] mb-6">Teaching,<br><span class="italic text-[#F59E0B]">refined.</span></h1>
        <p class="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">A calm, modern learning platform for schools, districts, and independent teachers — courses, quizzes, grading and lesson planning in one place.</p>
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 max-w-xs sm:max-w-none mx-auto">${primaryCta}${secondaryCta}</div>
        <p class="text-xs text-gray-600 mt-6">No credit card · No setup fees · Works on any device</p>
      </section>

      <section class="relative z-10 px-5 sm:px-6 pb-24">${preview}</section>

      <section class="relative z-10 max-w-6xl mx-auto px-5 sm:px-6 pb-24">
        <div class="text-center mb-12">
          <p class="text-xs text-[#F59E0B] uppercase tracking-[0.3em] mb-3">Everything you need</p>
          <h2 class="font-serif text-3xl sm:text-4xl text-white">One place for the whole school day.</h2>
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          ${features.map(f => `
            <div class="card card-hover p-6">
              ${iconTile(f.icon, 'amber')}
              <h3 class="font-serif text-xl text-white mt-4 mb-2">${f.title}</h3>
              <p class="text-sm text-gray-500 leading-relaxed">${f.desc}</p>
            </div>`).join('')}
        </div>
      </section>

      <section class="relative z-10 max-w-6xl mx-auto px-5 sm:px-6 pb-24">
        <div class="card p-6 sm:p-10">
          <p class="text-xs text-[#8B5CF6] uppercase tracking-[0.3em] mb-3">How it works</p>
          <h2 class="font-serif text-3xl text-white mb-10">Up and running before first period.</h2>
          <div class="grid md:grid-cols-3 gap-8">
            ${steps.map(s => `<div><div class="font-mono text-sm text-[#8B5CF6] mb-3">${s.n}</div><h3 class="font-serif text-xl text-white mb-2">${s.title}</h3><p class="text-sm text-gray-500 leading-relaxed">${s.desc}</p></div>`).join('')}
          </div>
        </div>
      </section>

      <section class="relative z-10 max-w-4xl mx-auto px-5 sm:px-6 pb-24 text-center">
        <h2 class="font-serif text-4xl sm:text-5xl text-white mb-4">Light the <span class="italic text-[#F59E0B]">spark.</span></h2>
        <p class="text-gray-500 mb-8">Set up your classroom in under a minute.</p>
        <div class="flex justify-center">${primaryCta}</div>
      </section>

      <footer class="relative z-10 border-t border-white/[0.06] py-8">
        <div class="max-w-6xl mx-auto px-5 sm:px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-gray-600">
          ${logo({ size: 'text-base' })}
          <div>© ${new Date().getFullYear()} ${APP_NAME}</div>
        </div>
      </footer>
    </div>`);
}

// ═══════════════════════════════════════════════════════════════
// AUTH SCREENS (shared shell)
// ═══════════════════════════════════════════════════════════════
function authShell({ eyebrow, headline, blurb, content }) {
  const perks = ['Courses, quizzes & grading', 'Student logins without email', 'Lesson plan reviews for admins'];
  return `<div class="min-h-[100dvh] flex view-enter">
    <div class="hidden lg:flex w-1/2 bg-[#050505] relative overflow-hidden border-r border-white/[0.08]">
      <div class="glow bottom-0 left-0 w-[600px] h-[600px] bg-[#F59E0B]/10"></div>
      <div class="glow top-0 right-0 w-[400px] h-[400px] bg-[#8B5CF6]/10"></div>
      <div class="relative z-10 flex flex-col justify-between p-16 w-full">
        ${logo({ size: 'text-2xl' })}
        <div>
          <p class="text-xs text-[#F59E0B] uppercase tracking-widest mb-4">${eyebrow}</p>
          <h1 class="font-serif text-5xl text-white leading-tight mb-4">${headline}</h1>
          <p class="text-gray-500 text-base max-w-md mb-8">${blurb}</p>
          <ul class="space-y-3">${perks.map(p => `<li class="flex items-center gap-3 text-sm text-gray-400">${ico('circle-check', 'w-4 h-4 text-[#F59E0B]')} ${p}</li>`).join('')}</ul>
        </div>
        <div class="text-xs text-gray-700">© ${new Date().getFullYear()} ${APP_NAME}</div>
      </div>
    </div>
    <div class="w-full lg:w-1/2 flex items-center justify-center px-5 sm:px-6 py-10 bg-[#0A0A0A]">
      <div class="max-w-md w-full">
        <div class="lg:hidden mb-8 text-center">${logo({ size: 'text-2xl' })}</div>
        ${content}
      </div>
    </div>
  </div>`;
}
function signedInCard(extra = '') {
  return `<div class="mb-6 p-4 bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-xl">
    <p class="text-[10px] text-[#F59E0B] uppercase tracking-wider mb-1">Already signed in</p>
    <p class="text-sm text-white truncate">${escapeHtml(currentUser.email || currentUser.displayName || '')}</p>
    ${extra ? `<p class="text-xs text-gray-400 mt-1">${extra}</p>` : ''}
    <div class="flex gap-2 mt-3">
      <button data-goto-account class="btn btn-primary btn-sm flex-1">Go to my account</button>
      <button data-signout class="btn btn-secondary btn-sm flex-1">Sign out</button>
    </div>
  </div>`;
}

// Searchable school combobox (keyboard friendly) used by student login & student signup.
function mountSchoolPicker(host, { initial = null, onChange = () => {} } = {}) {
  let selected = initial, results = [], active = -1;
  const draw = () => {
    if (selected) {
      host.innerHTML = `<div class="flex items-center gap-3 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/25 rounded-xl">
        ${iconTile('school', 'amber')}
        <div class="min-w-0 flex-1"><div class="text-sm text-white truncate" data-school-name>${escapeHtml(selected.name)}</div><div class="text-xs text-gray-500 font-mono truncate">/${escapeHtml(selected.slug)}</div></div>
        <button type="button" data-change class="btn btn-ghost btn-sm">Change</button></div>`;
      refreshIcons();
      host.querySelector('[data-change]').addEventListener('click', () => { selected = null; onChange(null); draw(); host.querySelector('input')?.focus(); });
      return;
    }
    host.innerHTML = `<div class="relative">
      <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">${ico('search')}</span>
      <input type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="Search for your school" placeholder="School or teacher's classroom name…" autocomplete="off" class="input pl-10" />
      <div data-results role="listbox" class="absolute z-30 left-0 right-0 mt-1 bg-[#171717] border border-white/[0.1] rounded-xl overflow-hidden hidden max-h-64 overflow-y-auto shadow-2xl"></div>
    </div>`;
    refreshIcons();
    const input = host.querySelector('input'), box = host.querySelector('[data-results]');
    const show = () => {
      box.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true');
      box.innerHTML = results.length
        ? results.map((s, i) => `<button type="button" role="option" aria-selected="${i === active}" data-i="${i}" class="w-full text-left px-4 py-3 border-b border-white/[0.04] last:border-0 transition-colors ${i === active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}"><div class="text-sm text-white flex items-center gap-2">${escapeHtml(s.name)}${s.type === 'personal' ? '<span class="badge badge-violet">Independent classroom</span>' : ''}</div><div class="text-xs text-gray-500 font-mono">/${escapeHtml(s.slug)}</div></button>`).join('')
        : `<div class="p-4 text-sm text-gray-500">No schools or classrooms match “${escapeHtml(input.value.trim())}”. Try the web address your teacher gave you (the part after /emberlms/).</div>`;
      box.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
    };
    const hide = () => { box.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); };
    const pick = s => { selected = { ...s }; onChange(selected); draw(); };
    const search = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { results = []; hide(); return; }
      try { results = await searchSchools(q); active = results.length ? 0 : -1; if (document.activeElement === input) show(); }
      catch (e) { box.innerHTML = `<div class="p-4 text-sm text-red-400">${escapeHtml(friendlyError(e))}</div>`; box.classList.remove('hidden'); }
    }, 160);
    input.addEventListener('input', search);
    input.addEventListener('keydown', e => {
      if (box.classList.contains('hidden') || !results.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % results.length; show(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + results.length) % results.length; show(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) pick(results[active]); }
      else if (e.key === 'Escape') { e.stopPropagation(); hide(); }
    });
    input.addEventListener('blur', () => setTimeout(hide, 150));
    box.addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(results[+b.dataset.i]); } });
  };
  draw();
  return {
    get: () => selected,
    setName(n) { if (!selected) return; selected.name = n; const el = host.querySelector('[data-school-name]'); if (el) el.textContent = n; }
  };
}

// ═══════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════
function viewLogin() {
  setTitle('Sign in');
  const params = new URLSearchParams(location.search);
  const schoolParam = params.get('school');
  const next = safeNext(params.get('next'));
  let mode = params.get('as') || (schoolParam ? 'student' : 'staff');
  if (!['staff', 'student', 'parent'].includes(mode)) mode = 'staff';
  let school = schoolParam ? { slug: schoolParam, name: schoolParam } : null;
  let picker = null;

  if (schoolParam) {
    getTenant(schoolParam).then(t => {
      if (!t) return;
      if (school?.slug === schoolParam) school.name = t.name;
      picker?.setName(t.name);
    }).catch(() => {});
  }

  const afterLogin = async (user, fallback) => {
    if (next) return navigate(next, { replace: true });
    const dest = await resolveDestinationForUser(user);
    navigate(dest || fallback, { replace: true });
  };

  const draw = () => {
    render(authShell({
      eyebrow: 'Welcome back',
      headline: 'Teaching,<br><span class="italic text-[#F59E0B]">refined.</span>',
      blurb: 'Sign in to your school, district, or personal classroom.',
      content: `
        <h2 class="font-serif text-3xl text-white mb-1">Sign in</h2>
        <p class="text-gray-500 text-sm mb-6">${mode === 'student' ? 'Students sign in with the username your teacher gave you.' : mode === 'parent' ? 'Parents and guardians — see grades, attendance and more in Family Access.' : 'Teachers, administrators and independent teachers.'}</p>
        ${currentUser ? signedInCard() : ''}
        <div class="segmented grid grid-cols-3 w-full mb-6" role="group" aria-label="Account type">
          <button type="button" data-login-mode="staff" aria-pressed="${mode === 'staff'}">${ico('briefcase', 'w-3.5 h-3.5')} Staff</button>
          <button type="button" data-login-mode="student" aria-pressed="${mode === 'student'}">${ico('graduation-cap', 'w-3.5 h-3.5')} Student</button>
          <button type="button" data-login-mode="parent" aria-pressed="${mode === 'parent'}">${ico('users', 'w-3.5 h-3.5')} Parent</button>
        </div>
        <div id="login-body"></div>
        <p class="text-xs text-gray-600 mt-8 text-center">Don't have an account? <a href="${buildUrl('/signup')}" class="text-[#F59E0B] hover:underline">Sign up</a></p>`
    }));
    $$('[data-login-mode]').forEach(b => b.addEventListener('click', () => {
      if (mode === b.dataset.loginMode) return;
      mode = b.dataset.loginMode;
      const url = new URL(location.href); url.searchParams.set('as', mode);
      history.replaceState(null, '', url.pathname + url.search);
      draw();
    }));
    const body = $('#login-body');

    if (mode === 'staff' || mode === 'parent') {
      const P = mode; // element ids: staff-email / parent-email …
      body.innerHTML = `
        <button type="button" id="google-btn" class="btn btn-google btn-block py-3">${GOOGLE_SVG} Continue with Google</button>
        ${DIVIDER}
        <form id="${P}-form" novalidate>
          <label for="${P}-email" class="label">Email</label>
          <input id="${P}-email" type="email" autocomplete="email" inputmode="email" class="input mb-4" required />
          ${passwordField(`${P}-password`)}
          <div class="flex justify-end mt-2 mb-4"><button type="button" id="${P}-forgot" class="text-xs text-gray-500 hover:text-[#F59E0B] transition-colors">Forgot password?</button></div>
          <p id="login-error" class="form-error mb-4 hidden" role="alert"></p>
          <button type="submit" class="btn btn-primary btn-block py-3">Sign in</button>
        </form>
        ${P === 'parent' ? `<div class="mt-6 p-4 rounded-xl border border-white/[0.08] bg-white/[0.02]">
          <p class="text-sm text-white mb-1">First time here?</p>
          <p class="text-xs text-gray-500 mb-3">Create your parent account with the Family Access code from your child's school, or ask the school office to set one up for you.</p>
          <a href="${buildUrl('/signup?role=guardian')}" class="btn btn-secondary btn-block">${ico('user-plus', 'w-4 h-4')} Create a parent account</a></div>` : ''}`;
      refreshIcons();
      const err = $('#login-error');
      $('#google-btn').addEventListener('click', e => withBusy(e.currentTarget, 'Opening Google…', () => authFlow(async () => {
        showError(err, '');
        try {
          const cred = await signInWithPopup(auth, new GoogleAuthProvider());
          await afterLogin(cred.user, P === 'parent' ? '/signup?role=guardian' : '/signup');
        } catch (e) {
          if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) return;
          console.error(e); showError(err, friendlyError(e));
        }
      })));
      $(`#${P}-form`).addEventListener('submit', e => {
        e.preventDefault();
        const btn = e.currentTarget.querySelector('[type=submit]');
        const email = $(`#${P}-email`).value.trim();
        const password = $(`#${P}-password`).value;
        showError(err, '');
        if (!email || !password) return showError(err, 'Enter your email and password.');
        if (!isValidEmail(email)) return showError(err, 'Enter a valid email address.');
        withBusy(btn, 'Signing in…', () => authFlow(async () => {
          try {
            const cred = await signInWithEmailAndPassword(auth, email, password);
            await afterLogin(cred.user, P === 'parent' ? '/signup?role=guardian' : '/signup');
          } catch (e) {
            if (!['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(e.code)) console.error(e);
            showError(err, friendlyError(e));
          }
        }));
      });
      $(`#${P}-forgot`).addEventListener('click', async e => {
        const email = $(`#${P}-email`).value.trim();
        if (!isValidEmail(email)) { showError(err, 'Enter your email above, then click “Forgot password?” again.'); $(`#${P}-email`).focus(); return; }
        await withBusy(e.currentTarget, 'Sending…', async () => {
          try { await sendPasswordResetEmail(auth, email); showError(err, ''); toast(`If an account exists for ${email}, a reset link is on its way.`, 'info'); }
          catch (ex) { showError(err, friendlyError(ex)); }
        });
      });
      return;
    }

    body.innerHTML = `
      <form id="student-form" novalidate>
        <span class="label">Your school</span>
        <div id="school-picker" class="mb-4"></div>
        <label for="student-username" class="label">Username</label>
        <input id="student-username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" class="input mb-4 font-mono" required />
        ${passwordField('student-password')}
        <p id="login-error" class="form-error mt-4 hidden" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block py-3 mt-5">Sign in</button>
        <p class="hint text-center mt-4">Forgot your password? Ask your teacher — they can see your login details.</p>
      </form>`;
    refreshIcons();
    picker = mountSchoolPicker($('#school-picker'), { initial: school, onChange: s => { school = s; } });
    const err = $('#login-error');
    $('#student-form').addEventListener('submit', e => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector('[type=submit]');
      showError(err, '');
      if (!school) return showError(err, 'Select your school first.');
      const u = $('#student-username').value.trim().toLowerCase().replace(/\s+/g, '_');
      const p = $('#student-password').value;
      if (!u || !p) return showError(err, 'Enter your username and password.');
      if (u.length > 40) return showError(err, 'That username is too long.');
      withBusy(btn, 'Signing in…', () => authFlow(async () => {
        try {
          const cred = await signInWithEmailAndPassword(auth, `${u}@${school.slug}.emberlms.local`, p);
          await afterLogin(cred.user, `/${school.slug}/pending`);
        } catch (e) {
          console.error(e);
          if (e.code === 'auth/invalid-email') showError(err, 'Your username contains characters that aren\'t allowed.');
          else if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(e.code)) showError(err, 'Incorrect username or password. Check you picked the right school.');
          else showError(err, friendlyError(e));
        }
      }));
    });
  };
  draw();
}

// ═══════════════════════════════════════════════════════════════
// SIGNUP WIZARD
// ═══════════════════════════════════════════════════════════════
async function viewSignup() {
  setTitle('Create account');
  if (currentUser) {
    const t = routeToken;
    render(loadingScreen());
    let dest = null;
    try { dest = await resolveDestinationForUser(currentUser); } catch (e) { console.warn(e); }
    if (!live(t)) return;
    if (dest && dest !== '/login') {
      render(authShell({
        eyebrow: 'Get started', headline: 'Welcome<br><span class="italic text-[#F59E0B]">back.</span>', blurb: 'You already have an account.',
        content: `<h2 class="font-serif text-3xl text-white mb-6">You're signed in</h2>${signedInCard('Sign out first if you want to create a different account.')}
          <p class="text-xs text-gray-600 text-center"><a href="${buildUrl('/')}" class="hover:text-gray-400">← Back home</a></p>`
      }));
      return;
    }
  }
  if (!signupWizard) {
    const asGuardian = new URLSearchParams(location.search).get('role') === 'guardian';
    signupWizard = { role: asGuardian ? 'guardian' : null, mode: null, step: asGuardian ? 'guardian-code' : 'role', data: {} };
  }
  renderWizard();
}

function renderWizard() {
  const w = signupWizard;
  const stepInfo = {
    'role': [1, 3], 'teacher-mode': [2, 4], 'teacher-join': [3, 4], 'teacher-personal-name': [3, 4], 'teacher-auth': [4, 4],
    'student-school': [2, 3], 'student-form': [3, 3], 'guardian-code': [2, 3], 'guardian-auth': [3, 3],
  }[w.step] || [1, 3];
  const progress = w.step === 'role' ? '' : `
    <div class="flex items-center gap-3 mb-6" aria-label="Step ${stepInfo[0]} of ${stepInfo[1]}">
      <div class="flex-1 flex gap-1.5">${Array.from({ length: stepInfo[1] }, (_, i) => `<div class="h-1 flex-1 rounded-full ${i < stepInfo[0] ? 'bg-[#F59E0B]' : 'bg-white/10'}"></div>`).join('')}</div>
      <span class="text-[10px] text-gray-500 uppercase tracking-wider">Step ${stepInfo[0]} of ${stepInfo[1]}</span>
    </div>`;
  const shell = content => authShell({
    eyebrow: 'Get started',
    headline: 'Begin your<br><span class="italic text-[#F59E0B]">journey.</span>',
    blurb: 'A free account. Yours in seconds.',
    content: `
      ${currentUser ? `<div class="mb-5 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-lg text-xs text-gray-300">Signed in as <span class="text-white">${escapeHtml(currentUser.email || currentUser.displayName || '')}</span>. Continue below to finish setting up, or <button data-signout class="text-[#F59E0B] hover:underline">sign out</button>.</div>` : ''}
      ${progress}${content}
      <p class="text-xs text-gray-600 mt-8 text-center">Already have an account? <a href="${buildUrl('/login')}" class="text-[#F59E0B] hover:underline">Sign in</a></p>`
  });
  const backBtn = `<button type="button" data-back class="text-xs text-gray-500 hover:text-white transition-colors inline-flex items-center gap-1 mb-6">${ico('arrow-left', 'w-3 h-3')} Back</button>`;
  const choice = (attr, val, icon, tone, title, sub) => `
    <button type="button" ${attr}="${val}" class="w-full flex items-center gap-4 p-5 card hover:border-[#F59E0B]/40 transition-all text-left group">
      ${iconTile(icon, tone, 'tile-lg')}
      <div class="flex-1 min-w-0"><div class="font-serif text-lg text-white">${title}</div><div class="text-xs text-gray-500">${sub}</div></div>
      ${ico('arrow-right', 'w-4 h-4 text-gray-600 group-hover:text-[#F59E0B] group-hover:translate-x-0.5 transition-all')}
    </button>`;
  const go = step => { w.step = step; renderWizard(); };
  const resumeSignedIn = msg => {
    currentUser = auth.currentUser;
    if (currentUser) { renderWizard(); showError($('#wz-error'), `Your account was created, but setup didn't finish: ${msg} Try again below.`); }
    else showError($('#wz-error'), msg);
  };
  const onBack = step => $('[data-back]')?.addEventListener('click', () => go(step));

  if (w.step === 'role') {
    render(shell(`
      <h2 class="font-serif text-3xl text-white mb-1">Create your account</h2>
      <p class="text-gray-500 text-sm mb-8">Tell us who you are to get started.</p>
      <div class="space-y-3">
        ${choice('data-role', 'teacher', 'graduation-cap', 'amber', "I'm a teacher", 'Join your school or teach independently')}
        ${choice('data-role', 'student', 'user', 'violet', "I'm a student", 'Join your school — your teacher approves you')}
        ${choice('data-role', 'guardian', 'house-heart', 'teal', "I'm a parent or guardian", 'Family Access with the code from your school')}
      </div>
      <div class="mt-6 p-4 bg-white/[0.02] border border-white/[0.06] rounded-lg flex gap-3">${ico('info', 'w-4 h-4 text-gray-500 shrink-0 mt-0.5')}<p class="text-xs text-gray-500 leading-relaxed">School administrators: ask your district admin to create your school, or start as a teacher teaching independently.</p></div>`));
    $$('[data-role]').forEach(b => b.addEventListener('click', () => { w.role = b.dataset.role; go({ teacher: 'teacher-mode', student: 'student-school', guardian: 'guardian-code' }[w.role]); }));
    return;
  }

  if (w.step === 'guardian-code') {
    render(shell(`${backBtn}
      <h2 class="font-serif text-3xl text-white mb-1">Family Access</h2>
      <p class="text-gray-500 text-sm mb-8">Enter the 8-character code your student's school gave you. Have more than one student? You can add the others after signing in.</p>
      <form id="wz-form" novalidate>
        <label for="wz-fcode" class="label">Family Access code</label>
        <input id="wz-fcode" type="text" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${escapeHtml(w.data.familyCode || '')}" class="input mb-4 text-center text-2xl font-mono tracking-[0.35em] uppercase" placeholder="ABCD2345" />
        <p id="wz-error" class="form-error mb-4 hidden" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block py-3">Continue</button>
      </form>`));
    onBack('role');
    const input = $('#wz-fcode');
    input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); });
    setTimeout(() => input.focus(), 50);
    $('#wz-form').addEventListener('submit', e => {
      e.preventDefault();
      const code = input.value.trim(); const err = $('#wz-error'); showError(err, '');
      if (code.length !== 8) return showError(err, 'Family Access codes are 8 characters long.');
      withBusy(e.currentTarget.querySelector('[type=submit]'), 'Checking…', async () => {
        try {
          const info = await (await import('./sis.js' + BUILD)).lookupFamilyCode(code);
          if (!info) return showError(err, "That code didn't match a student. Check it with the school office.");
          const school = await getTenant(info.tenantId).catch(() => null);
          Object.assign(w.data, { familyCode: code, family: info, schoolName: school?.name || info.tenantId });
          go('guardian-auth');
        } catch (ex) { showError(err, friendlyError(ex)); }
      });
    });
    return;
  }

  if (w.step === 'guardian-auth') {
    const info = w.data.family;
    render(shell(`${backBtn}
      <h2 class="font-serif text-3xl text-white mb-1">${currentUser ? 'Confirm your account' : 'Create your login'}</h2>
      <p class="text-gray-500 text-sm mb-6">Linking to <span class="text-white">${escapeHtml(info.studentName)}</span> at <span class="text-white">${escapeHtml(w.data.schoolName)}</span></p>
      <label for="wz-gname" class="label">Your name</label>
      <input id="wz-gname" type="text" autocomplete="name" class="input mb-6" value="${escapeHtml(w.data.guardianName || currentUser?.displayName || '')}" placeholder="Jordan Lovelace" />
      <div id="wz-auth"></div>
      <p id="wz-error" class="form-error mt-4 hidden" role="alert"></p>`));
    onBack('guardian-code');
    const err = $('#wz-error'), block = $('#wz-auth'), nameEl = $('#wz-gname');
    nameEl.addEventListener('input', () => { w.data.guardianName = nameEl.value; });
    const finish = async user => {
      const name = nameEl.value.trim() || user.displayName || (user.email ? user.email.split('@')[0] : 'Parent');
      await (await import('./sis.js' + BUILD)).linkGuardian(null, user, info, name);
      rememberTenant(user.uid, info.tenantId);
      signupWizard = null;
      toast(`Welcome! You're linked to ${info.studentName}.`);
      navigate('/' + info.tenantId, { replace: true });
    };
    if (currentUser) {
      block.innerHTML = `<button id="wz-finish" class="btn btn-primary btn-block py-3">Link my account</button>`;
      $('#wz-finish').addEventListener('click', e => withBusy(e.currentTarget, 'Linking…', async () => { try { await finish(currentUser); } catch (ex) { showError(err, friendlyError(ex)); } }));
      return;
    }
    block.innerHTML = `
      <button type="button" data-google class="btn btn-google btn-block py-3">${GOOGLE_SVG} Continue with Google</button>
      ${DIVIDER}
      <form id="wz-auth-form" novalidate>
        <label for="wz-email" class="label">Email</label>
        <input id="wz-email" type="email" autocomplete="email" inputmode="email" class="input mb-4" />
        ${passwordField('wz-pass', { autocomplete: 'new-password' })}
        <p class="hint">At least 6 characters.</p>
        <button type="submit" class="btn btn-primary btn-block py-3 mt-5">Create account</button>
      </form>`;
    refreshIcons();
    block.querySelector('[data-google]').addEventListener('click', e => withBusy(e.currentTarget, 'Opening Google…', () => authFlow(async () => {
      showError(err, '');
      try { const cred = await signInWithPopup(auth, new GoogleAuthProvider()); await finish(cred.user); }
      catch (ex) { if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(ex.code)) showError(err, friendlyError(ex)); }
    })));
    $('#wz-auth-form').addEventListener('submit', e => {
      e.preventDefault();
      const email = $('#wz-email').value.trim(), password = $('#wz-pass').value;
      showError(err, '');
      if (!nameEl.value.trim()) { nameEl.focus(); return showError(err, 'Enter your name so teachers know who you are.'); }
      if (!isValidEmail(email)) return showError(err, 'Enter a valid email address.');
      if (password.length < 6) return showError(err, 'Password must be at least 6 characters.');
      withBusy(e.currentTarget.querySelector('[type=submit]'), 'Creating account…', () => authFlow(async () => {
        try { const cred = await createUserWithEmailAndPassword(auth, email, password); await finish(cred.user); }
        catch (ex) { console.error(ex); resumeSignedIn(friendlyError(ex)); }
      }));
    });
    return;
  }

  if (w.step === 'teacher-mode') {
    render(shell(`${backBtn}
      <h2 class="font-serif text-3xl text-white mb-1">How do you teach?</h2>
      <p class="text-gray-500 text-sm mb-8">Pick the path that fits you best.</p>
      <div class="space-y-3">
        ${choice('data-tmode', 'join', 'building-2', 'amber', 'Join my school', 'Enter the join code from your admin')}
        ${choice('data-tmode', 'personal', 'sparkles', 'violet', 'Teach independently', 'Your own classroom with its own URL')}
      </div>`));
    onBack('role');
    $$('[data-tmode]').forEach(b => b.addEventListener('click', () => { w.mode = b.dataset.tmode; go(w.mode === 'join' ? 'teacher-join' : 'teacher-personal-name'); }));
    return;
  }

  if (w.step === 'teacher-join') {
    render(shell(`${backBtn}
      <h2 class="font-serif text-3xl text-white mb-1">Join your school</h2>
      <p class="text-gray-500 text-sm mb-8">Enter the 6-character join code your admin shared with you.</p>
      <form id="wz-form" novalidate>
        <label for="wz-joincode" class="label">Join code</label>
        <input id="wz-joincode" type="text" placeholder="X7B9Q2" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="6" value="${escapeHtml(w.data.joinCode || '')}"
          class="input mb-4 text-center text-2xl font-mono tracking-[0.4em] uppercase" autofocus />
        <p id="wz-error" class="form-error mb-4 hidden" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block py-3">Continue</button>
      </form>`));
    onBack('teacher-mode');
    const input = $('#wz-joincode');
    input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
    setTimeout(() => input.focus(), 50);
    $('#wz-form').addEventListener('submit', e => {
      e.preventDefault();
      const code = input.value.trim().toUpperCase();
      const err = $('#wz-error'); showError(err, '');
      if (code.length !== 6) return showError(err, 'Join codes are 6 characters long.');
      withBusy(e.currentTarget.querySelector('[type=submit]'), 'Looking up…', async () => {
        try {
          const school = await lookupJoinCode(code);
          if (!school) return showError(err, 'No school found with that code. Double-check it with your admin.');
          Object.assign(w.data, { joinCode: code, schoolSlug: school.id, schoolName: school.name });
          go('teacher-auth');
        } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
      });
    });
    return;
  }

  if (w.step === 'teacher-personal-name') {
    render(shell(`${backBtn}
      <h2 class="font-serif text-3xl text-white mb-1">Name your classroom</h2>
      <p class="text-gray-500 text-sm mb-8">Give it a name and a web address students will remember.</p>
      <form id="wz-form" novalidate>
        <label for="wz-name" class="label">Classroom name</label>
        <input id="wz-name" type="text" placeholder="Mr. Smith's Classroom" autocomplete="off" value="${escapeHtml(w.data.tenantName || '')}" class="input mb-4" />
        <label for="wz-slug" class="label">Web address</label>
        <div class="flex items-center input !p-0 focus-within:border-[#8B5CF6] focus-within:shadow-[0_0_0_3px_rgba(139,92,246,0.15)]">
          <span class="text-gray-500 text-xs pl-4 select-none whitespace-nowrap">${escapeHtml(location.host + BASE_PATH)}/</span>
          <input id="wz-slug" type="text" placeholder="mr-smith" autocomplete="off" autocapitalize="none" spellcheck="false" value="${escapeHtml(w.data.tenantSlug || '')}" class="flex-1 min-w-0 bg-transparent px-1 py-3 pr-4 text-white focus:outline-none" />
        </div>
        <p class="hint mb-4">3–30 characters: lowercase letters, numbers and hyphens.</p>
        <p id="wz-error" class="form-error mb-4 hidden" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block py-3">Continue</button>
      </form>`));
    onBack('teacher-mode');
    const nameEl = $('#wz-name'), slugEl = $('#wz-slug');
    if (w.data.tenantSlug) slugEl.dataset.touched = '1';
    nameEl.addEventListener('input', () => { if (!slugEl.dataset.touched) slugEl.value = slugify(nameEl.value).slice(0, 30); });
    slugEl.addEventListener('input', () => { slugEl.dataset.touched = '1'; slugEl.value = slugEl.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); });
    setTimeout(() => nameEl.focus(), 50);
    $('#wz-form').addEventListener('submit', e => {
      e.preventDefault();
      const name = nameEl.value.trim();
      const slug = slugEl.value.trim().toLowerCase();
      const err = $('#wz-error'); showError(err, '');
      if (!name) return showError(err, 'Give your classroom a name.');
      if (!/^[a-z0-9-]{3,30}$/.test(slug)) return showError(err, 'Web address must be 3–30 characters: lowercase letters, numbers, hyphens.');
      if (RESERVED.includes(slug)) return showError(err, 'That address is reserved — try another.');
      withBusy(e.currentTarget.querySelector('[type=submit]'), 'Checking…', async () => {
        try {
          const ex = await getDoc(doc(db, 'tenants', slug));
          if (ex.exists()) return showError(err, 'That address is taken — try another.');
          Object.assign(w.data, { tenantName: name, tenantSlug: slug });
          go('teacher-auth');
        } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
      });
    });
    return;
  }

  if (w.step === 'teacher-auth') {
    const isJoin = w.mode === 'join';
    render(shell(`${backBtn}
      <h2 class="font-serif text-3xl text-white mb-1">${currentUser ? 'Confirm your account' : 'Create your login'}</h2>
      <p class="text-gray-500 text-sm mb-6">${isJoin ? `Joining <span class="text-white">${escapeHtml(w.data.schoolName || '')}</span>` : `Creating <span class="text-white">${escapeHtml(w.data.tenantName || '')}</span>`}</p>
      <div id="wz-auth"></div>
      <p id="wz-error" class="form-error mt-4 hidden" role="alert"></p>`));
    onBack(isJoin ? 'teacher-join' : 'teacher-personal-name');
    const block = $('#wz-auth');
    const err = $('#wz-error');
    if (currentUser) {
      block.innerHTML = `
        <div class="p-4 card mb-4 flex items-center gap-3">${avatar(currentUser.displayName || currentUser.email, currentUser.photoURL)}<div class="min-w-0"><p class="text-xs text-gray-500">Signed in as</p><p class="text-sm text-white truncate">${escapeHtml(currentUser.email || currentUser.displayName || '')}</p></div></div>
        <button id="wz-finish" class="btn btn-primary btn-block py-3">${isJoin ? 'Join school' : 'Create classroom'}</button>`;
      refreshIcons();
      $('#wz-finish').addEventListener('click', e => withBusy(e.currentTarget, 'Setting up…', () => finalizeTeacherSignup(w, currentUser, err)));
      return;
    }
    block.innerHTML = `
      <button type="button" data-google class="btn btn-google btn-block py-3">${GOOGLE_SVG} Continue with Google</button>
      ${DIVIDER}
      <form id="wz-auth-form" novalidate>
        <label for="wz-email" class="label">Email</label>
        <input id="wz-email" type="email" autocomplete="email" inputmode="email" class="input mb-4" />
        ${passwordField('wz-pass', { autocomplete: 'new-password' })}
        <p class="hint">At least 6 characters.</p>
        <button type="submit" class="btn btn-primary btn-block py-3 mt-5">Create account</button>
      </form>`;
    refreshIcons();
    block.querySelector('[data-google]').addEventListener('click', e => withBusy(e.currentTarget, 'Opening Google…', () => authFlow(async () => {
      showError(err, '');
      try { const cred = await signInWithPopup(auth, new GoogleAuthProvider()); await finalizeTeacherSignup(w, cred.user, err); }
      catch (ex) { if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(ex.code)) showError(err, friendlyError(ex)); }
    })));
    $('#wz-auth-form').addEventListener('submit', e => {
      e.preventDefault();
      const email = $('#wz-email').value.trim(), password = $('#wz-pass').value;
      showError(err, '');
      if (!isValidEmail(email)) return showError(err, 'Enter a valid email address.');
      if (password.length < 6) return showError(err, 'Password must be at least 6 characters.');
      withBusy(e.currentTarget.querySelector('[type=submit]'), 'Creating account…', () => authFlow(async () => {
        try { const cred = await createUserWithEmailAndPassword(auth, email, password); await finalizeTeacherSignup(w, cred.user, err); }
        catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
        // Login created but setup failed: switch to the signed-in "finish" step instead of offering signup again.
        if ($('#wz-auth-form') && err.textContent) resumeSignedIn(err.textContent);
      }));
    });
    return;
  }

  if (w.step === 'student-school') {
    render(shell(`${backBtn}
      <h2 class="font-serif text-3xl text-white mb-1">Find your school</h2>
      <p class="text-gray-500 text-sm mb-8">Search by name or web address.</p>
      <span class="label">Your school</span>
      <div id="wz-picker" class="mb-6"></div>
      <button id="wz-school-next" class="btn btn-primary btn-block py-3" ${w.data.school ? '' : 'disabled'}>Continue</button>`));
    onBack('role');
    const next = $('#wz-school-next');
    mountSchoolPicker($('#wz-picker'), { initial: w.data.school, onChange: s => { w.data.school = s; next.disabled = !s; if (s) next.focus(); } });
    setTimeout(() => $('#wz-picker input')?.focus(), 50);
    next.addEventListener('click', () => { if (w.data.school) go('student-form'); });
    return;
  }

  if (w.step === 'student-form') {
    const school = w.data.school;
    render(shell(`${backBtn}
      <h2 class="font-serif text-3xl text-white mb-1">Create your login</h2>
      <p class="text-gray-500 text-sm mb-6">Joining <span class="text-white">${escapeHtml(school.name)}</span></p>
      <form id="wz-form" novalidate>
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div><label for="wz-first" class="label">First name</label><input id="wz-first" type="text" autocomplete="given-name" class="input" /></div>
          <div><label for="wz-last" class="label">Last name</label><input id="wz-last" type="text" autocomplete="family-name" class="input" /></div>
        </div>
        <label for="wz-user" class="label">Username</label>
        <input id="wz-user" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="auto-generated" class="input font-mono text-sm" />
        <p class="hint mb-4">3–20 characters. You'll use this to sign in — write it down!</p>
        ${passwordField('wz-pass', { autocomplete: 'new-password' })}
        <p class="hint">At least 6 characters.</p>
        <p id="wz-error" class="form-error mt-4 hidden" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block py-3 mt-5">Create account</button>
        <p class="hint text-center mt-4">Your teacher will approve your account before you can see your courses.</p>
      </form>`));
    onBack('student-school');
    const firstEl = $('#wz-first'), lastEl = $('#wz-last'), userEl = $('#wz-user');
    let existing = null;
    const updateUser = async () => {
      if (userEl.dataset.touched) return;
      const f = firstEl.value.trim(); if (!f) { userEl.value = ''; return; }
      if (existing === null) { existing = []; try { existing = (await getDocs(collection(db, 'tenants', school.slug, 'students'))).docs.map(d => d.data().username); } catch (e) { /* not readable before sign-up */ } }
      userEl.value = genUsername(f, lastEl.value.trim(), existing);
    };
    firstEl.addEventListener('input', updateUser);
    lastEl.addEventListener('input', updateUser);
    userEl.addEventListener('input', () => { userEl.dataset.touched = '1'; });
    setTimeout(() => firstEl.focus(), 50);
    $('#wz-form').addEventListener('submit', e => {
      e.preventDefault();
      const first = firstEl.value.trim(), last = lastEl.value.trim();
      const username = userEl.value.trim().toLowerCase();
      const password = $('#wz-pass').value;
      const err = $('#wz-error'); showError(err, '');
      if (!first) return showError(err, 'Enter your first name.');
      if (!/^[a-z0-9_.-]{3,20}$/.test(username)) return showError(err, 'Username must be 3–20 characters: lowercase letters, numbers, dots, dashes, underscores.');
      if (password.length < 6) return showError(err, 'Password must be at least 6 characters.');
      withBusy(e.currentTarget.querySelector('[type=submit]'), 'Creating account…', () => authFlow(async () => {
        try {
          const fakeEmail = `${username}@${school.slug}.emberlms.local`;
          // A retry after a failed profile write reuses the login that was already created.
          let user = auth.currentUser?.email === fakeEmail ? auth.currentUser : null;
          if (!user) {
            if (auth.currentUser) await signOut(auth);
            user = (await createUserWithEmailAndPassword(auth, fakeEmail, password)).user;
          }
          await setDoc(doc(db, 'tenants', school.slug, 'students', user.uid), {
            username, firstName: first, lastName: last, displayName: `${first} ${last}`.trim(),
            email: fakeEmail, role: 'student', status: 'pending', enrolledCourseIds: [], createdAt: serverTimestamp()
          });
          signupWizard = null;
          navigate(`/${school.slug}/pending`, { replace: true });
        } catch (ex) {
          console.error(ex);
          showError(err, ex.code === 'auth/email-already-in-use' ? 'That username is already taken at this school — try another.'
            : auth.currentUser ? `Your login was created, but we couldn't finish setting up your account (${friendlyError(ex)}). Press Create account to try again.` : friendlyError(ex));
        }
      }));
    });
    return;
  }

  signupWizard = { role: null, mode: null, step: 'role', data: {} };
  renderWizard();
}

async function finalizeTeacherSignup(w, u, errEl) {
  if (!u) { showError(errEl, 'You are not signed in.'); return; }
  const profile = {
    userId: u.uid, email: u.email || '',
    displayName: u.displayName || (u.email ? u.email.split('@')[0] : 'Teacher'),
    photoURL: u.photoURL || null, createdAt: serverTimestamp()
  };
  try {
    if (w.mode === 'join') {
      const slug = w.data.schoolSlug;
      const existing = await getDoc(doc(db, 'tenants', slug, 'users', u.uid));
      // joinCode is stored so security rules can verify the teacher really had it.
      if (!existing.exists()) await setDoc(doc(db, 'tenants', slug, 'users', u.uid), { ...profile, role: 'teacher', joinCode: w.data.joinCode });
      rememberTenant(u.uid, slug);
      signupWizard = null;
      toast(`Welcome to ${w.data.schoolName || 'your school'}!`);
      navigate('/' + slug, { replace: true });
    } else {
      const slug = w.data.tenantSlug, name = w.data.tenantName;
      const ex = await getDoc(doc(db, 'tenants', slug));
      if (ex.exists()) {
        toast('That address was just taken — pick another.', 'error');
        w.data.tenantSlug = ''; w.step = 'teacher-personal-name'; renderWizard(); return;
      }
      await setDoc(doc(db, 'tenants', slug), { type: 'personal', name, slug, ownerUid: u.uid, createdAt: serverTimestamp() });
      await setDoc(doc(db, 'tenants', slug, 'users', u.uid), { ...profile, role: 'admin' });
      rememberTenant(u.uid, slug);
      signupWizard = null;
      toast('Your classroom is ready!');
      navigate('/' + slug, { replace: true });
    }
  } catch (e) {
    console.error(e);
    showError(errEl, friendlyError(e));
    toast(friendlyError(e), 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// PENDING / REJECTED / NOT FOUND
// ═══════════════════════════════════════════════════════════════
function centeredMessage({ icon, tone = 'amber', title, text, actions = '' }) {
  return `<div class="min-h-[100dvh] flex items-center justify-center px-6 relative overflow-hidden view-enter">
    <div class="glow top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] ${tone === 'red' ? 'bg-red-500/5' : 'bg-[#F59E0B]/10'}"></div>
    <div class="max-w-md w-full text-center relative z-10">
      <div class="mb-10">${logo({ size: 'text-2xl' })}</div>
      <div class="tile tile-${tone} mx-auto mb-6 !w-16 !h-16 !rounded-full">${ico(icon, 'w-7 h-7')}</div>
      <h1 class="font-serif text-3xl text-white mb-2">${title}</h1>
      <div class="text-gray-500 mb-8 leading-relaxed">${text}</div>
      <div class="flex flex-wrap justify-center gap-3">${actions}</div>
    </div>
  </div>`;
}
function viewPending(slug, tenant) {
  setTitle('Awaiting approval', tenant.name);
  render(centeredMessage({
    icon: 'clock', title: 'Waiting for approval',
    text: `<p>Your account at <span class="text-white">${escapeHtml(tenant.name)}</span> is pending.</p><p class="text-sm mt-2">A teacher needs to approve you. This page updates automatically — you can leave it open.</p>`,
    actions: `<button data-signout class="btn btn-secondary">Sign out</button>`
  }));
  if (!currentUser) return;
  unsubs.push(onSnapshot(doc(db, 'tenants', slug, 'students', currentUser.uid), s => {
    const st = s.exists() ? s.data().status : null;
    if (st === 'approved') { toast("You're approved — welcome!"); navigate('/' + slug, { replace: true }); }
    else if (st === 'rejected') navigate(`/${slug}/rejected`, { replace: true });
  }, e => console.warn(e)));
}
function viewRejected(slug, tenant) {
  setTitle('Not approved', tenant.name);
  render(centeredMessage({
    icon: 'circle-x', tone: 'red', title: 'Access not approved',
    text: `Your account at <span class="text-white">${escapeHtml(tenant.name)}</span> wasn't approved. If you think this is a mistake, talk to your teacher.`,
    actions: `<button data-signout class="btn btn-secondary">Sign out</button>`
  }));
}
function viewNotFound() {
  setTitle('Not found');
  render(centeredMessage({ icon: 'compass', title: 'Page not found', text: "The page you're looking for doesn't exist or has moved.", actions: `<a href="${buildUrl('/')}" class="btn btn-secondary">${ico('arrow-left')} Back home</a>` }));
}
function viewTenantNotFound(slug) {
  setTitle('School not found');
  render(centeredMessage({ icon: 'search-x', title: 'School not found', text: `Nothing lives at <span class="text-[#F59E0B] font-mono">/${escapeHtml(slug)}</span>. Check the address and try again.`, actions: `<a href="${buildUrl('/')}" class="btn btn-secondary">${ico('arrow-left')} Back home</a>` }));
}
function viewNoAccess(slug, tenant) {
  setTitle(tenant.name);
  render(centeredMessage({
    icon: 'lock', title: escapeHtml(tenant.name),
    text: `You're signed in as <span class="text-white">${escapeHtml(currentUser.email || '')}</span>, which doesn't have access to this ${tenant.type === 'personal' ? 'classroom' : 'school'}.`,
    actions: `<a href="${buildUrl('/signup')}" class="btn btn-primary">Join with a code</a><button data-signout class="btn btn-secondary">Switch account</button>`
  }));
}
function viewFatal(e) {
  render(centeredMessage({ icon: 'triangle-alert', tone: 'red', title: 'Something went wrong', text: escapeHtml(friendlyError(e)), actions: `<button data-retry class="btn btn-secondary">${ico('refresh-cw')} Try again</button><a href="${buildUrl('/')}" class="btn btn-ghost">Home</a>` }));
}

// ═══════════════════════════════════════════════════════════════
// APP SHELL (sidebar + page)
// ═══════════════════════════════════════════════════════════════
// Canvas-style layout: a global navigation rail, an optional context menu (course/admin/district)
// and the page. Trays (Account, Admin, Courses, Help) slide out from the rail.
const navSection = title => `<div class="nav-section">${title}</div>`;
let layoutState = { ctx: null, district: null, course: null };

const COURSE_NAV = [
  { key: 'home', label: 'Home' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'modules', label: 'Modules' },
  { key: 'grades', label: 'Grades' },
  { key: 'collaborations', label: 'Collaborations' },
  { key: 'syllabus', label: 'Syllabus' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'discussions', label: 'Discussions' },
  { key: 'pages', label: 'Pages' },
  { key: 'files', label: 'Files' },
  { key: 'quizzes', label: 'Quizzes' },
  { key: 'conferences', label: 'Conferences' },
  { key: 'outcomes', label: 'Outcomes' },
  { key: 'people', label: 'People' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'settings', label: 'Settings', staffOnly: true },
];
const MOVABLE_NAV = COURSE_NAV.filter(n => n.key !== 'home' && n.key !== 'settings');
function orderedCourseNav(course) {
  const order = Array.isArray(course?.navOrder) ? course.navOrder : [];
  const rank = n => { const i = order.indexOf(n.key); return i >= 0 ? i : 100 + MOVABLE_NAV.indexOf(n); };
  return [...MOVABLE_NAV].sort((a, b) => rank(a) - rank(b));
}
// Home is always first and Settings always last, as in Canvas. Hidden items stay visible (dimmed) for teachers.
function courseNavItems(ctx, course) {
  const hidden = new Set(course.navHidden || []);
  return [COURSE_NAV[0], ...orderedCourseNav(course), COURSE_NAV[COURSE_NAV.length - 1]]
    .filter(n => !n.staffOnly || ctx.teacherMode)
    .filter(n => ctx.teacherMode || !hidden.has(n.key))
    .map(n => ({ ...n, hidden: hidden.has(n.key) }));
}

const inbox = { key: null, unsub: null, count: 0 };
function stopInbox() { try { inbox.unsub?.(); } catch (e) {} Object.assign(inbox, { key: null, unsub: null, count: 0 }); }
function watchInbox(ctx) {
  const key = `${ctx.slug}|${ctx.me.uid}`;
  if (inbox.key === key) return;
  stopInbox();
  inbox.key = key;
  inbox.unsub = onSnapshot(query(collection(db, 'tenants', ctx.slug, 'conversations'), where('participants', 'array-contains', ctx.me.uid)), snap => {
    inbox.count = snap.docs.filter(d => !(d.data().readBy || []).includes(ctx.me.uid)).length;
    $$('[data-inbox-badge]').forEach(b => { b.textContent = inbox.count > 99 ? '99+' : String(inbox.count); b.classList.toggle('hidden', !inbox.count); });
  }, () => {});
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS (top-level `notifications`: one doc per recipient, or per district for district admins)
// ═══════════════════════════════════════════════════════════════
const NOTIF_KINDS = {
  referral: ['flag', 'red', 'Discipline'], incident: ['shield-alert', 'red', 'Discipline'], request: ['clipboard-list', 'teal', 'Staff requests'],
  decision: ['circle-check', 'green', 'Staff requests'], coverage: ['hand', 'amber', 'Coverage'], plan: ['clipboard-check', 'violet', 'Lesson plans'],
  grade: ['award', 'amber', 'Grades'], attendance: ['calendar-check', 'blue', 'Attendance'], reportcard: ['file-text', 'violet', 'Report cards'],
  message: ['inbox', 'blue', 'Messages'], system: ['bell', 'muted', 'General'],
};
const notif = { key: null, unsubs: [], personal: [], district: [], ready: false, seen: new Set() };
const notifUnread = n => n.toDistrict ? !(n.readBy || []).includes(currentUser?.uid) : !n.read;
function notifItems() { return [...notif.personal, ...notif.district].sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt)); }
function stopNotifications() { notif.unsubs.splice(0).forEach(u => { try { u(); } catch (e) {} }); Object.assign(notif, { key: null, personal: [], district: [], ready: false }); notif.seen.clear(); paintNotifBadges(); }
function paintNotifBadges() {
  const n = notifItems().filter(notifUnread).length;
  $$('[data-notif-badge]').forEach(b => { b.textContent = n > 99 ? '99+' : String(n); b.classList.toggle('hidden', !n); });
  if (trayEl?.dataset.kind === 'notifications') { const body = trayEl.querySelector('[data-tray-body]'); if (body) { body.innerHTML = notifTrayHTML(); refreshIcons(); } }
  document.dispatchEvent(new CustomEvent('ember:notifications'));
}
// Listens for the signed-in user's notifications (and their district's, for district admins) across every page.
function watchNotifications() {
  const uid = currentUser?.uid;
  if (!uid) return stopNotifications();
  const districtId = ls(`ember_district:${uid}`) || '';
  const key = `${uid}|${districtId}`;
  if (notif.key === key) return;
  stopNotifications();
  notif.key = key;
  const onSnap = which => snap => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (notif.ready) items.filter(n => !notif.seen.has(n.id) && notifUnread(n)).slice(0, 3).forEach(n => toast(n.title, 'info'));
    items.forEach(n => notif.seen.add(n.id));
    notif[which] = items;
    paintNotifBadges();
  };
  notif.unsubs.push(onSnapshot(query(collection(db, 'notifications'), where('toUid', '==', uid)), onSnap('personal'), e => console.warn('notifications', e.code || e)));
  if (districtId) notif.unsubs.push(onSnapshot(query(collection(db, 'notifications'), where('toDistrict', '==', districtId)), onSnap('district'), e => console.warn('district notifications', e.code || e)));
  setTimeout(() => { if (notif.key === key) notif.ready = true; }, 2500);
}
async function markNotifRead(n) {
  if (!notifUnread(n)) return;
  const ref = doc(db, 'notifications', n.id);
  try { await updateDoc(ref, n.toDistrict ? { readBy: arrayUnion(currentUser.uid) } : { read: true }); } catch (e) { console.warn(e); }
}
async function markAllNotifsRead() { await Promise.all(notifItems().filter(notifUnread).map(markNotifRead)); }
function notifRow(n, { compact = false } = {}) {
  const [icon, tone, label] = NOTIF_KINDS[n.kind] || NOTIF_KINDS.system;
  const unread = notifUnread(n);
  return `<a href="${n.link ? buildUrl(n.link) : '#'}" data-notif="${escapeHtml(n.id)}" class="notif-row ${unread ? 'is-unread' : ''} flex items-start gap-3 ${compact ? 'px-3 py-3 -mx-3' : 'px-5 py-4'} rounded-lg hover:bg-white/[0.04] transition-colors">
    ${iconTile(icon, tone)}
    <span class="flex-1 min-w-0"><span class="flex items-start gap-2"><span class="text-sm ${unread ? 'text-white font-medium' : 'text-gray-300'} ${compact ? 'line-clamp-2' : ''}">${escapeHtml(n.title || '')}</span>${unread ? '<span class="w-2 h-2 mt-1.5 rounded-full bg-[#F59E0B] shrink-0 ml-auto" aria-label="unread"></span>' : ''}</span>
      ${n.body ? `<span class="block text-xs text-gray-400 mt-0.5 ${compact ? 'line-clamp-2' : ''}">${escapeHtml(n.body)}</span>` : ''}
      <span class="block text-[11px] text-gray-500 mt-1">${escapeHtml(label)}${n.fromName ? ' · ' + escapeHtml(n.fromName) : ''} · ${escapeHtml(timeAgo(n.createdAt))}</span></span></a>`;
}
function notifCenterHref() {
  const { ctx, district } = layoutState;
  return ctx ? `/${ctx.slug}/notifications` : district ? `/district/${district.id}/notifications` : null;
}
function notifTrayHTML() {
  const items = notifItems().slice(0, 12), unread = notifItems().filter(notifUnread).length, href = notifCenterHref();
  return `<div class="flex items-center justify-between mb-3"><span class="text-xs text-gray-500">${unread ? `${unread} unread` : 'All caught up'}</span>${unread ? `<button data-notif-readall class="text-xs text-[#F59E0B] hover:underline">Mark all as read</button>` : ''}</div>
    ${items.length ? `<div class="space-y-1">${items.map(n => notifRow(n, { compact: true })).join('')}</div>` : `<div class="text-center py-10">${ico('bell-off', 'w-8 h-8 text-gray-600 mx-auto mb-3')}<p class="text-sm text-gray-400">No notifications yet.</p><p class="text-xs text-gray-600 mt-1">Referrals, requests, grades and other updates will show up here.</p></div>`}
    ${href ? `<a href="${buildUrl(href)}" class="btn btn-secondary btn-block mt-5">Open notification center</a>` : ''}`;
}
// Send one notification per recipient (never to yourself). `toDistrict` reaches every admin of a district.
async function notify(ctx, { to = [], toDistrict = null, kind = 'system', title, body = '', link = '' }) {
  const base = { tenantId: ctx.slug, kind, title: String(title).slice(0, 140), body: String(body || '').slice(0, 400), link, fromUid: currentUser.uid, fromName: ctx.me?.name || '', createdAt: serverTimestamp() };
  const uids = [...new Set(to.filter(u => u && u !== currentUser.uid))];
  const jobs = uids.map(u => addDoc(collection(db, 'notifications'), { ...base, toUid: u, read: false }));
  if (toDistrict) jobs.push(addDoc(collection(db, 'notifications'), { ...base, toDistrict, readBy: [] }));
  const res = await Promise.allSettled(jobs);
  res.filter(r => r.status === 'rejected').forEach(r => console.warn('notify failed', r.reason));
}
// Recipient lookups
async function officeStaffUids(ctx, cap = null) {
  const snap = await getDocs(collection(db, 'tenants', ctx.slug, 'users'));
  return snap.docs.filter(d => d.data().role === 'admin' || (cap && (d.data().caps || []).includes(cap))).map(d => d.id);
}
async function guardianUidsOf(ctx, sids) {
  const out = new Set();
  await Promise.all(sids.map(async sid => { try { (await getDocs(query(collection(db, 'tenants', ctx.slug, 'guardianLinks'), where('studentUid', '==', sid)))).docs.forEach(d => out.add(d.data().guardianUid)); } catch (e) {} }));
  return [...out];
}

function globalNavHTML(active) {
  const { ctx, district } = layoutState;
  const accent = district ? 'violet' : 'amber';
  const home = ctx ? `/${ctx.slug}` : district ? `/district/${district.id}` : '/';
  const uname = ctx?.me.name || currentUser?.displayName || currentUser?.email || 'User';
  const cur = key => active === key ? 'aria-current="page"' : '';
  const link = (key, icon, label, href, extra = '') => `<a href="${buildUrl(href)}" class="gnav-item" ${cur(key)}>${ico(icon)}<span>${label}</span>${extra}</a>`;
  const tray = (key, iconHtml, label) => `<button type="button" class="gnav-item" data-tray="${key}" aria-expanded="false" aria-haspopup="dialog" ${cur(key)}>${iconHtml}<span>${label}</span></button>`;
  return `<nav class="gnav accent-${accent}" aria-label="Global navigation">
    <a href="${buildUrl(home)}" class="gnav-logo" aria-label="${APP_NAME} dashboard">${ico('flame', 'w-8 h-8 ' + (district ? 'text-[#8B5CF6]' : 'text-[#F59E0B]'))}</a>
    ${tray('account', `<span class="gnav-avatar">${avatar(uname, currentUser?.photoURL, 'w-7 h-7', 'text-[10px]')}</span>`, 'Account')}
    ${district ? tray('admin', ico('shield-check'), 'Admin') : ''}
    ${ctx?.isRealTeacher ? link('school', ctx.isAdmin ? 'shield-check' : 'clipboard-list', schoolHome(ctx).label, home + schoolHome(ctx).path) : ''}
    ${link('dashboard', 'layout-dashboard', 'Dashboard', home)}
    ${ctx?.isStudent ? link('access', 'id-card', 'My Info', `${home}/record/me`) : ''}
    ${ctx?.isGuardian && (ctx.children || []).length ? link('access', 'id-card', 'Family Access', `${home}/record/${ctx.children[0].uid}`) : ''}
    ${ctx && !ctx.isGuardian ? tray('courses', ico('book-open'), 'Courses') : ''}
    ${ctx ? link('calendar', 'calendar-days', 'Calendar', `${home}/calendar`) : ''}
    ${ctx ? link('inbox', 'inbox', 'Inbox', `${home}/inbox`, `<span class="gnav-badge ${inbox.count ? '' : 'hidden'}" data-inbox-badge aria-label="unread conversations">${inbox.count > 99 ? '99+' : inbox.count}</span>`) : ''}
    ${ctx?.isRealTeacher ? link('commons', 'library', 'Commons', `${home}/commons`) : ''}
    ${currentUser ? tray('notifications', `<span class="relative inline-flex">${ico('bell')}<span class="gnav-badge ${notifItems().some(notifUnread) ? '' : 'hidden'}" data-notif-badge aria-label="unread notifications">${notifItems().filter(notifUnread).length}</span></span>`, 'Alerts') : ''}
    ${tray('help', ico('circle-help'), 'Help')}
  </nav>`;
}
function subnavHTML({ eyebrow = '', title, items, accent = 'amber' }) {
  return `<nav class="subnav accent-${accent}" aria-label="${escapeHtml(title)} navigation">
    ${eyebrow ? `<div class="text-[10px] text-gray-500 uppercase tracking-widest px-3 mb-1 truncate">${eyebrow}</div>` : ''}
    <div class="text-white text-sm font-medium px-3 mb-4 line-clamp-2" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
    <div class="space-y-0.5">${items.map(i => i.section ? navSection(i.section) : `
      <a href="${i.href}" class="subnav-link ${i.hidden ? 'is-hidden' : ''}" ${i.active ? 'aria-current="page"' : ''}>
        ${i.icon ? ico(i.icon, 'w-4 h-4 shrink-0 opacity-70') : ''}<span class="min-w-0 leading-snug">${escapeHtml(i.label)}</span>
        ${i.hidden ? `<span class="ml-auto" title="Hidden from students">${ico('eye-off', 'w-3.5 h-3.5')}</span>` : ''}
        ${i.soon ? '<span class="soon">Soon</span>' : ''}
      </a>`).join('')}</div>
  </nav>`;
}
function appShell({ active = '', subnav = '', crumbs = [], accent = 'amber', banner = '', content }) {
  const link = accent === 'violet' ? 'text-[#A78BFA]' : 'text-[#F59E0B]';
  const crumbHtml = crumbs.length ? `<div class="hidden lg:flex items-center gap-3 h-14 px-6 border-b border-white/[0.06] shrink-0 text-sm">
      ${subnav ? `<button class="btn-icon -ml-2" data-subnav-toggle aria-label="Show or hide the menu">${ico('menu', 'w-5 h-5')}</button>` : ''}
      <ol class="flex items-center gap-2 min-w-0" aria-label="Breadcrumb">${crumbs.map((c, i) => `<li class="flex items-center gap-2 min-w-0">${i ? ico('chevron-right', 'w-3.5 h-3.5 text-gray-600 shrink-0') : ''}${c.href && i < crumbs.length - 1 ? `<a href="${c.href}" class="${link} hover:underline truncate">${escapeHtml(c.label)}</a>` : `<span class="text-gray-300 truncate" aria-current="page">${escapeHtml(c.label)}</span>`}</li>`).join('')}</ol>
    </div>` : '';
  const mobileTitle = crumbs.length ? crumbs[crumbs.length - 1].label : '';
  return `<div class="flex h-[100dvh] overflow-hidden">
    <div class="drawer-backdrop" data-sidebar-close></div>
    <div id="drawer" class="drawer">${globalNavHTML(active)}${subnav}</div>
    <div class="flex-1 min-w-0 flex flex-col">
      <div class="lg:hidden flex items-center gap-3 px-4 h-14 shrink-0 bg-[#0A0A0A]/95 backdrop-blur border-b border-white/[0.06] z-30">
        <button class="btn-icon -ml-1.5" data-sidebar-open aria-label="Open menu">${ico('menu', 'w-5 h-5')}</button>
        ${mobileTitle ? `<span class="text-sm text-white truncate">${escapeHtml(mobileTitle)}</span>` : logo({ accent })}
      </div>
      ${crumbHtml}
      ${banner}
      <main id="main" class="flex-1 overflow-y-auto relative ${crumbs.length ? 'has-crumbs' : ''}" tabindex="-1">
        <div class="page-glow ${accent}"></div>
        <div class="relative z-10 px-4 sm:px-8 py-6 sm:py-8 pb-16 view-enter">${content}</div>
      </main>
    </div>
  </div>`;
}

// ── Trays ──────────────────────────────────────────────────────
let trayEl = null;
function closeTray() {
  if (!trayEl) return;
  trayEl.remove(); trayEl = null;
  $$('[data-tray][aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
async function openTray(kind) {
  const same = trayEl?.dataset.kind === kind;
  closeTray();
  if (same) return;
  const titles = { account: 'Account', admin: 'Admin', office: 'Office', staff: 'Staff Hub', courses: 'Courses', help: 'Help', notifications: 'Notifications' };
  const wrap = document.createElement('div');
  wrap.dataset.kind = kind;
  wrap.innerHTML = `<div class="tray-backdrop" data-tray-close></div>
    <div class="tray" role="dialog" aria-modal="false" aria-label="${titles[kind]}">
      <div class="flex items-center justify-between px-6 pt-6 pb-3"><h2 class="font-serif text-2xl text-white">${titles[kind]}</h2><button class="btn-icon -mr-2" data-tray-close aria-label="Close">${ico('x', 'w-5 h-5')}</button></div>
      <div class="px-6 pb-10" data-tray-body>${spinner('py-10')}</div>
    </div>`;
  document.body.appendChild(wrap);
  trayEl = wrap;
  $$(`[data-tray="${kind}"]`).forEach(b => b.setAttribute('aria-expanded', 'true'));
  refreshIcons();
  wrap.addEventListener('click', e => {
    if (e.target.closest('[data-tray-close]')) return closeTray();
    if (e.target.closest('a[href]')) setTimeout(closeTray);
  });
  const body = wrap.querySelector('[data-tray-body]');
  const fill = html => { if (trayEl === wrap) { body.innerHTML = html; refreshIcons(); } };
  try {
    if (kind === 'account') fill(await accountTrayHTML());
    else if (kind === 'admin') fill(adminTrayHTML());
    else if (kind === 'notifications') fill(notifTrayHTML());
    else if (kind === 'courses') fill(await coursesTrayHTML());
    else if (kind === 'help') fill(helpTrayHTML());
  } catch (e) { console.error(e); fill(errorBox(e)); }
  setTimeout(() => wrap.querySelector('.tray a, .tray button:not([data-tray-close])')?.focus(), 30);
}
const trayLink = (href, icon, label, sub = '') => `<a href="${href}" class="flex items-center gap-3 px-3 py-2.5 -mx-3 rounded-lg hover:bg-white/[0.05] transition-colors">${ico(icon, 'w-4 h-4 text-gray-500 shrink-0')}<span class="min-w-0"><span class="block text-sm text-white truncate">${label}</span>${sub ? `<span class="block text-[11px] text-gray-500 truncate">${sub}</span>` : ''}</span></a>`;
const trayButton = (attr, icon, label) => `<button type="button" ${attr} class="w-full flex items-center gap-3 px-3 py-2.5 -mx-3 rounded-lg hover:bg-white/[0.05] transition-colors text-left">${ico(icon, 'w-4 h-4 text-gray-500 shrink-0')}<span class="text-sm text-white">${label}</span></button>`;

async function accountTrayHTML() {
  const { ctx, district } = layoutState;
  const name = ctx?.me.name || currentUser.displayName || currentUser.email || 'User';
  const sub = ctx?.isStudent ? (ctx.roleInfo.data?.username || '') : (currentUser.email || '');
  const role = ctx ? (ctx.isRealTeacher ? (ctx.isAdmin ? (ctx.isPersonal ? 'Owner' : 'Admin') : 'Teacher') : ctx.isGuardian ? 'Parent/guardian' : 'Student') : (district ? 'District admin' : '');
  let switcher = '';
  if (ctx) {
    try {
      const ix = await getDoc(doc(db, 'userIndex', currentUser.uid));
      const others = (ix.data()?.tenants || []).filter(s => s !== ctx.slug);
      if (others.length) switcher = navSection('Switch school') + others.map(s => trayLink(buildUrl('/' + s), 'repeat', escapeHtml(s))).join('');
    } catch (e) {}
  }
  const base = ctx ? `/${ctx.slug}` : '';
  return `<div class="flex items-center gap-4 mb-5">${avatar(name, currentUser.photoURL, 'w-14 h-14', 'text-base')}
      <div class="min-w-0"><div class="text-white font-medium truncate">${escapeHtml(name)}</div><div class="text-xs text-gray-500 truncate font-mono">${escapeHtml(sub)}</div>${role ? `<div class="mt-1">${badge(role, 'muted')}</div>` : ''}</div></div>
    <button data-signout class="btn btn-secondary btn-block mb-6">${ico('log-out')} Log out</button>
    <div class="space-y-0.5">
      ${ctx && !ctx.isGuardian ? trayButton('data-profile', 'user-pen', 'Profile') : ''}
      ${ctx ? trayLink(buildUrl(`${base}/inbox`), 'inbox', 'Inbox') : ''}
      ${ctx && !ctx.isGuardian ? trayLink(buildUrl(`${base}/courses`), 'book-open', 'All courses') : ''}
      ${ctx ? trayLink(buildUrl(`${base}/announcements`), 'megaphone', ctx.isPersonal ? 'Classroom announcements' : 'School announcements') : ''}
      ${ctx?.isRealTeacher && !ctx.isPersonal ? trayLink(buildUrl(`${base}/planning`), 'notebook-pen', 'My lesson plans') : ''}
      ${ctx?.isRealTeacher && !ctx.isAdmin ? trayLink(buildUrl(`${base}/students`), 'users', 'Student accounts') : ''}
      ${ctx?.isRealTeacher ? trayButton('data-concern', 'flag', 'Report a student concern') : ''}
    </div>
    ${ctx?.isStudent ? navSection('My records') + [['schedule', 'calendar-range', 'Schedule'], ['attendance', 'calendar-check', 'Attendance'], ['reportcards', 'file-text', 'Report cards'], ['discipline', 'shield', 'Discipline'], ['career', 'compass', 'Career plan']].map(([k, i, l]) => trayLink(buildUrl(`${base}/record/me/${k}`), i, l)).join('') : ''}
    ${ctx?.isGuardian ? navSection('My students') + (ctx.children || []).map(k => trayLink(buildUrl(`${base}/record/${k.uid}`), 'user', escapeHtml(displayNameOf(k)), k.gradeLevel ? `Grade ${escapeHtml(k.gradeLevel)}` : '')).join('') + trayButton('data-add-child', 'user-plus', 'Add a student') : ''}
    ${ctx ? trayLink(buildUrl(`${base}/activities`), 'trophy', 'Activities') : ''}
    ${switcher}`;
}
function adminTrayHTML() {
  const { ctx, district } = layoutState;
  if (district) {
    const p = s => buildUrl(`/district/${district.id}${s}`);
    return `<p class="label">${escapeHtml(district.name || district.id)}</p>
      ${trayLink(p(''), 'layout-dashboard', 'District dashboard')}${trayLink(p('/schools'), 'building-2', 'Schools')}
      ${navSection('Student information')}${trayLink(p('/students'), 'graduation-cap', 'Students')}${trayLink(p('/attendance'), 'calendar-check', 'Attendance')}${trayLink(p('/safety'), 'shield-alert', 'Safety')}
      ${navSection('Staff')}${trayLink(p('/teachers'), 'users', 'Teachers')}${trayLink(p('/planning'), 'clipboard-check', 'Lesson plans')}`;
  }
  return '';
}
async function coursesTrayHTML() {
  const { ctx } = layoutState;
  const courses = await myCourses(ctx);
  const favs = getFavs(ctx);
  const sorted = [...courses].sort((a, b) => (favs.includes(b.id) - favs.includes(a.id)) || (a.title || '').localeCompare(b.title || ''));
  return `<a href="${buildUrl(`/${ctx.slug}/courses`)}" class="text-sm text-[#F59E0B] hover:underline">All courses</a>
    <div class="mt-4 space-y-1">${sorted.length ? sorted.map(c => `<a href="${cHref(ctx, c.id)}" class="flex items-start gap-3 px-3 py-2.5 -mx-3 rounded-lg hover:bg-white/[0.05] transition-colors">
        <span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style="background:${courseHex(c)}"></span>
        <span class="min-w-0 flex-1"><span class="block text-sm text-white truncate">${escapeHtml(c.title || 'Untitled')}</span><span class="block text-[11px] text-gray-500 truncate">${escapeHtml([c.code, c.term].filter(Boolean).join(' · '))}</span></span>
        ${favs.includes(c.id) ? ico('star', 'w-3.5 h-3.5 text-[#F59E0B] fill-current mt-1 shrink-0') : ''}
      </a>`).join('') : `<p class="text-sm text-gray-500">${ctx.isRealTeacher ? 'No courses yet — create one from your dashboard.' : "You aren't enrolled in any courses yet."}</p>`}</div>`;
}
function helpTrayHTML() {
  const { ctx } = layoutState;
  return `<div class="space-y-0.5">
    ${ctx?.isStudent ? trayButton('data-help="ask"', 'message-circle-question', 'Ask your instructor a question') : ''}
    ${trayButton('data-help="guides"', 'book-open-check', 'Search the help guides')}
    ${trayButton('data-help="shortcuts"', 'keyboard', 'Keyboard shortcuts')}
    ${ctx ? trayButton('data-help="report"', 'bug', 'Report a problem') : ''}
  </div>
  <p class="hint mt-8">${APP_NAME} · press <kbd class="kbd">?</kbd> anywhere to open this menu.</p>`;
}
function pageHeader({ eyebrow = '', title, subtitle = '', actions = '', back = null, lead = '', accent = 'amber' }) {
  const ac = accent === 'violet' ? 'text-[#8B5CF6]' : 'text-[#F59E0B]';
  return `<header class="mb-6 sm:mb-8 max-w-6xl">
    ${back ? `<a href="${buildUrl(back.href)}" data-back-link class="text-xs text-gray-500 hover:text-white transition-colors inline-flex items-center gap-1 mb-4">${ico('arrow-left', 'w-3 h-3')} ${escapeHtml(back.label || 'Back')}</a>` : ''}
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div class="flex items-center gap-4 min-w-0">
        ${lead}
        <div class="min-w-0">
          ${eyebrow ? `<p class="text-[11px] ${ac} uppercase tracking-[0.18em] mb-1.5 truncate">${eyebrow}</p>` : ''}
          <h1 class="font-serif text-3xl sm:text-4xl text-white leading-tight break-words">${title}</h1>
          ${subtitle ? `<p class="text-sm text-gray-500 mt-1.5">${subtitle}</p>` : ''}
        </div>
      </div>
      ${actions ? `<div class="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">${actions}</div>` : ''}
    </div>
  </header>`;
}
function previewBanner() {
  return viewAsStudent ? `<div class="relative z-20 bg-[#F59E0B]/10 border-b border-[#F59E0B]/20 px-4 sm:px-8 py-2.5 flex items-center justify-between gap-3 text-xs shrink-0">
    <div class="flex items-center gap-2 text-[#F59E0B]">${ico('eye', 'w-3.5 h-3.5')} <span class="font-medium">Previewing as a student</span><span class="hidden sm:inline text-[#F59E0B]/70">— editing tools are hidden</span></div>
    <button data-exit-preview class="text-[#F59E0B] hover:text-white font-medium transition-colors">Exit preview</button>
  </div>` : '';
}
const previewToggle = ctx => ctx.isRealTeacher
  ? `<button data-toggle-preview class="btn btn-secondary">${ico(viewAsStudent ? 'eye-off' : 'eye')} ${viewAsStudent ? 'Exit preview' : 'Student view'}</button>` : '';

// ═══════════════════════════════════════════════════════════════
// DISTRICT
// ═══════════════════════════════════════════════════════════════
async function viewDistrict(districtId, segs = []) {
  if (!districtId) return viewNotFound();
  if (!currentUser) return navigate(`/login?next=${encodeURIComponent(currentAppPath())}`, { replace: true });
  const t = routeToken;
  render(loadingScreen());
  let dSnap = null;
  try { dSnap = await getDoc(doc(db, 'districts', districtId)); }
  catch (e) { if (!isPermErr(e)) throw e; } // the rules hide districts you don't administer
  if (!live(t)) return;
  const district = dSnap?.exists() ? { id: dSnap.id, ...dSnap.data() } : null;
  if (!district || !(district.adminUids || []).includes(currentUser.uid)) {
    return render(centeredMessage({ icon: 'lock', tone: 'red', title: 'Access denied', text: "You aren't a district administrator for this district.", actions: `<button data-signout class="btn btn-secondary">Switch account</button>` }));
  }
  ls(`ember_district:${currentUser.uid}`, districtId);
  watchNotifications();
  const dctx = { districtId, district, t };
  const sub = segs[0] || 'overview';
  if (sub === 'schools') return viewDistrictSchools(dctx);
  if (sub === 'teachers') return viewDistrictTeachers(dctx);
  if (sub === 'planning') return viewDistrictPlanning(dctx);
  const sis = await import('./sis.js' + BUILD);
  if (!live(t)) return;
  if (sub === 'attendance') return sis.viewDistrictAttendance(dctx);
  if (sub === 'students') return sis.viewDistrictStudents(dctx);
  if (sub === 'safety') return sis.viewDistrictSafety(dctx);
  if (sub === 'notifications') return (await import('./staff.js' + BUILD)).viewDistrictNotifications(dctx);
  return sis.viewDistrictHome(dctx);
}
function districtShell({ districtId, district }, active, header, body) {
  layoutState = { ctx: null, district: { id: districtId, ...district }, course: null };
  const p = s => buildUrl(`/district/${districtId}${s}`);
  const labels = { overview: 'Dashboard', schools: 'Schools', teachers: 'Teachers', planning: 'Lesson plans', attendance: 'Attendance', students: 'Students', safety: 'Safety', notifications: 'Notifications' };
  const subnav = subnavHTML({
    accent: 'violet', eyebrow: 'District', title: district.name || districtId, items: [
      { href: p(''), label: 'Dashboard', active: active === 'overview' }, { href: p('/schools'), label: 'Schools', active: active === 'schools' },
      { section: 'Student information' },
      { href: p('/students'), label: 'Students', active: active === 'students' }, { href: p('/attendance'), label: 'Attendance', active: active === 'attendance' },
      { href: p('/safety'), label: 'Safety', active: active === 'safety' },
      { section: 'Staff' },
      { href: p('/teachers'), label: 'Teachers', active: active === 'teachers' }, { href: p('/planning'), label: 'Lesson plans', active: active === 'planning' },
    ]
  });
  return appShell({
    accent: 'violet', active: active === 'overview' ? 'dashboard' : 'admin', subnav,
    crumbs: [{ label: district.name || districtId, href: p('') }, { label: labels[active] }],
    content: pageHeader({ accent: 'violet', ...header }) + body
  });
}
async function getDistrictSchools(districtId) {
  const snap = await getDocs(query(collection(db, 'tenants'), where('districtId', '==', districtId)));
  const schools = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  await Promise.all(schools.map(async s => {
    [s._teacherCount, s._studentCount, s._courseCount] = await Promise.all([
      countOf(collection(db, 'tenants', s.id, 'users')),
      countOf(query(collection(db, 'tenants', s.id, 'students'), where('status', '==', 'approved'))),
      countOf(collection(db, 'tenants', s.id, 'courses')),
    ]);
  }));
  return schools.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}
function schoolsTable(schools) {
  return dataTable(
    [{ label: 'School', cls: 'col-span-12 sm:col-span-5' }, { label: 'Teachers', cls: 'col-span-4 sm:col-span-2' }, { label: 'Students', cls: 'col-span-4 sm:col-span-2' }, { label: 'Courses', cls: 'col-span-3 sm:col-span-2' }, { label: '', cls: 'col-span-1 text-right' }],
    schools.map(s => ({
      cells: [
        `<a href="${buildUrl('/' + s.id + '/admin')}" class="flex items-center gap-3 group/link"><div class="tile tile-violet text-[10px] font-mono">${escapeHtml((s.id).slice(0, 3).toUpperCase())}</div><div class="min-w-0"><div class="text-sm text-white truncate group-hover/link:text-[#A78BFA] transition-colors">${escapeHtml(s.name || s.id)}</div><div class="text-xs text-gray-500 font-mono truncate">/${escapeHtml(s.id)}</div></div></a>`,
        `<span class="text-xs text-gray-400"><span class="sm:hidden text-gray-600">Teachers </span>${s._teacherCount}</span>`,
        `<span class="text-xs text-gray-400"><span class="sm:hidden text-gray-600">Students </span>${s._studentCount}</span>`,
        `<span class="text-xs text-gray-400"><span class="sm:hidden text-gray-600">Courses </span>${s._courseCount}</span>`,
        `<a href="${buildUrl('/' + s.id + '/admin')}" class="btn-icon" aria-label="Open ${escapeHtml(s.name || s.id)}">${ico('chevron-right')}</a>`
      ]
    }))
  );
}
async function viewDistrictSchools(dctx) {
  const { districtId, district, t } = dctx;
  setTitle('Schools', district.name);
  render(districtShell(dctx, 'schools',
    { eyebrow: escapeHtml(district.name || districtId), title: 'Schools', actions: `<button data-create-school class="btn btn-violet">${ico('plus')} New school</button>` },
    `<div id="schools-list" class="max-w-6xl">${skeletonRows(5)}</div>`));
  try {
    const schools = await getDistrictSchools(districtId);
    if (!live(t)) return;
    $('#schools-list').innerHTML = schools.length ? schoolsTable(schools) : emptyState({ icon: 'building-2', tone: 'violet', title: 'No schools yet', action: `<button data-create-school class="btn btn-violet">${ico('plus')} Create first school</button>` });
    refreshIcons();
  } catch (e) { console.error(e); if (live(t)) { $('#schools-list').innerHTML = errorBox(e); refreshIcons(); } }
}
async function viewDistrictTeachers(dctx) {
  const { districtId, district, t } = dctx;
  setTitle('Teachers', district.name);
  render(districtShell(dctx, 'teachers',
    { eyebrow: escapeHtml(district.name || districtId), title: 'Teachers', subtitle: 'Everyone teaching across the district.', actions: `<div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">${ico('search', 'w-3.5 h-3.5')}</span><input id="teacher-filter" type="search" placeholder="Filter…" class="input !py-2 pl-9 w-48" aria-label="Filter teachers"></div>` },
    `<div id="teachers-list" class="max-w-6xl">${skeletonRows(6)}</div>`));
  try {
    const snap = await getDocs(query(collection(db, 'tenants'), where('districtId', '==', districtId)));
    const all = [];
    await Promise.all(snap.docs.map(async s => {
      try { (await getDocs(collection(db, 'tenants', s.id, 'users'))).docs.forEach(d => all.push({ uid: d.id, ...d.data(), _schoolId: s.id, _schoolName: s.data().name || s.id })); } catch (e) {}
    }));
    if (!live(t)) return;
    all.sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
    const el = $('#teachers-list');
    const draw = (f = '') => {
      const list = all.filter(x => !f || `${displayNameOf(x)} ${x.email} ${x._schoolName}`.toLowerCase().includes(f));
      el.innerHTML = !all.length ? emptyState({ icon: 'users', tone: 'violet', title: 'No teachers yet', text: 'Teachers appear here once they join a school with its join code.' })
        : !list.length ? `<p class="text-sm text-gray-500 py-8 text-center">No teachers match “${escapeHtml(f)}”.</p>`
        : dataTable(
          [{ label: 'Teacher', cls: 'col-span-12 sm:col-span-5' }, { label: 'School', cls: 'col-span-8 sm:col-span-5' }, { label: 'Role', cls: 'col-span-4 sm:col-span-2 text-right sm:text-left' }],
          list.map(x => ({
            cells: [
              `<div class="flex items-center gap-3">${avatar(displayNameOf(x), x.photoURL)}<div class="min-w-0"><div class="text-sm text-white truncate">${escapeHtml(displayNameOf(x))}</div><div class="text-xs text-gray-500 truncate">${escapeHtml(x.email || '')}</div></div></div>`,
              `<a href="${buildUrl('/' + x._schoolId + '/admin/teachers')}" class="text-sm text-gray-300 hover:text-[#A78BFA] transition-colors truncate block">${escapeHtml(x._schoolName)}</a>`,
              x.role === 'admin' ? badge('Admin', 'violet') : badge('Teacher')
            ]
          })));
      refreshIcons();
    };
    draw();
    $('#teacher-filter').addEventListener('input', e => draw(e.target.value.trim().toLowerCase()));
  } catch (e) { console.error(e); if (live(t)) { $('#teachers-list').innerHTML = errorBox(e); refreshIcons(); } }
}
async function viewDistrictPlanning(dctx) {
  const { districtId, district, t } = dctx;
  setTitle('Lesson plans', district.name);
  render(districtShell(dctx, 'planning',
    { eyebrow: escapeHtml(district.name || districtId), title: 'Lesson plans', subtitle: 'Submitted plans across every school.' },
    `<div class="max-w-6xl"><div id="plan-filters" class="mb-4"></div><div id="plans-list">${skeletonRows(5)}</div></div>`));
  try {
    const snap = await getDocs(query(collection(db, 'tenants'), where('districtId', '==', districtId)));
    const all = [];
    await Promise.all(snap.docs.map(async s => {
      try { (await getDocs(collection(db, 'tenants', s.id, 'plans'))).docs.forEach(d => all.push({ id: d.id, ...d.data(), _schoolId: s.id, _schoolName: s.data().name || s.id })); } catch (e) {}
    }));
    if (!live(t)) return;
    all.sort((a, b) => recency(b.updatedAt) - recency(a.updatedAt));
    mountPlanList(all, { mode: 'district', defaultFilter: 'submitted', onReview: p => openPlanReviewModal(p._schoolId, p, () => renderRoute()) });
  } catch (e) { console.error(e); if (live(t)) { $('#plans-list').innerHTML = errorBox(e); refreshIcons(); } }
}
function openCreateSchoolModal(districtId, district) {
  const m = openModal({
    html: modalHeader({ title: 'New school', subtitle: `Add a school to ${escapeHtml(district.name || districtId)}.`, icon: 'building-2', tone: 'violet' }) + `
    <form novalidate>
      ${modalBody(`
        <label for="school-name" class="label">School name</label>
        <input id="school-name" type="text" placeholder="Lincoln High School" autocomplete="off" class="input mb-4" />
        <label for="school-slug" class="label">Web address</label>
        <div class="flex items-center input !p-0 focus-within:border-[#8B5CF6]">
          <span class="text-gray-500 text-xs pl-4 select-none whitespace-nowrap">${escapeHtml(BASE_PATH)}/</span>
          <input id="school-slug" type="text" placeholder="lincoln-high" autocomplete="off" autocapitalize="none" class="flex-1 min-w-0 bg-transparent px-1 py-3 pr-4 text-white focus:outline-none" />
        </div>
        <div class="mt-4 p-3 bg-[#8B5CF6]/5 border border-[#8B5CF6]/20 rounded-lg text-xs text-gray-400 leading-relaxed">You'll become this school's admin, and a join code is generated for teachers.</div>
        <p id="create-error" class="form-error mt-4 hidden" role="alert"></p>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-violet flex-1">Create school</button>`)}
    </form>`
  });
  const nameEl = m.$('#school-name'), slugEl = m.$('#school-slug');
  nameEl.addEventListener('input', () => { if (!slugEl.dataset.touched) slugEl.value = slugify(nameEl.value).slice(0, 30); });
  slugEl.addEventListener('input', () => { slugEl.dataset.touched = '1'; slugEl.value = slugEl.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const name = nameEl.value.trim(), slug = slugEl.value.trim().toLowerCase();
    const err = m.$('#create-error'); showError(err, '');
    if (!name) return showError(err, 'Enter a school name.');
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) return showError(err, 'Web address must be 3–30 characters: lowercase letters, numbers, hyphens.');
    if (RESERVED.includes(slug)) return showError(err, 'That address is reserved.');
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Creating…', async () => {
      try {
        if ((await getDoc(doc(db, 'tenants', slug))).exists()) return showError(err, 'That address is already taken.');
        await setDoc(doc(db, 'tenants', slug), { type: 'school', name, slug, districtId, ownerUid: currentUser.uid, createdAt: serverTimestamp() });
        await setDoc(doc(db, 'tenants', slug, 'users', currentUser.uid), {
          userId: currentUser.uid, role: 'admin', email: currentUser.email || '',
          displayName: currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'Admin'),
          photoURL: currentUser.photoURL || null, createdAt: serverTimestamp()
        });
        await setJoinCode(slug).catch(e => console.warn('join code not created', e));
        schoolsCache = null;
        m.close(); toast(`${name} created`); renderRoute();
      } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// TENANT ROUTING
// ═══════════════════════════════════════════════════════════════
function makeCtx(slug, tenant, roleInfo) {
  const isRealTeacher = roleInfo.role === 'teacher' || roleInfo.role === 'admin';
  const caps = Array.isArray(roleInfo.data?.caps) ? roleInfo.data.caps : [];
  return {
    slug, tenant, roleInfo, isRealTeacher, caps,
    isAdmin: roleInfo.role === 'admin',
    isPersonal: tenant.type === 'personal',
    isStudent: roleInfo.role === 'student',
    isGuardian: roleInfo.role === 'guardian',
    children: [],
    // Staff capabilities granted by an admin (Admin → Teachers & staff). Admins have all of them.
    can(cap) { return roleInfo.role === 'admin' || (isRealTeacher && caps.includes(cap)); },
    get teacherMode() { return isRealTeacher && !viewAsStudent; },
    get studentView() { return !isRealTeacher || viewAsStudent; },
    me: { uid: currentUser.uid, name: roleInfo.data?.displayName || currentUser.displayName || displayNameOf(roleInfo.data) },
  };
}
// District admins can open any school in their district; the first visit adds them as a school admin
// (allowed by the users rule) so every school tool works for them.
async function joinAsDistrictAdmin(slug, tenant) {
  try {
    const d = await getDoc(doc(db, 'districts', tenant.districtId));
    if (!d.exists() || !(d.data().adminUids || []).includes(currentUser.uid)) return null;
    const data = {
      userId: currentUser.uid, role: 'admin', districtAdmin: true, email: currentUser.email || '',
      displayName: currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'District admin'),
      photoURL: currentUser.photoURL || null, createdAt: serverTimestamp()
    };
    await setDoc(doc(db, 'tenants', slug, 'users', currentUser.uid), data);
    return { role: 'admin', data };
  } catch (e) { if (!isPermErr(e)) console.warn('district admin join failed', e); return null; }
}
async function viewTenant(slug, segs) {
  const t = routeToken;
  if (!tenantCache.has(slug)) render(loadingScreen());
  const tenant = await getTenant(slug);
  if (!live(t)) return;
  if (!tenant) return viewTenantNotFound(slug);
  if (!currentUser) return navigate(`/login?school=${encodeURIComponent(slug)}&next=${encodeURIComponent(currentAppPath())}`, { replace: true });
  let roleInfo = await getRoleInTenant(slug, currentUser.uid);
  if (!live(t)) return;
  if (!roleInfo && tenant.districtId) roleInfo = await joinAsDistrictAdmin(slug, tenant);
  if (!live(t)) return;
  if (!roleInfo) return viewNoAccess(slug, tenant);
  if (roleInfo.role !== 'student' || roleInfo.data.status === 'approved') rememberTenant(currentUser.uid, slug);
  if (roleInfo.role === 'student') {
    if (roleInfo.data.status === 'pending') return viewPending(slug, tenant);
    if (roleInfo.data.status === 'rejected') return viewRejected(slug, tenant);
  }
  const ctx = makeCtx(slug, tenant, roleInfo);
  if (ctx.isGuardian) {
    try {
      const links = await getDocs(query(collection(db, 'tenants', slug, 'guardianLinks'), where('guardianUid', '==', currentUser.uid)));
      ctx.children = (await Promise.all(links.docs.map(l => getDoc(doc(db, 'tenants', slug, 'students', l.data().studentUid)).then(x => x.exists() ? { uid: x.id, ...x.data() } : null).catch(() => null)))).filter(Boolean);
    } catch (e) { console.warn(e); }
    if (!live(t)) return;
  }
  layoutState = { ctx, district: null, course: null };
  watchInbox(ctx);
  const [sub, a, b, c, d] = segs;
  const teacherOnly = fn => ctx.isRealTeacher ? fn() : viewNotFound();
  const adminOnly = fn => ctx.isAdmin ? fn() : viewNotFound();
  // If the user navigates away while sis.js is still downloading, drop this render.
  const sis = async () => { const m = await import('./sis.js' + BUILD); if (!live(t)) throw Object.assign(new Error('stale'), { stale: true }); return m; };
  const staff = async () => { const m = await import('./staff.js' + BUILD); if (!live(t)) throw Object.assign(new Error('stale'), { stale: true }); return m; };
  if (ctx.isGuardian && !['dashboard', 'record', 'activities', 'inbox', 'calendar', 'announcements', 'notifications'].includes(sub || 'dashboard')) return navigate('/' + slug, { replace: true });
  switch (sub || 'dashboard') {
    case 'dashboard': return ctx.isGuardian ? (await sis()).viewFamilyHome(ctx) : viewDashboard(ctx);
    case 'sis': return ctx.isRealTeacher ? (await sis()).viewDirectory(ctx) : viewNotFound();
    case 'record': return (await sis()).viewRecord(ctx, a || 'me', b || 'overview');
    case 'activities': return (await sis()).viewActivities(ctx, a || null);
    case 'staff': return teacherOnly(async () => (await staff()).viewStaff(ctx, a, b));
    case 'referrals': return teacherOnly(async () => (await staff()).viewReferral(ctx, a));
    case 'notifications': return (await staff()).viewNotifications(ctx);
    case 'courses': return viewAllCourses(ctx);
    case 'calendar': return viewCalendar(ctx);
    case 'inbox': return viewInbox(ctx, a || null);
    case 'commons': return teacherOnly(() => viewCommons(ctx));
    case 'pending': return navigate('/' + slug, { replace: true });
    case 'rejected': return navigate('/' + slug, { replace: true });
    case 'announcements': return viewAnnouncements(ctx);
    case 'planning': return teacherOnly(() => viewPlanning(ctx));
    case 'students': return teacherOnly(() => viewStudents(ctx));
    case 'admin':
      switch (a) {
        case 'teachers': return adminOnly(() => viewAdminTeachers(ctx));
        case 'administrators': return adminOnly(async () => (await staff()).viewAdministrators(ctx));
        case 'parents': return adminOnly(async () => (await staff()).viewParents(ctx));
        case 'students': return adminOnly(() => viewStudents(ctx));
        case 'courses': return adminOnly(() => viewAdminCourses(ctx));
        case 'planning': return adminOnly(() => viewAdminPlanning(ctx));
        // Old links from before the Office split
        case 'attendance': case 'schedule': case 'reportcards': case 'setup': case 'services':
          return navigate(`/${slug}/office/${a}${location.search}`, { replace: true });
        case 'safety': return navigate(`/${slug}/office/discipline`, { replace: true });
        default: return adminOnly(() => viewAdminOverview(ctx));
      }
    case 'office':
      if (!hasOffice(ctx)) return viewNotFound();
      switch (a) {
        case 'attendance': return ctx.isAdmin ? (await sis()).viewAttendanceOffice(ctx) : viewNotFound();
        case 'schedule': return ctx.isAdmin ? (await sis()).viewMasterSchedule(ctx) : viewNotFound();
        case 'reportcards': return ctx.isAdmin ? (await sis()).viewReportCards(ctx) : viewNotFound();
        case 'setup': return ctx.isAdmin ? (await sis()).viewSisSetup(ctx) : viewNotFound();
        case 'services': return ctx.can('services') ? (await sis()).viewServices(ctx) : viewNotFound();
        case 'discipline': return ctx.can('safety') ? (await sis()).viewIncidents(ctx) : viewNotFound();
        case 'requests': return ctx.isAdmin ? (await staff()).viewRequestQueue(ctx) : viewNotFound();
        case 'bulk': return ctx.can('records') || ctx.can('health') ? (await import('./bulk.js' + BUILD)).viewBulk(ctx) : viewNotFound();
        case 'busing': return ctx.can('records') ? (await import('./bulk.js' + BUILD)).viewBusRoutes(ctx) : viewNotFound();
        case undefined: return navigate(`/${slug}${schoolHome(ctx).path}`, { replace: true });
        default: return viewNotFound();
      }
    case 'course':
      if (!a) break;
      return viewCourseSection(ctx, a, b, c, d);
  }
  return viewNotFound();
}

function tenantPage(ctx, active, content, course = null, { crumbs: extra = [], subnav: subOverride = null, gActive: gOverride = null } = {}) {
  const base = `/${ctx.slug}`;
  let subnav = '', crumbs = [], gActive = 'dashboard';
  layoutState = { ctx, district: null, course };
  if (subOverride) {
    return appShell({ active: gOverride || 'dashboard', subnav: subnavHTML(subOverride), crumbs: extra, banner: previewBanner(), content });
  }
  if (course) {
    const navKey = { course: 'modules', roster: 'people' }[active] || active;
    const cbase = `${base}/course/${course.id}`;
    subnav = subnavHTML({
      eyebrow: escapeHtml(course.term || course.code || 'Course'), title: course.title || 'Course',
      items: courseNavItems(ctx, course).map(n => ({ href: buildUrl(n.key === 'home' ? cbase : `${cbase}/${n.key}`), label: n.label, active: n.key === navKey, hidden: n.hidden }))
    });
    const label = COURSE_NAV.find(n => n.key === navKey)?.label;
    crumbs = [{ label: course.code || course.title || 'Course', href: buildUrl(cbase) }];
    if (navKey !== 'home' && label) crumbs.push({ label, href: buildUrl(`${cbase}/${navKey}`) });
    crumbs.push(...extra);
    gActive = 'courses';
  } else {
    const hit = schoolMenuItems(ctx).find(i => i.key === active);
    if (hit) {
      const home = schoolHome(ctx);
      subnav = schoolSubnav(ctx, active);
      crumbs = [{ label: home.label, href: buildUrl(base + home.path) }, ...(hit.path === home.path ? [] : [{ label: hit.label, href: buildUrl(base + hit.path) }]), ...extra];
      gActive = 'school';
    } else {
      gActive = { dashboard: 'dashboard', calendar: 'calendar', inbox: 'inbox', commons: 'commons', 'all-courses': 'courses', notifications: 'notifications' }[active] || 'account';
    }
  }
  return appShell({ active: gActive, subnav, crumbs, banner: previewBanner(), content });
}

// ONE workspace menu for school staff. Admins see it as "Admin", teachers as "Staff Hub"; each item is
// shown only to the roles it applies to. Course pages never show it.
// Item: { key, label, path, icon, desc, show(ctx) }. Paths starting with '@' are absolute; '#concern' opens the concern modal.
const isAdminC = c => c.isAdmin, isStaffC = c => c.isRealTeacher, notPersonal = c => !c.isPersonal;
const SCHOOL_MENU = [
  { group: null, items: [
    { key: 'admin-overview', label: 'Today', path: '/admin', icon: 'layout-grid', desc: 'What needs attention right now', show: isAdminC },
    { key: 'hub-overview', label: 'Overview', path: '/staff', icon: 'layout-grid', desc: 'Your forms and their status', show: c => !c.isAdmin },
  ] },
  { group: 'People', key: 'people', items: [
    { key: 'students', label: 'Student accounts', path: '/admin/students', icon: 'graduation-cap', desc: 'Create logins, approve sign-ups', show: isAdminC },
    { key: 'sis-directory', label: 'Student records', path: '/sis', icon: 'contact', desc: 'Every student’s record', show: isStaffC },
    { key: 'admin-parents', label: 'Parents & guardians', path: '/admin/parents', icon: 'users', desc: 'Family accounts and links', show: isAdminC },
    { key: 'admin-teachers', label: 'Teachers & staff', path: '/admin/teachers', icon: 'user-cog', desc: 'Invite and manage staff', show: c => c.isAdmin && notPersonal(c) },
    { key: 'admin-admins', label: 'Administrators', path: '/admin/administrators', icon: 'shield-check', desc: 'Who can run the school', show: c => c.isAdmin && notPersonal(c) },
    { key: 'sis-bulk', label: 'Bulk student updates', path: '/office/bulk', icon: 'list-checks', desc: 'Change many students at once', show: c => c.can('records') || c.can('health') },
  ] },
  { group: 'Attendance & scheduling', key: 'att', items: [
    { key: 'sis-attendance', label: 'Attendance office', path: '/office/attendance', icon: 'calendar-check', desc: 'Daily view, trends, chronic absence', show: isAdminC },
    { key: 'sis-schedule', label: 'Master schedule', path: '/office/schedule', icon: 'calendar-range', desc: 'Periods, rooms, conflicts', show: isAdminC },
    { key: 'sis-busing', label: 'Bus routes', path: '/office/busing', icon: 'bus', desc: 'Buses, stops and rider rosters', show: c => c.can('records') && notPersonal(c) },
  ] },
  { group: 'Students', key: 'stu', items: [
    { key: 'sis-safety', label: 'Discipline & safety', path: '/office/discipline', icon: 'shield-alert', desc: 'Referrals, incidents, concerns', show: c => c.can('safety') },
    { key: 'sis-services', label: 'Special ed · 504 · ELL', path: '/office/services', icon: 'heart-handshake', desc: 'IEPs, 504 plans, English learners', show: c => c.can('services') },
    { key: 'sis-reportcards', label: 'Report cards', path: '/office/reportcards', icon: 'file-text', desc: 'Grade entry, publish, print', show: isAdminC },
    { key: 'sis-activities', label: 'Activities & clubs', path: '/activities', icon: 'trophy', desc: 'Clubs, teams, join requests', show: c => isStaffC(c) && notPersonal(c) },
  ] },
  { group: 'Learning', key: 'learn', items: [
    { key: 'admin-courses', label: 'All courses', path: '/admin/courses', icon: 'book-open', desc: 'Every course in the school', show: isAdminC },
    { key: 'admin-planning', label: 'Plan reviews', path: '/admin/planning', icon: 'clipboard-check', desc: 'Approve lesson plans', show: c => c.isAdmin && notPersonal(c) },
    { key: 'planning', label: 'My lesson plans', path: '/planning', icon: 'notebook-pen', desc: 'Write and submit plans', show: c => isStaffC(c) && notPersonal(c) },
    { key: 'announcements', label: 'School announcements', path: '/announcements', icon: 'megaphone', desc: 'Post to everyone', show: isAdminC },
  ] },
  { group: 'Forms & requests', key: 'forms', items: [
    { key: 'staff-requests', label: 'Staff requests', path: '/office/requests', icon: 'inbox', desc: 'Call-outs, subs, coverage, work orders', show: c => c.isAdmin && notPersonal(c) },
    { key: 'hub-overview', label: 'My submissions', path: '/staff', icon: 'folder-check', desc: 'Forms you have sent', show: c => c.isAdmin && notPersonal(c) },
    { key: 'hub-referral', label: 'Discipline referral', path: '/staff/new/referral', icon: 'flag', desc: 'Behavioral documentation', show: c => isStaffC(c) && notPersonal(c) },
    { key: 'hub-concern', label: 'Quick concern', path: '#concern', icon: 'message-square-warning', desc: 'A short note to the office', show: c => isStaffC(c) && notPersonal(c) },
    { key: 'hub-parentcontact', label: 'Parent contact log', path: '/staff/new/parentcontact', icon: 'phone-call', desc: 'Document family contact', show: c => isStaffC(c) && notPersonal(c) },
    { key: 'hub-callout', label: 'Call out', path: '/staff/new/callout', icon: 'phone-off', desc: 'Report an absence', show: c => isStaffC(c) && notPersonal(c) },
    { key: 'hub-sub', label: 'Request a sub', path: '/staff/new/sub', icon: 'user-round-plus', desc: 'Plan ahead for time away', show: c => isStaffC(c) && notPersonal(c) },
    { key: 'hub-coverage', label: 'Request a break', path: '/staff/new/coverage', icon: 'hand', desc: 'Classroom coverage now', show: c => isStaffC(c) && notPersonal(c) },
    { key: 'hub-maintenance', label: 'Maintenance & tech', path: '/staff/new/maintenance', icon: 'wrench', desc: 'Work orders', show: c => isStaffC(c) && notPersonal(c) },
    { key: 'hub-fieldtrip', label: 'Field trip', path: '/staff/new/fieldtrip', icon: 'bus', desc: 'Trip approval', show: c => isStaffC(c) && notPersonal(c) },
  ] },
  { group: 'Settings', key: 'settings', items: [
    { key: 'sis-setup', label: 'School setup', path: '/office/setup', icon: 'settings-2', desc: 'Bell schedule, terms, grade scale', show: isAdminC },
  ] },
];
function schoolMenu(ctx) {
  if (!ctx?.isRealTeacher) return [];
  return SCHOOL_MENU.map(g => ({ ...g, items: g.items.filter(i => i.show(ctx)) })).filter(g => g.items.length);
}
const schoolMenuItems = ctx => schoolMenu(ctx).flatMap(g => g.items);
const schoolHome = ctx => ctx.isAdmin ? { label: 'Admin', path: '/admin' } : { label: 'Staff Hub', path: '/staff' };
// Kept for older callers: anyone with office-type access (admin or a services/safety capability).
const hasOffice = ctx => !!ctx && (ctx.isAdmin || ['services', 'safety', 'health', 'records'].some(c => ctx.can(c)));
function schoolSubnav(ctx, active) {
  const base = `/${ctx.slug}`;
  const href = path => path.startsWith('@') ? buildUrl(path.slice(1)) : path.startsWith('#') ? '#' : buildUrl(base + path);
  const groups = schoolMenu(ctx);
  const district = ctx.tenant.districtId && (ctx.roleInfo.data?.districtAdmin || ls(`ember_district:${currentUser.uid}`) === ctx.tenant.districtId);
  const open = navGroupState();
  const link = i => `<a href="${href(i.path)}" ${i.path === '#concern' ? 'data-concern' : ''} class="subnav-link" ${i.key === active ? 'aria-current="page"' : ''}>${ico(i.icon, 'w-4 h-4 shrink-0 opacity-70')}<span class="min-w-0 leading-snug">${escapeHtml(i.label)}</span></a>`;
  return `<nav class="subnav accent-amber" aria-label="${escapeHtml(schoolHome(ctx).label)} navigation">
    <div class="text-[10px] text-gray-500 uppercase tracking-widest px-3 mb-1 truncate">${escapeHtml(schoolHome(ctx).label)}</div>
    <div class="text-white text-sm font-medium px-3 mb-4 line-clamp-2" title="${escapeHtml(ctx.tenant.name)}">${escapeHtml(ctx.tenant.name)}</div>
    ${district ? `<a href="${buildUrl(`/district/${ctx.tenant.districtId}`)}" class="subnav-link mb-2 text-[#A78BFA]">${ico('arrow-left', 'w-4 h-4 shrink-0')}<span class="truncate">District dashboard</span></a>` : ''}
    ${groups.map(g => {
      if (!g.group) return `<div class="space-y-0.5">${g.items.map(link).join('')}</div>`;
      const hasActive = g.items.some(i => i.key === active);
      const isOpen = hasActive || (open[g.key] ?? true); // open unless this person collapsed it
      return `<div class="subnav-group ${isOpen ? '' : 'collapsed'}"><button type="button" class="nav-section nav-group-toggle" data-group-toggle="${g.key}" aria-expanded="${isOpen}"><span>${escapeHtml(g.group)}</span>${ico('chevron-down', 'w-3 h-3')}</button><div class="space-y-0.5" data-group-body>${g.items.map(link).join('')}</div></div>`;
    }).join('')}
  </nav>`;
}
function navGroupState() { try { return JSON.parse(ls('ember_nav_groups') || '{}'); } catch { return {}; } }

async function viewCourseSection(ctx, courseId, section, x, y) {
  const t = routeToken;
  const course = await loadCourse(ctx, courseId);
  if (!live(t)) return;
  if (!course) return viewNotFound();
  if (!ctx.isRealTeacher && course.published === false) {
    setTitle(course.title);
    return render(tenantPage(ctx, 'dashboard', `<div class="max-w-xl mt-10">${emptyState({ icon: 'eye-off', title: "This course isn't open yet", text: 'Your teacher hasn\'t published it. Check back later.', action: `<a href="${buildUrl('/' + ctx.slug)}" class="btn btn-secondary">Back to dashboard</a>` })}</div>`));
  }
  section = section || 'home';
  if (section === 'roster') return navigate(`/${ctx.slug}/course/${courseId}/people`, { replace: true });
  if (ctx.studentView && (course.navHidden || []).includes(section)) {
    setTitle(course.title);
    return render(tenantPage(ctx, section, pageHeader({ eyebrow: escapeHtml(course.title || ''), title: 'Page disabled' }) +
      `<div class="max-w-xl">${emptyState({ icon: 'eye-off', title: 'That page has been disabled for this course', text: 'Your teacher has hidden it from the course menu.' })}</div>`, course));
  }
  switch (section) {
    case 'home': return viewCourseHome(ctx, course);
    case 'announcements': return viewCourseAnnouncements(ctx, course);
    case 'modules': return viewCourse(ctx, courseId);
    case 'grades': if (x !== 'term') return viewGrades(ctx, courseId); { const m = await import('./sis.js' + BUILD); return live(t) && m.viewTermGrades(ctx, course); }
    case 'attendance': { const m = await import('./sis.js' + BUILD); return live(t) && m.viewRollCall(ctx, course); }
    case 'collaborations': return viewCollaborations(ctx, course);
    case 'syllabus': return viewSyllabus(ctx, course);
    case 'assignments': return viewItemIndex(ctx, course, 'assignment');
    case 'discussions': return x ? viewDiscussion(ctx, course, x) : viewDiscussions(ctx, course);
    case 'pages': return viewItemIndex(ctx, course, 'page');
    case 'files': return viewFiles(ctx, course);
    case 'quizzes': return viewItemIndex(ctx, course, 'quiz');
    case 'conferences': return viewConferences(ctx, course);
    case 'outcomes': return viewOutcomes(ctx, course);
    case 'people': return viewPeople(ctx, course);
    case 'settings': return viewCourseSettings(ctx, course);
    case 'item': if (x && y) return viewItem(ctx, courseId, x, y); break;
  }
  return viewNotFound();
}

function openCourseModal(ctx, existing = null) {
  let grad = GRADIENTS.includes(existing?.gradient) ? existing.gradient : GRADIENTS[0];
  const m = openModal({
    html: modalHeader({ title: existing ? 'Edit course' : 'New course', subtitle: existing ? '' : 'Create a course for your students.', icon: 'book-open' }) + `
    <form novalidate>
      ${modalBody(`
        <div id="course-preview" class="${grad} h-16 rounded-xl mb-5 relative overflow-hidden"><div class="absolute inset-0 grad-pattern opacity-30"></div></div>
        <label for="course-title" class="label">Course name</label>
        <input id="course-title" type="text" placeholder="English 1" autocomplete="off" value="${escapeHtml(existing?.title || '')}" class="input mb-4" />
        <label for="course-code" class="label">Course code <span class="normal-case tracking-normal text-gray-600">(optional)</span></label>
        <input id="course-code" type="text" placeholder="Period 3 · ENG-101" autocomplete="off" value="${escapeHtml(existing?.code || '')}" class="input mb-4" />
        <label for="course-term" class="label">Term <span class="normal-case tracking-normal text-gray-600">(optional)</span></label>
        <input id="course-term" type="text" placeholder="Spring 2026" autocomplete="off" value="${escapeHtml(existing?.term || '')}" class="input mb-4" />
        <span class="label">Color</span>
        <div class="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Course color">${GRADIENTS.map(g => `<button type="button" role="radio" aria-checked="${g === grad}" aria-label="${g.replace('grad-', '')}" data-grad="${g}" class="${g} h-9 rounded-lg border-2 ${g === grad ? 'border-white' : 'border-transparent'} hover:border-white/50 transition-all"></button>`).join('')}</div>
        <p id="course-error" class="form-error mt-4 hidden" role="alert"></p>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${existing ? 'Save changes' : 'Create course'}</button>`)}
    </form>`
  });
  m.$$('[data-grad]').forEach(b => b.addEventListener('click', () => {
    grad = b.dataset.grad;
    m.$$('[data-grad]').forEach(x => { x.classList.replace('border-white', 'border-transparent'); x.setAttribute('aria-checked', 'false'); });
    b.classList.replace('border-transparent', 'border-white'); b.setAttribute('aria-checked', 'true');
    m.$('#course-preview').className = `${grad} h-16 rounded-xl mb-5 relative overflow-hidden`;
  }));
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const title = m.$('#course-title').value.trim(), code = m.$('#course-code').value.trim(), term = m.$('#course-term').value.trim();
    const err = m.$('#course-error'); showError(err, '');
    if (!title) return showError(err, 'Give the course a name.');
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Saving…', async () => {
      try {
        if (existing) {
          await updateDoc(doc(db, 'tenants', ctx.slug, 'courses', existing.id), { title, code, term, gradient: grad, updatedAt: serverTimestamp() });
          invalidateCourses(); m.close(); toast('Course updated'); renderRoute();
        } else {
          const ref = await addDoc(collection(db, 'tenants', ctx.slug, 'courses'), { title, code, term, gradient: grad, ownerUid: currentUser.uid, ownerName: ctx.me.name, published: true, createdAt: serverTimestamp() });
          invalidateCourses(); m.close(); toast('Course created');
          navigate(`/${ctx.slug}/course/${ref.id}`);
        }
      } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
    });
  });
}
async function deleteCourseDeep(slug, courseId) {
  const base = ['tenants', slug, 'courses', courseId];
  // Firestore doesn't cascade deletes, so clean up sub-collections (best effort) before the course itself.
  try {
    const mods = await getDocs(collection(db, ...base, 'modules'));
    for (const md of mods.docs) await batchDelete((await getDocs(collection(md.ref, 'items'))).docs.map(d => d.ref));
    await batchDelete(mods.docs.map(d => d.ref));
    const [enr, subs] = await Promise.all([getDocs(collection(db, ...base, 'enrollments')), getDocs(collection(db, ...base, 'submissions'))]);
    await Promise.all(enr.docs.map(d => updateDoc(doc(db, 'tenants', slug, 'students', d.id), { enrolledCourseIds: arrayRemove(courseId) }).catch(() => {})));
    await batchDelete([...enr.docs, ...subs.docs].map(d => d.ref));
  } catch (e) { console.warn('Course cleanup incomplete', e); }
  await deleteDoc(doc(db, ...base));
}

// ═══════════════════════════════════════════════════════════════
// COURSE (modules & items)
// ═══════════════════════════════════════════════════════════════
const typeMeta = type => ITEM_TYPES.find(t => t.type === type) || ITEM_TYPES[0];
const itemPoints = item => item.type === 'quiz' ? (item.data?.questions?.length || 0) : (Number(item.data?.points) || 0);
function itemMetaLine(item, studentView) {
  const parts = [typeMeta(item.type).label];
  if (item.type === 'assignment') parts.push(`${itemPoints(item)} pts`);
  if (item.type === 'quiz') parts.push(plural(item.data?.questions?.length || 0, 'question'));
  const due = toDate(item.data?.dueDate);
  if (due) parts.push(`<span class="${studentView && due < new Date() ? 'text-red-400/80' : ''}">Due ${escapeHtml(formatDateTime(due))}</span>`);
  if (item.type === 'link' && item.data?.url) parts.push(escapeHtml(hostOf(item.data.url)));
  return parts.join(' <span class="text-gray-700">·</span> ');
}
async function loadCourse(ctx, courseId) {
  const s = await getDoc(doc(db, 'tenants', ctx.slug, 'courses', courseId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
function courseLead(course) { return `<div class="${gradOf(course)} w-12 h-12 sm:w-14 sm:h-14 rounded-xl shrink-0 relative overflow-hidden hidden sm:block"><div class="absolute inset-0 grad-pattern opacity-30"></div></div>`; }

async function viewCourse(ctx, courseId) {
  const t = routeToken;
  const course = await loadCourse(ctx, courseId);
  if (!live(t)) return;
  if (!course) return viewNotFound();
  setTitle(course.title, ctx.tenant.name);
  render(tenantPage(ctx, 'course', pageHeader({
    back: { href: '/' + ctx.slug, label: ctx.studentView ? 'My courses' : 'All courses' },
    lead: courseLead(course),
    eyebrow: escapeHtml(course.code || ''),
    title: escapeHtml(course.title || 'Untitled'),
    actions: `${previewToggle(ctx)}${ctx.teacherMode ? `<button id="add-module-btn" class="btn btn-primary">${ico('plus')} Add module</button>` : ''}`
  }) + `<div id="modules-list" class="max-w-3xl space-y-4">${skeletonRows(3, 'h-32')}</div>`, course));
  $('#add-module-btn')?.addEventListener('click', async () => {
    const title = await promptDialog({ title: 'New module', label: 'Module title', placeholder: 'Week 1 — Introductions', confirmLabel: 'Create module' });
    if (!title) return;
    try { await addDoc(collection(db, 'tenants', ctx.slug, 'courses', courseId, 'modules'), { title, position: Date.now(), createdAt: serverTimestamp() }); toast('Module added'); }
    catch (e) { toast(friendlyError(e), 'error'); }
  });
  subscribeToModules(ctx, courseId);
}

function subscribeToModules(ctx, courseId) {
  const list = $('#modules-list');
  const modsCol = collection(db, 'tenants', ctx.slug, 'courses', courseId, 'modules');
  const state = { modules: null, items: new Map(), itemUnsubs: new Map() };
  let raf = 0;
  const draw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); };
  const paint = () => {
    if (!list.isConnected || !state.modules) return;
    if (!state.modules.length) {
      list.innerHTML = emptyState({ icon: 'layers', tone: 'amber', title: 'No modules yet', text: ctx.teacherMode ? 'Modules group your content — try one per week or per unit.' : 'Your teacher hasn\'t added any content yet.', action: ctx.teacherMode ? `<button data-action="add-module" class="btn btn-primary">${ico('plus')} Add first module</button>` : '' });
    } else {
      list.innerHTML = state.modules.map((m, i) => moduleCardHTML(ctx, courseId, m, state.items.get(m.id), i, state.modules.length)).join('');
    }
    refreshIcons();
  };
  // One listener for modules + one per module for its items; all are torn down on navigation.
  const modUnsub = onSnapshot(query(modsCol, orderBy('position', 'asc')), snap => {
    state.modules = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
    const ids = new Set(state.modules.map(m => m.id));
    for (const [id, u] of state.itemUnsubs) if (!ids.has(id)) { u(); state.itemUnsubs.delete(id); state.items.delete(id); }
    for (const m of state.modules) {
      if (state.itemUnsubs.has(m.id)) continue;
      state.itemUnsubs.set(m.id, onSnapshot(query(collection(modsCol, m.id, 'items'), orderBy('position', 'asc')), s => {
        state.items.set(m.id, s.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() })));
        draw();
      }, e => { console.error(e); state.items.set(m.id, []); draw(); }));
    }
    draw();
  }, e => { console.error(e); list.innerHTML = errorBox(e); refreshIcons(); });
  unsubs.push(modUnsub, () => { state.itemUnsubs.forEach(u => u()); state.itemUnsubs.clear(); cancelAnimationFrame(raf); });

  list.addEventListener('click', async e => {
    const b = e.target.closest('[data-action]'); if (!b || !ctx.teacherMode) return;
    e.preventDefault();
    const mods = state.modules || [];
    const mi = mods.findIndex(m => m.id === (b.dataset.mod || b.dataset.id));
    const mod = mods[mi];
    const items = mod ? (state.items.get(mod.id) || []) : [];
    const ii = items.findIndex(x => x.id === b.dataset.item);
    try {
      switch (b.dataset.action) {
        case 'add-module': return $('#add-module-btn')?.click();
        case 'add-item': return openItemTypeModal(ctx, courseId, mod.id);
        case 'mod-up': if (mi > 0) await swapPositions(mod, mods[mi - 1]); return;
        case 'mod-down': if (mi < mods.length - 1) await swapPositions(mod, mods[mi + 1]); return;
        case 'mod-rename': {
          const title = await promptDialog({ title: 'Rename module', label: 'Module title', value: mod.title || '' });
          if (title && title !== mod.title) await updateDoc(mod.ref, { title });
          return;
        }
        case 'mod-delete': {
          if (!await confirmDialog({ title: `Delete “${mod.title || 'module'}”?`, message: items.length ? `This also deletes its ${plural(items.length, 'item')}.` : '', confirmLabel: 'Delete module', danger: true })) return;
          await batchDelete(items.map(x => x.ref));
          await deleteDoc(mod.ref);
          return toast('Module deleted');
        }
        case 'item-up': if (ii > 0) await swapPositions(items[ii], items[ii - 1]); return;
        case 'item-down': if (ii < items.length - 1) await swapPositions(items[ii], items[ii + 1]); return;
        case 'item-edit': return openItemEditor(ctx, courseId, mod.id, items[ii], items[ii].type);
        case 'item-delete': {
          if (!await confirmDialog({ title: `Delete “${items[ii].title || 'item'}”?`, confirmLabel: 'Delete', danger: true })) return;
          await deleteDoc(items[ii].ref);
          return toast('Item deleted');
        }
      }
    } catch (ex) { console.error(ex); toast(friendlyError(ex), 'error'); }
  });
}
function moduleCardHTML(ctx, courseId, mod, items, idx, total) {
  const tm = ctx.teacherMode;
  const itemsHtml = items === undefined
    ? `<div class="p-4"><div class="skeleton h-10"></div></div>`
    : !items.length
      ? `<p class="text-xs text-gray-600 italic py-4 px-5">${tm ? 'Empty — use “Add item” to add a page, assignment, quiz or link.' : 'Nothing here yet.'}</p>`
      : items.map((it, i) => itemRowHTML(ctx, courseId, mod.id, it, i, items.length)).join('');
  return `<section class="card overflow-hidden" aria-label="${escapeHtml(mod.title || 'Module')}">
    <div class="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-white/[0.06] group">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-[10px] font-mono text-gray-600">${String(idx + 1).padStart(2, '0')}</span>
        <h2 class="font-serif text-lg text-white truncate">${escapeHtml(mod.title || 'Untitled')}</h2>
        ${items ? `<span class="text-[10px] text-gray-600 shrink-0 hidden sm:inline">${plural(items.length, 'item')}</span>` : ''}
      </div>
      ${tm ? `<div class="flex items-center shrink-0">
        <div class="row-actions">
          <button class="btn-icon" data-action="mod-up" data-id="${mod.id}" ${idx === 0 ? 'disabled' : ''} aria-label="Move module up">${ico('chevron-up')}</button>
          <button class="btn-icon" data-action="mod-down" data-id="${mod.id}" ${idx === total - 1 ? 'disabled' : ''} aria-label="Move module down">${ico('chevron-down')}</button>
          <button class="btn-icon" data-action="mod-rename" data-id="${mod.id}" aria-label="Rename module">${ico('pencil', 'w-3.5 h-3.5')}</button>
          <button class="btn-icon danger" data-action="mod-delete" data-id="${mod.id}" aria-label="Delete module">${ico('trash-2', 'w-3.5 h-3.5')}</button>
        </div>
        <button class="btn btn-secondary btn-sm ml-2" data-action="add-item" data-id="${mod.id}">${ico('plus', 'w-3.5 h-3.5')}<span class="hidden sm:inline">Add item</span></button>
      </div>` : ''}
    </div>
    <div class="divide-y divide-white/[0.04]">${itemsHtml}</div>
  </section>`;
}
function itemRowHTML(ctx, courseId, moduleId, item, i, total) {
  const meta = typeMeta(item.type);
  const tm = ctx.teacherMode;
  const url = safeUrl(item.data?.url);
  const external = item.type === 'link' && url && !tm;
  const href = external ? url : buildUrl(`/${ctx.slug}/course/${courseId}/item/${moduleId}/${item.id}`);
  return `<div class="group relative flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-white/[0.03] transition-colors">
    <a href="${escapeHtml(href)}" ${external ? 'target="_blank" rel="noopener noreferrer"' : ''} class="absolute inset-0" aria-label="${escapeHtml(item.title || 'Untitled')}"></a>
    <div class="tile tile-muted !w-8 !h-8 group-hover:!text-[#F59E0B] transition-colors">${ico(meta.icon, 'w-3.5 h-3.5')}</div>
    <div class="flex-1 min-w-0">
      <div class="text-sm text-gray-100 truncate">${escapeHtml(item.title || 'Untitled')}</div>
      <div class="text-[11px] text-gray-500 truncate">${itemMetaLine(item, ctx.studentView)}</div>
    </div>
    ${tm ? `<div class="row-actions relative z-10">
      <button class="btn-icon" data-action="item-up" data-mod="${moduleId}" data-item="${item.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ico('chevron-up', 'w-3.5 h-3.5')}</button>
      <button class="btn-icon" data-action="item-down" data-mod="${moduleId}" data-item="${item.id}" ${i === total - 1 ? 'disabled' : ''} aria-label="Move down">${ico('chevron-down', 'w-3.5 h-3.5')}</button>
      <button class="btn-icon" data-action="item-edit" data-mod="${moduleId}" data-item="${item.id}" aria-label="Edit">${ico('pencil', 'w-3.5 h-3.5')}</button>
      <button class="btn-icon danger" data-action="item-delete" data-mod="${moduleId}" data-item="${item.id}" aria-label="Delete">${ico('trash-2', 'w-3.5 h-3.5')}</button>
    </div>` : ico(external ? 'external-link' : 'chevron-right', 'w-4 h-4 text-gray-700 group-hover:text-[#F59E0B] transition-colors shrink-0')}
  </div>`;
}

function openItemTypeModal(ctx, courseId, moduleId) {
  const m = openModal({
    html: modalHeader({ title: 'Add item', subtitle: 'What kind of content?', icon: 'plus' }) + modalBody(`
      <div class="space-y-2">${ITEM_TYPES.map(t => `
        <button type="button" data-type="${t.type}" class="w-full flex items-center gap-4 px-4 py-3.5 bg-white/[0.03] border border-white/[0.08] rounded-xl hover:bg-white/[0.06] hover:border-[#F59E0B]/40 transition-all text-left group">
          ${iconTile(t.icon, 'amber')}
          <div class="flex-1 min-w-0"><div class="text-sm text-white font-medium">${t.label}</div><div class="text-xs text-gray-500">${t.desc}</div></div>
          ${ico('chevron-right', 'w-4 h-4 text-gray-600 group-hover:text-[#F59E0B] transition-colors')}
        </button>`).join('')}</div>`)
  });
  m.$$('[data-type]').forEach(b => b.addEventListener('click', () => { m.close(); openItemEditor(ctx, courseId, moduleId, null, b.dataset.type); }));
  setTimeout(() => m.$('[data-type]')?.focus(), 50);
}

function mountQuizBuilder(host, initial = []) {
  const newQ = () => ({ prompt: '', choices: ['', ''], answer: 0 });
  const qs = (initial.length ? initial : [newQ()]).map(q => ({ prompt: q.prompt || '', choices: q.choices?.length ? [...q.choices] : ['', ''], answer: q.answer ?? 0 }));
  const draw = (focusSel) => {
    host.innerHTML = qs.map((q, qi) => `
      <div class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4" data-q="${qi}">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] uppercase tracking-wider text-gray-500">Question ${qi + 1}</span>
          ${qs.length > 1 ? `<button type="button" class="btn-icon danger" data-qa="remove-q" aria-label="Remove question ${qi + 1}">${ico('trash-2', 'w-3.5 h-3.5')}</button>` : ''}
        </div>
        <textarea class="input mb-3" rows="2" data-prompt placeholder="What is the powerhouse of the cell?" aria-label="Question ${qi + 1} prompt">${escapeHtml(q.prompt)}</textarea>
        <div class="space-y-2">${q.choices.map((c, ci) => `
          <div class="flex items-center gap-2">
            <label class="flex items-center justify-center w-10 h-10 shrink-0 cursor-pointer rounded-lg border transition-colors ${q.answer === ci ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 hover:border-white/20'}" title="Mark as the correct answer">
              <input type="radio" name="q${qi}-ans" class="accent-emerald-500 w-4 h-4" data-answer="${ci}" ${q.answer === ci ? 'checked' : ''} aria-label="Choice ${ci + 1} is correct">
            </label>
            <input type="text" class="input !py-2.5" data-choice="${ci}" value="${escapeHtml(c)}" placeholder="Choice ${ci + 1}" aria-label="Question ${qi + 1} choice ${ci + 1}">
            ${q.choices.length > 2 ? `<button type="button" class="btn-icon danger" data-qa="remove-c" data-ci="${ci}" aria-label="Remove choice ${ci + 1}">${ico('x', 'w-3.5 h-3.5')}</button>` : '<span class="w-[30px] shrink-0"></span>'}
          </div>`).join('')}</div>
        ${q.choices.length < 6 ? `<button type="button" class="btn btn-ghost btn-sm mt-2" data-qa="add-c">${ico('plus', 'w-3.5 h-3.5')} Add choice</button>` : ''}
      </div>`).join('') + `<button type="button" class="btn btn-secondary btn-sm" data-qa="add-q">${ico('plus', 'w-3.5 h-3.5')} Add question</button>`;
    refreshIcons();
    if (focusSel) host.querySelector(focusSel)?.focus();
  };
  host.addEventListener('input', e => {
    const qel = e.target.closest('[data-q]'); if (!qel) return;
    const q = qs[+qel.dataset.q];
    if (e.target.matches('[data-prompt]')) q.prompt = e.target.value;
    else if (e.target.matches('[data-choice]')) q.choices[+e.target.dataset.choice] = e.target.value;
  });
  host.addEventListener('change', e => {
    if (!e.target.matches('[data-answer]')) return;
    const qi = +e.target.closest('[data-q]').dataset.q;
    qs[qi].answer = +e.target.dataset.answer; draw();
  });
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-qa]'); if (!b) return;
    const qel = b.closest('[data-q]'); const qi = qel ? +qel.dataset.q : -1;
    if (b.dataset.qa === 'add-q') { qs.push(newQ()); draw(`[data-q="${qs.length - 1}"] [data-prompt]`); }
    else if (b.dataset.qa === 'remove-q') { qs.splice(qi, 1); draw(); }
    else if (b.dataset.qa === 'add-c') { qs[qi].choices.push(''); draw(`[data-q="${qi}"] [data-choice="${qs[qi].choices.length - 1}"]`); }
    else if (b.dataset.qa === 'remove-c') {
      const ci = +b.dataset.ci, q = qs[qi];
      q.choices.splice(ci, 1);
      if (q.answer === ci) q.answer = 0; else if (q.answer > ci) q.answer--;
      draw();
    }
  });
  draw();
  return {
    collect() {
      host.querySelectorAll('[data-q]').forEach(qel => {
        const q = qs[+qel.dataset.q]; if (!q) return;
        q.prompt = qel.querySelector('[data-prompt]').value;
        qel.querySelectorAll('[data-choice]').forEach(i => { q.choices[+i.dataset.choice] = i.value; });
      });
      const out = [];
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i], prompt = q.prompt.trim();
        if (!prompt) return { error: `Question ${i + 1} needs a prompt.` };
        const choices = []; let answer = -1;
        q.choices.forEach((c, ci) => { const t = c.trim(); if (t) { if (ci === q.answer) answer = choices.length; choices.push(t); } });
        if (choices.length < 2) return { error: `Question ${i + 1} needs at least two choices.` };
        if (answer < 0) return { error: `Mark the correct answer for question ${i + 1} (the correct choice can't be blank).` };
        out.push({ prompt, choices, answer });
      }
      return { questions: out };
    }
  };
}

function openItemEditor(ctx, courseId, moduleId, existingItem, type, onSaved = null) {
  const item = existingItem || { type, title: '', data: {} };
  const meta = typeMeta(item.type);
  const d = item.data || {};
  const fields = {
    page: `<div><span class="label">Content</span><div class="editor-box"><div data-editor></div></div></div>`,
    assignment: `<div><span class="label">Instructions</span><div class="editor-box"><div data-editor></div></div></div>
      <div class="grid sm:grid-cols-2 gap-4">
        <div><label for="item-points" class="label">Points</label><input id="item-points" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(d.points ?? 100)}" class="input" /></div>
        <div><label for="item-due" class="label">Due <span class="normal-case tracking-normal text-gray-600">(optional)</span></label><input id="item-due" type="datetime-local" value="${toDateTimeInput(d.dueDate)}" class="input" /></div>
      </div>`,
    link: `<div><label for="item-url" class="label">URL</label><input id="item-url" type="url" inputmode="url" value="${escapeHtml(d.url || '')}" placeholder="https://example.com" class="input" /><p class="hint">Opens in a new tab for students.</p></div>`,
    quiz: `<div><span class="label">Questions</span><p class="hint !mt-0 mb-3">Click the circle next to a choice to mark it correct. Each question is worth 1 point.</p><div data-quiz class="space-y-3"></div></div>
      <div class="grid sm:grid-cols-2 gap-4">
        <div><label for="item-due" class="label">Due <span class="normal-case tracking-normal text-gray-600">(optional)</span></label><input id="item-due" type="datetime-local" value="${toDateTimeInput(d.dueDate)}" class="input" /></div>
        <div class="space-y-3 sm:pt-7">
          <label class="check"><input type="checkbox" id="quiz-retake" ${d.allowRetake ? 'checked' : ''}> Allow retakes</label>
          <label class="check"><input type="checkbox" id="quiz-show" ${d.showAnswers !== false ? 'checked' : ''}> Show correct answers after submitting</label>
        </div>
      </div>`,
  };
  const m = openModal({
    size: 'xl', align: 'top',
    html: modalHeader({ title: `${existingItem ? 'Edit' : 'New'} ${meta.label.toLowerCase()}`, icon: meta.icon }) + `
    <form novalidate>
      ${modalBody(`<div class="space-y-5">
        <div><label for="item-title" class="label">Title</label><input id="item-title" type="text" value="${escapeHtml(item.title || '')}" autocomplete="off" class="input" placeholder="${item.type === 'quiz' ? 'Chapter 3 check-in' : item.type === 'assignment' ? 'Lab report: Photosynthesis' : ''}" /></div>
        ${fields[item.type] || ''}
        <p id="item-error" class="form-error hidden" role="alert"></p>
      </div>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${existingItem ? 'Save changes' : 'Create ' + meta.label.toLowerCase()}</button>`)}
    </form>`
  });
  let editor = null, quiz = null;
  if (item.type === 'page' || item.type === 'assignment') {
    editor = mountEditor(m.$('[data-editor]'), { html: item.type === 'page' ? d.content : d.description, toolbar: item.type === 'page' ? 'full' : 'basic', placeholder: item.type === 'page' ? 'Write your page…' : 'Describe what students should do…' });
  }
  if (item.type === 'quiz') quiz = mountQuizBuilder(m.$('[data-quiz]'), d.questions || []);
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const title = m.$('#item-title').value.trim();
    const err = m.$('#item-error'); showError(err, '');
    if (!title) { m.$('#item-title').focus(); return showError(err, 'Give it a title.'); }
    const data = {};
    const dueVal = m.$('#item-due')?.value;
    if (item.type === 'page') data.content = editor.getHTML();
    else if (item.type === 'assignment') {
      data.description = editor.getHTML();
      const pts = Number(m.$('#item-points').value);
      if (!Number.isFinite(pts) || pts < 0) return showError(err, 'Points must be 0 or more.');
      data.points = Math.round(pts * 100) / 100;
      data.dueDate = dueVal ? new Date(dueVal) : null;
    } else if (item.type === 'link') {
      const url = normalizeUrl(m.$('#item-url').value);
      if (!url) return showError(err, 'Enter a valid web address (http or https).');
      data.url = url;
    } else if (item.type === 'quiz') {
      const r = quiz.collect();
      if (r.error) return showError(err, r.error);
      Object.assign(data, { questions: r.questions, points: r.questions.length, dueDate: dueVal ? new Date(dueVal) : null, allowRetake: m.$('#quiz-retake').checked, showAnswers: m.$('#quiz-show').checked });
    }
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Saving…', async () => {
      try {
        const itemsCol = collection(db, 'tenants', ctx.slug, 'courses', courseId, 'modules', moduleId, 'items');
        if (existingItem) await updateDoc(doc(itemsCol, existingItem.id), { title, data, updatedAt: serverTimestamp() });
        else await addDoc(itemsCol, { type: item.type, title, data, position: Date.now(), createdAt: serverTimestamp() });
        m.close();
        toast(existingItem ? 'Saved' : `${meta.label} created`);
        if (onSaved) onSaved();
        else if (existingItem && parseRoute().segments[2] === 'item') renderRoute();
      } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// ITEM VIEW (pages, assignments, quizzes, links)
// ═══════════════════════════════════════════════════════════════
const subsCol = (ctx, courseId) => collection(db, 'tenants', ctx.slug, 'courses', courseId, 'submissions');
async function loadMySubmission(ctx, courseId, itemId) {
  const snap = await getDocs(query(subsCol(ctx, courseId), where('itemId', '==', itemId), where('studentId', '==', currentUser.uid)));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => recency(b.submittedAt) - recency(a.submittedAt));
  return all[0] || null;
}
async function saveSubmission(ctx, courseId, moduleId, item, existing, payload) {
  const id = existing?.id || `${item.id}_${currentUser.uid}`;
  const data = {
    itemId: item.id, moduleId, itemTitle: item.title || '', itemType: item.type,
    studentId: currentUser.uid, studentName: ctx.me.name, username: ctx.roleInfo.data?.username || '',
    submittedAt: serverTimestamp(), ...payload
  };
  await setDoc(doc(subsCol(ctx, courseId), id), data, { merge: true });
  return { id, ...data, submittedAt: new Date() };
}
const isLate = (sub, item) => { const due = toDate(item.data?.dueDate), at = toDate(sub?.submittedAt); return !!(due && at && at > due); };
const hasGrade = s => s && s.grade !== null && s.grade !== undefined && s.grade !== '';
function gradeChip(s, points) {
  if (!s) return `<span class="text-xs text-gray-600">—</span>`;
  if (hasGrade(s)) return `<span class="text-sm text-white font-medium tabular-nums">${escapeHtml(s.grade)}<span class="text-gray-500">/${points}</span></span>`;
  return badge('Needs grading', 'amber');
}

async function viewItem(ctx, courseId, moduleId, itemId) {
  const t = routeToken;
  render(loadingScreen());
  const itemsCol = collection(db, 'tenants', ctx.slug, 'courses', courseId, 'modules', moduleId, 'items');
  const [course, iSnap, siblings] = await Promise.all([
    loadCourse(ctx, courseId),
    getDoc(doc(itemsCol, itemId)),
    getDocs(query(itemsCol, orderBy('position', 'asc'))).catch(() => null),
  ]);
  if (!live(t)) return;
  if (!course || !iSnap.exists()) return viewNotFound();
  const item = { id: iSnap.id, ...iSnap.data() };
  const meta = typeMeta(item.type);
  setTitle(item.title, course.title);
  const sibs = siblings ? siblings.docs.map(d => ({ id: d.id, ...d.data() })) : [];
  const pos = sibs.findIndex(s => s.id === itemId);
  const prev = pos > 0 ? sibs[pos - 1] : null, next = pos >= 0 && pos < sibs.length - 1 ? sibs[pos + 1] : null;
  const sibHref = s => buildUrl(`/${ctx.slug}/course/${courseId}/item/${moduleId}/${s.id}`);
  const pager = (prev || next) ? `<nav class="mt-10 pt-6 border-t border-white/[0.06] grid grid-cols-2 gap-3" aria-label="Item navigation">
    <div>${prev ? `<a href="${sibHref(prev)}" class="card card-hover p-4 block"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1">${ico('arrow-left', 'w-3 h-3')} Previous</div><div class="text-sm text-white truncate">${escapeHtml(prev.title || 'Untitled')}</div></a>` : ''}</div>
    <div>${next ? `<a href="${sibHref(next)}" class="card card-hover p-4 block text-right"><div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1 justify-end">Next ${ico('arrow-right', 'w-3 h-3')}</div><div class="text-sm text-white truncate">${escapeHtml(next.title || 'Untitled')}</div></a>` : ''}</div>
  </nav>` : '';

  const due = toDate(item.data?.dueDate);
  const chips = [];
  if (GRADED_TYPES.includes(item.type)) chips.push(badge(`${itemPoints(item)} points`, 'amber'));
  if (item.type === 'quiz') chips.push(badge(plural(item.data?.questions?.length || 0, 'question'), 'muted'));
  if (due) chips.push(badge(`${due < new Date() ? 'Was due' : 'Due'} ${escapeHtml(formatDateTime(due))}`, due < new Date() ? 'red' : 'muted'));

  let body = '';
  if (item.type === 'page') body = `<article class="prose-ember">${sanitize(item.data?.content) || '<p class="text-gray-500 italic">This page is empty.</p>'}</article>`;
  else if (item.type === 'link') {
    const url = safeUrl(item.data?.url);
    body = url ? `<div class="card p-6 flex flex-col sm:flex-row sm:items-center gap-4">${iconTile('globe', 'amber', 'tile-lg')}<div class="flex-1 min-w-0"><div class="text-white text-sm truncate">${escapeHtml(hostOf(url))}</div><div class="text-xs text-gray-500 truncate font-mono">${escapeHtml(url)}</div></div><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">${ico('external-link')} Open link</a></div>`
      : `<p class="text-gray-500 italic">This link has no valid URL.</p>`;
  } else if (item.type === 'assignment') {
    body = `<article class="prose-ember mb-8">${sanitize(item.data?.description) || '<p class="text-gray-500 italic">No instructions provided.</p>'}</article>
      <div id="${ctx.teacherMode ? 'submissions' : 'work-area'}"></div>`;
  } else if (item.type === 'quiz') {
    body = `<div id="${ctx.teacherMode ? 'quiz-teacher' : 'work-area'}"></div>${ctx.teacherMode ? '<div id="submissions" class="mt-10"></div>' : ''}`;
  } else body = `<p class="text-gray-500 italic">Unknown item type.</p>`;

  render(tenantPage(ctx, 'course', pageHeader({
    back: { href: `/${ctx.slug}/course/${courseId}`, label: course.title || 'Course' },
    lead: iconTile(meta.icon, 'amber', 'tile-lg'),
    eyebrow: meta.label,
    title: escapeHtml(item.title || 'Untitled'),
    actions: `${previewToggle(ctx)}${ctx.teacherMode && item.type !== 'link' ? `<button id="share-item-btn" class="btn btn-secondary">${ico('share-2', 'w-3.5 h-3.5')} Share</button>` : ''}${ctx.teacherMode ? `<button id="edit-item-btn" class="btn btn-secondary">${ico('pencil', 'w-3.5 h-3.5')} Edit</button>` : ''}`
  }) + `<div class="max-w-3xl">${chips.length ? `<div class="flex flex-wrap gap-2 mb-6 -mt-2">${chips.join('')}</div>` : ''}${body}${pager}</div>`, course, { crumbs: [{ label: item.title || 'Untitled' }] }));
  $('#edit-item-btn')?.addEventListener('click', () => openItemEditor(ctx, courseId, moduleId, item, item.type));
  $('#share-item-btn')?.addEventListener('click', () => openShareToCommons(ctx, item, course));

  if (item.type === 'assignment') ctx.teacherMode ? mountSubmissionsPanel(ctx, courseId, item) : mountAssignmentWork(ctx, courseId, moduleId, item);
  if (item.type === 'quiz') {
    if (ctx.teacherMode) { renderQuizTeacherPreview(item); mountSubmissionsPanel(ctx, courseId, item); }
    else mountQuizWork(ctx, courseId, moduleId, item);
  }
}

function mountAssignmentWork(ctx, courseId, moduleId, item) {
  const host = $('#work-area');
  const points = itemPoints(item);
  let mine = null;
  host.innerHTML = `<div class="skeleton h-48"></div>`;
  const draw = (editing = false) => {
    if (!host.isConnected) return;
    if (mine && !editing) {
      const graded = hasGrade(mine);
      const url = safeUrl(mine.url);
      host.innerHTML = `<div class="card overflow-hidden">
        <div class="px-6 py-4 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">${iconTile(graded ? 'award' : 'circle-check', graded ? 'amber' : 'green')}<div><div class="text-sm text-white font-medium">${graded ? 'Graded' : 'Submitted'}</div><div class="text-xs text-gray-500">${escapeHtml(formatDateTime(mine.submittedAt) || 'just now')}${isLate(mine, item) ? ' · <span class="text-red-400">late</span>' : ''}</div></div></div>
          ${graded ? `<div class="text-right"><div class="font-serif text-3xl text-white tabular-nums">${escapeHtml(mine.grade)}<span class="text-gray-500 text-lg">/${points}</span></div></div>` : mine.gradedBy ? badge('Reviewed by teacher', 'violet') : `<button data-edit-sub class="btn btn-secondary btn-sm">${ico('pencil', 'w-3.5 h-3.5')} Edit submission</button>`}
        </div>
        <div class="p-6 space-y-4">
          ${mine.content ? `<div><span class="label">Your answer</span><div class="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">${escapeHtml(mine.content)}</div></div>` : ''}
          ${url ? `<div><span class="label">Link</span><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-sm text-[#F59E0B] hover:underline break-all">${escapeHtml(url)}</a></div>` : ''}
          ${mine.feedback ? `<div class="p-4 rounded-lg bg-[#8B5CF6]/5 border border-[#8B5CF6]/20"><span class="label !text-[#A78BFA]">Teacher feedback</span><p class="text-sm text-gray-300 whitespace-pre-wrap">${escapeHtml(mine.feedback)}</p></div>` : ''}
          ${!graded && !mine.gradedBy ? `<p class="text-xs text-gray-500">You can edit your submission until it's graded.</p>` : ''}
        </div>
      </div>`;
      refreshIcons();
      host.querySelector('[data-edit-sub]')?.addEventListener('click', () => draw(true));
      return;
    }
    host.innerHTML = `<form class="card p-6" novalidate>
      <h2 class="font-serif text-xl text-white mb-1">${mine ? 'Edit your submission' : 'Submit your work'}</h2>
      <p class="text-xs text-gray-500 mb-5">Type your answer, paste a link (Google Doc, video…), or both.</p>
      <label for="submission-text" class="label">Your answer</label>
      <textarea id="submission-text" rows="7" placeholder="Type your answer…" class="input">${escapeHtml(mine?.content || '')}</textarea>
      <label for="submission-url" class="label mt-4">Link <span class="normal-case tracking-normal text-gray-600">(optional)</span></label>
      <input id="submission-url" type="url" inputmode="url" value="${escapeHtml(mine?.url || '')}" placeholder="https://docs.google.com/…" class="input" />
      <p id="submission-error" class="form-error mt-3 hidden" role="alert"></p>
      <div class="flex flex-wrap gap-3 mt-5">
        <button type="submit" class="btn btn-primary">${ico('send', 'w-4 h-4')} ${mine ? 'Resubmit' : 'Submit assignment'}</button>
        ${mine ? `<button type="button" data-cancel class="btn btn-ghost">Cancel</button>` : ''}
      </div>
    </form>`;
    refreshIcons();
    host.querySelector('[data-cancel]')?.addEventListener('click', () => draw(false));
    host.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const content = $('#submission-text').value.trim();
      const rawUrl = $('#submission-url').value.trim();
      const url = rawUrl ? normalizeUrl(rawUrl) : '';
      const err = $('#submission-error'); showError(err, '');
      if (!content && !rawUrl) return showError(err, 'Add an answer or a link before submitting.');
      if (rawUrl && !url) return showError(err, 'That link doesn\'t look valid.');
      withBusy(e.currentTarget.querySelector('[type=submit]'), 'Submitting…', async () => {
        try {
          mine = await saveSubmission(ctx, courseId, moduleId, item, mine, { kind: 'assignment', content, url, grade: null, points });
          toast('Submitted!'); draw(false);
        } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
      });
    });
  };
  loadMySubmission(ctx, courseId, item.id).then(s => { mine = s; draw(); }).catch(e => { console.error(e); draw(); });
}

function renderQuizTeacherPreview(item) {
  const qs = item.data?.questions || [];
  $('#quiz-teacher').innerHTML = !qs.length ? emptyState({ icon: 'list-checks', title: 'No questions yet', text: 'Click Edit to add questions.' }) : `
    <div class="flex items-center justify-between mb-3"><h2 class="font-serif text-xl text-white">Questions</h2><span class="text-xs text-gray-500">${item.data?.allowRetake ? 'Retakes allowed' : 'One attempt'} · ${item.data?.showAnswers !== false ? 'Answers shown after' : 'Answers hidden'}</span></div>
    <ol class="space-y-3">${qs.map((q, i) => `<li class="card p-5"><p class="text-sm text-white mb-3"><span class="text-gray-500 font-mono mr-2">${i + 1}.</span>${escapeHtml(q.prompt)}</p>
      <ul class="space-y-1.5">${q.choices.map((c, ci) => `<li class="flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${ci === q.answer ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'text-gray-400 border border-transparent'}">${ico(ci === q.answer ? 'circle-check' : 'circle', 'w-4 h-4 shrink-0')} ${escapeHtml(c)}</li>`).join('')}</ul></li>`).join('')}</ol>`;
  refreshIcons();
}

function mountQuizWork(ctx, courseId, moduleId, item) {
  const host = $('#work-area');
  const qs = item.data?.questions || [];
  const showAnswers = item.data?.showAnswers !== false;
  let mine = null;
  if (!qs.length) { host.innerHTML = emptyState({ icon: 'list-checks', title: 'This quiz has no questions yet' }); refreshIcons(); return; }
  host.innerHTML = `<div class="skeleton h-48"></div>`;
  const results = () => {
    const got = hasGrade(mine) ? Number(mine.grade) : mine.score; // a teacher's override wins over the auto score
    const pct = Math.round((got / (mine.points || qs.length)) * 100);
    host.innerHTML = `<div class="card p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-5">
        <div class="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 36 36" class="w-20 h-20 -rotate-90"><circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="3"/><circle cx="18" cy="18" r="15.9" fill="none" stroke="${pct >= 70 ? '#34D399' : pct >= 50 ? '#F59E0B' : '#F87171'}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${pct} 100"/></svg>
          <div class="absolute inset-0 flex items-center justify-center font-serif text-xl text-white">${pct}%</div>
        </div>
        <div class="flex-1"><div class="font-serif text-2xl text-white">${escapeHtml(got)} / ${escapeHtml(mine.points || qs.length)} ${hasGrade(mine) && Number(mine.grade) !== mine.score ? 'points' : 'correct'}</div><div class="text-xs text-gray-500 mt-1">Submitted ${escapeHtml(formatDateTime(mine.submittedAt) || 'just now')}</div></div>
        ${item.data?.allowRetake ? `<button data-retake class="btn btn-secondary">${ico('rotate-ccw', 'w-4 h-4')} Retake</button>` : ''}
      </div>
      ${mine.feedback ? `<div class="p-4 mb-6 rounded-lg bg-[#8B5CF6]/5 border border-[#8B5CF6]/20"><span class="label !text-[#A78BFA]">Teacher feedback</span><p class="text-sm text-gray-300 whitespace-pre-wrap">${escapeHtml(mine.feedback)}</p></div>` : ''}
      ${showAnswers ? `<ol class="space-y-3">${qs.map((q, i) => {
        const chosen = mine.answers?.[i];
        const right = chosen === q.answer;
        return `<li class="card p-5"><div class="flex items-start gap-2 mb-3">${ico(right ? 'circle-check' : 'circle-x', 'w-4 h-4 mt-0.5 shrink-0 ' + (right ? 'text-emerald-400' : 'text-red-400'))}<p class="text-sm text-white">${escapeHtml(q.prompt)}</p></div>
          <ul class="space-y-1.5">${q.choices.map((c, ci) => {
            const cls = ci === q.answer ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : ci === chosen ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'border-transparent text-gray-500';
            return `<li class="text-sm px-3 py-2 rounded-lg border ${cls}">${escapeHtml(c)}${ci === chosen ? ' <span class="text-[10px] uppercase tracking-wider opacity-70 ml-1">your answer</span>' : ''}</li>`;
          }).join('')}</ul></li>`;
      }).join('')}</ol>` : `<p class="text-sm text-gray-500">Your teacher has chosen not to show the correct answers.</p>`}`;
    refreshIcons();
    host.querySelector('[data-retake]')?.addEventListener('click', () => form());
  };
  const form = () => {
    host.innerHTML = `<form novalidate>
      <ol class="space-y-4">${qs.map((q, i) => `<li class="card p-5"><fieldset><legend class="text-sm text-white mb-3"><span class="text-gray-500 font-mono mr-2">${i + 1}.</span>${escapeHtml(q.prompt)}</legend>
        <div class="space-y-2">${q.choices.map((c, ci) => `<label class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.02] cursor-pointer transition-colors has-[:checked]:border-[#F59E0B]/50 has-[:checked]:bg-[#F59E0B]/[0.06]">
          <input type="radio" name="qa${i}" value="${ci}" class="accent-[#F59E0B] w-4 h-4"> <span class="text-sm text-gray-200">${escapeHtml(c)}</span></label>`).join('')}</div></fieldset></li>`).join('')}</ol>
      <p id="quiz-error" class="form-error mt-4 hidden" role="alert"></p>
      <div class="flex items-center gap-4 mt-6"><button type="submit" class="btn btn-primary">${ico('send', 'w-4 h-4')} Submit quiz</button><span id="quiz-progress" class="text-xs text-gray-500">0 of ${qs.length} answered</span></div>
    </form>`;
    refreshIcons();
    const f = host.querySelector('form');
    f.addEventListener('change', () => { $('#quiz-progress').textContent = `${qs.filter((_, i) => f.querySelector(`input[name="qa${i}"]:checked`)).length} of ${qs.length} answered`; });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const answers = qs.map((_, i) => { const r = f.querySelector(`input[name="qa${i}"]:checked`); return r ? +r.value : null; });
      const err = $('#quiz-error'); showError(err, '');
      const missing = answers.findIndex(a => a === null);
      if (missing >= 0) { showError(err, `Answer question ${missing + 1} before submitting.`); f.querySelectorAll('fieldset')[missing].scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (!await confirmDialog({ title: 'Submit quiz?', message: item.data?.allowRetake ? 'You can retake it afterwards.' : "You won't be able to change your answers.", confirmLabel: 'Submit' })) return;
      const score = answers.filter((a, i) => a === qs[i].answer).length;
      withBusy(f.querySelector('[type=submit]'), 'Submitting…', async () => {
        try {
          mine = await saveSubmission(ctx, courseId, moduleId, item, mine, { kind: 'quiz', answers, score, points: qs.length, grade: score, autoGraded: true, attempts: (mine?.attempts || 0) + 1 });
          toast(`Submitted — ${score}/${qs.length}`);
          results();
          $('#main')?.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
      });
    });
  };
  loadMySubmission(ctx, courseId, item.id).then(s => { mine = s; mine ? results() : form(); }).catch(e => { console.error(e); form(); });
}

function mountSubmissionsPanel(ctx, courseId, item) {
  const host = $('#submissions'); if (!host) return;
  const points = itemPoints(item);
  let subs = null, enrolled = null;
  host.innerHTML = `<div class="skeleton h-40"></div>`;
  countOf(collection(db, 'tenants', ctx.slug, 'courses', courseId, 'enrollments')).then(n => { enrolled = n; draw(); });
  const draw = () => {
    if (!host.isConnected || subs === null) return;
    const graded = subs.filter(hasGrade).length;
    const avg = graded ? subs.filter(hasGrade).reduce((a, s) => a + Number(s.grade), 0) / graded : null;
    host.innerHTML = `
      <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div><h2 class="font-serif text-2xl text-white">Submissions</h2>
        <p class="text-xs text-gray-500 mt-1">${subs.length}${enrolled !== null ? ` of ${enrolled}` : ''} submitted · ${graded} graded${avg !== null && points ? ` · average ${Math.round((avg / points) * 100)}%` : ''}</p></div>
        ${enrolled ? `<div class="w-40 h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div class="h-full bg-[#F59E0B] rounded-full" style="width:${Math.min(100, Math.round(subs.length / enrolled * 100))}%"></div></div>` : ''}
      </div>
      ${!subs.length ? emptyState({ icon: 'inbox', title: 'No submissions yet', text: 'Student work shows up here the moment it\'s turned in.' }) : dataTable(
        [{ label: 'Student', cls: 'col-span-12 sm:col-span-5' }, { label: 'Submitted', cls: 'col-span-6 sm:col-span-3' }, { label: 'Grade', cls: 'col-span-3 sm:col-span-2' }, { label: '', cls: 'col-span-3 sm:col-span-2 text-right' }],
        subs.map(s => ({
          cells: [
            `<div class="flex items-center gap-3">${avatar(s.studentName || 'Student')}<div class="min-w-0"><div class="text-sm text-white truncate">${escapeHtml(s.studentName || 'Student')}</div>${s.username ? `<div class="text-xs text-gray-500 font-mono truncate">${escapeHtml(s.username)}</div>` : ''}</div></div>`,
            `<div class="text-xs text-gray-400">${escapeHtml(formatDateTime(s.submittedAt) || 'just now')} ${isLate(s, item) ? badge('Late', 'red') : ''}</div>`,
            gradeChip(s, points),
            `<button data-grade="${escapeHtml(s.id)}" class="btn btn-secondary btn-sm">${hasGrade(s) ? 'View' : 'Grade'}</button>`
          ]
        })))}`;
    refreshIcons();
  };
  unsubs.push(onSnapshot(query(subsCol(ctx, courseId), where('itemId', '==', item.id)), snap => {
    subs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => recency(b.submittedAt) - recency(a.submittedAt));
    draw();
  }, e => { console.error(e); host.innerHTML = errorBox(e); refreshIcons(); }));
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-grade]'); if (!b) return;
    const s = subs?.find(x => x.id === b.dataset.grade);
    if (s) openGradeModal(ctx, courseId, item, s, subs);
  });
}

function openGradeModal(ctx, courseId, item, sub, allSubs = []) {
  const points = itemPoints(item);
  const url = safeUrl(sub.url);
  const qs = item.data?.questions || [];
  const ungraded = allSubs.filter(s => !hasGrade(s) && s.id !== sub.id);
  const m = openModal({
    size: 'lg', align: 'top',
    html: modalHeader({ title: escapeHtml(sub.studentName || 'Student'), subtitle: `${escapeHtml(item.title || '')} · submitted ${escapeHtml(formatDateTime(sub.submittedAt) || 'just now')}${isLate(sub, item) ? ' · <span class="text-red-400">late</span>' : ''}`, icon: 'award' }) + `
    <form novalidate>
      ${modalBody(`
        <div class="space-y-4 mb-6">
          ${sub.kind === 'quiz' || item.type === 'quiz' ? `
            <div class="p-4 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-between"><span class="text-sm text-gray-300">Auto-graded score</span><span class="font-serif text-2xl text-white">${escapeHtml(sub.score ?? '—')} / ${escapeHtml(sub.points || qs.length)}</span></div>
            <ol class="space-y-2 max-h-72 overflow-y-auto pr-1">${qs.map((q, i) => { const a = sub.answers?.[i]; const ok = a === q.answer; return `<li class="text-sm flex items-start gap-2">${ico(ok ? 'circle-check' : 'circle-x', 'w-4 h-4 mt-0.5 shrink-0 ' + (ok ? 'text-emerald-400' : 'text-red-400'))}<div><div class="text-gray-200">${escapeHtml(q.prompt)}</div><div class="text-xs text-gray-500">Answered: ${escapeHtml(q.choices[a] ?? '—')}${ok ? '' : ` · Correct: ${escapeHtml(q.choices[q.answer])}`}</div></div></li>`; }).join('')}</ol>`
          : `
            ${sub.content ? `<div><span class="label">Answer</span><div class="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed bg-[#0A0A0A] border border-white/[0.08] rounded-lg p-4 max-h-80 overflow-y-auto">${escapeHtml(sub.content)}</div></div>` : ''}
            ${url ? `<div><span class="label">Link</span><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 text-sm text-[#F59E0B] hover:underline break-all">${ico('external-link', 'w-3.5 h-3.5 shrink-0')} ${escapeHtml(url)}</a></div>` : ''}
            ${!sub.content && !url ? `<p class="text-sm text-gray-500 italic">Empty submission.</p>` : ''}`}
        </div>
        <div class="grid sm:grid-cols-[140px_1fr] gap-4">
          <div><label for="grade-val" class="label">Grade</label><div class="flex items-center gap-2"><input id="grade-val" type="number" min="0" step="0.5" inputmode="decimal" value="${hasGrade(sub) ? escapeHtml(sub.grade) : ''}" class="input !py-2.5" /><span class="text-sm text-gray-500 whitespace-nowrap">/ ${points}</span></div></div>
          <div><label for="grade-fb" class="label">Feedback <span class="normal-case tracking-normal text-gray-600">(visible to student)</span></label><textarea id="grade-fb" rows="3" class="input" placeholder="Great analysis — next time cite your sources.">${escapeHtml(sub.feedback || '')}</textarea></div>
        </div>
        <p id="grade-error" class="form-error mt-3 hidden" role="alert"></p>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary sm:flex-1">Close</button>${ungraded.length ? `<button type="submit" data-next class="btn btn-secondary sm:flex-1">Save & next ${ico('arrow-right', 'w-3.5 h-3.5')}</button>` : ''}<button type="submit" class="btn btn-primary sm:flex-1">Save grade</button>`)}
    </form>`
  });
  setTimeout(() => m.$('#grade-val').focus(), 60);
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const goNext = e.submitter?.hasAttribute('data-next');
    const raw = m.$('#grade-val').value.trim();
    const feedback = m.$('#grade-fb').value.trim();
    const err = m.$('#grade-error'); showError(err, '');
    const grade = raw === '' ? null : Number(raw);
    if (grade !== null && (!Number.isFinite(grade) || grade < 0)) return showError(err, 'Grade must be a number of 0 or more.');
    withBusy(e.submitter || m.$('[type=submit]'), 'Saving…', async () => {
      try {
        await updateDoc(doc(subsCol(ctx, courseId), sub.id), { grade, feedback: feedback || null, gradedBy: currentUser.uid, gradedAt: serverTimestamp() });
        if (grade !== null || feedback) {
          const what = grade !== null ? `${grade}/${itemPoints(item)}` : 'New feedback';
          const cTitle = layoutState.course?.title || 'your course';
          const mid = sub.moduleId || item.moduleId; const link = mid ? `/${ctx.slug}/course/${courseId}/item/${mid}/${item.id}` : `/${ctx.slug}/course/${courseId}/grades`;
          notify(ctx, { to: [sub.studentId], kind: 'grade', title: `${item.title || 'Assignment'} was graded`, body: `${what} in ${cTitle}${feedback ? ' · “' + feedback.slice(0, 120) + '”' : ''}`, link }).catch(e => console.warn(e));
          guardianUidsOf(ctx, [sub.studentId]).then(to => notify(ctx, { to, kind: 'grade', title: `${sub.studentName || 'Your student'}: ${item.title || 'assignment'} graded`, body: `${what} in ${cTitle}`, link: `/${ctx.slug}/record/${sub.studentId}/grades` })).catch(e => console.warn(e));
        }
        toast('Grade saved');
        m.close();
        if (goNext && ungraded[0]) openGradeModal(ctx, courseId, item, ungraded[0], allSubs.map(s => s.id === sub.id ? { ...s, grade } : s));
      } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// GRADES (teacher gradebook / student report)
// ═══════════════════════════════════════════════════════════════
async function loadGradedItems(ctx, courseId) {
  return (await loadAllItems(ctx, courseId)).filter(i => GRADED_TYPES.includes(i.type));
}
async function viewGrades(ctx, courseId) {
  const t = routeToken;
  const course = await loadCourse(ctx, courseId);
  if (!live(t)) return;
  if (!course) return viewNotFound();
  setTitle(ctx.teacherMode ? 'Gradebook' : 'Grades', course.title);
  render(tenantPage(ctx, 'grades', pageHeader({
    back: { href: `/${ctx.slug}/course/${courseId}`, label: course.title || 'Course' },
    lead: courseLead(course), eyebrow: escapeHtml(course.title || ''), title: ctx.teacherMode ? 'Gradebook' : 'My grades',
    actions: `${previewToggle(ctx)}${ctx.teacherMode ? `<a href="${buildUrl(`/${ctx.slug}/course/${courseId}/grades/term`)}" class="btn btn-secondary">${ico('file-text')} Report card grades</a><button id="export-csv" class="btn btn-secondary" disabled>${ico('download')} Export CSV</button>` : ''}`
  }) + `<div id="grades" class="max-w-6xl">${skeletonRows(6)}</div>`, course));
  const host = $('#grades');
  const itemHref = it => buildUrl(`/${ctx.slug}/course/${courseId}/item/${it.moduleId}/${it.id}`);
  try {
    if (ctx.teacherMode) {
      const [items, enr, subs] = await Promise.all([
        loadGradedItems(ctx, courseId),
        getDocs(collection(db, 'tenants', ctx.slug, 'courses', courseId, 'enrollments')),
        getDocs(subsCol(ctx, courseId)),
      ]);
      if (!live(t)) return;
      const students = enr.docs.map(d => ({ id: d.id, name: d.data().studentName || d.data().username || 'Student', username: d.data().username || '' })).sort((a, b) => a.name.localeCompare(b.name));
      const map = new Map();
      subs.docs.forEach(d => { const s = { id: d.id, ...d.data() }; const k = `${s.studentId}|${s.itemId}`; const prev = map.get(k); if (!prev || recency(s.submittedAt) > recency(prev.submittedAt)) map.set(k, s); });
      const totals = st => {
        let got = 0, max = 0;
        items.forEach(it => { const s = map.get(`${st.id}|${it.id}`); if (hasGrade(s)) { got += Number(s.grade); max += itemPoints(it); } });
        return max ? Math.round(got / max * 1000) / 10 : null;
      };
      if (!items.length || !students.length) {
        host.innerHTML = emptyState({ icon: 'award', tone: 'amber', title: !items.length ? 'Nothing to grade yet' : 'No students enrolled', text: !items.length ? 'Add an assignment or quiz to a module and it will appear here as a column.' : 'Enroll students from the People page.', action: !students.length ? `<a href="${buildUrl(`/${ctx.slug}/course/${courseId}/people`)}" class="btn btn-primary">${ico('user-plus')} Go to People</a>` : '' });
        refreshIcons(); return;
      }
      const now = new Date();
      host.innerHTML = `<p class="text-xs text-gray-500 mb-3">Totals count graded work only. Click a cell to open the item.</p>
        <div class="card overflow-auto max-h-[70vh]"><table class="gradebook w-full text-sm border-separate border-spacing-0">
          <thead><tr class="text-[11px] text-gray-400 text-left">
            <th class="sticky-col min-w-[180px]">Student</th><th class="text-right">Total</th>
            ${items.map(it => `<th class="max-w-[160px]"><a href="${itemHref(it)}" class="block truncate hover:text-[#F59E0B]" title="${escapeHtml(it.title)}">${escapeHtml(it.title || 'Untitled')}</a><span class="text-gray-600 font-normal">${typeMeta(it.type).label} · ${itemPoints(it)} pts</span></th>`).join('')}
          </tr></thead>
          <tbody>${students.map(st => {
            const tot = totals(st);
            return `<tr><td class="sticky-col"><div class="text-white truncate">${escapeHtml(st.name)}</div><div class="text-[11px] text-gray-500 font-mono">${escapeHtml(st.username)}</div></td>
              <td class="text-right font-medium tabular-nums ${tot === null ? 'text-gray-600' : tot >= 70 ? 'text-emerald-400' : tot >= 50 ? 'text-[#F59E0B]' : 'text-red-400'}">${tot === null ? '—' : tot + '%'}</td>
              ${items.map(it => {
                const s = map.get(`${st.id}|${it.id}`);
                const due = toDate(it.data?.dueDate);
                const cell = s ? gradeChip(s, itemPoints(it)) : (due && due < now ? `<span class="text-xs text-red-400/80">Missing</span>` : `<span class="text-gray-700">—</span>`);
                return `<td><a href="${itemHref(it)}" class="block">${cell}</a></td>`;
              }).join('')}</tr>`;
          }).join('')}</tbody></table></div>`;
      refreshIcons();
      const exp = $('#export-csv');
      exp.disabled = false;
      exp.addEventListener('click', () => {
        const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [['Student', 'Username', 'Total %', ...items.map(it => `${it.title} (${itemPoints(it)})`)]];
        students.forEach(st => rows.push([st.name, st.username, totals(st) ?? '', ...items.map(it => { const s = map.get(`${st.id}|${it.id}`); return hasGrade(s) ? s.grade : (s ? 'submitted' : ''); })]));
        const blob = new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `${slugify(course.title) || 'course'}-grades.csv`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('Gradebook exported');
      });
      return;
    }
    // Student view
    const [items, mineSnap] = await Promise.all([loadGradedItems(ctx, courseId), getDocs(query(subsCol(ctx, courseId), where('studentId', '==', currentUser.uid)))]);
    if (!live(t)) return;
    const mine = new Map();
    mineSnap.docs.forEach(d => { const s = { id: d.id, ...d.data() }; const p = mine.get(s.itemId); if (!p || recency(s.submittedAt) > recency(p.submittedAt)) mine.set(s.itemId, s); });
    let got = 0, max = 0;
    items.forEach(it => { const s = mine.get(it.id); if (hasGrade(s)) { got += Number(s.grade); max += itemPoints(it); } });
    const pct = max ? Math.round(got / max * 1000) / 10 : null;
    if (!items.length) { host.innerHTML = emptyState({ icon: 'award', title: 'No graded work yet', text: 'Assignments and quizzes will show up here.' }); refreshIcons(); return; }
    const now = new Date();
    host.innerHTML = `<div class="max-w-3xl">
      <div class="card p-6 mb-6 flex items-center gap-5">${iconTile('award', 'amber', 'tile-lg')}<div><div class="text-xs text-gray-500 uppercase tracking-wider">Current grade</div><div class="font-serif text-4xl text-white">${pct === null ? '—' : pct + '%'}</div><div class="text-xs text-gray-500">${max ? `${got} of ${max} points on graded work` : 'Nothing graded yet'}</div></div></div>
      ${dataTable(
        [{ label: 'Item', cls: 'col-span-12 sm:col-span-6' }, { label: 'Status', cls: 'col-span-6 sm:col-span-3' }, { label: 'Score', cls: 'col-span-6 sm:col-span-3 text-right' }],
        items.map(it => {
          const s = mine.get(it.id); const due = toDate(it.data?.dueDate);
          const status = hasGrade(s) ? badge('Graded', 'green') : s ? badge('Submitted', 'blue') : due && due < now ? badge('Missing', 'red') : badge('To do', 'muted');
          return { cells: [
            `<a href="${itemHref(it)}" class="flex items-center gap-3 hover:text-[#F59E0B] transition-colors">${iconTile(typeMeta(it.type).icon, 'muted')}<div class="min-w-0"><div class="text-sm text-white truncate">${escapeHtml(it.title || 'Untitled')}</div><div class="text-[11px] text-gray-500 truncate">${escapeHtml(it.moduleTitle || '')}${due ? ' · due ' + escapeHtml(formatDate(due)) : ''}</div></div></a>`,
            status,
            `<div class="text-right">${hasGrade(s) ? `<span class="text-sm text-white tabular-nums">${escapeHtml(s.grade)}<span class="text-gray-500">/${itemPoints(it)}</span></span>` : `<span class="text-xs text-gray-600">— / ${itemPoints(it)}</span>`}</div>`
          ] };
        }))}</div>`;
    refreshIcons();
  } catch (e) { console.error(e); if (live(t)) { host.innerHTML = errorBox(e); refreshIcons(); } }
}

// ═══════════════════════════════════════════════════════════════
// ROSTER
// ═══════════════════════════════════════════════════════════════
async function openEnrollModal(ctx, courseId) {
  const m = openModal({ html: modalHeader({ title: 'Enroll students', icon: 'user-plus' }) + `<div id="enroll-body">${modalBody(skeletonRows(4, 'h-10'))}</div>` });
  try {
    const [allSnap, enrolledSnap] = await Promise.all([
      getDocs(query(collection(db, 'tenants', ctx.slug, 'students'), where('status', '==', 'approved'))),
      getDocs(collection(db, 'tenants', ctx.slug, 'courses', courseId, 'enrollments'))
    ]);
    const enrolled = new Set(enrolledSnap.docs.map(d => d.id));
    const available = allSnap.docs.filter(d => !enrolled.has(d.id)).map(d => ({ id: d.id, ...d.data() })).sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
    const body = m.$('#enroll-body');
    if (!available.length) {
      body.innerHTML = modalBody(`<div class="text-center py-6"><p class="text-gray-400 text-sm mb-4">${allSnap.empty ? 'There are no approved students yet.' : 'Every approved student is already enrolled.'}</p><a href="${buildUrl(ctx.isAdmin && !ctx.isPersonal ? `/${ctx.slug}/admin/students` : `/${ctx.slug}/students`)}" class="btn btn-secondary btn-sm" data-close>${ico('user-plus', 'w-3.5 h-3.5')} Add students</a></div>`);
      refreshIcons(); body.querySelector('[data-close]').addEventListener('click', () => m.close()); return;
    }
    body.innerHTML = `<div class="px-5 sm:px-8 pt-5"><div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">${ico('search', 'w-3.5 h-3.5')}</span><input type="search" id="enroll-filter" class="input !py-2.5 pl-9" placeholder="Filter students…" aria-label="Filter students"></div>
        <label class="check mt-4 px-3"><input type="checkbox" id="enroll-all"> <span class="text-gray-400">Select all (${available.length})</span></label></div>
      <div class="max-h-[45vh] overflow-y-auto px-5 sm:px-8 py-3" id="enroll-list">${available.map(s => `
        <label class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] cursor-pointer transition-colors" data-filter-text="${escapeHtml(`${displayNameOf(s)} ${s.username || ''}`.toLowerCase())}">
          <input type="checkbox" value="${s.id}" class="w-4 h-4 accent-[#F59E0B]" />
          ${avatar(displayNameOf(s))}
          <div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(displayNameOf(s))}</div><div class="text-xs text-gray-500 font-mono truncate">${escapeHtml(s.username || '')}</div></div>
        </label>`).join('')}</div>
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button id="enroll-confirm" class="btn btn-primary flex-1" disabled>Enroll</button>`)}`;
    refreshIcons();
    body.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => m.close()));
    const boxes = () => [...body.querySelectorAll('#enroll-list input[type=checkbox]')];
    const visibleBoxes = () => boxes().filter(c => !c.closest('label').classList.contains('hidden'));
    const confirmBtn = m.$('#enroll-confirm');
    const sync = () => { const n = boxes().filter(c => c.checked).length; confirmBtn.disabled = !n; confirmBtn.textContent = n ? `Enroll ${plural(n, 'student')}` : 'Enroll'; };
    body.addEventListener('change', e => { if (e.target.id === 'enroll-all') visibleBoxes().forEach(c => { c.checked = e.target.checked; }); sync(); });
    m.$('#enroll-filter').addEventListener('input', e => { const f = e.target.value.trim().toLowerCase(); body.querySelectorAll('[data-filter-text]').forEach(l => l.classList.toggle('hidden', !!f && !l.dataset.filterText.includes(f))); });
    setTimeout(() => m.$('#enroll-filter').focus(), 50);
    confirmBtn.addEventListener('click', () => withBusy(confirmBtn, 'Enrolling…', async () => {
      const picked = available.filter(s => boxes().some(c => c.checked && c.value === s.id));
      try {
        await Promise.all(picked.map(async s => {
          await setDoc(doc(db, 'tenants', ctx.slug, 'courses', courseId, 'enrollments', s.id), { studentId: s.id, studentName: displayNameOf(s), username: s.username || '', enrolledAt: serverTimestamp() });
          await updateDoc(doc(db, 'tenants', ctx.slug, 'students', s.id), { enrolledCourseIds: arrayUnion(courseId) });
        }));
        m.close(); toast(`Enrolled ${plural(picked.length, 'student')}`);
      } catch (ex) { console.error(ex); toast(friendlyError(ex), 'error'); }
    }));
  } catch (e) { console.error(e); m.$('#enroll-body').innerHTML = modalBody(errorBox(e)); refreshIcons(); }
}

// ═══════════════════════════════════════════════════════════════
// STUDENTS
// ═══════════════════════════════════════════════════════════════
const loginText = (ctx, username, password) =>
  `${APP_NAME} login\nWebsite: ${location.origin}${buildUrl(`/login?school=${ctx.slug}&as=student`)}\nSchool: ${ctx.tenant.name}\nUsername: ${username}\nPassword: ${password || '(ask your teacher)'}`;
// Create a Firebase Auth login for someone else (admins, parents) without signing the current user out.
async function createLogin(email, password) {
  const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  await signOut(secondaryAuth);
  return cred.user.uid;
}
async function createStudentAccount(slug, { firstName, lastName, username, password }) {
  const fakeEmail = `${username}@${slug}.emberlms.local`;
  const cred = await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, password);
  await signOut(secondaryAuth);
  await setDoc(doc(db, 'tenants', slug, 'students', cred.user.uid), {
    username, firstName, lastName, displayName: `${firstName} ${lastName}`.trim(),
    email: fakeEmail, role: 'student', status: 'approved',
    // NOTE: stored so teachers can re-share logins. Lock this field down in your security rules.
    tempPassword: password, enrolledCourseIds: [],
    approvedBy: currentUser.uid, approvedAt: serverTimestamp(), createdAt: serverTimestamp()
  });
  return cred.user.uid;
}

function viewStudents(ctx) {
  const { slug, tenant } = ctx;
  setTitle('Students', tenant.name);
  render(tenantPage(ctx, 'students', pageHeader({
    eyebrow: escapeHtml(tenant.name), title: 'Students',
    actions: `<button id="bulk-btn" class="btn btn-secondary">${ico('list-plus')} Add a class</button><button id="add-student-btn" class="btn btn-primary">${ico('user-plus')} New student</button>`
  }) + `<div class="max-w-5xl"><div id="pending-section"></div>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-3"><p id="student-count" class="text-xs text-gray-500"></p>
      <div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">${ico('search', 'w-3.5 h-3.5')}</span><input id="student-filter" type="search" placeholder="Search students…" class="input !py-2 pl-9 w-56" aria-label="Search students"></div></div>
    <div id="student-list">${skeletonRows(6)}</div></div>`));
  $('#add-student-btn').addEventListener('click', () => openCreateStudentModal(ctx));
  $('#bulk-btn').addEventListener('click', () => openBulkStudentsModal(ctx));
  const pendingEl = $('#pending-section'), list = $('#student-list');
  let pending = [], students = [], filter = '';

  unsubs.push(onSnapshot(query(collection(db, 'tenants', slug, 'students'), where('status', '==', 'pending')), snap => {
    pending = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!pending.length) { pendingEl.innerHTML = ''; return; }
    pendingEl.innerHTML = `<div class="bg-[#F59E0B]/5 border border-[#F59E0B]/20 rounded-xl overflow-hidden mb-8">
      <div class="px-5 py-3 border-b border-[#F59E0B]/20 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">${ico('clock', 'w-4 h-4 text-[#F59E0B]')}<span class="text-sm text-[#F59E0B] font-medium">${plural(pending.length, 'student')} waiting for approval</span></div>
        ${pending.length > 1 ? `<button data-approve-all class="btn btn-primary btn-sm">Approve all</button>` : ''}
      </div>
      <div class="divide-y divide-white/[0.04]">${pending.map(s => `<div class="flex items-center px-5 py-3 gap-3">
        ${avatar(displayNameOf(s))}
        <div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(displayNameOf(s))}</div><div class="text-xs text-gray-500 font-mono truncate">${escapeHtml(s.username || '')} · requested ${escapeHtml(timeAgo(s.createdAt))}</div></div>
        <button data-approve="${s.id}" class="btn btn-primary btn-sm">Approve</button>
        <button data-reject="${s.id}" class="btn btn-secondary btn-sm">Reject</button></div>`).join('')}</div></div>`;
    refreshIcons();
  }, e => console.warn(e)));

  const draw = () => {
    if (!list.isConnected) return;
    const shown = students.filter(s => !filter || `${displayNameOf(s)} ${s.username}`.toLowerCase().includes(filter));
    $('#student-count').textContent = students.length ? `${plural(students.length, 'student')}${filter ? ` · ${shown.length} shown` : ''}` : '';
    if (!students.length) {
      list.innerHTML = emptyState({ icon: 'users', tone: 'amber', title: 'No students yet', text: `Create logins for your students, or share your school's address so they can sign up and you approve them.`, action: `<button data-empty-bulk class="btn btn-primary">${ico('list-plus')} Add a whole class</button>` });
      refreshIcons(); return;
    }
    if (!shown.length) { list.innerHTML = `<p class="text-sm text-gray-500 py-8 text-center">No students match “${escapeHtml(filter)}”.</p>`; return; }
    list.innerHTML = dataTable(
      [{ label: 'Name', cls: 'col-span-12 sm:col-span-4' }, { label: 'Username', cls: 'col-span-6 sm:col-span-3' }, { label: 'Status', cls: 'col-span-3 sm:col-span-2' }, { label: 'Courses', cls: 'hidden sm:block sm:col-span-1' }, { label: '', cls: 'col-span-3 sm:col-span-2 text-right' }],
      shown.map(s => {
        const st = s.status || 'approved';
        return {
          cells: [
            `<div class="flex items-center gap-3">${avatar(displayNameOf(s))}<span class="text-sm text-white truncate">${escapeHtml(displayNameOf(s))}</span></div>`,
            `<span class="text-sm text-gray-400 font-mono truncate block">${escapeHtml(s.username || '')}</span>`,
            st === 'approved' ? badge('Active', 'green') : badge(escapeHtml(st), 'red'),
            `<span class="text-xs text-gray-500">${(s.enrolledCourseIds || []).length}</span>`,
            `<div class="row-actions">
              ${st === 'rejected' ? `<button data-approve="${s.id}" class="btn-icon" aria-label="Approve">${ico('user-check', 'w-4 h-4')}</button>` : ''}
              <button data-copy-login="${s.id}" class="btn-icon" aria-label="Copy login details" title="Copy login details">${ico('key-round', 'w-4 h-4')}</button>
              <button data-delete-student="${s.id}" class="btn-icon danger" aria-label="Delete student">${ico('trash-2', 'w-4 h-4')}</button>
            </div>`
          ]
        };
      }));
    refreshIcons();
  };
  unsubs.push(onSnapshot(query(collection(db, 'tenants', slug, 'students'), orderBy('createdAt', 'desc')), snap => {
    students = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status !== 'pending');
    draw();
  }, e => { console.error(e); list.innerHTML = errorBox(e); refreshIcons(); }));
  $('#student-filter').addEventListener('input', e => { filter = e.target.value.trim().toLowerCase(); draw(); });

  $('#main').addEventListener('click', async e => {
    const t = e.target;
    const setStatus = (id, status) => updateDoc(doc(db, 'tenants', slug, 'students', id), { status, approvedBy: currentUser.uid, approvedAt: serverTimestamp() });
    try {
      if (t.closest('[data-empty-bulk]')) return openBulkStudentsModal(ctx);
      let b = t.closest('[data-approve]');
      if (b) { await setStatus(b.dataset.approve, 'approved'); return toast('Student approved'); }
      if (t.closest('[data-approve-all]')) {
        const b2 = writeBatch(db);
        pending.forEach(s => b2.update(doc(db, 'tenants', slug, 'students', s.id), { status: 'approved', approvedBy: currentUser.uid, approvedAt: serverTimestamp() }));
        await b2.commit(); return toast(`Approved ${plural(pending.length, 'student')}`);
      }
      b = t.closest('[data-reject]');
      if (b) {
        const s = pending.find(x => x.id === b.dataset.reject);
        if (await confirmDialog({ title: `Reject ${displayNameOf(s)}?`, message: 'They won\'t be able to access this school. You can approve them later from the student list.', confirmLabel: 'Reject', danger: true })) { await setStatus(b.dataset.reject, 'rejected'); toast('Student rejected', 'info'); }
        return;
      }
      b = t.closest('[data-copy-login]');
      if (b) { const s = students.find(x => x.id === b.dataset.copyLogin); return copyText(loginText(ctx, s.username, s.tempPassword), 'Login details copied'); }
      b = t.closest('[data-delete-student]');
      if (b) {
        const s = students.find(x => x.id === b.dataset.deleteStudent);
        if (!await confirmDialog({ title: `Delete ${displayNameOf(s)}?`, message: 'They will be removed from this school and all of its courses.', confirmLabel: 'Delete student', danger: true })) return;
        await Promise.all((s.enrolledCourseIds || []).map(cid => deleteDoc(doc(db, 'tenants', slug, 'courses', cid, 'enrollments', s.id)).catch(() => {})));
        await deleteDoc(doc(db, 'tenants', slug, 'students', s.id));
        toast('Student deleted');
      }
    } catch (ex) { console.error(ex); toast(friendlyError(ex), 'error'); }
  });
}

function openCreateStudentModal(ctx) {
  const m = openModal({
    html: modalHeader({ title: 'New student', subtitle: 'Create a username and password — no email needed.', icon: 'user-plus' }) + `
    <div id="cs-body"><form novalidate>
      ${modalBody(`
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div><label for="student-first" class="label">First name</label><input id="student-first" type="text" autocomplete="off" class="input" /></div>
          <div><label for="student-last" class="label">Last name</label><input id="student-last" type="text" autocomplete="off" class="input" /></div>
        </div>
        <label for="student-user" class="label">Username</label>
        <input id="student-user" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="auto-generated" class="input mb-4 font-mono text-sm" />
        <label for="student-pass" class="label">Password</label>
        <div class="flex gap-2"><input id="student-pass" type="text" autocomplete="off" class="input flex-1 font-mono text-sm" /><button id="regen-pass" type="button" class="btn btn-secondary !px-3" aria-label="Generate new password">${ico('refresh-cw')}</button></div>
        <p id="student-error" class="form-error mt-4 hidden" role="alert"></p>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">Create student</button>`)}
    </form></div>`
  });
  const firstEl = m.$('#student-first'), lastEl = m.$('#student-last'), userEl = m.$('#student-user'), passEl = m.$('#student-pass');
  passEl.value = genPassword();
  let existing = null;
  const updateUser = async () => {
    if (userEl.dataset.touched) return;
    const f = firstEl.value.trim(); if (!f) { userEl.value = ''; return; }
    if (existing === null) { existing = []; try { existing = (await getDocs(collection(db, 'tenants', ctx.slug, 'students'))).docs.map(d => d.data().username); } catch (e) {} }
    userEl.value = genUsername(f, lastEl.value.trim(), existing);
  };
  firstEl.addEventListener('input', updateUser);
  lastEl.addEventListener('input', updateUser);
  userEl.addEventListener('input', () => { userEl.dataset.touched = '1'; });
  m.$('#regen-pass').addEventListener('click', () => { passEl.value = genPassword(); });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const firstName = firstEl.value.trim(), lastName = lastEl.value.trim();
    const username = userEl.value.trim().toLowerCase(), password = passEl.value;
    const err = m.$('#student-error'); showError(err, '');
    if (!firstName) return showError(err, 'Enter a first name.');
    if (!/^[a-z0-9_.-]{3,20}$/.test(username)) return showError(err, 'Username must be 3–20 characters: lowercase letters, numbers, dots, dashes, underscores.');
    if (password.length < 6) return showError(err, 'Password must be at least 6 characters.');
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Creating…', async () => {
      try {
        await createStudentAccount(ctx.slug, { firstName, lastName, username, password });
        const text = loginText(ctx, username, password);
        m.$('#cs-body').innerHTML = modalBody(`
          <div class="text-center mb-5">${iconTile('circle-check', 'green', 'tile-lg mx-auto mb-3')}<p class="text-white font-medium">${escapeHtml(`${firstName} ${lastName}`.trim())} is ready to go</p><p class="text-xs text-gray-500">Share these details with them.</p></div>
          <pre class="bg-[#0A0A0A] border border-white/[0.08] rounded-lg p-4 text-xs text-gray-300 font-mono whitespace-pre-wrap break-all">${escapeHtml(text)}</pre>`) +
          modalFooter(`<button data-another class="btn btn-secondary flex-1">Add another</button><button data-copy class="btn btn-primary flex-1">${ico('copy')} Copy & close</button>`);
        refreshIcons();
        m.$('[data-copy]').addEventListener('click', () => { copyText(text, 'Login details copied'); m.close(); });
        m.$('[data-another]').addEventListener('click', () => { m.close(); openCreateStudentModal(ctx); });
      } catch (ex) {
        console.error(ex);
        showError(err, ex.code === 'auth/email-already-in-use' ? 'That username is already taken — try another.' : friendlyError(ex));
      }
    });
  });
}

function openBulkStudentsModal(ctx) {
  const m = openModal({
    size: 'lg',
    html: modalHeader({ title: 'Add a class', subtitle: 'Paste a list of names — logins are generated for everyone.', icon: 'list-plus' }) + `<div id="bulk-body">
      ${modalBody(`
        <label for="bulk-names" class="label">Student names</label>
        <textarea id="bulk-names" rows="9" class="input font-mono text-sm" placeholder="Ada Lovelace&#10;Alan Turing&#10;Grace Hopper"></textarea>
        <p class="hint">One student per line, “First Last”. You can paste straight from a spreadsheet column.</p>
        <p id="bulk-count" class="text-xs text-gray-400 mt-3"></p>
        <p id="bulk-error" class="form-error mt-3 hidden" role="alert"></p>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button id="bulk-go" class="btn btn-primary flex-1" disabled>Create accounts</button>`)}
    </div>`
  });
  const ta = m.$('#bulk-names'), go = m.$('#bulk-go');
  const parse = () => [...new Set(ta.value.split(/\r?\n/).map(l => l.replace(/[\t,;]+/g, ' ').trim()).filter(Boolean))];
  ta.addEventListener('input', () => { const n = parse().length; go.disabled = !n; m.$('#bulk-count').textContent = n ? `${plural(n, 'student')} will be created.` : ''; go.textContent = n ? `Create ${plural(n, 'account')}` : 'Create accounts'; });
  go.addEventListener('click', async () => {
    if (go.dataset.running) return;
    const names = parse();
    if (names.length > 200) return showError(m.$('#bulk-error'), 'Add at most 200 students at a time.');
    m.dismissible = false; go.dataset.running = '1'; go.disabled = true;
    let existing = [];
    try { existing = (await getDocs(collection(db, 'tenants', ctx.slug, 'students'))).docs.map(d => d.data().username); } catch (e) {}
    const results = [];
    const body = m.$('#bulk-body');
    body.innerHTML = modalBody(`<div class="py-8 text-center"><div class="mb-4">${ico('loader-circle', 'w-6 h-6 animate-spin mx-auto text-[#F59E0B]')}</div><p class="text-sm text-white" id="bulk-progress">Creating 1 of ${names.length}…</p><div class="mt-4 h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div id="bulk-bar" class="h-full bg-[#F59E0B] rounded-full transition-all" style="width:0%"></div></div><p class="hint mt-4">Keep this window open.</p></div>`);
    refreshIcons();
    for (let i = 0; i < names.length; i++) {
      const parts = names[i].split(/\s+/);
      const firstName = parts[0], lastName = parts.slice(1).join(' ');
      const username = genUsername(firstName, lastName, existing);
      const password = genPassword();
      $('#bulk-progress') && ($('#bulk-progress').textContent = `Creating ${i + 1} of ${names.length}…`);
      try {
        await createStudentAccount(ctx.slug, { firstName, lastName, username, password });
        existing.push(username);
        results.push({ name: names[i], username, password, ok: true });
      } catch (e) {
        if (e.code === 'auth/email-already-in-use') existing.push(username);
        results.push({ name: names[i], ok: false, error: friendlyError(e) });
      }
      $('#bulk-bar') && ($('#bulk-bar').style.width = `${Math.round((i + 1) / names.length * 100)}%`);
    }
    const ok = results.filter(r => r.ok);
    const tsv = 'Name\tUsername\tPassword\n' + ok.map(r => `${r.name}\t${r.username}\t${r.password}`).join('\n');
    body.innerHTML = modalBody(`
      <div class="flex items-center gap-3 mb-4">${iconTile(ok.length === results.length ? 'circle-check' : 'triangle-alert', ok.length === results.length ? 'green' : 'amber')}<div><p class="text-white text-sm font-medium">${plural(ok.length, 'account')} created</p>${ok.length < results.length ? `<p class="text-xs text-red-400">${results.length - ok.length} failed — see below.</p>` : '<p class="text-xs text-gray-500">Copy these now and share them with your students.</p>'}</div></div>
      <div class="card overflow-hidden max-h-[45vh] overflow-y-auto"><table class="w-full text-sm"><thead class="text-[10px] uppercase tracking-wider text-gray-500 text-left"><tr class="border-b border-white/[0.06]"><th class="px-4 py-2 font-medium">Name</th><th class="px-4 py-2 font-medium">Username</th><th class="px-4 py-2 font-medium">Password</th></tr></thead>
      <tbody class="divide-y divide-white/[0.04]">${results.map(r => `<tr><td class="px-4 py-2 text-white">${escapeHtml(r.name)}</td>${r.ok ? `<td class="px-4 py-2 font-mono text-gray-300">${escapeHtml(r.username)}</td><td class="px-4 py-2 font-mono text-gray-300">${escapeHtml(r.password)}</td>` : `<td colspan="2" class="px-4 py-2 text-xs text-red-400">${escapeHtml(r.error)}</td>`}</tr>`).join('')}</tbody></table></div>`) +
      modalFooter(`<button data-close-final class="btn btn-secondary flex-1">Done</button>${ok.length ? `<button data-copy-csv class="btn btn-primary flex-1">${ico('copy')} Copy as spreadsheet</button>` : ''}`);
    refreshIcons();
    m.dismissible = true;
    m.$('[data-close-final]').addEventListener('click', () => m.close());
    m.$('[data-copy-csv]')?.addEventListener('click', () => copyText(tsv, 'Copied — paste into a spreadsheet'));
  });
}

// ═══════════════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════
function viewAnnouncements(ctx) {
  const { slug, tenant } = ctx;
  setTitle('Announcements', tenant.name);
  const col = collection(db, 'tenants', slug, 'announcements');
  const subtitle = ctx.isPersonal ? 'Everyone in this classroom will see it.' : 'Everyone at this school will see it.';
  render(tenantPage(ctx, 'announcements', pageHeader({
    eyebrow: escapeHtml(tenant.name), title: ctx.isPersonal ? 'Announcements' : 'School announcements',
    actions: `${previewToggle(ctx)}${ctx.teacherMode ? `<button id="new-ann-btn" class="btn btn-primary">${ico('megaphone')} Post announcement</button>` : ''}`
  }) + `<div id="ann-list" class="max-w-3xl space-y-4">${skeletonRows(3, 'h-32')}</div>`));
  $('#new-ann-btn')?.addEventListener('click', () => openAnnouncementModal(ctx, null, col, subtitle));
  mountAnnouncementList(ctx, $('#ann-list'), col, ctx.teacherMode, subtitle);
}
function mountAnnouncementList(ctx, el, col, canPost, subtitle) {
  let docs = [];
  unsubs.push(onSnapshot(query(col, orderBy('createdAt', 'desc'), limit(50)), snap => {
    docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!docs.length) {
      el.innerHTML = emptyState({ icon: 'megaphone', tone: 'amber', title: 'No announcements yet', text: canPost ? subtitle : 'Updates from your teachers will appear here.', action: canPost ? `<button data-new-ann class="btn btn-primary">${ico('plus')} Post the first one</button>` : '' });
      refreshIcons(); return;
    }
    el.innerHTML = docs.map(a => `<article class="card p-5 sm:p-6 group">
      <header class="flex items-start justify-between gap-3 mb-4">
        <div class="flex items-center gap-3 min-w-0">${avatar(a.authorName || 'Teacher', a.authorPhoto)}<div class="min-w-0"><h2 class="font-serif text-lg text-white leading-snug">${escapeHtml(a.title || 'Untitled')}</h2><p class="text-xs text-gray-500">${escapeHtml(a.authorName || 'Teacher')} · <time title="${escapeHtml(formatDateTime(a.createdAt))}">${escapeHtml(timeAgo(a.createdAt))}</time></p></div></div>
        ${canPost ? `<div class="row-actions shrink-0"><button data-edit-ann="${a.id}" class="btn-icon" aria-label="Edit">${ico('pencil', 'w-3.5 h-3.5')}</button><button data-del-ann="${a.id}" class="btn-icon danger" aria-label="Delete">${ico('trash-2', 'w-3.5 h-3.5')}</button></div>` : ''}
      </header>
      <div class="prose-ember text-sm">${sanitize(a.content || '')}</div>
    </article>`).join('');
    refreshIcons();
  }, e => { console.error(e); el.innerHTML = errorBox(e); refreshIcons(); }));
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-new-ann]')) return openAnnouncementModal(ctx, null, col, subtitle);
    const ed = e.target.closest('[data-edit-ann]');
    if (ed) return openAnnouncementModal(ctx, docs.find(d => d.id === ed.dataset.editAnn), col, subtitle);
    const b = e.target.closest('[data-del-ann]'); if (!b) return;
    if (!await confirmDialog({ title: 'Delete this announcement?', confirmLabel: 'Delete', danger: true })) return;
    try { await deleteDoc(doc(col, b.dataset.delAnn)); toast('Announcement deleted'); }
    catch (ex) { toast(friendlyError(ex), 'error'); }
  });
}
function openAnnouncementModal(ctx, existing, col, subtitle = '') {
  const m = openModal({
    size: 'lg', align: 'top',
    html: modalHeader({ title: existing ? 'Edit announcement' : 'New announcement', subtitle: escapeHtml(subtitle), icon: 'megaphone' }) + `
    <form novalidate>
      ${modalBody(`<div class="space-y-5">
        <div><label for="an-title" class="label">Title</label><input id="an-title" type="text" value="${escapeHtml(existing?.title || '')}" placeholder="Welcome to week 5!" autocomplete="off" class="input" /></div>
        <div><span class="label">Message</span><div class="editor-box"><div data-editor></div></div></div>
        <p id="an-error" class="form-error hidden" role="alert"></p></div>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${ico('send', 'w-4 h-4')} ${existing ? 'Save' : 'Post'}</button>`)}
    </form>`
  });
  const editor = mountEditor(m.$('[data-editor]'), { html: existing?.content || '', toolbar: 'basic', placeholder: 'Write your announcement…' });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const title = m.$('#an-title').value.trim(), content = editor.getHTML();
    const err = m.$('#an-error'); showError(err, '');
    if (!title) return showError(err, 'Add a title.');
    if (!content) return showError(err, 'Write a message.');
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Posting…', async () => {
      try {
        if (existing) await updateDoc(doc(col, existing.id), { title, content, updatedAt: serverTimestamp() });
        else await addDoc(col, { title, content, authorUid: currentUser.uid, authorName: ctx.me.name || currentUser.email || 'Teacher', authorPhoto: currentUser.photoURL || null, createdAt: serverTimestamp() });
        m.close(); toast(existing ? 'Announcement updated' : 'Announcement posted');
      } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// LESSON PLANS
// ═══════════════════════════════════════════════════════════════
const PLAN_STATUS = {
  draft: ['Draft', 'muted'], submitted: ['Submitted', 'amber'],
  changes_requested: ['Changes requested', 'red'], reviewed: ['Approved', 'green'],
};
const planBadge = s => { const [l, t] = PLAN_STATUS[s] || PLAN_STATUS.draft; return badge(l, t); };
function planTitleCell(p) {
  return `<div class="min-w-0"><div class="text-sm text-white truncate">${escapeHtml(p.title || 'Untitled')}</div>
    <div class="text-xs text-gray-500 truncate">${escapeHtml(describeWeek(p.week) || 'No week')}${weekDateRange(p.week) ? ' · ' + escapeHtml(weekDateRange(p.week)) : ''}${p.subject ? ' · ' + escapeHtml(p.subject) : ''}</div></div>`;
}
function planTable(plans, mode) {
  if (mode === 'own') return dataTable(
    [{ label: 'Plan', cls: 'col-span-12 sm:col-span-6' }, { label: 'Updated', cls: 'hidden sm:block sm:col-span-2' }, { label: 'Status', cls: 'col-span-6 sm:col-span-2' }, { label: '', cls: 'col-span-6 sm:col-span-2 text-right' }],
    plans.map(p => ({ cells: [
      `<button data-plan-open="${p.id}" class="text-left w-full hover:opacity-80">${planTitleCell(p)}</button>`,
      `<span class="text-xs text-gray-500">${escapeHtml(timeAgo(p.updatedAt))}</span>`,
      `<div class="flex items-center gap-1.5">${planBadge(p.status)}${p.reviewComment ? `<span title="Has feedback">${ico('message-square', 'w-3.5 h-3.5 text-[#A78BFA]')}</span>` : ''}</div>`,
      `<div class="row-actions"><button data-plan-open="${p.id}" class="btn-icon" aria-label="Edit">${ico('pencil', 'w-3.5 h-3.5')}</button><button data-plan-dup="${p.id}" class="btn-icon" aria-label="Duplicate to next week" title="Duplicate to next week">${ico('copy', 'w-3.5 h-3.5')}</button><button data-plan-del="${p.id}" class="btn-icon danger" aria-label="Delete">${ico('trash-2', 'w-3.5 h-3.5')}</button></div>`
    ] })));
  const showSchool = mode === 'district';
  return dataTable(
    [{ label: 'Plan', cls: 'col-span-12 sm:col-span-5' }, { label: showSchool ? 'School · teacher' : 'Teacher', cls: 'col-span-12 sm:col-span-3' }, { label: 'Status', cls: 'col-span-6 sm:col-span-2' }, { label: '', cls: 'col-span-6 sm:col-span-2 text-right' }],
    plans.map(p => ({ cells: [
      planTitleCell(p),
      `<div class="flex items-center gap-2 min-w-0">${avatar(p.teacherName || 'Teacher', null, 'w-6 h-6', 'text-[9px]')}<div class="min-w-0">${showSchool ? `<div class="text-xs text-gray-300 truncate">${escapeHtml(p._schoolName || '')}</div>` : ''}<div class="text-xs ${showSchool ? 'text-gray-500' : 'text-gray-300'} truncate">${escapeHtml(p.teacherName || '')}</div></div></div>`,
      planBadge(p.status),
      `<button data-plan-review="${p.id}" data-school="${escapeHtml(p._schoolId || '')}" class="btn ${p.status === 'submitted' ? 'btn-violet' : 'btn-secondary'} btn-sm">${p.status === 'submitted' ? 'Review' : 'Open'}</button>`
    ] })));
}
function mountPlanList(plans, { mode, defaultFilter = 'all', onOpen, onReview, onDup, onDel }) {
  const filtersEl = $('#plan-filters'), listEl = $('#plans-list');
  const filters = mode === 'own'
    ? [['all', 'All'], ['draft', 'Drafts'], ['submitted', 'Submitted'], ['changes_requested', 'Changes requested'], ['reviewed', 'Approved']]
    : [['submitted', 'Needs review'], ['changes_requested', 'Changes requested'], ['reviewed', 'Approved'], ['all', 'All']];
  let f = defaultFilter;
  const draw = () => {
    const count = k => k === 'all' ? plans.length : plans.filter(p => (p.status || 'draft') === k).length;
    filtersEl.innerHTML = `<div class="segmented flex-wrap" role="group" aria-label="Filter plans">${filters.map(([k, l]) => `<button data-f="${k}" aria-pressed="${f === k}">${l}<span class="text-[10px] text-gray-500 tabular-nums">${count(k)}</span></button>`).join('')}</div>`;
    const shown = f === 'all' ? plans : plans.filter(p => (p.status || 'draft') === f);
    listEl.innerHTML = shown.length ? planTable(shown, mode) : emptyState({
      icon: 'clipboard-check', tone: mode === 'own' ? 'amber' : 'violet',
      title: !plans.length ? (mode === 'own' ? 'No lesson plans yet' : 'No plans submitted yet') : f === 'submitted' && mode !== 'own' ? 'All caught up!' : 'Nothing here',
      text: !plans.length && mode === 'own' ? 'Write your first weekly plan and submit it for review.' : (f === 'submitted' && mode !== 'own' ? 'There are no plans waiting for review.' : 'Try a different filter.')
    });
    refreshIcons();
  };
  filtersEl.onclick = e => { const b = e.target.closest('[data-f]'); if (b) { f = b.dataset.f; draw(); } };
  listEl.onclick = e => {
    const pick = attr => { const b = e.target.closest(`[${attr}]`); return b ? plans.find(p => p.id === b.getAttribute(attr) && (!b.dataset.school || p._schoolId === b.dataset.school)) : null; };
    let p;
    if ((p = pick('data-plan-open'))) return onOpen?.(p);
    if ((p = pick('data-plan-review'))) return onReview?.(p);
    if ((p = pick('data-plan-dup'))) return onDup?.(p);
    if ((p = pick('data-plan-del'))) return onDel?.(p);
  };
  draw();
}

async function viewPlanning(ctx) {
  const { slug, tenant } = ctx;
  const t = routeToken;
  setTitle('Lesson plans', tenant.name);
  render(tenantPage(ctx, 'planning', pageHeader({
    eyebrow: escapeHtml(tenant.name), title: 'My lesson plans', subtitle: 'Write weekly plans and submit them for admin review.',
    actions: `<button id="new-plan-btn" class="btn btn-primary">${ico('plus')} New plan</button>`
  }) + `<div class="max-w-5xl"><div id="plan-filters" class="mb-4"></div><div id="plans-list">${skeletonRows(4)}</div></div>`));
  $('#new-plan-btn').addEventListener('click', () => openPlanEditor(ctx));
  try {
    const snap = await getDocs(query(collection(db, 'tenants', slug, 'plans'), where('teacherUid', '==', currentUser.uid)));
    if (!live(t)) return;
    const plans = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => recency(b.updatedAt) - recency(a.updatedAt));
    mountPlanList(plans, {
      mode: 'own',
      onOpen: p => openPlanEditor(ctx, p),
      onDup: p => openPlanEditor(ctx, { title: p.title, subject: p.subject, content: p.content, week: shiftWeek(p.week || currentISOWeek(), 1) }),
      onDel: async p => {
        if (!await confirmDialog({ title: `Delete “${p.title || 'plan'}”?`, confirmLabel: 'Delete', danger: true })) return;
        try { await deleteDoc(doc(db, 'tenants', slug, 'plans', p.id)); toast('Plan deleted'); renderRoute(); } catch (e) { toast(friendlyError(e), 'error'); }
      }
    });
  } catch (e) { console.error(e); if (live(t)) { $('#plans-list').innerHTML = errorBox(e); refreshIcons(); } }
}
function openPlanEditor(ctx, existing = null) {
  const isEdit = !!existing?.id;
  const plan = { title: '', week: currentISOWeek(), subject: '', content: '', status: 'draft', ...(existing || {}) };
  const mon = weekMonday(plan.week) || new Date();
  const m = openModal({
    size: 'xl', align: 'top',
    html: modalHeader({ title: isEdit ? 'Edit lesson plan' : 'New lesson plan', subtitle: isEdit ? planBadge(plan.status) : 'Save a draft any time, then submit for review.', icon: 'clipboard-check' }) + `
    <form novalidate>
      ${modalBody(`<div class="space-y-5">
        ${plan.reviewComment ? `<div class="p-4 rounded-lg ${plan.status === 'changes_requested' ? 'bg-red-500/5 border border-red-500/20' : 'bg-[#8B5CF6]/5 border border-[#8B5CF6]/20'}"><p class="label ${plan.status === 'changes_requested' ? '!text-red-400' : '!text-[#A78BFA]'}">Admin feedback</p><p class="text-sm text-gray-300 whitespace-pre-wrap">${escapeHtml(plan.reviewComment)}</p></div>` : ''}
        <div><label for="plan-title" class="label">Title</label><input id="plan-title" type="text" value="${escapeHtml(plan.title)}" placeholder="Photosynthesis — light reactions" autocomplete="off" class="input" /></div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div><label for="plan-week" class="label">Week of</label><input id="plan-week" type="date" value="${toDateInput(mon)}" class="input" /><p id="plan-week-label" class="hint">${escapeHtml(describeWeek(plan.week))} · ${escapeHtml(weekDateRange(plan.week))}</p></div>
          <div><label for="plan-subject" class="label">Subject</label><input id="plan-subject" type="text" value="${escapeHtml(plan.subject || '')}" placeholder="Biology" autocomplete="off" class="input" /></div>
        </div>
        <div><div class="flex items-center justify-between mb-2"><span class="label !mb-0">Plan</span><button type="button" id="plan-template" class="text-xs text-gray-500 hover:text-[#F59E0B] transition-colors">Insert template</button></div><div class="editor-box"><div data-editor></div></div></div>
        <p id="plan-error" class="form-error hidden" role="alert"></p></div>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary sm:flex-1">Cancel</button><button type="button" id="plan-save-draft" class="btn btn-secondary sm:flex-1">Save draft</button><button type="submit" class="btn btn-primary sm:flex-1">${ico('send', 'w-4 h-4')} Submit for review</button>`)}
    </form>`
  });
  const editor = mountEditor(m.$('[data-editor]'), { html: plan.content, placeholder: 'Objectives, activities, materials, assessment…' });
  const weekInput = m.$('#plan-week');
  const weekOf = () => { const v = weekInput.value; return v ? isoWeekOf(new Date(v + 'T12:00:00')) : ''; };
  weekInput.addEventListener('change', () => { const w = weekOf(); m.$('#plan-week-label').textContent = w ? `${describeWeek(w)} · ${weekDateRange(w)}` : ''; });
  m.$('#plan-template').addEventListener('click', async () => {
    if (!editor.quill) return;
    if (!isEmptyRichText(editor.getHTML()) && !await confirmDialog({ title: 'Replace with template?', message: 'Your current plan text will be replaced.', confirmLabel: 'Replace' })) return;
    editor.quill.clipboard.dangerouslyPasteHTML('<h2>Learning objectives</h2><ul><li>Students will be able to…</li></ul><h2>Standards</h2><p></p><h2>Activities</h2><ol><li>Warm-up (5 min)</li><li>Direct instruction (15 min)</li><li>Guided practice (15 min)</li><li>Exit ticket (5 min)</li></ol><h2>Materials</h2><ul><li></li></ul><h2>Assessment</h2><p></p><h2>Differentiation</h2><p></p>');
  });
  const save = (submit, btn) => {
    const title = m.$('#plan-title').value.trim(), week = weekOf(), subject = m.$('#plan-subject').value.trim();
    const err = m.$('#plan-error'); showError(err, '');
    if (!title) return showError(err, 'Add a title.');
    if (!week) return showError(err, 'Pick the week this plan is for.');
    const content = editor.getHTML();
    if (submit && !content) return showError(err, 'Write the plan before submitting it.');
    withBusy(btn, submit ? 'Submitting…' : 'Saving…', async () => {
      const payload = { title, week, subject, content, teacherUid: currentUser.uid, teacherName: ctx.me.name || currentUser.email || 'Teacher', status: submit ? 'submitted' : (plan.status === 'reviewed' || plan.status === 'changes_requested' ? plan.status : 'draft'), updatedAt: serverTimestamp() };
      if (submit) payload.submittedAt = serverTimestamp();
      try {
        if (isEdit) await updateDoc(doc(db, 'tenants', ctx.slug, 'plans', plan.id), payload);
        else await addDoc(collection(db, 'tenants', ctx.slug, 'plans'), { ...payload, createdAt: serverTimestamp(), reviewComment: null, reviewedBy: null, reviewedAt: null });
        if (submit) officeStaffUids(ctx).then(to => notify(ctx, { to, kind: 'plan', title: `${payload.teacherName} submitted a lesson plan`, body: `${title}${week ? ' · week of ' + week : ''}`, link: `/${ctx.slug}/admin/planning` })).catch(e => console.warn(e));
        m.close(); toast(submit ? 'Submitted for review' : 'Draft saved'); renderRoute();
      } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
    });
  };
  m.$('#plan-save-draft').addEventListener('click', e => save(false, e.currentTarget));
  m.$('form').addEventListener('submit', e => { e.preventDefault(); save(true, e.currentTarget.querySelector('[type=submit]')); });
}
async function viewAdminPlanning(ctx) {
  const { slug, tenant } = ctx;
  const t = routeToken;
  setTitle('Plan reviews', tenant.name);
  render(tenantPage(ctx, 'admin-planning', pageHeader({ eyebrow: 'Admin', title: 'Lesson plan reviews', subtitle: `Teacher plans for ${escapeHtml(tenant.name)}.` }) +
    `<div class="max-w-5xl"><div id="plan-filters" class="mb-4"></div><div id="plans-list">${skeletonRows(4)}</div></div>`));
  try {
    const snap = await getDocs(collection(db, 'tenants', slug, 'plans'));
    if (!live(t)) return;
    const plans = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.status !== 'draft').sort((a, b) => recency(b.updatedAt) - recency(a.updatedAt));
    mountPlanList(plans, { mode: 'review', defaultFilter: 'submitted', onReview: p => openPlanReviewModal(slug, p, () => renderRoute()) });
  } catch (e) { console.error(e); if (live(t)) { $('#plans-list').innerHTML = errorBox(e); refreshIcons(); } }
}
function openPlanReviewModal(slug, plan, onDone) {
  const m = openModal({
    size: 'xl', align: 'top',
    html: modalHeader({ title: escapeHtml(plan.title || 'Untitled'), subtitle: `${escapeHtml(plan.teacherName || '')} · ${escapeHtml(describeWeek(plan.week))} · ${escapeHtml(weekDateRange(plan.week))}`, icon: 'clipboard-check', tone: 'violet' }) + `
    <form novalidate>
      ${modalBody(`
        <div class="flex flex-wrap items-center gap-2 mb-4">${planBadge(plan.status)}${plan.subject ? badge(escapeHtml(plan.subject), 'muted') : ''}${plan.submittedAt ? `<span class="text-xs text-gray-500">submitted ${escapeHtml(timeAgo(plan.submittedAt))}</span>` : ''}</div>
        <div class="prose-ember bg-[#0A0A0A] border border-white/[0.08] rounded-lg p-5 sm:p-6 mb-6 max-h-[45vh] overflow-y-auto">${sanitize(plan.content) || '<p class="text-gray-500 italic">No content.</p>'}</div>
        <label for="rv-comment" class="label">Feedback for ${escapeHtml(plan.teacherName || 'the teacher')}</label>
        <textarea id="rv-comment" rows="4" class="input" placeholder="Looks great! Consider adding more group work on Thursday…">${escapeHtml(plan.reviewComment || '')}</textarea>
        <p id="rv-error" class="form-error mt-3 hidden" role="alert"></p>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary sm:flex-1">Close</button><button type="submit" data-status="changes_requested" class="btn btn-secondary sm:flex-1">${ico('rotate-ccw', 'w-4 h-4')} Request changes</button><button type="submit" data-status="reviewed" class="btn btn-violet sm:flex-1">${ico('check', 'w-4 h-4')} Approve</button>`)}
    </form>`
  });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const status = e.submitter?.dataset.status || 'reviewed';
    const comment = m.$('#rv-comment').value.trim();
    const err = m.$('#rv-error'); showError(err, '');
    if (status === 'changes_requested' && !comment) { m.$('#rv-comment').focus(); return showError(err, 'Explain what should change.'); }
    withBusy(e.submitter, 'Saving…', async () => {
      try {
        await updateDoc(doc(db, 'tenants', slug, 'plans', plan.id), { reviewComment: comment || null, status, reviewedBy: currentUser.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        notify({ slug, me: { name: currentUser.displayName || currentUser.email || '' } }, { to: [plan.teacherUid], kind: 'plan', title: status === 'reviewed' ? `Lesson plan approved: ${plan.title || ''}` : `Changes requested: ${plan.title || ''}`, body: comment || '', link: `/${slug}/planning` }).catch(e => console.warn(e));
        m.close(); toast(status === 'reviewed' ? 'Plan approved' : 'Changes requested'); onDone?.();
      } catch (ex) { console.error(ex); showError(err, friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SCHOOL ADMIN
// ═══════════════════════════════════════════════════════════════
async function viewAdminOverview(ctx) {
  const { slug, tenant } = ctx;
  const t = routeToken;
  setTitle('Admin', tenant.name);
  render(tenantPage(ctx, 'admin-overview', pageHeader({ eyebrow: 'Admin', title: escapeHtml(tenant.name), subtitle: escapeHtml(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) }) +
    `<div id="admin-content" class="max-w-6xl"><div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">${Array.from({ length: 4 }, () => '<div class="skeleton h-32"></div>').join('')}</div><div class="skeleton h-48"></div></div>`));
  try {
    const studentsCol = collection(db, 'tenants', slug, 'students');
    const failed = [];
    const safe = (p, fallback) => p.catch(e => { console.warn(e); failed.push(e); return fallback; });
    const [teacherCount, studentCount, pendingCount, courseCount, plansSnap, fresh] = await Promise.all([
      countOf(collection(db, 'tenants', slug, 'users')),
      countOf(query(studentsCol, where('status', '==', 'approved'))),
      countOf(query(studentsCol, where('status', '==', 'pending'))),
      countOf(collection(db, 'tenants', slug, 'courses')),
      safe(getDocs(query(collection(db, 'tenants', slug, 'plans'), where('status', '==', 'submitted'))), { docs: [] }),
      safe(getTenant(slug, { fresh: true }), tenant),
    ]);
    let joinCode = await getJoinCode(slug, fresh || tenant);
    if (!joinCode) joinCode = await safe(setJoinCode(slug), '');
    if (!live(t)) return;
    const toReview = plansSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => recency(b.submittedAt) - recency(a.submittedAt));
    const p = s => buildUrl(`/${slug}${s}`);
    const pendingPlans = toReview.length;
    $('#admin-content').innerHTML = `
      ${failed.length ? `<div class="mb-6 p-4 rounded-xl bg-red-500/5 border border-red-500/20 text-sm text-gray-300 flex gap-3">${ico('triangle-alert', 'w-4 h-4 text-red-400 shrink-0 mt-0.5')}<span>Some data couldn't be loaded: ${escapeHtml(friendlyError(failed[0]))} Check that your Firestore security rules are published.</span></div>` : ''}
      <div id="today-kpis" class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">${Array.from({ length: 4 }, () => '<div class="skeleton h-28"></div>').join('')}</div>
      <div class="grid lg:grid-cols-3 gap-6 mb-8">
        <section class="lg:col-span-2"><div class="flex items-center justify-between mb-3"><h2 class="font-serif text-xl text-white">Needs attention</h2></div>
          <div id="today-todo">${skeletonRows(3)}</div>
          ${pendingPlans ? `<div class="card overflow-hidden mt-4"><div class="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between"><h3 class="text-sm text-white font-medium">${plural(pendingPlans, 'lesson plan')} to review</h3><a href="${p('/admin/planning')}" class="text-xs text-[#F59E0B] hover:underline">All plans →</a></div>
            <div class="divide-y divide-white/[0.04]">${toReview.slice(0, 4).map(pl => `<button data-review="${pl.id}" class="w-full text-left flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">${avatar(pl.teacherName || 'T')}<div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${escapeHtml(pl.title || 'Untitled plan')}</div><div class="text-xs text-gray-500 truncate">${escapeHtml(pl.teacherName || '')}${pl.week ? ' · ' + escapeHtml(pl.week) : ''}</div></div>${badge('Review', 'amber')}</button>`).join('')}</div></div>` : ''}
        </section>
        <aside class="space-y-4">
          ${tenant.type === 'personal' ? '' : `<div class="card p-5"><p class="label">Teacher join code</p>
            <div class="flex items-center gap-2 mb-2"><code class="text-2xl font-mono text-[#F59E0B] tracking-[0.2em]">${escapeHtml(joinCode || '——')}</code>
              <button id="copy-join-code" class="btn-icon" aria-label="Copy join code" title="Copy">${ico('copy')}</button><button id="regen-join-code" class="btn-icon" aria-label="Generate a new join code" title="Regenerate">${ico('refresh-cw')}</button></div>
            <p class="text-xs text-gray-500 leading-relaxed">Teachers enter this at sign-up to join ${escapeHtml(tenant.name)}.</p></div>`}
          <div class="card p-5"><p class="label">At a glance</p><div class="grid grid-cols-2 gap-3">
            ${[['graduation-cap', 'Students', studentCount, p('/admin/students'), pendingCount ? `${pendingCount} pending` : ''], ['user-cog', 'Staff', teacherCount, p('/admin/teachers'), ''], ['book-open', 'Courses', courseCount, p('/admin/courses'), ''], ['clipboard-check', 'Plans to review', pendingPlans, p('/admin/planning'), '']]
              .map(([i, l, v, h, sub]) => `<a href="${h}" class="rounded-lg border border-white/[0.06] p-3 hover:border-white/20 transition-colors">${ico(i, 'w-4 h-4 text-gray-500')}<div class="text-xl text-white font-semibold mt-1 tabular-nums">${v.toLocaleString()}</div><div class="text-[11px] text-gray-500">${l}${sub ? ` · <span class="text-[#F59E0B]">${sub}</span>` : ''}</div></a>`).join('')}</div></div>
          <div class="card p-5"><p class="label">Quick actions</p><div class="space-y-2">
            <a href="${p('/staff/new/referral')}" class="flex items-center gap-2 text-sm text-gray-300 hover:text-[#F59E0B] transition-colors">${ico('flag')} Write a referral</a>
            <a href="${p('/announcements')}" class="flex items-center gap-2 text-sm text-gray-300 hover:text-[#F59E0B] transition-colors">${ico('megaphone')} Post an announcement</a>
            <a href="${p('/admin/students')}" class="flex items-center gap-2 text-sm text-gray-300 hover:text-[#F59E0B] transition-colors">${ico('user-plus')} Add students</a>
            <a href="${p('/admin/parents')}" class="flex items-center gap-2 text-sm text-gray-300 hover:text-[#F59E0B] transition-colors">${ico('users')} Add a parent</a>
          </div></div>
        </aside>
      </div>`;
    import('./sis.js' + BUILD).then(m => m.officeToday(ctx)).then(r => { if (!live(t) || !$('#today-kpis')) return; $('#today-kpis').innerHTML = r.tiles || ''; $('#today-todo').innerHTML = r.todo; refreshIcons(); })
      .catch(e => { console.warn(e); if (live(t) && $('#today-todo')) { $('#today-todo').innerHTML = errorBox(e); refreshIcons(); } });
    refreshIcons();
    $('#copy-join-code')?.addEventListener('click', () => copyText(joinCode, 'Join code copied'));
    $('#regen-join-code')?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Generate a new join code?', message: 'The current code will stop working immediately. Teachers who already joined are not affected.', confirmLabel: 'Regenerate' })) return;
      try { await setJoinCode(slug, joinCode); toast('New join code generated'); renderRoute(); }
      catch (e) { toast(friendlyError(e), 'error'); }
    });
    $('#admin-content').addEventListener('click', e => {
      const b = e.target.closest('[data-review]'); if (!b) return;
      const pl = toReview.find(x => x.id === b.dataset.review);
      if (pl) openPlanReviewModal(slug, pl, () => renderRoute());
    });
  } catch (e) { console.error(e); if (live(t)) { $('#admin-content').innerHTML = errorBox(e); refreshIcons(); } }
}

async function viewAdminTeachers(ctx) {
  const { slug, tenant } = ctx;
  const t = routeToken;
  setTitle('Teachers & staff', tenant.name);
  render(tenantPage(ctx, 'admin-teachers', pageHeader({ eyebrow: 'Admin', title: 'Teachers & staff', subtitle: 'Roles and access. Student services and Safety access let counselors, case managers and deans use those SIS tools without being admins.', actions: `<button id="invite-teacher-btn" class="btn btn-primary">${ico('user-plus')} Invite teachers</button>` }) +
    `<div id="teachers-list" class="max-w-5xl">${skeletonRows(5)}</div>`));
  $('#invite-teacher-btn').addEventListener('click', async () => openInviteTeacherModal(tenant, await getJoinCode(slug, tenant)));
  try {
    const [teachersSnap, coursesSnap] = await Promise.all([getDocs(collection(db, 'tenants', slug, 'users')), getDocs(collection(db, 'tenants', slug, 'courses'))]);
    if (!live(t)) return;
    const courseCount = {}; coursesSnap.docs.forEach(d => { const o = d.data().ownerUid; courseCount[o] = (courseCount[o] || 0) + 1; });
    const teachers = teachersSnap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => (b.role === 'admin') - (a.role === 'admin') || displayNameOf(a).localeCompare(displayNameOf(b)));
    const el = $('#teachers-list');
    el.innerHTML = !teachers.length ? emptyState({ icon: 'user-cog', title: 'No teachers yet' }) : dataTable(
      [{ label: 'Name', cls: 'col-span-12 sm:col-span-5' }, { label: 'Role', cls: 'col-span-4 sm:col-span-2' }, { label: 'Courses', cls: 'col-span-4 sm:col-span-2' }, { label: '', cls: 'col-span-4 sm:col-span-3 text-right' }],
      teachers.map(x => {
        const isSelf = x.uid === currentUser.uid, isOwner = x.uid === tenant.ownerUid;
        return { cells: [
          `<div class="flex items-center gap-3">${avatar(displayNameOf(x), x.photoURL)}<div class="min-w-0"><div class="text-sm text-white truncate">${escapeHtml(displayNameOf(x))}${isSelf ? ' <span class="text-[10px] text-[#F59E0B] ml-1">You</span>' : ''}</div><div class="text-xs text-gray-500 truncate">${escapeHtml(x.email || '')}</div></div></div>`,
          `<div class="flex flex-wrap gap-1">${x.role === 'admin' ? badge(isOwner ? 'Owner' : 'Admin', 'violet') : badge('Teacher')}${x.role !== 'admin' ? (x.caps || []).map(c => badge(STAFF_CAPS[c] || c, 'blue')).join('') : ''}</div>`,
          `<span class="text-xs text-gray-500">${plural(courseCount[x.uid] || 0, 'course')}</span>`,
          isSelf || isOwner ? '<span class="text-[10px] text-gray-600 block text-right">—</span>' : `<div class="row-actions">
            ${x.role !== 'admin' ? `<button data-caps="${x.uid}" class="btn-icon" aria-label="Access for ${escapeHtml(displayNameOf(x))}" title="Access">${ico('key-round', 'w-3.5 h-3.5')}</button>` : ''}
            <button data-toggle-role="${x.uid}" class="btn btn-ghost btn-sm">${ico(x.role === 'admin' ? 'shield-off' : 'shield-check', 'w-3.5 h-3.5')} ${x.role === 'admin' ? 'Make teacher' : 'Make admin'}</button>
            <button data-remove-teacher="${x.uid}" class="btn-icon danger" aria-label="Remove from school">${ico('trash-2', 'w-3.5 h-3.5')}</button></div>`
        ] };
      }));
    refreshIcons();
    el.addEventListener('click', async e => {
      const cp = e.target.closest('[data-caps]');
      if (cp) {
        const x = teachers.find(tt => tt.uid === cp.dataset.caps);
        const m = openModal({ size: 'sm', html: `<form class="p-6 sm:p-7" novalidate><h2 class="font-serif text-xl text-white mb-1">Access for ${escapeHtml(displayNameOf(x))}</h2><p class="text-sm text-gray-500 mb-5">Extra tools beyond teaching. Admins already have everything.</p>
          <div class="space-y-3">${Object.entries(STAFF_CAPS).map(([k, l]) => `<label class="check"><input type="checkbox" data-cap="${k}" ${(x.caps || []).includes(k) ? 'checked' : ''}> <span><span class="text-white">${l}</span><span class="block text-xs text-gray-500">${STAFF_CAP_HELP[k]}</span></span></label>`).join('')}</div>
          <div class="flex gap-3 mt-6"><button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button class="btn btn-primary flex-1">Save</button></div></form>` });
        m.$('form').addEventListener('submit', ev => {
          ev.preventDefault();
          const caps = m.$$('[data-cap]').filter(c => c.checked).map(c => c.dataset.cap);
          withBusy(ev.currentTarget.querySelector('button:not([data-close])'), 'Saving…', async () => {
            try { await updateDoc(doc(db, 'tenants', slug, 'users', x.uid), { caps }); m.close(); toast('Access updated'); renderRoute(); } catch (ex) { toast(friendlyError(ex), 'error'); }
          });
        });
        return;
      }
      const r = e.target.closest('[data-toggle-role]'), d = e.target.closest('[data-remove-teacher]');
      const x = teachers.find(tt => tt.uid === (r?.dataset.toggleRole || d?.dataset.removeTeacher)); if (!x) return;
      try {
        if (r) {
          const newRole = x.role === 'admin' ? 'teacher' : 'admin';
          if (!await confirmDialog({ title: `Make ${displayNameOf(x)} ${newRole === 'admin' ? 'an admin' : 'a teacher'}?`, message: newRole === 'admin' ? 'Admins can manage teachers, students, courses and review lesson plans.' : '', confirmLabel: 'Change role' })) return;
          await updateDoc(doc(db, 'tenants', slug, 'users', x.uid), { role: newRole }); toast('Role updated'); renderRoute();
        } else {
          if (!await confirmDialog({ title: `Remove ${displayNameOf(x)}?`, message: 'They will lose access to this school. Their courses stay in place.', confirmLabel: 'Remove', danger: true })) return;
          await deleteDoc(doc(db, 'tenants', slug, 'users', x.uid)); toast('Teacher removed'); renderRoute();
        }
      } catch (ex) { toast(friendlyError(ex), 'error'); }
    });
  } catch (e) { console.error(e); if (live(t)) { $('#teachers-list').innerHTML = errorBox(e); refreshIcons(); } }
}
const STAFF_CAPS = { services: 'Special ed · 504 · ELL', safety: 'Discipline & safety', health: 'Health / nurse', records: 'Records / registrar' };
const STAFF_CAP_HELP = { services: 'IEP / 504 / ELL caseloads, accommodations, confidential notes.', safety: 'View and manage the incident log; see every reported concern.',
  health: 'Edit allergies, medications, immunizations, screenings and nurse visits.', records: 'Edit test scores, academic history, graduation checks and busing.' };
function openInviteTeacherModal(tenant, joinCode) {
  const signupUrl = location.origin + buildUrl('/signup');
  const msg = `You're invited to join ${tenant.name} on ${APP_NAME}.\n\n1. Go to ${signupUrl}\n2. Choose "I'm a teacher" → "Join my school"\n3. Enter the join code: ${joinCode || ''}`;
  const m = openModal({
    html: modalHeader({ title: 'Invite teachers', subtitle: `Share this code so teachers can join ${escapeHtml(tenant.name)}.`, icon: 'user-plus' }) + modalBody(`
      <div class="bg-[#0A0A0A] border border-white/[0.08] rounded-xl p-6 mb-5 text-center">
        <p class="label">Join code</p>
        <code class="text-4xl font-mono text-[#F59E0B] tracking-[0.3em] block">${escapeHtml(joinCode || '——')}</code>
      </div>
      <ol class="text-sm text-gray-400 space-y-2 list-decimal pl-5">
        <li>Go to <span class="text-[#F59E0B] break-all">${escapeHtml(signupUrl)}</span></li>
        <li>Choose <span class="text-white">I'm a teacher</span> → <span class="text-white">Join my school</span></li>
        <li>Enter the code above</li>
      </ol>`) + modalFooter(`<button data-copy-code class="btn btn-secondary flex-1">${ico('copy')} Copy code</button><button data-copy-msg class="btn btn-primary flex-1">${ico('mail')} Copy invite message</button>`)
  });
  m.$('[data-copy-code]').addEventListener('click', () => copyText(joinCode || '', 'Join code copied'));
  m.$('[data-copy-msg]').addEventListener('click', () => { copyText(msg, 'Invite message copied'); m.close(); });
}

async function viewAdminCourses(ctx) {
  const { slug, tenant } = ctx;
  const t = routeToken;
  setTitle('All courses', tenant.name);
  render(tenantPage(ctx, 'admin-courses', pageHeader({ eyebrow: 'Admin', title: 'All courses', subtitle: `Every course in ${escapeHtml(tenant.name)}.` }) +
    `<div id="courses-list" class="max-w-6xl grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">${skeletonCards(3)}</div>`));
  try {
    const [coursesSnap, teachersSnap] = await Promise.all([getDocs(collection(db, 'tenants', slug, 'courses')), getDocs(collection(db, 'tenants', slug, 'users'))]);
    const teachers = {}; teachersSnap.docs.forEach(d => { teachers[d.id] = d.data(); });
    const courses = coursesSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => recency(b.createdAt) - recency(a.createdAt));
    const counts = await Promise.all(courses.map(c => countOf(collection(db, 'tenants', slug, 'courses', c.id, 'enrollments'))));
    if (!live(t)) return;
    const el = $('#courses-list');
    if (!courses.length) { el.innerHTML = `<div class="col-span-full">${emptyState({ icon: 'book-open', title: 'No courses yet', text: 'Courses your teachers create will appear here.' })}</div>`; refreshIcons(); return; }
    el.innerHTML = courses.map((c, i) => {
      const tn = teachers[c.ownerUid] ? displayNameOf(teachers[c.ownerUid]) : 'Unknown teacher';
      return `<div class="card card-hover overflow-hidden relative group">
        <a href="${buildUrl(`/${slug}/course/${c.id}`)}" class="absolute inset-0 z-10" aria-label="Open ${escapeHtml(c.title || 'course')}"></a>
        <div class="${gradOf(c)} h-16 relative"><div class="absolute inset-0 grad-pattern opacity-30"></div></div>
        <div class="p-5">
          <p class="text-xs text-gray-500 mb-1 truncate">${escapeHtml(c.code || ' ')}</p>
          <h3 class="font-serif text-lg text-white mb-3 truncate">${escapeHtml(c.title || 'Untitled')}</h3>
          <div class="flex items-center gap-2 mb-3">${avatar(tn, teachers[c.ownerUid]?.photoURL, 'w-6 h-6', 'text-[9px]')}<span class="text-xs text-gray-400 truncate">${escapeHtml(tn)}</span></div>
          <div class="flex justify-between items-center text-xs text-gray-500"><span>${plural(counts[i], 'student')}</span><a href="${buildUrl(`/${slug}/course/${c.id}/roster`)}" class="relative z-20 hover:text-[#F59E0B] transition-colors">Roster →</a></div>
        </div></div>`;
    }).join('');
    refreshIcons();
  } catch (e) { console.error(e); if (live(t)) { $('#courses-list').innerHTML = `<div class="col-span-full">${errorBox(e)}</div>`; refreshIcons(); } }
}

// ═══════════════════════════════════════════════════════════════
// SHARED COURSE DATA
// ═══════════════════════════════════════════════════════════════
const GRAD_HEX = { 'grad-amber': '#F59E0B', 'grad-violet': '#8B5CF6', 'grad-teal': '#14B8A6', 'grad-rose': '#F43F5E', 'grad-blue': '#3B82F6', 'grad-emerald': '#10B981' };
const courseHex = c => GRAD_HEX[gradOf(c)] || '#F59E0B';
const courseCol = (ctx, courseId, name) => collection(db, 'tenants', ctx.slug, 'courses', courseId, name);
const cHref = (ctx, courseId, sub = '') => buildUrl(`/${ctx.slug}/course/${courseId}${sub ? '/' + sub : ''}`);
const itemHref = (ctx, it) => buildUrl(`/${ctx.slug}/course/${it.courseId}/item/${it.moduleId}/${it.id}`);
function goHref(href) { if (href !== location.pathname + location.search) history.pushState(null, '', href); renderRoute(); }
const searchBox = (id, ph) => `<div class="relative w-full sm:w-64"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">${ico('search', 'w-3.5 h-3.5')}</span><input id="${id}" type="search" placeholder="${ph}" class="input !py-2 pl-9" aria-label="${ph}"></div>`;
const panel = (title, body) => `<section class="card p-5"><h2 class="label">${title}</h2><div class="space-y-0.5">${body}</div></section>`;
const sectionHeader = (ctx, course, title, actions = '') => pageHeader({ eyebrow: escapeHtml(course.title || ''), title, actions: previewToggle(ctx) + actions });
function formatBytes(n) { if (!n) return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024))); return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`; }

const coursesCache = { key: null, at: 0, list: null };
function invalidateCourses() { coursesCache.key = null; }
async function myCourses(ctx, { fresh = false } = {}) {
  const key = `${ctx.slug}|${ctx.me.uid}|${ctx.isRealTeacher}|${ctx.isGuardian}`;
  if (!fresh && coursesCache.key === key && Date.now() - coursesCache.at < 30000) return coursesCache.list;
  let list;
  if (ctx.isGuardian) {
    const ids = [...new Set((ctx.children || []).flatMap(k => k.enrolledCourseIds || []))];
    list = (await Promise.all(ids.map(id => getDoc(doc(db, 'tenants', ctx.slug, 'courses', id)).then(c => c.exists() ? { id: c.id, ...c.data() } : null).catch(() => null)))).filter(Boolean);
  } else if (ctx.isRealTeacher) {
    const base = collection(db, 'tenants', ctx.slug, 'courses');
    // Personal classrooms show everything; in a school each teacher sees the courses they own.
    list = (await getDocs(ctx.isPersonal ? base : query(base, where('ownerUid', '==', ctx.me.uid)))).docs.map(d => ({ id: d.id, ...d.data() }));
  } else {
    const s = await getDoc(doc(db, 'tenants', ctx.slug, 'students', ctx.me.uid));
    const ids = (s.exists() && s.data().enrolledCourseIds) || [];
    list = (await Promise.all(ids.map(id => getDoc(doc(db, 'tenants', ctx.slug, 'courses', id)).then(c => c.exists() ? { id: c.id, ...c.data() } : null).catch(() => null)))).filter(Boolean);
  }
  if (!ctx.isRealTeacher) list = list.filter(c => c.published !== false); // unpublished courses are hidden from students & families
  list.sort((a, b) => recency(b.createdAt) - recency(a.createdAt));
  Object.assign(coursesCache, { key, at: Date.now(), list });
  return list;
}
const favKey = ctx => `ember_favs:${ctx.me.uid}:${ctx.slug}`;
function getFavs(ctx) { try { return JSON.parse(ls(favKey(ctx)) || '[]'); } catch { return []; } }
function toggleFav(ctx, id) { const f = new Set(getFavs(ctx)); f.has(id) ? f.delete(id) : f.add(id); ls(favKey(ctx), JSON.stringify([...f])); return f.has(id); }

// Modules + items for a course, fetched once per page view.
const contentCache = new Map();
function loadCourseContent(ctx, courseId) {
  if (contentCache.has(courseId)) return contentCache.get(courseId);
  const p = (async () => {
    const mods = await getDocs(query(courseCol(ctx, courseId, 'modules'), orderBy('position', 'asc')));
    const modules = mods.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
    const per = await Promise.all(mods.docs.map(async md => (await getDocs(query(collection(md.ref, 'items'), orderBy('position', 'asc'))))
      .docs.map(d => ({ id: d.id, ref: d.ref, moduleId: md.id, moduleTitle: md.data().title, courseId, ...d.data() }))));
    return { modules, items: per.flat() };
  })();
  contentCache.set(courseId, p);
  p.catch(() => contentCache.delete(courseId));
  return p;
}
const loadAllItems = (ctx, courseId) => loadCourseContent(ctx, courseId).then(r => r.items);
async function mySubmissionMap(ctx, courseId) {
  const snap = await getDocs(query(subsCol(ctx, courseId), where('studentId', '==', ctx.me.uid)));
  const m = new Map();
  snap.docs.forEach(d => { const s = { id: d.id, ...d.data() }; const p = m.get(s.itemId); if (!p || recency(s.submittedAt) > recency(p.submittedAt)) m.set(s.itemId, s); });
  return m;
}
async function coursePeople(ctx, course) {
  let teacherName = course.ownerName;
  if (!teacherName && ctx.isRealTeacher && course.ownerUid) {
    try { const u = await getDoc(doc(db, 'tenants', ctx.slug, 'users', course.ownerUid)); if (u.exists()) teacherName = displayNameOf(u.data()); } catch (e) {}
  }
  const out = course.ownerUid ? [{ uid: course.ownerUid, name: teacherName || 'Teacher', role: 'Teacher' }] : [];
  if (ctx.isGuardian) return out; // families message teachers, not classmates
  try {
    (await getDocs(courseCol(ctx, course.id, 'enrollments'))).docs.forEach(d => out.push({ uid: d.id, name: d.data().studentName || d.data().username || 'Student', username: d.data().username || '', role: 'Student', enrolledAt: d.data().enrolledAt }));
  } catch (e) { console.warn(e); }
  return out;
}
async function pickModule(ctx, courseId) {
  const mods = (await getDocs(query(courseCol(ctx, courseId, 'modules'), orderBy('position', 'asc')))).docs.map(d => ({ id: d.id, ...d.data() }));
  return new Promise(resolve => {
    let result = null;
    const m = openModal({
      size: 'sm', onClose: () => resolve(result), html: `
      <form class="p-6 sm:p-7" novalidate>
        <h2 class="font-serif text-xl text-white mb-1">Add to which module?</h2>
        <p class="text-sm text-gray-500 mb-5">Course content lives inside modules.</p>
        ${mods.length ? `<label class="label" for="pm-sel">Module</label><select id="pm-sel" class="input mb-4">${mods.map(x => `<option value="${x.id}">${escapeHtml(x.title || 'Untitled')}</option>`).join('')}<option value="__new">+ New module…</option></select>` : ''}
        <div id="pm-new" class="${mods.length ? 'hidden' : ''}"><label class="label" for="pm-name">New module name</label><input id="pm-name" class="input" value="${mods.length ? '' : 'General'}" autocomplete="off" /></div>
        <p id="pm-error" class="form-error mt-3 hidden"></p>
        <div class="flex gap-3 mt-6"><button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">Continue</button></div>
      </form>` });
    const sel = m.$('#pm-sel');
    sel?.addEventListener('change', () => { m.$('#pm-new').classList.toggle('hidden', sel.value !== '__new'); if (sel.value === '__new') m.$('#pm-name').focus(); });
    m.$('form').addEventListener('submit', async e => {
      e.preventDefault();
      if (sel && sel.value !== '__new') { result = sel.value; return m.close(); }
      const title = m.$('#pm-name').value.trim();
      if (!title) return showError(m.$('#pm-error'), 'Name the new module.');
      await withBusy(m.$('[type=submit]'), 'Creating…', async () => {
        try { const ref = await addDoc(courseCol(ctx, courseId, 'modules'), { title, position: Date.now(), createdAt: serverTimestamp() }); result = ref.id; m.close(); }
        catch (ex) { showError(m.$('#pm-error'), friendlyError(ex)); }
      });
    });
  });
}
function todoRow(ctx, it, { course = null, note = '' } = {}) {
  const due = toDate(it.data?.dueDate);
  return `<a href="${itemHref(ctx, it)}" class="flex items-start gap-3 p-2.5 -mx-2.5 rounded-lg hover:bg-white/[0.04] transition-colors">
    <div class="tile tile-muted !w-8 !h-8 mt-0.5">${ico(typeMeta(it.type).icon, 'w-3.5 h-3.5')}</div>
    <div class="min-w-0 flex-1"><div class="text-sm text-white truncate">${escapeHtml(it.title || 'Untitled')}</div>
      ${course ? `<div class="text-[11px] truncate" style="color:${courseHex(course)}">${escapeHtml(course.code || course.title || '')}</div>` : ''}
      <div class="text-[11px] text-gray-500">${note || (due ? `${itemPoints(it)} pts · ${escapeHtml(formatDateTime(due))}` : '')}</div></div></a>`;
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD & ALL COURSES
// ═══════════════════════════════════════════════════════════════
async function viewDashboard(ctx) {
  const t = routeToken;
  const { slug, tenant } = ctx;
  setTitle('Dashboard', tenant.name);
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const first = String(ctx.me.name || '').split(/\s+/)[0];
  render(tenantPage(ctx, 'dashboard', pageHeader({
    eyebrow: escapeHtml(tenant.name), title: 'Dashboard', subtitle: `${greeting}${first ? ', ' + escapeHtml(first) : ''}.`,
    actions: `${previewToggle(ctx)}${ctx.teacherMode ? `<button id="add-course-btn" class="btn btn-primary">${ico('plus')} New course</button>` : ''}`
  }) + `<div class="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-8 max-w-7xl">
      <div class="min-w-0"><div id="ann-strip"></div><div id="fav-note" class="text-xs text-gray-500 mb-3"></div>
        <div id="course-grid" class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-5">${skeletonCards(3)}</div></div>
      <aside id="dash-side" class="space-y-6">${skeletonRows(3, 'h-24')}</aside>
    </div>`));
  $('#add-course-btn')?.addEventListener('click', () => openCourseModal(ctx));
  mountAnnouncementStrip(ctx);
  const grid = $('#course-grid');
  let courses = [];
  grid.addEventListener('click', async e => {
    const b = e.target.closest('[data-course-action]'); if (!b) return;
    e.preventDefault();
    const c = courses.find(x => x.id === b.dataset.id); if (!c) return;
    if (b.dataset.courseAction === 'edit') return openCourseModal(ctx, c);
    if (await confirmDialog({ title: `Delete “${c.title}”?`, message: 'All modules, items, enrollments and submissions in this course will be permanently deleted.', confirmLabel: 'Delete course', danger: true })) {
      try { await deleteCourseDeep(slug, c.id); invalidateCourses(); toast('Course deleted'); renderRoute(); } catch (ex) { toast(friendlyError(ex), 'error'); }
    }
  });
  try {
    courses = await myCourses(ctx, { fresh: true });
    if (!live(t)) return;
    const favs = getFavs(ctx).filter(id => courses.some(c => c.id === id));
    const shown = favs.length ? courses.filter(c => favs.includes(c.id)) : courses;
    const allLink = `<a href="${buildUrl(`/${slug}/courses`)}" class="text-[#F59E0B] hover:underline">All courses</a>`;
    $('#fav-note').innerHTML = favs.length ? `Showing your ${plural(favs.length, 'favorite')} · ${allLink}` : courses.length > 1 ? `Star courses on ${allLink} to pin them here.` : '';
    grid.innerHTML = shown.length ? shown.map(c => renderCourseCard(ctx, c, favs.includes(c.id))).join('')
      : `<div class="col-span-full">${emptyState({ icon: 'book-open', tone: 'amber', title: 'No courses yet', text: ctx.teacherMode ? 'Create your first course to start adding modules, assignments and quizzes.' : "Your teacher hasn't added you to any courses yet.", action: ctx.teacherMode ? `<button data-new-course class="btn btn-primary">${ico('plus')} Create a course</button>` : '' })}</div>`;
    refreshIcons();
    grid.querySelector('[data-new-course]')?.addEventListener('click', () => openCourseModal(ctx));
    renderDashSide(ctx, courses, t);
  } catch (e) { console.error(e); if (live(t)) { grid.innerHTML = `<div class="col-span-full">${errorBox(e)}</div>`; $('#dash-side').innerHTML = ''; refreshIcons(); } }
}
function mountAnnouncementStrip(ctx) {
  const host = $('#ann-strip');
  unsubs.push(onSnapshot(query(collection(db, 'tenants', ctx.slug, 'announcements'), orderBy('createdAt', 'desc'), limit(1)), snap => {
    if (!host.isConnected) return;
    if (snap.empty) { host.innerHTML = ''; return; }
    const a = snap.docs[0].data();
    const d = document.createElement('div'); d.innerHTML = sanitize(a.content || '');
    host.innerHTML = `<a href="${buildUrl(`/${ctx.slug}/announcements`)}" class="card card-hover flex items-center gap-4 p-4 mb-6 group">
      ${iconTile('megaphone', 'amber')}
      <div class="flex-1 min-w-0"><div class="flex items-center gap-2"><span class="text-sm text-white font-medium truncate">${escapeHtml(a.title || 'Announcement')}</span><span class="text-[11px] text-gray-500 shrink-0">${escapeHtml(timeAgo(a.createdAt))}</span></div>
      <p class="text-xs text-gray-500 truncate">${escapeHtml(d.textContent.trim())}</p></div>
      ${ico('chevron-right', 'w-4 h-4 text-gray-600 group-hover:text-[#F59E0B] transition-colors shrink-0')}</a>`;
    refreshIcons();
  }, () => { host.innerHTML = ''; }));
}
function renderCourseCard(ctx, c, fav = false) {
  const grad = gradOf(c);
  const hidden = new Set(ctx.studentView ? (c.navHidden || []) : []);
  const quick = [['announcements', 'megaphone', 'Announcements'], ['assignments', 'clipboard-list', 'Assignments'], ['discussions', 'messages-square', 'Discussions'], ['files', 'folder', 'Files']].filter(q => !hidden.has(q[0]));
  return `<div class="card card-hover overflow-hidden group relative flex flex-col">
    <a href="${cHref(ctx, c.id)}" class="absolute inset-0 z-10 rounded-[.85rem]" aria-label="Open ${escapeHtml(c.title || 'course')}"></a>
    <div class="${grad} h-28 relative"><div class="absolute inset-0 grad-pattern opacity-30"></div>
      ${fav ? `<span class="absolute top-2.5 left-2.5 z-20 text-white/90" title="Favorite">${ico('star', 'w-4 h-4 fill-current')}</span>` : ''}
      ${ctx.teacherMode ? `<div class="row-actions absolute top-2 right-2 z-20">
        <button data-course-action="edit" data-id="${c.id}" class="p-1.5 bg-black/30 hover:bg-black/50 rounded-md text-white/90 transition-colors" aria-label="Edit course">${ico('pencil', 'w-3.5 h-3.5')}</button>
        <button data-course-action="delete" data-id="${c.id}" class="p-1.5 bg-black/30 hover:bg-red-500/80 rounded-md text-white/90 transition-colors" aria-label="Delete course">${ico('trash-2', 'w-3.5 h-3.5')}</button>
      </div>` : ''}
    </div>
    <div class="px-4 pt-4 pb-2">
      <h3 class="font-serif text-lg truncate" style="color:${courseHex(c)}">${escapeHtml(c.title || 'Untitled')}</h3>
      <p class="text-xs text-gray-400 truncate">${escapeHtml(c.code || ' ')}</p>
      <p class="text-[11px] text-gray-600 truncate">${escapeHtml(c.term || ' ')}</p>
    </div>
    <div class="relative z-20 flex items-center gap-0.5 px-2.5 pb-2.5 mt-auto">${quick.map(([k, i, l]) => `<a href="${cHref(ctx, c.id, k)}" class="btn-icon" aria-label="${l}" title="${l}">${ico(i)}</a>`).join('')}</div>
  </div>`;
}
async function renderDashSide(ctx, courses, t) {
  const side = $('#dash-side'); if (!side) return;
  if (!courses.length) { side.innerHTML = ''; return; }
  const byId = Object.fromEntries(courses.map(c => [c.id, c]));
  const now = Date.now();
  try {
    const items = (await Promise.all(courses.map(c => loadAllItems(ctx, c.id).catch(() => [])))).flat().filter(i => GRADED_TYPES.includes(i.type));
    let html = '';
    if (ctx.studentView) {
      const maps = await Promise.all(courses.map(c => mySubmissionMap(ctx, c.id).catch(() => new Map())));
      const done = new Set(), feedback = [];
      maps.forEach((m, i) => m.forEach((s, itemId) => { done.add(itemId); if (hasGrade(s) || s.feedback) feedback.push({ s, course: courses[i] }); }));
      const todo = items.filter(i => !done.has(i.id) && tsMillis(i.data?.dueDate) >= now - 7 * 864e5).sort((a, b) => tsMillis(a.data.dueDate) - tsMillis(b.data.dueDate)).slice(0, 7);
      html += panel('To do', todo.length ? todo.map(i => todoRow(ctx, i, { course: byId[i.courseId], note: tsMillis(i.data.dueDate) < now ? `<span class="text-red-400">Missing · was due ${escapeHtml(formatDate(i.data.dueDate))}</span>` : '' })).join('') : `<p class="text-sm text-gray-500">Nothing due — you're all caught up.</p>`);
      feedback.sort((a, b) => recency(b.s.gradedAt) - recency(a.s.gradedAt));
      const itemById = Object.fromEntries(items.map(i => [i.id, i]));
      html += panel('Recent feedback', feedback.length ? feedback.slice(0, 4).map(({ s, course }) => {
        const it = itemById[s.itemId];
        return it ? todoRow(ctx, it, { course, note: `${hasGrade(s) ? `<span class="text-white">${escapeHtml(s.grade)}/${itemPoints(it)}</span>` : ''}${s.feedback ? ` · “${escapeHtml(s.feedback.slice(0, 60))}${s.feedback.length > 60 ? '…' : ''}”` : ''}` }) : '';
      }).join('') : `<p class="text-sm text-gray-500">No feedback yet.</p>`);
    } else {
      const subs = (await Promise.all(courses.map(c => getDocs(subsCol(ctx, c.id)).then(s => s.docs.map(d => d.data())).catch(() => [])))).flat();
      const toGrade = new Map();
      subs.filter(s => !hasGrade(s)).forEach(s => toGrade.set(s.itemId, (toGrade.get(s.itemId) || 0) + 1));
      const grading = items.filter(i => toGrade.has(i.id)).sort((a, b) => toGrade.get(b.id) - toGrade.get(a.id)).slice(0, 7);
      html += panel('To grade', grading.length ? grading.map(i => todoRow(ctx, i, { course: byId[i.courseId], note: `<span class="text-[#F59E0B]">${plural(toGrade.get(i.id), 'submission')} to grade</span>` })).join('') : `<p class="text-sm text-gray-500">No ungraded submissions.</p>`);
      const soon = items.filter(i => { const d = tsMillis(i.data?.dueDate); return d >= now && d <= now + 14 * 864e5; }).sort((a, b) => tsMillis(a.data.dueDate) - tsMillis(b.data.dueDate)).slice(0, 6);
      html += panel('Coming up', soon.length ? soon.map(i => todoRow(ctx, i, { course: byId[i.courseId] })).join('') : `<p class="text-sm text-gray-500">Nothing due in the next two weeks.</p>`);
    }
    if (!live(t) || !side.isConnected) return;
    side.innerHTML = html + `<a href="${buildUrl(`/${ctx.slug}/calendar`)}" class="btn btn-secondary btn-block">${ico('calendar-days')} View calendar</a>`;
    refreshIcons();
  } catch (e) { console.error(e); if (side.isConnected) side.innerHTML = ''; }
}
async function viewAllCourses(ctx) {
  const t = routeToken;
  setTitle('All courses', ctx.tenant.name);
  render(tenantPage(ctx, 'all-courses', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'All courses', subtitle: 'Star a course to show it on your dashboard.', actions: ctx.teacherMode ? `<button id="add-course-btn" class="btn btn-primary">${ico('plus')} New course</button>` : '' }) + `<div id="all-courses" class="max-w-5xl">${skeletonRows(4)}</div>`));
  $('#add-course-btn')?.addEventListener('click', () => openCourseModal(ctx));
  const el = $('#all-courses');
  let courses = [];
  const draw = () => {
    const favs = getFavs(ctx);
    el.innerHTML = !courses.length ? emptyState({ icon: 'book-open', title: 'No courses yet' }) : dataTable(
      [{ label: '', cls: 'col-span-2 sm:col-span-1' }, { label: 'Course', cls: 'col-span-10 sm:col-span-5' }, { label: 'Term', cls: 'col-span-6 sm:col-span-2' }, { label: 'Enrolled as', cls: 'col-span-6 sm:col-span-2' }, { label: 'Published', cls: 'hidden sm:block sm:col-span-2' }],
      courses.map(c => ({ cells: [
        `<button data-fav="${c.id}" class="btn-icon ${favs.includes(c.id) ? '!text-[#F59E0B]' : ''}" aria-pressed="${favs.includes(c.id)}" aria-label="${favs.includes(c.id) ? 'Remove from' : 'Add to'} dashboard">${ico('star', 'w-4 h-4' + (favs.includes(c.id) ? ' fill-current' : ''))}</button>`,
        `<a href="${cHref(ctx, c.id)}" class="flex items-center gap-3 group/c"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${courseHex(c)}"></span><span class="min-w-0"><span class="block text-sm text-white truncate group-hover/c:text-[#F59E0B]">${escapeHtml(c.title || 'Untitled')}</span><span class="block text-[11px] text-gray-500 truncate">${escapeHtml(c.code || '')}</span></span></a>`,
        `<span class="text-xs text-gray-400">${escapeHtml(c.term || '—')}</span>`,
        `<span class="text-xs text-gray-400">${ctx.isRealTeacher ? 'Teacher' : 'Student'}</span>`,
        c.published === false ? badge('Unpublished', 'muted') : badge('Published', 'green')
      ] })));
    refreshIcons();
  };
  el.addEventListener('click', e => { const b = e.target.closest('[data-fav]'); if (!b) return; const on = toggleFav(ctx, b.dataset.fav); toast(on ? 'Added to your dashboard' : 'Removed from your dashboard', 'info'); draw(); });
  try { courses = await myCourses(ctx, { fresh: true }); if (live(t)) draw(); }
  catch (e) { if (live(t)) { el.innerHTML = errorBox(e); refreshIcons(); } }
}

// ═══════════════════════════════════════════════════════════════
// COURSE HOME / SYLLABUS / ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════
async function viewCourseHome(ctx, course) {
  const t = routeToken;
  setTitle(course.title, ctx.tenant.name);
  if (ctx.teacherMode && !course.ownerName && course.ownerUid === ctx.me.uid) updateDoc(doc(db, 'tenants', ctx.slug, 'courses', course.id), { ownerName: ctx.me.name }).catch(() => {});
  render(tenantPage(ctx, 'home', pageHeader({
    lead: courseLead(course), eyebrow: escapeHtml([course.code, course.term].filter(Boolean).join(' · ')), title: escapeHtml(course.title || 'Untitled'),
    actions: previewToggle(ctx) + (ctx.teacherMode ? `<a href="${cHref(ctx, course.id, 'settings')}" class="btn btn-secondary">${ico('settings')} Settings</a>` : '')
  }) + `<div class="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-8 max-w-6xl">
      <div class="space-y-8 min-w-0">
        ${course.description ? `<div class="card p-6 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">${escapeHtml(course.description)}</div>` : ''}
        <div id="home-ann"></div>
        <section>
          <div class="flex items-center justify-between mb-3"><h2 class="font-serif text-2xl text-white">Modules</h2><a href="${cHref(ctx, course.id, 'modules')}" class="text-xs text-[#F59E0B] hover:underline">Open modules →</a></div>
          <div id="home-mods">${skeletonRows(3)}</div>
        </section>
      </div>
      <aside class="space-y-6">
        ${ctx.teacherMode ? `<section class="card p-5"><h2 class="label">Quick actions</h2><div class="grid gap-2">
          <button data-home="announce" class="btn btn-secondary !justify-start">${ico('megaphone')} New announcement</button>
          <button data-home="assignment" class="btn btn-secondary !justify-start">${ico('clipboard-list')} New assignment</button>
          <button data-home="quiz" class="btn btn-secondary !justify-start">${ico('list-checks')} New quiz</button>
          <a href="${cHref(ctx, course.id, 'people')}" class="btn btn-secondary !justify-start">${ico('user-plus')} Enroll students</a>
          <a href="${cHref(ctx, course.id, 'grades')}" class="btn btn-secondary !justify-start">${ico('award')} Gradebook</a>
        </div></section>` : ''}
        <section class="card p-5"><h2 class="label">Coming up</h2><div id="home-todo">${skeletonRows(3, 'h-10')}</div></section>
      </aside>
    </div>`, course));
  $('#main').addEventListener('click', async e => {
    const b = e.target.closest('[data-home]'); if (!b) return;
    if (b.dataset.home === 'announce') return openAnnouncementModal(ctx, null, courseCol(ctx, course.id, 'announcements'), 'Students in this course will see it.');
    const mid = await pickModule(ctx, course.id);
    if (mid) openItemEditor(ctx, course.id, mid, null, b.dataset.home, () => renderRoute());
  });
  getDocs(query(courseCol(ctx, course.id, 'announcements'), orderBy('createdAt', 'desc'), limit(1))).then(snap => {
    const el = $('#home-ann'); if (!el || !live(t) || snap.empty) return;
    const a = snap.docs[0].data();
    el.innerHTML = `<a href="${cHref(ctx, course.id, 'announcements')}" class="card card-hover block p-5"><div class="flex items-center gap-2 mb-2">${badge('Latest announcement', 'amber')}<span class="text-xs text-gray-500">${escapeHtml(timeAgo(a.createdAt))}</span></div>
      <h3 class="font-serif text-lg text-white mb-1">${escapeHtml(a.title || '')}</h3><div class="prose-ember text-sm line-clamp-3">${sanitize(a.content)}</div></a>`;
  }).catch(() => {});
  try {
    const [{ modules, items }, mine] = await Promise.all([loadCourseContent(ctx, course.id), ctx.studentView ? mySubmissionMap(ctx, course.id).catch(() => new Map()) : Promise.resolve(new Map())]);
    if (!live(t)) return;
    $('#home-mods').innerHTML = modules.length ? `<div class="card divide-y divide-white/[0.05] overflow-hidden">${modules.map((m, i) => {
      const its = items.filter(x => x.moduleId === m.id);
      const graded = its.filter(x => GRADED_TYPES.includes(x.type));
      const done = graded.filter(x => mine.has(x.id)).length;
      return `<a href="${cHref(ctx, course.id, 'modules')}" class="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.03] transition-colors">
        <span class="text-[10px] font-mono text-gray-600">${String(i + 1).padStart(2, '0')}</span>
        <span class="flex-1 min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(m.title || 'Untitled')}</span><span class="block text-[11px] text-gray-500">${plural(its.length, 'item')}${ctx.studentView && graded.length ? ` · ${done}/${graded.length} submitted` : ''}</span></span>
        ${ctx.studentView && graded.length ? `<span class="w-16 h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><span class="block h-full bg-[#F59E0B]" style="width:${Math.round(done / graded.length * 100)}%"></span></span>` : ''}
        ${ico('chevron-right', 'w-4 h-4 text-gray-600')}</a>`;
    }).join('')}</div>` : emptyState({ icon: 'layers', title: 'No modules yet', text: ctx.teacherMode ? 'Add modules to organise your content.' : 'Content will appear here soon.' });
    const now = Date.now();
    const upcoming = items.filter(i => GRADED_TYPES.includes(i.type) && tsMillis(i.data?.dueDate) >= now && !mine.has(i.id)).sort((a, b) => tsMillis(a.data.dueDate) - tsMillis(b.data.dueDate)).slice(0, 6);
    $('#home-todo').innerHTML = upcoming.length ? upcoming.map(i => todoRow(ctx, i)).join('') : `<p class="text-sm text-gray-500">Nothing due soon.</p>`;
    refreshIcons();
  } catch (e) { console.error(e); if (live(t)) { $('#home-mods').innerHTML = errorBox(e); $('#home-todo').innerHTML = ''; refreshIcons(); } }
}

function viewCourseAnnouncements(ctx, course) {
  setTitle('Announcements', course.title);
  const col = courseCol(ctx, course.id, 'announcements');
  render(tenantPage(ctx, 'announcements', sectionHeader(ctx, course, 'Announcements', ctx.teacherMode ? `<button id="new-ann-btn" class="btn btn-primary">${ico('megaphone')} Announcement</button>` : '') +
    `<div id="ann-list" class="max-w-3xl space-y-4">${skeletonRows(3, 'h-32')}</div>`, course));
  const subtitle = 'Students in this course will see it.';
  $('#new-ann-btn')?.addEventListener('click', () => openAnnouncementModal(ctx, null, col, subtitle));
  mountAnnouncementList(ctx, $('#ann-list'), col, ctx.teacherMode, subtitle);
}

async function viewSyllabus(ctx, course) {
  const t = routeToken;
  setTitle('Syllabus', course.title);
  const courseRef = doc(db, 'tenants', ctx.slug, 'courses', course.id);
  render(tenantPage(ctx, 'syllabus', sectionHeader(ctx, course, 'Syllabus', ctx.teacherMode ? `<button id="edit-syl" class="btn btn-secondary">${ico('pencil', 'w-3.5 h-3.5')} Edit</button>` : '') + `
    <div class="max-w-4xl">
      <div id="syl-body" class="card p-6 sm:p-8 mb-10"><article class="prose-ember">${sanitize(course.syllabus) || `<p class="text-gray-500 italic">${ctx.teacherMode ? 'No syllabus yet — click Edit to write one.' : 'Your teacher hasn\'t posted a syllabus yet.'}</p>`}</article></div>
      <h2 class="font-serif text-2xl text-white mb-1">Course summary</h2><p class="text-xs text-gray-500 mb-4">Generated from due dates, conferences and calendar events.</p>
      <div id="syl-summary">${skeletonRows(4)}</div>
    </div>`, course));
  $('#edit-syl')?.addEventListener('click', e => {
    e.currentTarget.classList.add('hidden');
    const box = $('#syl-body');
    box.innerHTML = `<div class="editor-box mb-4"><div data-editor></div></div><div class="flex gap-3"><button id="syl-save" class="btn btn-primary">Save syllabus</button><button id="syl-cancel" class="btn btn-ghost">Cancel</button></div>`;
    const ed = mountEditor(box.querySelector('[data-editor]'), { html: course.syllabus || '<h2>Course description</h2><p></p><h2>Learning goals</h2><ul><li></li></ul><h2>Grading</h2><p></p><h2>Policies</h2><p></p>' });
    $('#syl-cancel').addEventListener('click', () => renderRoute());
    $('#syl-save').addEventListener('click', ev => withBusy(ev.currentTarget, 'Saving…', async () => {
      try { await updateDoc(courseRef, { syllabus: ed.getHTML(), updatedAt: serverTimestamp() }); invalidateCourses(); toast('Syllabus saved'); renderRoute(); }
      catch (ex) { toast(friendlyError(ex), 'error'); }
    }));
  });
  try {
    const [items, confs, evs] = await Promise.all([
      loadAllItems(ctx, course.id),
      getDocs(courseCol(ctx, course.id, 'conferences')).then(s => s.docs.map(d => d.data())).catch(() => []),
      getDocs(courseCol(ctx, course.id, 'events')).then(s => s.docs.map(d => d.data())).catch(() => []),
    ]);
    if (!live(t)) return;
    const rows = [
      ...items.filter(i => GRADED_TYPES.includes(i.type)).map(i => ({ date: toDate(i.data?.dueDate), label: i.title, icon: typeMeta(i.type).icon, href: itemHref(ctx, i), extra: `${itemPoints(i)} pts` })),
      ...confs.map(c => ({ date: toDate(c.startAt), label: c.title, icon: 'video', href: cHref(ctx, course.id, 'conferences'), extra: 'Conference' })),
      ...evs.map(ev => ({ date: toDate(ev.startAt), label: ev.title, icon: 'calendar', href: buildUrl(`/${ctx.slug}/calendar`), extra: 'Event' })),
    ].sort((a, b) => (a.date ? a.date.getTime() : Infinity) - (b.date ? b.date.getTime() : Infinity));
    $('#syl-summary').innerHTML = rows.length ? dataTable(
      [{ label: 'Date', cls: 'col-span-12 sm:col-span-3' }, { label: 'Details', cls: 'col-span-8 sm:col-span-7' }, { label: '', cls: 'col-span-4 sm:col-span-2 text-right' }],
      rows.map(r => ({ cells: [
        `<span class="text-xs ${r.date ? 'text-gray-300' : 'text-gray-600'}">${r.date ? escapeHtml(r.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })) : 'No date'}</span>`,
        `<a href="${r.href}" class="flex items-center gap-2 text-sm text-white hover:text-[#F59E0B] transition-colors">${ico(r.icon, 'w-4 h-4 text-gray-500 shrink-0')}<span class="truncate">${escapeHtml(r.label || 'Untitled')}</span></a>`,
        `<span class="text-[11px] text-gray-500 block text-right">${r.date && r.extra !== 'Conference' && r.extra !== 'Event' ? 'due ' + escapeHtml(r.date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) + ' · ' : ''}${escapeHtml(r.extra)}</span>`
      ] }))) : `<p class="text-sm text-gray-500">Nothing scheduled yet.</p>`;
    refreshIcons();
  } catch (e) { if (live(t)) { $('#syl-summary').innerHTML = errorBox(e); refreshIcons(); } }
}

// ═══════════════════════════════════════════════════════════════
// ASSIGNMENTS / QUIZZES / PAGES (index views over module items)
// ═══════════════════════════════════════════════════════════════
async function viewItemIndex(ctx, course, type) {
  const t = routeToken;
  const meta = typeMeta(type);
  const navKey = { assignment: 'assignments', quiz: 'quizzes', page: 'pages' }[type];
  const title = COURSE_NAV.find(n => n.key === navKey).label;
  setTitle(title, course.title);
  render(tenantPage(ctx, navKey, sectionHeader(ctx, course, title, ctx.teacherMode ? `<button id="new-of-type" class="btn btn-primary">${ico('plus')} ${meta.label}</button>` : '') +
    `<div class="max-w-4xl"><div class="mb-5">${searchBox('idx-search', `Search ${title.toLowerCase()}…`)}</div><div id="idx-list">${skeletonRows(4)}</div></div>`, course));
  $('#new-of-type')?.addEventListener('click', async () => {
    const mid = await pickModule(ctx, course.id);
    if (mid) openItemEditor(ctx, course.id, mid, null, type, () => renderRoute());
  });
  const el = $('#idx-list');
  try {
    const [items, mine, allSubs] = await Promise.all([
      loadAllItems(ctx, course.id).then(list => list.filter(i => i.type === type)),
      type !== 'page' && ctx.studentView ? mySubmissionMap(ctx, course.id).catch(() => new Map()) : Promise.resolve(new Map()),
      type !== 'page' && ctx.teacherMode ? getDocs(subsCol(ctx, course.id)).then(s => s.docs.map(d => d.data())).catch(() => []) : Promise.resolve([]),
    ]);
    if (!live(t)) return;
    const now = Date.now();
    const row = it => {
      const due = toDate(it.data?.dueDate);
      let right = '';
      if (type !== 'page') {
        if (ctx.studentView) { const s = mine.get(it.id); right = hasGrade(s) ? `<span class="text-sm text-white tabular-nums">${escapeHtml(s.grade)}<span class="text-gray-500">/${itemPoints(it)}</span></span>` : s ? badge('Submitted', 'blue') : due && due.getTime() < now ? badge('Missing', 'red') : `<span class="text-xs text-gray-500">${itemPoints(it)} pts</span>`; }
        else { const subs = allSubs.filter(s => s.itemId === it.id); const ng = subs.filter(s => !hasGrade(s)).length; right = `<span class="text-xs text-gray-500">${subs.length} submitted</span>${ng ? ` ${badge(`${ng} to grade`, 'amber')}` : ''}`; }
      }
      return `<a href="${itemHref(ctx, it)}" data-search-text="${escapeHtml((it.title || '').toLowerCase())}" class="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.03] transition-colors">
        ${iconTile(meta.icon, 'muted')}
        <span class="flex-1 min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(it.title || 'Untitled')}</span><span class="block text-[11px] text-gray-500 truncate">${escapeHtml(it.moduleTitle || '')}${due ? ' · Due ' + escapeHtml(formatDateTime(due)) : ''}${type === 'quiz' ? ' · ' + plural(it.data?.questions?.length || 0, 'question') : ''}</span></span>
        <span class="flex items-center gap-2 shrink-0">${right}</span></a>`;
    };
    let groups;
    if (type === 'page') groups = [['', items]];
    else {
      const dated = items.filter(i => toDate(i.data?.dueDate));
      groups = [
        ['Upcoming', dated.filter(i => tsMillis(i.data.dueDate) >= now).sort((a, b) => tsMillis(a.data.dueDate) - tsMillis(b.data.dueDate))],
        ['Undated', items.filter(i => !toDate(i.data?.dueDate))],
        ['Past', dated.filter(i => tsMillis(i.data.dueDate) < now).sort((a, b) => tsMillis(b.data.dueDate) - tsMillis(a.data.dueDate))],
      ];
    }
    el.innerHTML = !items.length ? emptyState({ icon: meta.icon, tone: 'amber', title: `No ${title.toLowerCase()} yet`, text: ctx.teacherMode ? `Click “${meta.label}” to create one inside a module.` : '' })
      : groups.filter(([, list]) => list.length).map(([label, list]) => `<section class="mb-6" data-group>${label ? `<h2 class="label">${label} · ${list.length}</h2>` : ''}<div class="card overflow-hidden divide-y divide-white/[0.05]">${list.map(row).join('')}</div></section>`).join('');
    refreshIcons();
    $('#idx-search').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      el.querySelectorAll('[data-search-text]').forEach(a => a.classList.toggle('hidden', !!q && !a.dataset.searchText.includes(q)));
      el.querySelectorAll('[data-group]').forEach(g => g.classList.toggle('hidden', !g.querySelector('[data-search-text]:not(.hidden)')));
    });
  } catch (e) { console.error(e); if (live(t)) { el.innerHTML = errorBox(e); refreshIcons(); } }
}

// ═══════════════════════════════════════════════════════════════
// DISCUSSIONS
// ═══════════════════════════════════════════════════════════════
const canStartTopic = (ctx, course) => ctx.teacherMode || (ctx.isStudent && course.allowStudentTopics);
function viewDiscussions(ctx, course) {
  setTitle('Discussions', course.title);
  const col = courseCol(ctx, course.id, 'discussions');
  render(tenantPage(ctx, 'discussions', sectionHeader(ctx, course, 'Discussions', canStartTopic(ctx, course) ? `<button id="new-topic" class="btn btn-primary">${ico('plus')} Discussion</button>` : '') +
    `<div class="max-w-4xl"><div class="mb-5">${searchBox('topic-search', 'Search discussions…')}</div><div id="topic-list">${skeletonRows(4, 'h-16')}</div></div>`, course));
  $('#new-topic')?.addEventListener('click', () => openTopicModal(ctx, course));
  const el = $('#topic-list');
  let topics = [], q = '';
  const draw = () => {
    const list = topics.filter(x => !q || `${x.title} ${x.authorName}`.toLowerCase().includes(q));
    el.innerHTML = !topics.length ? emptyState({ icon: 'messages-square', tone: 'amber', title: 'No discussions yet', text: canStartTopic(ctx, course) ? 'Start a conversation — ask a question or post a prompt for the class.' : 'Discussion topics from your teacher will appear here.' })
      : !list.length ? `<p class="text-sm text-gray-500 text-center py-8">No discussions match.</p>`
      : `<div class="card overflow-hidden divide-y divide-white/[0.05]">${list.map(x => `
        <div class="group relative flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition-colors">
          <a href="${cHref(ctx, course.id, 'discussions/' + x.id)}" class="absolute inset-0" aria-label="${escapeHtml(x.title || 'Discussion')}"></a>
          ${iconTile(x.pinned ? 'pin' : 'messages-square', x.pinned ? 'amber' : 'muted')}
          <div class="flex-1 min-w-0"><div class="text-sm text-white truncate flex items-center gap-2">${escapeHtml(x.title || 'Untitled')}${x.locked ? ico('lock', 'w-3.5 h-3.5 text-gray-500 shrink-0') : ''}</div>
            <div class="text-[11px] text-gray-500 truncate">${escapeHtml(x.authorName || '')} · ${escapeHtml(timeAgo(x.createdAt))}${x.lastReplyAt ? ' · last reply ' + escapeHtml(timeAgo(x.lastReplyAt)) : ''}</div></div>
          <div class="text-right shrink-0"><div class="text-sm text-white tabular-nums">${x.replyCount || 0}</div><div class="text-[10px] text-gray-500">${(x.replyCount || 0) === 1 ? 'reply' : 'replies'}</div></div>
          ${ctx.teacherMode ? `<div class="row-actions relative z-10"><button class="btn-icon" data-topic="pin" data-id="${x.id}" aria-label="${x.pinned ? 'Unpin' : 'Pin'}">${ico(x.pinned ? 'pin-off' : 'pin', 'w-3.5 h-3.5')}</button><button class="btn-icon" data-topic="lock" data-id="${x.id}" aria-label="${x.locked ? 'Unlock' : 'Close for comments'}">${ico(x.locked ? 'lock-open' : 'lock', 'w-3.5 h-3.5')}</button><button class="btn-icon danger" data-topic="delete" data-id="${x.id}" aria-label="Delete">${ico('trash-2', 'w-3.5 h-3.5')}</button></div>` : ''}
        </div>`).join('')}</div>`;
    refreshIcons();
  };
  unsubs.push(onSnapshot(col, snap => {
    topics = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (!!b.pinned - !!a.pinned) || recency(b.lastReplyAt || b.createdAt) - recency(a.lastReplyAt || a.createdAt));
    draw();
  }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  $('#topic-search').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-topic]'); if (!b) return;
    const x = topics.find(tp => tp.id === b.dataset.id); const ref = doc(col, b.dataset.id);
    try {
      if (b.dataset.topic === 'pin') await updateDoc(ref, { pinned: !x.pinned });
      else if (b.dataset.topic === 'lock') { await updateDoc(ref, { locked: !x.locked }); toast(x.locked ? 'Discussion reopened' : 'Discussion closed for comments', 'info'); }
      else if (await confirmDialog({ title: `Delete “${x.title}”?`, message: 'All replies will be deleted too.', confirmLabel: 'Delete', danger: true })) {
        await batchDelete((await getDocs(collection(ref, 'replies'))).docs.map(d => d.ref));
        await deleteDoc(ref); toast('Discussion deleted');
      }
    } catch (ex) { toast(friendlyError(ex), 'error'); }
  });
}
function openTopicModal(ctx, course, existing = null) {
  const m = openModal({
    size: 'lg', align: 'top',
    html: modalHeader({ title: existing ? 'Edit discussion' : 'New discussion', icon: 'messages-square' }) + `<form novalidate>${modalBody(`<div class="space-y-5">
      <div><label for="tp-title" class="label">Topic title</label><input id="tp-title" class="input" value="${escapeHtml(existing?.title || '')}" placeholder="What surprised you about this week's reading?" autocomplete="off"></div>
      <div><span class="label">Message</span><div class="editor-box"><div data-editor></div></div></div>
      ${ctx.teacherMode ? `<div class="flex flex-wrap gap-6"><label class="check"><input type="checkbox" id="tp-pin" ${existing?.pinned ? 'checked' : ''}> Pin to top</label><label class="check"><input type="checkbox" id="tp-lock" ${existing?.locked ? 'checked' : ''}> Closed for comments</label></div>` : ''}
      <p id="tp-error" class="form-error hidden" role="alert"></p></div>`)}
      ${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${existing ? 'Save' : 'Post discussion'}</button>`)}</form>`
  });
  const ed = mountEditor(m.$('[data-editor]'), { html: existing?.message || '', toolbar: 'basic', placeholder: 'Write the prompt or question…' });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const title = m.$('#tp-title').value.trim(), message = ed.getHTML();
    const err = m.$('#tp-error'); showError(err, '');
    if (!title) return showError(err, 'Give the discussion a title.');
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Saving…', async () => {
      const flags = ctx.teacherMode ? { pinned: m.$('#tp-pin').checked, locked: m.$('#tp-lock').checked } : {};
      try {
        if (existing) await updateDoc(doc(courseCol(ctx, course.id, 'discussions'), existing.id), { title, message, ...flags, updatedAt: serverTimestamp() });
        else {
          const ref = await addDoc(courseCol(ctx, course.id, 'discussions'), { title, message, pinned: false, locked: false, ...flags, authorUid: ctx.me.uid, authorName: ctx.me.name, authorRole: ctx.isRealTeacher ? 'teacher' : 'student', replyCount: 0, lastReplyAt: null, createdAt: serverTimestamp() });
          m.close(); toast('Discussion posted'); return goHref(cHref(ctx, course.id, 'discussions/' + ref.id));
        }
        m.close(); toast('Saved'); renderRoute();
      } catch (ex) { showError(err, friendlyError(ex)); }
    });
  });
}
async function viewDiscussion(ctx, course, topicId) {
  const t = routeToken;
  const ref = doc(courseCol(ctx, course.id, 'discussions'), topicId);
  const s = await getDoc(ref);
  if (!live(t)) return;
  if (!s.exists()) return viewNotFound();
  const topic = { id: s.id, ...s.data() };
  setTitle(topic.title, course.title);
  const canModerate = ctx.teacherMode;
  render(tenantPage(ctx, 'discussions', pageHeader({
    back: { href: `/${ctx.slug}/course/${course.id}/discussions`, label: 'Discussions' },
    eyebrow: topic.pinned ? 'Pinned discussion' : 'Discussion', title: escapeHtml(topic.title || 'Untitled'),
    actions: canModerate || topic.authorUid === ctx.me.uid ? `<button id="edit-topic" class="btn btn-secondary">${ico('pencil', 'w-3.5 h-3.5')} Edit</button>` : ''
  }) + `<div class="max-w-3xl">
      <article class="card p-6 mb-8">
        <div class="flex items-center gap-3 mb-4">${avatar(topic.authorName)}<div><div class="text-sm text-white">${escapeHtml(topic.authorName || '')} ${topic.authorRole === 'teacher' ? badge('Teacher', 'violet') : ''}</div><div class="text-[11px] text-gray-500">${escapeHtml(formatDateTime(topic.createdAt))}</div></div></div>
        <div class="prose-ember">${sanitize(topic.message) || ''}</div>
      </article>
      <h2 class="font-serif text-xl text-white mb-4" id="reply-count">Replies</h2>
      ${topic.locked ? `<div class="card p-4 mb-6 flex items-center gap-3 text-sm text-gray-400">${ico('lock', 'w-4 h-4')} This discussion is closed for comments.</div>` : `
      <form id="reply-form" class="card p-4 mb-6" novalidate><label for="reply-body" class="sr-only">Your reply</label><textarea id="reply-body" rows="3" class="input mb-3" placeholder="Write a reply…"></textarea><button type="submit" class="btn btn-primary btn-sm">${ico('reply', 'w-3.5 h-3.5')} Post reply</button></form>`}
      <div id="replies" class="space-y-4">${skeletonRows(2, 'h-20')}</div>
    </div>`, course, { crumbs: [{ label: topic.title || 'Discussion' }] }));
  $('#edit-topic')?.addEventListener('click', () => openTopicModal(ctx, course, topic));
  const repliesCol = collection(ref, 'replies');
  const post = async (body, parentId, btn) => withBusy(btn, 'Posting…', async () => {
    try {
      await addDoc(repliesCol, { body, parentId: parentId || null, authorUid: ctx.me.uid, authorName: ctx.me.name, authorRole: ctx.isRealTeacher ? 'teacher' : 'student', createdAt: serverTimestamp() });
      await updateDoc(ref, { replyCount: increment(1), lastReplyAt: serverTimestamp() }).catch(() => {});
      return true;
    } catch (ex) { toast(friendlyError(ex), 'error'); return false; }
  });
  $('#reply-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const ta = $('#reply-body'); const body = ta.value.trim(); if (!body) return ta.focus();
    if (await post(body, null, e.currentTarget.querySelector('[type=submit]'))) ta.value = '';
  });
  let replies = [];
  const one = (r, nested = false) => `<div class="${nested ? 'ml-6 sm:ml-12 pl-4 border-l border-white/[0.08]' : 'card p-5'}">
    <div class="flex items-start gap-3">${avatar(r.authorName, null, nested ? 'w-7 h-7' : 'w-8 h-8')}
      <div class="flex-1 min-w-0"><div class="flex items-center gap-2 flex-wrap"><span class="text-sm text-white">${escapeHtml(r.authorName || '')}</span>${r.authorRole === 'teacher' ? badge('Teacher', 'violet') : ''}<span class="text-[11px] text-gray-500">${escapeHtml(timeAgo(r.createdAt))}</span></div>
        ${r.deleted ? `<p class="text-sm text-gray-600 italic mt-1">Reply deleted by its author.</p>` : `<p class="text-sm text-gray-300 whitespace-pre-wrap break-words mt-1">${escapeHtml(r.body || '')}</p>`}
        <div class="flex gap-3 mt-2 text-xs">${!nested && !topic.locked ? `<button data-reply-to="${r.id}" class="text-gray-500 hover:text-[#F59E0B]">Reply</button>` : ''}${canModerate || r.authorUid === ctx.me.uid ? `<button data-del-reply="${r.id}" class="text-gray-500 hover:text-red-400">Delete</button>` : ''}</div>
        <div data-inline="${r.id}"></div></div></div></div>`;
  const draw = () => {
    const host = $('#replies'); if (!host) return;
    $('#reply-count').textContent = `${plural(replies.length, 'reply', 'replies')}`;
    const top = replies.filter(r => !r.parentId);
    host.innerHTML = top.length ? top.map(r => `<div class="space-y-3">${one(r)}${replies.filter(c => c.parentId === r.id).map(c => one(c, true)).join('')}</div>`).join('') : `<p class="text-sm text-gray-500">No replies yet${topic.locked ? '' : ' — be the first'}.</p>`;
    refreshIcons();
  };
  unsubs.push(onSnapshot(query(repliesCol, orderBy('createdAt', 'asc')), snap => { replies = snap.docs.map(d => ({ id: d.id, ...d.data() })); draw(); }, e => { $('#replies').innerHTML = errorBox(e); refreshIcons(); }));
  $('#replies').addEventListener('click', async e => {
    const rt = e.target.closest('[data-reply-to]');
    if (rt) {
      const slot = $(`[data-inline="${rt.dataset.replyTo}"]`);
      if (slot.innerHTML) { slot.innerHTML = ''; return; }
      slot.innerHTML = `<form class="mt-3" novalidate><textarea rows="2" class="input mb-2" placeholder="Reply…" aria-label="Reply"></textarea><div class="flex gap-2"><button type="submit" class="btn btn-primary btn-sm">Reply</button><button type="button" data-cancel class="btn btn-ghost btn-sm">Cancel</button></div></form>`;
      const f = slot.querySelector('form'); f.querySelector('textarea').focus();
      f.querySelector('[data-cancel]').addEventListener('click', () => { slot.innerHTML = ''; });
      f.addEventListener('submit', async ev => { ev.preventDefault(); const body = f.querySelector('textarea').value.trim(); if (body) await post(body, rt.dataset.replyTo, f.querySelector('[type=submit]')); });
      return;
    }
    const del = e.target.closest('[data-del-reply]');
    if (del && await confirmDialog({ title: 'Delete this reply?', confirmLabel: 'Delete', danger: true })) {
      try {
        const kids = replies.filter(r => r.parentId === del.dataset.delReply);
        // Students can't delete classmates' replies, so a reply with others' answers under it is blanked instead.
        if (!ctx.isRealTeacher && kids.some(k => k.authorUid !== ctx.me.uid)) {
          await updateDoc(doc(repliesCol, del.dataset.delReply), { body: '', deleted: true });
          return;
        }
        await batchDelete([del.dataset.delReply, ...kids.map(k => k.id)].map(id => doc(repliesCol, id)));
        await updateDoc(ref, { replyCount: increment(-(1 + kids.length)) }).catch(() => {});
      } catch (ex) { toast(friendlyError(ex), 'error'); }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// COLLABORATIONS
// ═══════════════════════════════════════════════════════════════
function collabKind(url) {
  const u = String(url || '');
  if (/docs\.google\.com\/document/.test(u)) return ['Google Doc', 'file-text', 'blue'];
  if (/docs\.google\.com\/spreadsheets/.test(u)) return ['Google Sheet', 'file-spreadsheet', 'green'];
  if (/docs\.google\.com\/presentation/.test(u)) return ['Google Slides', 'presentation', 'amber'];
  if (/(sharepoint\.com|onedrive|office\.com|live\.com)/.test(u)) return ['Microsoft 365', 'file-text', 'blue'];
  if (/(canva\.com)/.test(u)) return ['Canva', 'palette', 'violet'];
  return ['Link', 'link', 'muted'];
}
function viewCollaborations(ctx, course) {
  setTitle('Collaborations', course.title);
  const col = courseCol(ctx, course.id, 'collaborations');
  render(tenantPage(ctx, 'collaborations', sectionHeader(ctx, course, 'Collaborations', `<button id="new-collab" class="btn btn-primary">${ico('plus')} Collaboration</button>`) +
    `<p class="text-sm text-gray-500 -mt-4 mb-6 max-w-3xl">Shared documents everyone in the course can work on together — paste a share link from Google Docs, Sheets, Slides or Microsoft 365.</p>
    <div id="collab-list" class="max-w-5xl grid sm:grid-cols-2 gap-4">${skeletonRows(2, 'h-28')}</div>`, course));
  let list = [];
  $('#new-collab').addEventListener('click', () => openCollabModal(ctx, col));
  const el = $('#collab-list');
  unsubs.push(onSnapshot(col, snap => {
    list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => recency(b.createdAt) - recency(a.createdAt));
    el.innerHTML = !list.length ? `<div class="col-span-full">${emptyState({ icon: 'users-round', tone: 'amber', title: 'No collaborations yet', text: 'Start one to write, plan or brainstorm together.' })}</div>`
      : list.map(c => { const [kind, icon, tone] = collabKind(c.url); const url = safeUrl(c.url); const mine = c.createdBy === ctx.me.uid;
        return `<article class="card p-5 flex flex-col group">
          <div class="flex items-start gap-3 mb-3">${iconTile(icon, tone)}<div class="min-w-0 flex-1"><h3 class="text-white text-sm font-medium truncate">${escapeHtml(c.title || 'Untitled')}</h3><p class="text-[11px] text-gray-500">${kind} · ${escapeHtml(c.createdByName || '')} · ${escapeHtml(timeAgo(c.createdAt))}</p></div>
            ${ctx.teacherMode || mine ? `<div class="row-actions"><button class="btn-icon" data-collab-edit="${c.id}" aria-label="Edit">${ico('pencil', 'w-3.5 h-3.5')}</button><button class="btn-icon danger" data-collab-del="${c.id}" aria-label="Delete">${ico('trash-2', 'w-3.5 h-3.5')}</button></div>` : ''}</div>
          ${c.description ? `<p class="text-sm text-gray-400 mb-4 line-clamp-3">${escapeHtml(c.description)}</p>` : ''}
          ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm mt-auto self-start">${ico('external-link', 'w-3.5 h-3.5')} Open</a>` : ''}
        </article>`; }).join('');
    refreshIcons();
  }, e => { el.innerHTML = `<div class="col-span-full">${errorBox(e)}</div>`; refreshIcons(); }));
  el.addEventListener('click', async e => {
    const ed = e.target.closest('[data-collab-edit]'); if (ed) return openCollabModal(ctx, col, list.find(c => c.id === ed.dataset.collabEdit));
    const del = e.target.closest('[data-collab-del]');
    if (del && await confirmDialog({ title: 'Remove this collaboration?', message: 'The shared document itself is not deleted.', confirmLabel: 'Remove', danger: true })) {
      try { await deleteDoc(doc(col, del.dataset.collabDel)); toast('Removed'); } catch (ex) { toast(friendlyError(ex), 'error'); }
    }
  });
}
function openCollabModal(ctx, col, existing = null) {
  const m = openModal({
    html: modalHeader({ title: existing ? 'Edit collaboration' : 'New collaboration', icon: 'users-round' }) + `<form novalidate>${modalBody(`
      <label class="label" for="cb-title">Title</label><input id="cb-title" class="input mb-4" value="${escapeHtml(existing?.title || '')}" placeholder="Group project plan" autocomplete="off">
      <label class="label" for="cb-url">Share link</label><input id="cb-url" type="url" inputmode="url" class="input" value="${escapeHtml(existing?.url || '')}" placeholder="https://docs.google.com/document/d/…">
      <p class="hint mb-4">Make sure the document's sharing settings let your class open it.</p>
      <label class="label" for="cb-desc">Description</label><textarea id="cb-desc" rows="3" class="input">${escapeHtml(existing?.description || '')}</textarea>
      <p id="cb-error" class="form-error mt-3 hidden"></p>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${existing ? 'Save' : 'Start collaborating'}</button>`)}</form>`
  });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const title = m.$('#cb-title').value.trim(), url = normalizeUrl(m.$('#cb-url').value), description = m.$('#cb-desc').value.trim();
    const err = m.$('#cb-error'); showError(err, '');
    if (!title) return showError(err, 'Add a title.');
    if (!url) return showError(err, 'Paste a valid share link.');
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Saving…', async () => {
      try {
        if (existing) await updateDoc(doc(col, existing.id), { title, url, description, updatedAt: serverTimestamp() });
        else await addDoc(col, { title, url, description, createdBy: ctx.me.uid, createdByName: ctx.me.name, createdAt: serverTimestamp() });
        m.close(); toast('Saved');
      } catch (ex) { showError(err, friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// FILES (no Firebase Storage: links, plus small files stored in Firestore)
// ═══════════════════════════════════════════════════════════════
const MAX_INLINE = 700 * 1024; // Firestore documents max out at 1 MB, and base64 adds a third
function fileIcon(f) {
  const t = f.contentType || '', n = (f.name || '').toLowerCase();
  if (f.kind === 'link') return /youtube|youtu\.be|vimeo/.test(f.url || '') ? 'youtube' : /docs\.google|drive\.google|onedrive|sharepoint|dropbox/.test(f.url || '') ? 'cloud' : 'link';
  if (t.startsWith('image/')) return 'file-image';
  if (t.startsWith('video/')) return 'film';
  if (t.startsWith('audio/')) return 'file-audio';
  if (/pdf/.test(t) || n.endsWith('.pdf')) return 'file-text';
  if (/sheet|excel|csv/.test(t) || /\.(xlsx?|csv)$/.test(n)) return 'file-spreadsheet';
  if (/presentation|powerpoint/.test(t) || /\.(pptx?|key)$/.test(n)) return 'presentation';
  if (/zip|compressed/.test(t) || /\.(zip|rar|7z)$/.test(n)) return 'file-archive';
  return 'file';
}
function viewFiles(ctx, course) {
  setTitle('Files', course.title);
  const col = courseCol(ctx, course.id, 'files');
  const canUpload = ctx.teacherMode;
  render(tenantPage(ctx, 'files', sectionHeader(ctx, course, 'Files', canUpload ? `<button id="new-folder" class="btn btn-secondary">${ico('folder-plus')} Folder</button><button id="add-link" class="btn btn-secondary">${ico('link')} Add link</button><label class="btn btn-primary cursor-pointer" title="Files up to 700 KB. Share bigger files as a link.">${ico('upload')} Upload<input type="file" id="file-input" multiple class="sr-only"></label>` : '') + `
    <div class="max-w-5xl" id="files-root">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4"><div id="folder-bar" class="flex flex-wrap gap-2"></div>${searchBox('file-search', 'Search files…')}</div>
      <div id="uploads" class="space-y-2 mb-4"></div>
      ${canUpload ? `<p class="hint mb-4">${ico('info', 'w-3.5 h-3.5 inline -mt-0.5')} Upload files up to 700 KB, or use <strong class="text-gray-300">Add link</strong> for anything bigger (Google Drive, OneDrive, YouTube…).</p><div id="dropzone" class="hidden border-2 border-dashed border-[#F59E0B]/50 bg-[#F59E0B]/5 rounded-xl p-10 text-center text-sm text-[#F59E0B] mb-4">Drop files to upload</div>` : ''}
      <div id="file-list">${skeletonRows(4)}</div>
    </div>`, course));
  let files = [], folder = '', q = '', extraFolders = new Set();
  const el = $('#file-list');
  const draw = () => {
    const folders = [...new Set([...files.map(f => f.folder || '').filter(Boolean), ...extraFolders])].sort();
    $('#folder-bar').innerHTML = folders.length ? `<div class="segmented flex-wrap">${['', ...folders].map(f => `<button data-folder="${escapeHtml(f)}" aria-pressed="${f === folder}">${ico(f ? 'folder' : 'files', 'w-3.5 h-3.5')} ${escapeHtml(f || 'All files')}</button>`).join('')}</div>` : '';
    const list = files.filter(f => (!folder || (f.folder || '') === folder) && (!q || (f.name || '').toLowerCase().includes(q)));
    el.innerHTML = !files.length ? emptyState({ icon: 'folder', tone: 'amber', title: 'No files yet', text: canUpload ? 'Upload handouts, slides and readings — or drag files onto this page.' : 'Files your teacher shares will appear here.' })
      : !list.length ? `<p class="text-sm text-gray-500 text-center py-8">${folder && !q ? 'This folder is empty — upload files while it is selected.' : 'No files match.'}</p>`
      : dataTable(
        [{ label: 'Name', cls: 'col-span-12 sm:col-span-6' }, { label: 'Size', cls: 'col-span-4 sm:col-span-2' }, { label: 'Added', cls: 'col-span-4 sm:col-span-2' }, { label: '', cls: 'col-span-4 sm:col-span-2 text-right' }],
        list.map(f => ({ cells: [
          `<a href="${f.inline ? '#' : escapeHtml(safeUrl(f.url))}" ${f.inline ? `data-open-file="${f.id}"` : 'target="_blank" rel="noopener noreferrer"'} class="flex items-center gap-3 group/f">${iconTile(fileIcon(f), f.kind === 'link' ? 'teal' : 'muted')}<span class="min-w-0"><span class="block text-sm text-white truncate group-hover/f:text-[#F59E0B]">${escapeHtml(f.name)}</span>${f.folder && !folder ? `<span class="block text-[11px] text-gray-500 truncate">${ico('folder', 'w-3 h-3 inline -mt-0.5')} ${escapeHtml(f.folder)}</span>` : ''}</span></a>`,
          `<span class="text-xs text-gray-400">${f.kind === 'link' ? 'Link' : formatBytes(f.size)}</span>`,
          `<span class="text-xs text-gray-500">${escapeHtml(formatDate(f.createdAt) || 'just now')}</span>`,
          `<div class="row-actions">${f.inline ? `<button class="btn-icon" data-open-file="${f.id}" data-download aria-label="Download">${ico('download', 'w-4 h-4')}</button>` : `<a href="${escapeHtml(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer" class="btn-icon" aria-label="Open">${ico(f.kind === 'link' ? 'external-link' : 'download', 'w-4 h-4')}</a><button class="btn-icon" data-copy-file="${f.id}" aria-label="Copy link">${ico('link', 'w-4 h-4')}</button>`}${canUpload ? `<button class="btn-icon danger" data-del-file="${f.id}" aria-label="Delete">${ico('trash-2', 'w-4 h-4')}</button>` : ''}</div>`
        ] })));
    refreshIcons();
  };
  unsubs.push(onSnapshot(col, snap => { files = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')); draw(); }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  $('#file-search').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
  $('#files-root').addEventListener('click', async e => {
    const fb = e.target.closest('[data-folder]'); if (fb) { folder = fb.dataset.folder; return draw(); }
    const cp = e.target.closest('[data-copy-file]'); if (cp) return copyText(files.find(f => f.id === cp.dataset.copyFile)?.url || '', 'Link copied');
    const of = e.target.closest('[data-open-file]');
    if (of) {
      e.preventDefault();
      const f = files.find(x => x.id === of.dataset.openFile); if (!f) return;
      try {
        const b = await getDoc(doc(courseCol(ctx, course.id, 'fileBlobs'), f.id));
        if (!b.exists()) throw new Error('This file’s contents are missing.');
        const bin = atob(b.data().data), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: f.contentType || 'application/octet-stream' }));
        const a = document.createElement('a'); a.href = url;
        if (of.hasAttribute('data-download') || !/^(image|video|audio)\/|pdf|text\//.test(f.contentType || '')) a.download = f.name; else a.target = '_blank';
        a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (ex) { toast(friendlyError(ex), 'error'); }
      return;
    }
    const del = e.target.closest('[data-del-file]');
    if (del) {
      const f = files.find(x => x.id === del.dataset.delFile);
      if (!await confirmDialog({ title: `Delete “${f.name}”?`, confirmLabel: 'Delete', danger: true })) return;
      try { if (f.inline) await deleteDoc(doc(courseCol(ctx, course.id, 'fileBlobs'), f.id)).catch(() => {}); await deleteDoc(doc(col, f.id)); toast('File deleted'); }
      catch (ex) { toast(friendlyError(ex), 'error'); }
    }
  });
  if (!canUpload) return;
  $('#add-link').addEventListener('click', () => {
    const m = openModal({ size: 'sm', html: `<form class="p-6 sm:p-7" novalidate><h2 class="font-serif text-xl text-white mb-1">Add a link</h2><p class="text-sm text-gray-500 mb-5">Share a Google Drive, OneDrive, YouTube or any web link.</p>
      <label class="label" for="lk-url">Link</label><input id="lk-url" type="url" class="input mb-4" placeholder="https://…" autocomplete="off">
      <label class="label" for="lk-name">Name</label><input id="lk-name" class="input" placeholder="Unit 3 slides" maxlength="120">
      <p id="lk-err" class="form-error mt-3 hidden"></p>
      <div class="flex gap-3 mt-6"><button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">Add</button></div></form>` });
    m.$('form').addEventListener('submit', e => {
      e.preventDefault();
      const url = safeUrl(m.$('#lk-url').value.trim()), name = m.$('#lk-name').value.trim();
      if (!url || !/^https?:/i.test(url)) return showError(m.$('#lk-err'), 'Enter a full web address starting with https://');
      withBusy(m.$('[type=submit]'), 'Adding…', async () => {
        try { await addDoc(col, { name: name || url.replace(/^https?:\/\//, '').slice(0, 80), kind: 'link', url, folder, uploadedBy: ctx.me.uid, uploadedByName: ctx.me.name, createdAt: serverTimestamp() }); m.close(); toast('Link added'); }
        catch (ex) { showError(m.$('#lk-err'), friendlyError(ex)); }
      });
    });
  });
  $('#new-folder').addEventListener('click', async () => {
    const name = await promptDialog({ title: 'New folder', label: 'Folder name', placeholder: 'Week 1 readings', confirmLabel: 'Create' });
    if (name) { extraFolders.add(name.slice(0, 60)); folder = name.slice(0, 60); draw(); }
  });
  const upload = async list => {
    for (const file of list) {
      const row = document.createElement('div');
      row.className = 'card px-4 py-3 flex items-center gap-3';
      row.innerHTML = `${ico('upload', 'w-4 h-4 text-[#F59E0B] shrink-0')}<span class="text-sm text-white truncate flex-1">${escapeHtml(file.name)}</span><span class="w-32 h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><span class="block h-full bg-[#F59E0B] transition-all" style="width:0%"></span></span>`;
      $('#uploads')?.appendChild(row); refreshIcons();
      const bar = row.querySelector('span > span');
      try {
        if (file.size > MAX_INLINE) throw Object.assign(new Error(`is ${formatBytes(file.size)} — files over 700 KB need to be shared as a link (Google Drive, OneDrive…).`), { expected: true });
        const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.onprogress = ev => { bar.style.width = `${Math.round(ev.loaded / (ev.total || 1) * 80)}%`; }; fr.readAsDataURL(file); });
        const ref = doc(col);
        await setDoc(doc(courseCol(ctx, course.id, 'fileBlobs'), ref.id), { data, uploadedBy: ctx.me.uid });
        bar.style.width = '100%';
        await setDoc(ref, { name: file.name, size: file.size, contentType: file.type || '', inline: true, folder, uploadedBy: ctx.me.uid, uploadedByName: ctx.me.name, createdAt: serverTimestamp() });
        row.remove();
      } catch (ex) {
        if (!ex.expected) console.error(ex);
        row.innerHTML = `${ico('circle-x', 'w-4 h-4 text-red-400 shrink-0')}<span class="text-sm text-red-300 flex-1">${escapeHtml(file.name)}: ${escapeHtml(friendlyError(ex))}</span><button class="btn-icon" aria-label="Dismiss">${ico('x', 'w-4 h-4')}</button>`;
        refreshIcons(); row.querySelector('button').addEventListener('click', () => row.remove());
      }
    }
    if (list.length) toast(`Uploaded ${plural(list.length, 'file')}`);
  };
  $('#file-input').addEventListener('change', e => { upload([...e.target.files]); e.target.value = ''; });
  const main = $('#main'), dz = $('#dropzone');
  main.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); dz.classList.remove('hidden'); } });
  main.addEventListener('dragleave', e => { if (!main.contains(e.relatedTarget)) dz.classList.add('hidden'); });
  main.addEventListener('drop', e => { e.preventDefault(); dz.classList.add('hidden'); if (e.dataTransfer?.files?.length) upload([...e.dataTransfer.files]); });
}

// ═══════════════════════════════════════════════════════════════
// CONFERENCES
// ═══════════════════════════════════════════════════════════════
function viewConferences(ctx, course) {
  setTitle('Conferences', course.title);
  const col = courseCol(ctx, course.id, 'conferences');
  render(tenantPage(ctx, 'conferences', sectionHeader(ctx, course, 'Conferences', ctx.teacherMode ? `<button id="new-conf" class="btn btn-primary">${ico('plus')} Conference</button>` : '') +
    `<p class="text-sm text-gray-500 -mt-4 mb-6 max-w-3xl">Live video sessions — Google Meet, Zoom or Teams links, scheduled for the class.</p><div id="conf-list" class="max-w-4xl space-y-8">${skeletonRows(3, 'h-20')}</div>`, course));
  let list = [];
  $('#new-conf')?.addEventListener('click', () => openConferenceModal(ctx, col));
  const el = $('#conf-list');
  const draw = () => {
    const now = Date.now();
    const span = c => { const s = tsMillis(c.startAt); return [s, s + (Number(c.durationMin) || 60) * 60000]; };
    const live_ = list.filter(c => { const [s, e] = span(c); return s <= now && now <= e; });
    const up = list.filter(c => span(c)[0] > now).sort((a, b) => tsMillis(a.startAt) - tsMillis(b.startAt));
    const past = list.filter(c => span(c)[1] < now).sort((a, b) => tsMillis(b.startAt) - tsMillis(a.startAt));
    const card = (c, state) => {
      const [s, e] = span(c); const url = safeUrl(c.joinUrl);
      const joinable = url && (ctx.teacherMode ? state !== 'past' : now >= s - 15 * 60000 && now <= e);
      return `<article class="card p-5 flex flex-col sm:flex-row sm:items-center gap-4 group">
        ${iconTile('video', state === 'live' ? 'green' : state === 'past' ? 'muted' : 'amber', 'tile-lg')}
        <div class="flex-1 min-w-0"><div class="flex items-center gap-2"><h3 class="text-white font-medium truncate">${escapeHtml(c.title || 'Conference')}</h3>${state === 'live' ? badge('In progress', 'green') : ''}</div>
          <p class="text-xs text-gray-500">${escapeHtml(formatDateTime(c.startAt))} – ${escapeHtml(new Date(e).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}${state === 'upcoming' ? ` · starts ${escapeHtml(relativeFuture(s))}` : ''}</p>
          ${c.description ? `<p class="text-sm text-gray-400 mt-1 line-clamp-2">${escapeHtml(c.description)}</p>` : ''}</div>
        <div class="flex items-center gap-2 shrink-0">
          ${joinable ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="btn ${state === 'live' ? 'btn-primary' : 'btn-secondary'} btn-sm">${ico('video', 'w-3.5 h-3.5')} Join</a>` : state === 'upcoming' ? `<span class="text-[11px] text-gray-500">Join opens 15 min before</span>` : ''}
          ${ctx.teacherMode ? `<div class="row-actions"><button class="btn-icon" data-conf-edit="${c.id}" aria-label="Edit">${ico('pencil', 'w-3.5 h-3.5')}</button><button class="btn-icon danger" data-conf-del="${c.id}" aria-label="Delete">${ico('trash-2', 'w-3.5 h-3.5')}</button></div>` : ''}
        </div></article>`;
    };
    const sec = (title, arr, state) => arr.length ? `<section><h2 class="label">${title}</h2><div class="space-y-3">${arr.map(c => card(c, state)).join('')}</div></section>` : '';
    el.innerHTML = list.length ? sec('In progress', live_, 'live') + sec('Upcoming', up, 'upcoming') + sec('Concluded', past, 'past') : emptyState({ icon: 'video', tone: 'amber', title: 'No conferences scheduled', text: ctx.teacherMode ? 'Schedule a live session and students get a Join button when it starts.' : 'Live sessions your teacher schedules will appear here.' });
    refreshIcons();
  };
  unsubs.push(onSnapshot(col, snap => { list = snap.docs.map(d => ({ id: d.id, ...d.data() })); draw(); }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  const tick = setInterval(() => { if (el.isConnected) draw(); else clearInterval(tick); }, 60000);
  unsubs.push(() => clearInterval(tick));
  el.addEventListener('click', async e => {
    const ed = e.target.closest('[data-conf-edit]'); if (ed) return openConferenceModal(ctx, col, list.find(c => c.id === ed.dataset.confEdit));
    const del = e.target.closest('[data-conf-del]');
    if (del && await confirmDialog({ title: 'Delete this conference?', confirmLabel: 'Delete', danger: true })) { try { await deleteDoc(doc(col, del.dataset.confDel)); toast('Conference deleted'); } catch (ex) { toast(friendlyError(ex), 'error'); } }
  });
}
function relativeFuture(ms) {
  const m = Math.round((ms - Date.now()) / 60000);
  if (m < 60) return `in ${plural(Math.max(1, m), 'minute')}`;
  if (m < 1440) return `in ${plural(Math.round(m / 60), 'hour')}`;
  return `in ${plural(Math.round(m / 1440), 'day')}`;
}
function openConferenceModal(ctx, col, existing = null) {
  const start = toDate(existing?.startAt) || (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();
  const m = openModal({
    html: modalHeader({ title: existing ? 'Edit conference' : 'New conference', icon: 'video' }) + `<form novalidate>${modalBody(`
      <label class="label" for="cf-title">Name</label><input id="cf-title" class="input mb-4" value="${escapeHtml(existing?.title || '')}" placeholder="Office hours" autocomplete="off">
      <div class="grid grid-cols-[1fr_120px] gap-3 mb-4"><div><label class="label" for="cf-start">Starts</label><input id="cf-start" type="datetime-local" class="input" value="${toDateTimeInput(start)}"></div>
        <div><label class="label" for="cf-dur">Length</label><select id="cf-dur" class="input">${[15, 30, 45, 60, 90, 120].map(n => `<option value="${n}" ${Number(existing?.durationMin || 60) === n ? 'selected' : ''}>${n} min</option>`).join('')}</select></div></div>
      <label class="label" for="cf-url">Join link</label><input id="cf-url" type="url" inputmode="url" class="input" value="${escapeHtml(existing?.joinUrl || '')}" placeholder="https://meet.google.com/abc-defg-hij">
      <p class="hint mb-4">Google Meet, Zoom, Teams or any video link.</p>
      <label class="label" for="cf-desc">Description</label><textarea id="cf-desc" rows="3" class="input">${escapeHtml(existing?.description || '')}</textarea>
      <p id="cf-error" class="form-error mt-3 hidden"></p>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${existing ? 'Save' : 'Schedule'}</button>`)}</form>`
  });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const title = m.$('#cf-title').value.trim(), startVal = m.$('#cf-start').value, joinUrl = normalizeUrl(m.$('#cf-url').value);
    const err = m.$('#cf-error'); showError(err, '');
    if (!title) return showError(err, 'Name the conference.');
    if (!startVal) return showError(err, 'Pick a start time.');
    if (!joinUrl) return showError(err, 'Add a valid join link.');
    const data = { title, startAt: new Date(startVal), durationMin: Number(m.$('#cf-dur').value), joinUrl, description: m.$('#cf-desc').value.trim() };
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Saving…', async () => {
      try {
        if (existing) await updateDoc(doc(col, existing.id), { ...data, updatedAt: serverTimestamp() });
        else await addDoc(col, { ...data, createdBy: ctx.me.uid, createdAt: serverTimestamp() });
        m.close(); toast(existing ? 'Conference updated' : 'Conference scheduled');
      } catch (ex) { showError(err, friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// OUTCOMES
// ═══════════════════════════════════════════════════════════════
const DEFAULT_RATINGS = [{ points: 4, label: 'Exceeds mastery' }, { points: 3, label: 'Meets mastery' }, { points: 2, label: 'Near mastery' }, { points: 1, label: 'Below mastery' }, { points: 0, label: 'No evidence' }];
function viewOutcomes(ctx, course) {
  setTitle('Outcomes', course.title);
  const col = courseCol(ctx, course.id, 'outcomes');
  render(tenantPage(ctx, 'outcomes', sectionHeader(ctx, course, 'Outcomes', ctx.teacherMode ? `<button id="new-outcome" class="btn btn-primary">${ico('plus')} Outcome</button>` : '') +
    `<p class="text-sm text-gray-500 -mt-4 mb-6 max-w-3xl">The skills and standards this course is built to develop, with the scale used to judge mastery.</p><div id="outcome-list" class="max-w-4xl space-y-3">${skeletonRows(3, 'h-24')}</div>`, course));
  let list = [];
  $('#new-outcome')?.addEventListener('click', () => openOutcomeModal(ctx, col));
  const el = $('#outcome-list');
  unsubs.push(onSnapshot(col, snap => {
    list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.code || a.title || '').localeCompare(b.code || b.title || '', undefined, { numeric: true }));
    el.innerHTML = !list.length ? emptyState({ icon: 'target', tone: 'amber', title: 'No outcomes yet', text: ctx.teacherMode ? 'Add learning outcomes or standards (e.g. “CCSS.ELA.RL.9.2”) to make expectations visible.' : '' })
      : list.map(o => `<article class="card p-5 group">
          <div class="flex items-start gap-4">${iconTile('target', 'amber')}
            <div class="flex-1 min-w-0"><div class="flex items-center gap-2 flex-wrap">${o.code ? `<span class="text-[11px] font-mono text-[#F59E0B]">${escapeHtml(o.code)}</span>` : ''}<h3 class="text-white font-medium">${escapeHtml(o.title || 'Untitled')}</h3></div>
              ${o.description ? `<p class="text-sm text-gray-400 mt-1 whitespace-pre-wrap">${escapeHtml(o.description)}</p>` : ''}
              <div class="flex flex-wrap gap-1.5 mt-3">${(o.ratings || DEFAULT_RATINGS).map(r => `<span class="badge ${Number(r.points) >= Number(o.masteryPoints ?? 3) ? 'badge-green' : 'badge-muted'}">${escapeHtml(r.points)} · ${escapeHtml(r.label)}</span>`).join('')}</div>
              <p class="text-[11px] text-gray-500 mt-2">Mastery at ${escapeHtml(o.masteryPoints ?? 3)} points</p></div>
            ${ctx.teacherMode ? `<div class="row-actions"><button class="btn-icon" data-out-edit="${o.id}" aria-label="Edit">${ico('pencil', 'w-3.5 h-3.5')}</button><button class="btn-icon danger" data-out-del="${o.id}" aria-label="Delete">${ico('trash-2', 'w-3.5 h-3.5')}</button></div>` : ''}
          </div></article>`).join('');
    refreshIcons();
  }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  el.addEventListener('click', async e => {
    const ed = e.target.closest('[data-out-edit]'); if (ed) return openOutcomeModal(ctx, col, list.find(o => o.id === ed.dataset.outEdit));
    const del = e.target.closest('[data-out-del]');
    if (del && await confirmDialog({ title: 'Delete this outcome?', confirmLabel: 'Delete', danger: true })) { try { await deleteDoc(doc(col, del.dataset.outDel)); toast('Outcome deleted'); } catch (ex) { toast(friendlyError(ex), 'error'); } }
  });
}
function openOutcomeModal(ctx, col, existing = null) {
  let ratings = (existing?.ratings || DEFAULT_RATINGS).map(r => ({ ...r }));
  const m = openModal({
    size: 'lg', align: 'top',
    html: modalHeader({ title: existing ? 'Edit outcome' : 'New outcome', icon: 'target' }) + `<form novalidate>${modalBody(`
      <div class="grid sm:grid-cols-[160px_1fr] gap-3 mb-4"><div><label class="label" for="oc-code">Code <span class="normal-case tracking-normal text-gray-600">(optional)</span></label><input id="oc-code" class="input font-mono text-sm" value="${escapeHtml(existing?.code || '')}" placeholder="RL.9.2"></div>
        <div><label class="label" for="oc-title">Outcome</label><input id="oc-title" class="input" value="${escapeHtml(existing?.title || '')}" placeholder="Determine a theme and analyze its development"></div></div>
      <label class="label" for="oc-desc">Description</label><textarea id="oc-desc" rows="3" class="input mb-5">${escapeHtml(existing?.description || '')}</textarea>
      <div class="flex items-center justify-between mb-2"><span class="label !mb-0">Rating scale</span><button type="button" id="oc-add" class="btn btn-ghost btn-sm">${ico('plus', 'w-3.5 h-3.5')} Rating</button></div>
      <div id="oc-ratings" class="space-y-2 mb-4"></div>
      <label class="label" for="oc-mastery">Mastery at</label><select id="oc-mastery" class="input"></select>
      <p id="oc-error" class="form-error mt-3 hidden"></p>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">Save outcome</button>`)}</form>`
  });
  const drawRatings = () => {
    m.$('#oc-ratings').innerHTML = ratings.map((r, i) => `<div class="flex items-center gap-2"><input type="number" class="input !py-2 w-20" data-rp="${i}" value="${escapeHtml(r.points)}" aria-label="Points"><input class="input !py-2 flex-1" data-rl="${i}" value="${escapeHtml(r.label)}" aria-label="Label">${ratings.length > 2 ? `<button type="button" class="btn-icon danger" data-rdel="${i}" aria-label="Remove rating">${ico('x', 'w-3.5 h-3.5')}</button>` : ''}</div>`).join('');
    const cur = Number(m.$('#oc-mastery').value || existing?.masteryPoints || 3);
    m.$('#oc-mastery').innerHTML = [...new Set(ratings.map(r => Number(r.points)))].sort((a, b) => b - a).map(p => `<option value="${p}" ${p === cur ? 'selected' : ''}>${p} points</option>`).join('');
    refreshIcons();
  };
  drawRatings();
  m.$('#oc-ratings').addEventListener('input', e => { const i = e.target.dataset.rp ?? e.target.dataset.rl; if (i === undefined) return; if (e.target.dataset.rp !== undefined) ratings[i].points = Number(e.target.value); else ratings[i].label = e.target.value; });
  m.$('#oc-ratings').addEventListener('change', e => { if (e.target.dataset.rp !== undefined) drawRatings(); });
  m.$('#oc-ratings').addEventListener('click', e => { const b = e.target.closest('[data-rdel]'); if (b) { ratings.splice(+b.dataset.rdel, 1); drawRatings(); } });
  m.$('#oc-add').addEventListener('click', () => { ratings.push({ points: 0, label: '' }); drawRatings(); });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const title = m.$('#oc-title').value.trim(); const err = m.$('#oc-error'); showError(err, '');
    if (!title) return showError(err, 'Describe the outcome.');
    const clean = ratings.filter(r => String(r.label).trim()).map(r => ({ points: Number(r.points) || 0, label: String(r.label).trim() })).sort((a, b) => b.points - a.points);
    if (clean.length < 2) return showError(err, 'Add at least two labelled ratings.');
    const data = { code: m.$('#oc-code').value.trim(), title, description: m.$('#oc-desc').value.trim(), ratings: clean, masteryPoints: Number(m.$('#oc-mastery').value) };
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Saving…', async () => {
      try { if (existing) await updateDoc(doc(col, existing.id), data); else await addDoc(col, { ...data, createdAt: serverTimestamp() }); m.close(); toast('Outcome saved'); }
      catch (ex) { showError(err, friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// PEOPLE & SETTINGS
// ═══════════════════════════════════════════════════════════════
function viewPeople(ctx, course) {
  const t = routeToken;
  setTitle('People', course.title);
  render(tenantPage(ctx, 'people', sectionHeader(ctx, course, 'People', ctx.teacherMode ? `<button id="enroll-btn" class="btn btn-primary">${ico('user-plus')} People</button>` : '') + `
    <div class="max-w-5xl"><div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="segmented" role="group" aria-label="Filter by role"><button data-prole="all" aria-pressed="true">Everyone</button><button data-prole="Teacher" aria-pressed="false">Teachers</button><button data-prole="Student" aria-pressed="false">Students</button></div>
      ${searchBox('people-search', 'Search people…')}</div><div id="people-list">${skeletonRows(5)}</div></div>`, course));
  $('#enroll-btn')?.addEventListener('click', () => openEnrollModal(ctx, course.id));
  let people = [], role = 'all', q = '';
  const el = $('#people-list');
  const draw = () => {
    const list = people.filter(p => (role === 'all' || p.role === role) && (!q || `${p.name} ${p.username || ''}`.toLowerCase().includes(q)));
    $$('[data-prole]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.prole === role)));
    el.innerHTML = `<p class="text-xs text-gray-500 mb-3">${plural(people.filter(p => p.role === 'Student').length, 'student')} · ${plural(people.filter(p => p.role === 'Teacher').length, 'teacher')}</p>` + (!list.length ? `<p class="text-sm text-gray-500 py-8 text-center">No one matches.</p>` : dataTable(
      [{ label: 'Name', cls: 'col-span-12 sm:col-span-5' }, { label: 'Role', cls: 'col-span-4 sm:col-span-2' }, { label: ctx.teacherMode ? 'Username' : '', cls: 'col-span-4 sm:col-span-3' }, { label: '', cls: 'col-span-4 sm:col-span-2 text-right' }],
      list.map(p => ({ cells: [
        `<div class="flex items-center gap-3">${avatar(p.name)}<span class="text-sm text-white truncate">${escapeHtml(p.name)}${p.uid === ctx.me.uid ? ' <span class="text-[10px] text-[#F59E0B]">You</span>' : ''}</span></div>`,
        p.role === 'Teacher' ? badge('Teacher', 'violet') : badge('Student'),
        ctx.teacherMode ? `<span class="text-xs text-gray-400 font-mono truncate block">${escapeHtml(p.username || '')}</span>` : '',
        `<div class="row-actions">${p.uid !== ctx.me.uid ? `<button class="btn-icon" data-msg="${p.uid}" aria-label="Message ${escapeHtml(p.name)}">${ico('mail', 'w-4 h-4')}</button>` : ''}${ctx.teacherMode && p.role === 'Student' ? `<button class="btn-icon danger" data-unenroll="${p.uid}" aria-label="Remove ${escapeHtml(p.name)}">${ico('user-minus', 'w-4 h-4')}</button>` : ''}</div>`
      ] }))));
    refreshIcons();
  };
  unsubs.push(onSnapshot(courseCol(ctx, course.id, 'enrollments'), async () => { const ppl = await coursePeople(ctx, course); if (live(t)) { people = ppl; draw(); } }, e => { el.innerHTML = errorBox(e); refreshIcons(); }));
  $('#people-search').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
  $('#main').addEventListener('click', async e => {
    const r = e.target.closest('[data-prole]'); if (r) { role = r.dataset.prole; return draw(); }
    const msg = e.target.closest('[data-msg]'); if (msg) return openComposeModal(ctx, { courseId: course.id, to: [msg.dataset.msg] });
    const un = e.target.closest('[data-unenroll]'); if (!un) return;
    const p = people.find(x => x.uid === un.dataset.unenroll);
    if (!await confirmDialog({ title: `Remove ${p?.name || 'student'}?`, message: 'They will lose access to this course. Their submissions are kept.', confirmLabel: 'Remove', danger: true })) return;
    try {
      await deleteDoc(doc(courseCol(ctx, course.id, 'enrollments'), un.dataset.unenroll));
      await updateDoc(doc(db, 'tenants', ctx.slug, 'students', un.dataset.unenroll), { enrolledCourseIds: arrayRemove(course.id) }).catch(() => {});
      toast('Student removed');
    } catch (ex) { toast(friendlyError(ex), 'error'); }
  });
}

function viewCourseSettings(ctx, course) {
  if (!ctx.teacherMode) return viewNotFound();
  setTitle('Settings', course.title);
  const ref = doc(db, 'tenants', ctx.slug, 'courses', course.id);
  let tab = 'details', grad = gradOf(course);
  let order = orderedCourseNav(course).map(n => n.key), hidden = new Set(course.navHidden || []);
  render(tenantPage(ctx, 'settings', sectionHeader(ctx, course, 'Settings') + `
    <div class="grid lg:grid-cols-[minmax(0,1fr)_240px] gap-8 max-w-6xl">
      <div class="min-w-0"><div class="segmented mb-6" role="tablist"><button data-tab="details" aria-pressed="true">Course details</button><button data-tab="navigation" aria-pressed="false">Navigation</button></div><div id="settings-body"></div></div>
      <aside class="space-y-2">
        <button data-toggle-preview class="btn btn-secondary btn-block !justify-start">${ico('eye')} Student view</button>
        <a href="${cHref(ctx, course.id, 'grades')}" class="btn btn-secondary btn-block !justify-start">${ico('award')} Gradebook</a>
        <a href="${cHref(ctx, course.id, 'people')}" class="btn btn-secondary btn-block !justify-start">${ico('users')} People</a>
        <button id="del-course" class="btn btn-ghost btn-block !justify-start !text-red-400">${ico('trash-2')} Delete this course</button>
      </aside>
    </div>`, course));
  const body = $('#settings-body');
  const draw = () => {
    $$('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    if (tab === 'details') {
      body.innerHTML = `<form id="details-form" class="card p-6 space-y-5" novalidate>
        <div><label class="label" for="cs-title">Name</label><input id="cs-title" class="input" value="${escapeHtml(course.title || '')}"></div>
        <div class="grid sm:grid-cols-2 gap-4"><div><label class="label" for="cs-code">Course code</label><input id="cs-code" class="input" value="${escapeHtml(course.code || '')}" placeholder="BIO 101"></div><div><label class="label" for="cs-term">Term</label><input id="cs-term" class="input" value="${escapeHtml(course.term || '')}" placeholder="Spring 2026"></div></div>
        <div class="grid sm:grid-cols-2 gap-4"><div><label class="label" for="cs-start">Starts</label><input id="cs-start" type="date" class="input" value="${toDateInput(course.startDate)}"></div><div><label class="label" for="cs-end">Ends</label><input id="cs-end" type="date" class="input" value="${toDateInput(course.endDate)}"></div></div>
        <div><label class="label" for="cs-desc">Description <span class="normal-case tracking-normal text-gray-600">(shown on the course home page)</span></label><textarea id="cs-desc" rows="4" class="input">${escapeHtml(course.description || '')}</textarea></div>
        <div><span class="label">Color</span><div class="grid grid-cols-6 gap-2 max-w-sm" role="radiogroup">${GRADIENTS.map(g => `<button type="button" role="radio" aria-checked="${g === grad}" aria-label="${g.replace('grad-', '')}" data-grad="${g}" class="${g} h-9 rounded-lg border-2 ${g === grad ? 'border-white' : 'border-transparent'} hover:border-white/50 transition-all"></button>`).join('')}</div></div>
        <div class="space-y-3"><label class="check"><input type="checkbox" id="cs-topics" ${course.allowStudentTopics ? 'checked' : ''}> Let students start discussion topics</label>
          <label class="check"><input type="checkbox" id="cs-pub" ${course.published !== false ? 'checked' : ''}> Published</label></div>
        <p id="cs-error" class="form-error hidden"></p>
        <button type="submit" class="btn btn-primary">Update course details</button></form>`;
      body.querySelectorAll('[data-grad]').forEach(b => b.addEventListener('click', () => { grad = b.dataset.grad; body.querySelectorAll('[data-grad]').forEach(x => { x.classList.replace('border-white', 'border-transparent'); x.setAttribute('aria-checked', 'false'); }); b.classList.replace('border-transparent', 'border-white'); b.setAttribute('aria-checked', 'true'); }));
      $('#details-form').addEventListener('submit', e => {
        e.preventDefault();
        const title = $('#cs-title').value.trim(); if (!title) return showError($('#cs-error'), 'The course needs a name.');
        const s = $('#cs-start').value, en = $('#cs-end').value;
        withBusy(e.currentTarget.querySelector('[type=submit]'), 'Saving…', async () => {
          try {
            await updateDoc(ref, { title, code: $('#cs-code').value.trim(), term: $('#cs-term').value.trim(), description: $('#cs-desc').value.trim(), startDate: s ? new Date(s + 'T00:00') : null, endDate: en ? new Date(en + 'T23:59') : null, gradient: grad, allowStudentTopics: $('#cs-topics').checked, published: $('#cs-pub').checked, updatedAt: serverTimestamp() });
            invalidateCourses(); toast('Course details updated'); renderRoute();
          } catch (ex) { showError($('#cs-error'), friendlyError(ex)); }
        });
      });
    } else {
      const label = k => COURSE_NAV.find(n => n.key === k).label;
      body.innerHTML = `<div class="card p-6"><p class="text-sm text-gray-400 mb-5">Reorder the course menu and hide pages students don't need. Hidden pages are still visible to you, dimmed. Home and Settings always stay in place.</p>
        <div class="space-y-1.5">
          <div class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-sm text-gray-500">${ico('lock', 'w-3.5 h-3.5')} Home</div>
          ${order.map((k, i) => `<div class="flex items-center gap-3 px-3 py-2 rounded-lg border border-white/[0.08] ${hidden.has(k) ? 'opacity-50' : ''}">
            <span class="text-sm text-white flex-1">${label(k)}</span>${hidden.has(k) ? badge('Hidden', 'muted') : ''}
            <button class="btn-icon" data-nav-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${label(k)} up">${ico('chevron-up', 'w-4 h-4')}</button>
            <button class="btn-icon" data-nav-down="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Move ${label(k)} down">${ico('chevron-down', 'w-4 h-4')}</button>
            <button class="btn-icon" data-nav-hide="${k}" aria-label="${hidden.has(k) ? 'Show' : 'Hide'} ${label(k)}">${ico(hidden.has(k) ? 'eye-off' : 'eye', 'w-4 h-4')}</button></div>`).join('')}
          <div class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-sm text-gray-500">${ico('lock', 'w-3.5 h-3.5')} Settings <span class="text-[11px]">(teachers only)</span></div>
        </div>
        <div class="flex gap-3 mt-6"><button id="nav-save" class="btn btn-primary">Save navigation</button><button id="nav-reset" class="btn btn-ghost">Reset to default</button></div></div>`;
      refreshIcons();
    }
  };
  draw();
  $('#main').addEventListener('click', async e => {
    const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; return draw(); }
    const up = e.target.closest('[data-nav-up]'); if (up) { const i = +up.dataset.navUp; [order[i - 1], order[i]] = [order[i], order[i - 1]]; return draw(); }
    const dn = e.target.closest('[data-nav-down]'); if (dn) { const i = +dn.dataset.navDown; [order[i + 1], order[i]] = [order[i], order[i + 1]]; return draw(); }
    const hd = e.target.closest('[data-nav-hide]'); if (hd) { const k = hd.dataset.navHide; hidden.has(k) ? hidden.delete(k) : hidden.add(k); return draw(); }
    if (e.target.closest('#nav-reset')) { order = MOVABLE_NAV.map(n => n.key); hidden = new Set(); return draw(); }
    const save = e.target.closest('#nav-save');
    if (save) return withBusy(save, 'Saving…', async () => {
      try { await updateDoc(ref, { navOrder: order, navHidden: [...hidden] }); invalidateCourses(); toast('Navigation saved'); renderRoute(); } catch (ex) { toast(friendlyError(ex), 'error'); }
    });
    if (e.target.closest('#del-course') && await confirmDialog({ title: `Delete “${course.title}”?`, message: 'All modules, items, enrollments and submissions will be permanently deleted.', confirmLabel: 'Delete course', danger: true })) {
      try { await deleteCourseDeep(ctx.slug, course.id); invalidateCourses(); toast('Course deleted'); navigate('/' + ctx.slug); } catch (ex) { toast(friendlyError(ex), 'error'); }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════
async function viewCalendar(ctx) {
  const t = routeToken;
  setTitle('Calendar', ctx.tenant.name);
  const today = new Date();
  let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  let mode = matchMedia('(max-width: 767px)').matches ? 'agenda' : 'month';
  const hiddenKey = `ember_cal_hidden:${ctx.me.uid}`;
  let hidden; try { hidden = new Set(JSON.parse(ls(hiddenKey) || '[]')); } catch { hidden = new Set(); }
  render(tenantPage(ctx, 'calendar', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'Calendar', actions: ctx.teacherMode ? `<button id="new-event" class="btn btn-primary">${ico('calendar-plus')} Event</button>` : '' }) + `
    <div class="grid lg:grid-cols-[minmax(0,1fr)_220px] gap-6 max-w-7xl">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div class="flex items-center gap-1.5"><button class="btn btn-secondary btn-sm" data-cal="today">Today</button><button class="btn-icon" data-cal="prev" aria-label="Previous month">${ico('chevron-left')}</button><button class="btn-icon" data-cal="next" aria-label="Next month">${ico('chevron-right')}</button><h2 id="cal-title" class="font-serif text-2xl text-white ml-2" aria-live="polite"></h2></div>
          <div class="segmented" role="group" aria-label="Calendar view"><button data-mode="month">Month</button><button data-mode="agenda">Agenda</button></div>
        </div>
        <div id="cal-body">${skeletonRows(5, 'h-24')}</div>
      </div>
      <aside><h2 class="label">Calendars</h2><div id="cal-courses" class="space-y-0.5"></div><p class="hint mt-4">Assignment and quiz due dates, conferences and events appear automatically.</p></aside>
    </div>`));
  let courses = [], events = [];
  try {
    courses = await myCourses(ctx);
    const per = await Promise.all(courses.map(async c => {
      const studentHidden = ctx.studentView ? new Set(c.navHidden || []) : new Set();
      const [items, confs, evs] = await Promise.all([
        loadAllItems(ctx, c.id).catch(() => []),
        studentHidden.has('conferences') ? [] : getDocs(courseCol(ctx, c.id, 'conferences')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
        getDocs(courseCol(ctx, c.id, 'events')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
      ]);
      const out = [];
      items.forEach(i => { const d = toDate(i.data?.dueDate); if (d) out.push({ kind: 'item', title: i.title, date: d, course: c, icon: typeMeta(i.type).icon, href: itemHref(ctx, i) }); });
      confs.forEach(x => { const d = toDate(x.startAt); if (d) out.push({ kind: 'conference', title: x.title, date: d, course: c, icon: 'video', href: cHref(ctx, c.id, 'conferences') }); });
      evs.forEach(x => { const d = toDate(x.startAt); if (d) out.push({ kind: 'event', id: x.id, title: x.title, date: d, allDay: !!x.allDay, description: x.description || '', course: c, icon: 'calendar' }); });
      return out;
    }));
    events = per.flat().sort((a, b) => a.date - b.date);
  } catch (e) { if (live(t)) { $('#cal-body').innerHTML = errorBox(e); refreshIcons(); } return; }
  if (!live(t)) return;
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const timeLabel = ev => ev.allDay ? '' : ev.date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const chip = ev => `<button type="button" data-ev="${events.indexOf(ev)}" class="cal-chip" style="--c:${courseHex(ev.course)}" title="${escapeHtml(ev.title)} — ${escapeHtml(ev.course.title || '')}">${ico(ev.icon, 'w-3 h-3 shrink-0')}<span class="truncate">${timeLabel(ev) ? `<span class="opacity-70">${escapeHtml(timeLabel(ev))}</span> ` : ''}${escapeHtml(ev.title || 'Untitled')}</span></button>`;
  const draw = () => {
    const vis = events.filter(ev => !hidden.has(ev.course.id));
    $('#cal-title').textContent = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    $$('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const body = $('#cal-body');
    if (mode === 'month') {
      const start = new Date(cursor); start.setDate(1 - cursor.getDay());
      const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
      body.innerHTML = `<div class="card overflow-hidden"><div class="cal-grid border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-gray-500">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="px-2 py-2">${d}</div>`).join('')}</div>
        <div class="cal-grid">${days.map(d => { const evs = vis.filter(ev => sameDay(ev.date, d));
          return `<div class="cal-cell ${d.getMonth() !== cursor.getMonth() ? 'is-out' : ''} ${ctx.teacherMode ? 'cursor-pointer' : ''}" data-day="${toDateInput(d)}"><div class="cal-date ${sameDay(d, today) ? 'is-today' : ''}">${d.getDate()}</div>${evs.slice(0, 3).map(chip).join('')}${evs.length > 3 ? `<button type="button" class="cal-more" data-more="1">+${evs.length - 3} more</button>` : ''}</div>`; }).join('')}</div></div>`;
    } else {
      const from = cursor, to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const groups = {};
      vis.filter(ev => ev.date >= from && ev.date < to).forEach(ev => (groups[toDateInput(ev.date)] ||= []).push(ev));
      const keys = Object.keys(groups);
      body.innerHTML = keys.length ? `<div class="space-y-4">${keys.map(day => `<section class="card overflow-hidden"><h3 class="px-4 py-2.5 text-xs uppercase tracking-wider ${day === toDateInput(today) ? 'text-[#F59E0B]' : 'text-gray-400'} border-b border-white/[0.06]">${escapeHtml(new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</h3>
        <div class="p-2 space-y-0.5">${groups[day].map(ev => `<button type="button" data-ev="${events.indexOf(ev)}" class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.04] text-left"><span class="w-2 h-2 rounded-full shrink-0" style="background:${courseHex(ev.course)}"></span>${ico(ev.icon, 'w-4 h-4 text-gray-500 shrink-0')}<span class="flex-1 min-w-0"><span class="block text-sm text-white truncate">${escapeHtml(ev.title || 'Untitled')}</span><span class="block text-[11px] text-gray-500 truncate">${escapeHtml(ev.course.title || '')}${timeLabel(ev) ? ' · ' + escapeHtml(timeLabel(ev)) : ''}</span></span></button>`).join('')}</div></section>`).join('')}</div>`
        : emptyState({ icon: 'calendar-days', title: 'Nothing scheduled this month', text: 'Due dates, conferences and events show up here automatically.' });
    }
    $('#cal-courses').innerHTML = courses.length ? courses.map(c => `<label class="check px-2 py-1.5 rounded-lg hover:bg-white/[0.03]"><input type="checkbox" data-cal-course="${c.id}" ${hidden.has(c.id) ? '' : 'checked'} style="accent-color:${courseHex(c)}"><span class="truncate">${escapeHtml(c.title || 'Untitled')}</span></label>`).join('') : `<p class="text-xs text-gray-500">No courses yet.</p>`;
    refreshIcons();
  };
  draw();
  const main = $('#main');
  main.addEventListener('click', e => {
    const nav = e.target.closest('[data-cal]');
    if (nav) { const a = nav.dataset.cal; cursor = a === 'today' ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(cursor.getFullYear(), cursor.getMonth() + (a === 'next' ? 1 : -1), 1); return draw(); }
    const md = e.target.closest('[data-mode]'); if (md) { mode = md.dataset.mode; return draw(); }
    if (e.target.closest('[data-more]')) { mode = 'agenda'; return draw(); }
    const evb = e.target.closest('[data-ev]');
    if (evb) { const ev = events[+evb.dataset.ev]; return ev.href ? goHref(ev.href) : openEventDetails(ctx, ev); }
    const cell = e.target.closest('[data-day]');
    if (cell && ctx.teacherMode) openEventEditor(ctx, courses, cell.dataset.day);
  });
  main.addEventListener('change', e => {
    const cb = e.target.closest('[data-cal-course]'); if (!cb) return;
    cb.checked ? hidden.delete(cb.dataset.calCourse) : hidden.add(cb.dataset.calCourse);
    ls(hiddenKey, JSON.stringify([...hidden])); draw();
  });
  $('#new-event')?.addEventListener('click', () => openEventEditor(ctx, courses, toDateInput(new Date())));
}
function openEventEditor(ctx, courses, day) {
  if (!courses.length) return toast('Create a course first.', 'info');
  const m = openModal({
    html: modalHeader({ title: 'New event', icon: 'calendar-plus' }) + `<form novalidate>${modalBody(`
      <label class="label" for="ev-title">Title</label><input id="ev-title" class="input mb-4" placeholder="Field trip permission slips due" autocomplete="off">
      <label class="label" for="ev-course">Calendar</label><select id="ev-course" class="input mb-4">${courses.map(c => `<option value="${c.id}">${escapeHtml(c.title || 'Untitled')}</option>`).join('')}</select>
      <div class="grid grid-cols-2 gap-3 mb-4"><div><label class="label" for="ev-date">Date</label><input id="ev-date" type="date" class="input" value="${day}"></div><div><label class="label" for="ev-time">Time <span class="normal-case tracking-normal text-gray-600">(optional)</span></label><input id="ev-time" type="time" class="input"></div></div>
      <label class="label" for="ev-desc">Details</label><textarea id="ev-desc" rows="3" class="input"></textarea>
      <p id="ev-error" class="form-error mt-3 hidden"></p>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">Add event</button>`)}</form>`
  });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const title = m.$('#ev-title').value.trim(), date = m.$('#ev-date').value, time = m.$('#ev-time').value;
    const err = m.$('#ev-error'); showError(err, '');
    if (!title) return showError(err, 'Add a title.');
    if (!date) return showError(err, 'Pick a date.');
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Saving…', async () => {
      try {
        await addDoc(courseCol(ctx, m.$('#ev-course').value, 'events'), { title, startAt: new Date(`${date}T${time || '00:00'}`), allDay: !time, description: m.$('#ev-desc').value.trim(), createdBy: ctx.me.uid, createdAt: serverTimestamp() });
        m.close(); toast('Event added'); renderRoute();
      } catch (ex) { showError(err, friendlyError(ex)); }
    });
  });
}
function openEventDetails(ctx, ev) {
  const m = openModal({
    size: 'sm', html: `<div class="p-6 sm:p-7">
      <div class="flex items-start gap-3 mb-4"><span class="w-3 h-3 rounded-full mt-2 shrink-0" style="background:${courseHex(ev.course)}"></span><div><h2 class="font-serif text-xl text-white">${escapeHtml(ev.title)}</h2><p class="text-xs text-gray-500">${escapeHtml(ev.course.title || '')}</p></div></div>
      <p class="text-sm text-gray-300 mb-2">${escapeHtml(ev.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}${ev.allDay ? '' : ' · ' + escapeHtml(ev.date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</p>
      ${ev.description ? `<p class="text-sm text-gray-400 whitespace-pre-wrap">${escapeHtml(ev.description)}</p>` : ''}
      <div class="flex gap-3 mt-6"><button data-close class="btn btn-secondary flex-1">Close</button>${ctx.teacherMode ? `<button data-del class="btn btn-danger flex-1">Delete</button>` : ''}</div></div>`
  });
  m.$('[data-del]')?.addEventListener('click', async () => {
    try { await deleteDoc(doc(courseCol(ctx, ev.course.id, 'events'), ev.id)); m.close(); toast('Event deleted'); renderRoute(); } catch (ex) { toast(friendlyError(ex), 'error'); }
  });
}

// ═══════════════════════════════════════════════════════════════
// INBOX
// ═══════════════════════════════════════════════════════════════
function viewInbox(ctx, convId = null) {
  setTitle('Inbox', ctx.tenant.name);
  const me = ctx.me.uid;
  render(tenantPage(ctx, 'inbox', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'Inbox', actions: `<button id="compose-btn" class="btn btn-primary">${ico('square-pen')} Compose</button>` }) + `
    <div class="card overflow-hidden max-w-6xl grid md:grid-cols-[320px_minmax(0,1fr)] h-[calc(100dvh-14rem)] min-h-[440px]">
      <div class="border-r border-white/[0.06] flex-col min-h-0 ${convId ? 'hidden md:flex' : 'flex'}">
        <div class="p-3 border-b border-white/[0.06] space-y-2"><div class="segmented grid grid-cols-2 w-full" role="group" aria-label="Filter"><button data-box="all" aria-pressed="true">All</button><button data-box="unread" aria-pressed="false">Unread</button></div>${searchBox('conv-search', 'Search messages…')}</div>
        <div id="conv-list" class="flex-1 overflow-y-auto">${skeletonRows(5, 'h-16')}</div>
      </div>
      <div id="conv-view" class="flex-col min-h-0 ${convId ? 'flex' : 'hidden md:flex'}"></div>
    </div>`));
  $('#compose-btn').addEventListener('click', () => openComposeModal(ctx));
  let convs = null, box = 'all', q = '';
  const listEl = $('#conv-list'), viewEl = $('#conv-view');
  const others = c => Object.entries(c.names || {}).filter(([u]) => u !== me).map(([, n]) => n).join(', ') || 'Just you';
  const drawList = () => {
    if (!listEl.isConnected || !convs) return;
    $$('[data-box]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.box === box)));
    let list = convs;
    if (box === 'unread') list = list.filter(c => !(c.readBy || []).includes(me));
    if (q) list = list.filter(c => `${c.subject} ${others(c)} ${c.lastMessage}`.toLowerCase().includes(q));
    listEl.innerHTML = list.length ? list.map(c => {
      const unread = !(c.readBy || []).includes(me);
      return `<a href="${buildUrl(`/${ctx.slug}/inbox/${c.id}`)}" class="block px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.03] ${c.id === convId ? 'bg-white/[0.06]' : ''}">
        <div class="flex items-center gap-2">${unread ? '<span class="w-2 h-2 rounded-full bg-[#F59E0B] shrink-0"><span class="sr-only">Unread</span></span>' : ''}<span class="text-sm ${unread ? 'text-white font-semibold' : 'text-gray-200'} truncate flex-1">${escapeHtml(others(c))}</span><span class="text-[10px] text-gray-500 shrink-0">${escapeHtml(timeAgo(c.lastAt))}</span></div>
        <div class="text-xs ${unread ? 'text-gray-200' : 'text-gray-400'} truncate mt-0.5">${escapeHtml(c.subject || '(No subject)')}</div>
        <div class="text-[11px] text-gray-500 truncate">${escapeHtml(c.lastMessage || '')}</div></a>`;
    }).join('') : `<p class="p-6 text-sm text-gray-500 text-center">${convs.length ? 'No matching conversations.' : 'No messages yet.'}</p>`;
  };
  const drawHead = () => {
    const h = $('#thread-head'); if (!h || !convs) return;
    const c = convs.find(x => x.id === convId);
    if (!c) { h.innerHTML = `<p class="text-sm text-gray-500">Conversation not found.</p>`; return; }
    h.innerHTML = `<a href="${buildUrl(`/${ctx.slug}/inbox`)}" class="md:hidden text-xs text-gray-500 inline-flex items-center gap-1 mb-2">${ico('arrow-left', 'w-3 h-3')} Inbox</a>
      <h2 class="font-serif text-xl text-white truncate">${escapeHtml(c.subject || '(No subject)')}</h2>
      <p class="text-xs text-gray-500 truncate">${escapeHtml(Object.values(c.names || {}).join(', '))}${c.courseTitle ? ' · ' + escapeHtml(c.courseTitle) : ''}</p>`;
    refreshIcons();
    if (!(c.readBy || []).includes(me)) updateDoc(doc(db, 'tenants', ctx.slug, 'conversations', convId), { readBy: arrayUnion(me) }).catch(() => {});
  };
  unsubs.push(onSnapshot(query(collection(db, 'tenants', ctx.slug, 'conversations'), where('participants', 'array-contains', me)), snap => {
    convs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => recency(b.lastAt) - recency(a.lastAt));
    drawList(); if (convId) drawHead();
  }, e => { listEl.innerHTML = `<div class="p-4">${errorBox(e)}</div>`; refreshIcons(); }));
  $('#conv-search').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); drawList(); });
  $$('[data-box]').forEach(b => b.addEventListener('click', () => { box = b.dataset.box; drawList(); }));
  if (!convId) {
    viewEl.innerHTML = `<div class="flex-1 flex items-center justify-center text-center p-8"><div>${iconTile('inbox', 'muted', 'tile-lg mx-auto mb-3')}<p class="text-sm text-gray-500">Select a conversation, or compose a new message.</p></div></div>`;
    refreshIcons(); return;
  }
  const convRef = doc(db, 'tenants', ctx.slug, 'conversations', convId);
  viewEl.innerHTML = `<div id="thread-head" class="px-5 py-4 border-b border-white/[0.06] shrink-0"></div>
    <div id="thread" class="flex-1 overflow-y-auto p-5 space-y-4">${skeletonRows(3, 'h-14')}</div>
    <form id="reply-form" class="p-4 border-t border-white/[0.06] flex gap-3 items-end shrink-0" novalidate><textarea id="reply-body" rows="2" class="input flex-1" placeholder="Write a reply… (Ctrl+Enter to send)" aria-label="Reply"></textarea><button type="submit" class="btn btn-primary">${ico('send', 'w-4 h-4')}<span class="hidden sm:inline">Send</span></button></form>`;
  refreshIcons();
  unsubs.push(onSnapshot(query(collection(convRef, 'messages'), orderBy('createdAt', 'asc')), snap => {
    const th = $('#thread'); if (!th) return;
    th.innerHTML = snap.docs.map(d => { const m = d.data(); const mine = m.senderUid === me;
      return `<div class="flex gap-3 ${mine ? 'justify-end' : ''}">${mine ? '' : avatar(m.senderName)}<div class="max-w-[85%] sm:max-w-[75%]"><div class="text-[11px] text-gray-500 mb-1 ${mine ? 'text-right' : ''}">${escapeHtml(mine ? 'You' : m.senderName || '')} · ${escapeHtml(formatDateTime(m.createdAt) || 'just now')}</div>
        <div class="rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${mine ? 'bg-[#F59E0B]/15 border border-[#F59E0B]/25 text-white rounded-tr-sm' : 'bg-white/[0.05] border border-white/[0.08] text-gray-200 rounded-tl-sm'}">${escapeHtml(m.body || '')}</div></div></div>`;
    }).join('') || `<p class="text-sm text-gray-500">No messages.</p>`;
    th.scrollTop = th.scrollHeight;
  }, e => { const th = $('#thread'); if (th) { th.innerHTML = errorBox(e); refreshIcons(); } }));
  const form = $('#reply-form'), ta = $('#reply-body');
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const body = ta.value.trim(); if (!body) return ta.focus();
    withBusy(form.querySelector('[type=submit]'), '', async () => {
      try {
        await addDoc(collection(convRef, 'messages'), { senderUid: me, senderName: ctx.me.name, body, createdAt: serverTimestamp() });
        await updateDoc(convRef, { lastMessage: body.slice(0, 140), lastAt: serverTimestamp(), lastSenderUid: me, readBy: [me] });
        ta.value = '';
      } catch (ex) { toast(friendlyError(ex), 'error'); }
    });
  });
}
async function openComposeModal(ctx, { courseId = null, to = [], subject = '' } = {}) {
  const courses = await myCourses(ctx).catch(() => []);
  const m = openModal({
    size: 'lg', align: 'top',
    html: modalHeader({ title: 'New message', icon: 'square-pen' }) + `<form novalidate>${modalBody(`
      <label class="label" for="cm-course">Course</label>
      <select id="cm-course" class="input mb-4">${courses.length ? '' : '<option value="">No courses</option>'}${courses.map(c => `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${escapeHtml(c.title || 'Untitled')}</option>`).join('')}</select>
      <span class="label">To</span>
      <div id="cm-people" class="rounded-xl border border-white/[0.08] bg-white/[0.02] max-h-52 overflow-y-auto p-1.5 mb-4"></div>
      <label class="label" for="cm-subject">Subject</label><input id="cm-subject" class="input mb-4" value="${escapeHtml(subject)}" autocomplete="off">
      <label class="label" for="cm-body">Message</label><textarea id="cm-body" rows="6" class="input"></textarea>
      <p id="cm-error" class="form-error mt-3 hidden" role="alert"></p>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${ico('send', 'w-4 h-4')} Send</button>`)}</form>`
  });
  const peopleEl = m.$('#cm-people'); const pre = new Set(to);
  const loadPeople = async () => {
    const c = courses.find(x => x.id === m.$('#cm-course').value);
    if (!c) { peopleEl.innerHTML = `<p class="text-xs text-gray-500 p-2">Pick a course to see who you can message.</p>`; return; }
    peopleEl.innerHTML = skeletonRows(2, 'h-8');
    const people = (await coursePeople(ctx, c)).filter(p => p.uid !== ctx.me.uid);
    const students = people.filter(p => p.role === 'Student');
    peopleEl.innerHTML = people.length ? (ctx.isRealTeacher && students.length > 1 ? `<label class="check px-2.5 py-2 border-b border-white/[0.06] mb-1"><input type="checkbox" data-all> <span class="text-gray-400">All students (${students.length})</span></label>` : '') +
      people.map(p => `<label class="check px-2.5 py-2 rounded-lg hover:bg-white/[0.03]"><input type="checkbox" value="${p.uid}" data-name="${escapeHtml(p.name)}" data-role="${p.role}" ${pre.has(p.uid) ? 'checked' : ''}> <span class="flex-1">${escapeHtml(p.name)}</span><span class="text-[10px] text-gray-500">${p.role}</span></label>`).join('')
      : `<p class="text-xs text-gray-500 p-2">No one else is in this course yet.</p>`;
  };
  peopleEl.addEventListener('change', e => { if (e.target.matches('[data-all]')) peopleEl.querySelectorAll('input[data-role="Student"]').forEach(c => { c.checked = e.target.checked; }); });
  m.$('#cm-course').addEventListener('change', () => { pre.clear(); loadPeople(); });
  loadPeople();
  setTimeout(() => (to.length ? m.$('#cm-subject') : m.$('#cm-course')).focus(), 60);
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const err = m.$('#cm-error'); showError(err, '');
    const recips = [...peopleEl.querySelectorAll('input[value]:checked')].map(c => ({ uid: c.value, name: c.dataset.name }));
    const body = m.$('#cm-body').value.trim(), subj = m.$('#cm-subject').value.trim();
    if (!recips.length) return showError(err, 'Choose at least one recipient.');
    if (!body) return showError(err, 'Write a message.');
    const c = courses.find(x => x.id === m.$('#cm-course').value);
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Sending…', async () => {
      try {
        const names = { [ctx.me.uid]: ctx.me.name };
        recips.forEach(r => { names[r.uid] = r.name; });
        const ref = await addDoc(collection(db, 'tenants', ctx.slug, 'conversations'), {
          participants: [ctx.me.uid, ...recips.map(r => r.uid)], names, subject: subj || '(No subject)',
          courseId: c?.id || null, courseTitle: c?.title || '', lastMessage: body.slice(0, 140), lastAt: serverTimestamp(),
          lastSenderUid: ctx.me.uid, readBy: [ctx.me.uid], createdAt: serverTimestamp()
        });
        await addDoc(collection(ref, 'messages'), { senderUid: ctx.me.uid, senderName: ctx.me.name, body, createdAt: serverTimestamp() });
        m.close(); toast('Message sent');
        navigate(`/${ctx.slug}/inbox/${ref.id}`);
      } catch (ex) { showError(err, friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// COMMONS (shared content library for teachers)
// ═══════════════════════════════════════════════════════════════
const GRADE_BANDS = ['K–2', '3–5', '6–8', '9–12', 'Higher ed', 'Any'];
function viewCommons(ctx) {
  setTitle('Commons', ctx.tenant.name);
  const col = collection(db, 'tenants', ctx.slug, 'commons');
  render(tenantPage(ctx, 'commons', pageHeader({ eyebrow: escapeHtml(ctx.tenant.name), title: 'Commons', subtitle: 'Share and reuse pages, assignments and quizzes with other teachers. Use “Share” on any item to add it here.' }) + `
    <div class="max-w-6xl"><div class="flex flex-wrap items-center gap-3 mb-6">${searchBox('commons-search', 'Search Commons…')}
      <div class="segmented flex-wrap" role="group" aria-label="Type"><button data-ctype="" aria-pressed="true">All</button>${ITEM_TYPES.filter(x => x.type !== 'link').map(x => `<button data-ctype="${x.type}" aria-pressed="false">${x.label}s</button>`).join('')}</div>
      <label class="check ml-auto"><input type="checkbox" id="commons-mine"> Shared by me</label></div>
      <div id="commons-grid" class="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">${skeletonCards(3)}</div></div>`));
  let list = [], type = '', q = '', mine = false;
  const grid = $('#commons-grid');
  const draw = () => {
    $$('[data-ctype]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ctype === type)));
    const shown = list.filter(x => (!type || x.type === type) && (!mine || x.authorUid === ctx.me.uid) && (!q || `${x.title} ${x.description} ${x.subject} ${(x.tags || []).join(' ')} ${x.authorName}`.toLowerCase().includes(q)));
    grid.innerHTML = !list.length ? `<div class="col-span-full">${emptyState({ icon: 'library', tone: 'amber', title: 'Commons is empty', text: 'Open any page, assignment or quiz and click “Share” to publish it here for your colleagues.' })}</div>`
      : !shown.length ? `<p class="col-span-full text-sm text-gray-500 text-center py-8">Nothing matches.</p>`
      : shown.map(x => `<button type="button" data-commons="${x.id}" class="card card-hover p-5 text-left flex flex-col">
          <div class="flex items-center gap-2 mb-3">${iconTile(typeMeta(x.type).icon, 'amber')}${badge(typeMeta(x.type).label, 'muted')}${x.gradeLevel ? badge(escapeHtml(x.gradeLevel), 'muted') : ''}</div>
          <h3 class="font-serif text-lg text-white mb-1 line-clamp-2">${escapeHtml(x.title || 'Untitled')}</h3>
          ${x.description ? `<p class="text-sm text-gray-400 line-clamp-2 mb-3">${escapeHtml(x.description)}</p>` : ''}
          <div class="mt-auto flex items-center gap-2 text-[11px] text-gray-500 pt-2">${avatar(x.authorName, null, 'w-5 h-5', 'text-[8px]')}<span class="truncate">${escapeHtml(x.authorName || '')}</span><span class="ml-auto shrink-0">${ico('download', 'w-3 h-3 inline -mt-0.5')} ${x.imports || 0}</span></div>
        </button>`).join('');
    refreshIcons();
  };
  unsubs.push(onSnapshot(col, snap => { list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => recency(b.createdAt) - recency(a.createdAt)); draw(); }, e => { grid.innerHTML = `<div class="col-span-full">${errorBox(e)}</div>`; refreshIcons(); }));
  $('#commons-search').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
  $('#commons-mine').addEventListener('change', e => { mine = e.target.checked; draw(); });
  $('#main').addEventListener('click', e => {
    const tb = e.target.closest('[data-ctype]'); if (tb) { type = tb.dataset.ctype; return draw(); }
    const card = e.target.closest('[data-commons]'); if (card) openCommonsPreview(ctx, list.find(x => x.id === card.dataset.commons));
  });
}
function openCommonsPreview(ctx, x) {
  const d = x.data || {};
  const preview = x.type === 'quiz'
    ? `<ol class="space-y-2 list-decimal pl-5 text-sm text-gray-300">${(d.questions || []).map(q => `<li>${escapeHtml(q.prompt)}</li>`).join('')}</ol>`
    : `<div class="prose-ember text-sm">${sanitize(x.type === 'page' ? d.content : d.description) || '<p class="text-gray-500 italic">No content.</p>'}</div>`;
  const m = openModal({
    size: 'xl', align: 'top',
    html: modalHeader({ title: escapeHtml(x.title || 'Untitled'), subtitle: `${typeMeta(x.type).label} · shared by ${escapeHtml(x.authorName || '')} · ${escapeHtml(formatDate(x.createdAt))}`, icon: typeMeta(x.type).icon }) + modalBody(`
      <div class="flex flex-wrap gap-2 mb-4">${x.subject ? badge(escapeHtml(x.subject), 'blue') : ''}${x.gradeLevel ? badge(escapeHtml(x.gradeLevel), 'muted') : ''}${(x.tags || []).map(tg => badge('#' + escapeHtml(tg), 'muted')).join('')}${GRADED_TYPES.includes(x.type) ? badge(`${x.type === 'quiz' ? (d.questions || []).length : d.points ?? 0} pts`, 'amber') : ''}</div>
      ${x.description ? `<p class="text-sm text-gray-300 mb-5 whitespace-pre-wrap">${escapeHtml(x.description)}</p>` : ''}
      <div class="bg-[#0A0A0A] border border-white/[0.08] rounded-lg p-5 max-h-[40vh] overflow-y-auto">${preview}</div>`) +
      modalFooter(`${x.authorUid === ctx.me.uid || ctx.isAdmin ? `<button data-remove class="btn btn-ghost sm:flex-1 !text-red-400">${ico('trash-2', 'w-4 h-4')} Remove from Commons</button>` : '<span class="sm:flex-1"></span>'}<button data-import class="btn btn-primary sm:flex-1">${ico('import', 'w-4 h-4')} Import into a course</button>`)
  });
  m.$('[data-remove]')?.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Remove from Commons?', message: 'Copies already imported into courses are not affected.', confirmLabel: 'Remove', danger: true })) return;
    try { await deleteDoc(doc(db, 'tenants', ctx.slug, 'commons', x.id)); m.close(); toast('Removed from Commons'); } catch (ex) { toast(friendlyError(ex), 'error'); }
  });
  m.$('[data-import]').addEventListener('click', async () => {
    const courses = await myCourses(ctx);
    if (!courses.length) return toast('Create a course first.', 'info');
    const courseId = courses.length === 1 ? courses[0].id : await new Promise(resolve => {
      let result = null;
      const pm = openModal({ size: 'sm', onClose: () => resolve(result), html: `<form class="p-6 sm:p-7" novalidate><h2 class="font-serif text-xl text-white mb-4">Import into which course?</h2><select id="ic-course" class="input">${courses.map(c => `<option value="${c.id}">${escapeHtml(c.title || 'Untitled')}</option>`).join('')}</select><div class="flex gap-3 mt-6"><button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">Next</button></div></form>` });
      pm.$('form').addEventListener('submit', e => { e.preventDefault(); result = pm.$('#ic-course').value; pm.close(); });
    });
    if (!courseId) return;
    const moduleId = await pickModule(ctx, courseId);
    if (!moduleId) return;
    try {
      await addDoc(collection(db, 'tenants', ctx.slug, 'courses', courseId, 'modules', moduleId, 'items'), { type: x.type, title: x.title, data: { ...d, dueDate: null }, position: Date.now(), importedFrom: x.id, createdAt: serverTimestamp() });
      await updateDoc(doc(db, 'tenants', ctx.slug, 'commons', x.id), { imports: increment(1) }).catch(() => {});
      m.close(); toast(`Imported into ${courses.find(c => c.id === courseId)?.title || 'course'}`);
    } catch (ex) { toast(friendlyError(ex), 'error'); }
  });
}
function openShareToCommons(ctx, item, course) {
  const m = openModal({
    html: modalHeader({ title: 'Share to Commons', subtitle: 'Other teachers at your school can preview and import a copy.', icon: 'share-2' }) + `<form novalidate>${modalBody(`
      <label class="label" for="sc-title">Title</label><input id="sc-title" class="input mb-4" value="${escapeHtml(item.title || '')}">
      <label class="label" for="sc-desc">Description</label><textarea id="sc-desc" rows="3" class="input mb-4" placeholder="What is it, and how do you use it?"></textarea>
      <div class="grid grid-cols-2 gap-3 mb-4"><div><label class="label" for="sc-subject">Subject</label><input id="sc-subject" class="input" placeholder="Biology"></div>
        <div><label class="label" for="sc-grade">Grade level</label><select id="sc-grade" class="input">${GRADE_BANDS.map(g => `<option>${g}</option>`).join('')}</select></div></div>
      <label class="label" for="sc-tags">Tags <span class="normal-case tracking-normal text-gray-600">(comma separated)</span></label><input id="sc-tags" class="input" placeholder="cells, lab, review">
      <p id="sc-error" class="form-error mt-3 hidden"></p>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">${ico('share-2', 'w-4 h-4')} Share</button>`)}</form>`
  });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const title = m.$('#sc-title').value.trim(); if (!title) return showError(m.$('#sc-error'), 'Add a title.');
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Sharing…', async () => {
      try {
        await addDoc(collection(db, 'tenants', ctx.slug, 'commons'), {
          title, type: item.type, data: { ...(item.data || {}), dueDate: null }, description: m.$('#sc-desc').value.trim(),
          subject: m.$('#sc-subject').value.trim(), gradeLevel: m.$('#sc-grade').value,
          tags: m.$('#sc-tags').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10),
          authorUid: ctx.me.uid, authorName: ctx.me.name, sourceCourseTitle: course?.title || '', imports: 0, createdAt: serverTimestamp()
        });
        m.close(); toast('Shared to Commons');
      } catch (ex) { showError(m.$('#sc-error'), friendlyError(ex)); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNT & HELP ACTIONS
// ═══════════════════════════════════════════════════════════════
function openProfileModal(ctx) {
  const m = openModal({
    size: 'sm', html: `<form class="p-6 sm:p-7" novalidate><h2 class="font-serif text-xl text-white mb-5">Profile</h2>
      <div class="flex justify-center mb-5">${avatar(ctx.me.name, currentUser.photoURL, 'w-16 h-16', 'text-lg')}</div>
      <label class="label" for="pf-name">Display name</label><input id="pf-name" class="input" value="${escapeHtml(ctx.me.name || '')}" autocomplete="name">
      <p class="hint">This is the name teachers and classmates see.</p>
      ${ctx.isStudent ? `<p class="text-xs text-gray-500 mt-4">Username: <span class="font-mono text-gray-300">${escapeHtml(ctx.roleInfo.data?.username || '')}</span></p>` : `<p class="text-xs text-gray-500 mt-4">Email: <span class="text-gray-300">${escapeHtml(currentUser.email || '')}</span></p>`}
      <p id="pf-error" class="form-error mt-3 hidden"></p>
      <div class="flex gap-3 mt-6"><button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">Save</button></div></form>`
  });
  m.$('form').addEventListener('submit', e => {
    e.preventDefault();
    const name = m.$('#pf-name').value.trim().slice(0, 80);
    if (!name) return showError(m.$('#pf-error'), 'Enter a name.');
    withBusy(e.currentTarget.querySelector('[type=submit]'), 'Saving…', async () => {
      try {
        await updateDoc(doc(db, 'tenants', ctx.slug, ctx.isRealTeacher ? 'users' : 'students', ctx.me.uid), { displayName: name });
        m.close(); toast('Profile updated'); renderRoute();
      } catch (ex) { showError(m.$('#pf-error'), friendlyError(ex)); }
    });
  });
}
function openHelp(kind) {
  const { ctx, course } = layoutState;
  closeTray();
  if (kind === 'ask') {
    return (async () => {
      const courses = await myCourses(ctx).catch(() => []);
      const c = course || courses[0];
      if (!c) return toast("You aren't enrolled in any courses yet.", 'info');
      openComposeModal(ctx, { courseId: c.id, to: c.ownerUid ? [c.ownerUid] : [], subject: 'Question' });
    })();
  }
  if (kind === 'shortcuts') {
    const keys = [['?', 'Open the Help menu'], ['/', 'Search on the current page'], ['g then d', 'Go to Dashboard'], ['g then c', 'Go to Calendar'], ['g then i', 'Go to Inbox'], ['g then a', 'Go to All courses'], ['Esc', 'Close a dialog or menu'], ['Ctrl + Enter', 'Send a message in the Inbox']];
    return openModal({ size: 'sm', html: modalHeader({ title: 'Keyboard shortcuts', icon: 'keyboard' }) + modalBody(`<dl class="space-y-2.5">${keys.map(([k, d]) => `<div class="flex items-center justify-between gap-4"><dt class="text-sm text-gray-300">${d}</dt><dd>${k.split(' ').map(p => ['then', '+'].includes(p) ? `<span class="text-xs text-gray-600 mx-1">${p}</span>` : `<kbd class="kbd">${p}</kbd>`).join('')}</dd></div>`).join('')}</dl>`) });
  }
  if (kind === 'guides') {
    const faqs = [
      ['How do students sign in?', 'Students choose “Student” on the sign-in page, search for their school, then enter the username and password their teacher gave them. Teachers can copy login details from the Students page (key icon).'],
      ['How do I add students to a course?', 'Open the course → People → “+ People”. Students must be approved first (Admin → Students, or Account → Students). Use “Add a class” to create many logins at once.'],
      ['How do I hide course menu items?', 'Course → Settings → Navigation. Reorder items with the arrows and hide anything students don’t need — hidden items stay visible to you, dimmed.'],
      ['How do quizzes get graded?', 'Multiple-choice quizzes are scored automatically when a student submits. Scores appear in the course Grades page and you can override them or add feedback from the quiz’s submissions list.'],
      ['What does “Student view” do?', 'It shows the course exactly as students see it — hidden menu items, no editing tools, and the student submission forms.'],
      ['How do I start a video conference?', 'Course → Conferences → “+ Conference”. Paste a Google Meet, Zoom or Teams link; students get a Join button 15 minutes before it starts.'],
      ['Where are Commons items shared?', 'Commons is a library for teachers at your school. Use “Share” on any page, assignment or quiz, and colleagues can import a copy into their own courses.'],
    ];
    return openModal({ size: 'lg', align: 'top', html: modalHeader({ title: 'Help guides', icon: 'book-open-check' }) + modalBody(`<div class="relative mb-4"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">${ico('search', 'w-3.5 h-3.5')}</span><input id="faq-search" type="search" class="input !py-2 pl-9" placeholder="Search the guides…" aria-label="Search the guides"></div>
      <div class="space-y-2" id="faq-list">${faqs.map(([q, a]) => `<details class="card px-4 py-3 group" data-faq="${escapeHtml((q + ' ' + a).toLowerCase())}"><summary class="text-sm text-white cursor-pointer list-none flex items-center justify-between gap-3">${escapeHtml(q)}${ico('chevron-down', 'w-4 h-4 text-gray-500 group-open:rotate-180 transition-transform shrink-0')}</summary><p class="text-sm text-gray-400 mt-3 leading-relaxed">${escapeHtml(a)}</p></details>`).join('')}</div>`) })
      .$('#faq-search').addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); $$('[data-faq]').forEach(d => d.classList.toggle('hidden', !!q && !d.dataset.faq.includes(q))); });
  }
  if (kind === 'report') {
    const m = openModal({
      html: modalHeader({ title: 'Report a problem', subtitle: 'Your school admin will see this report.', icon: 'bug' }) + `<form novalidate>${modalBody(`
        <label class="label" for="rp-subject">Subject</label><input id="rp-subject" class="input mb-4" placeholder="Quiz won't submit">
        <label class="label" for="rp-desc">What happened?</label><textarea id="rp-desc" rows="5" class="input mb-4" placeholder="What were you doing, and what did you expect?"></textarea>
        <label class="label" for="rp-sev">How bad is it?</label><select id="rp-sev" class="input"><option value="low">Just a heads-up</option><option value="medium" selected>It's slowing me down</option><option value="high">I can't get my work done</option></select>
        <p id="rp-error" class="form-error mt-3 hidden"></p>`)}${modalFooter(`<button type="button" data-close class="btn btn-secondary flex-1">Cancel</button><button type="submit" class="btn btn-primary flex-1">Send report</button>`)}</form>`
    });
    m.$('form').addEventListener('submit', e => {
      e.preventDefault();
      const subject = m.$('#rp-subject').value.trim(), description = m.$('#rp-desc').value.trim();
      if (!subject || !description) return showError(m.$('#rp-error'), 'Fill in the subject and description.');
      withBusy(e.currentTarget.querySelector('[type=submit]'), 'Sending…', async () => {
        try {
          await addDoc(collection(db, 'tenants', ctx.slug, 'feedback'), { subject, description, severity: m.$('#rp-sev').value, page: location.pathname, userAgent: navigator.userAgent.slice(0, 300), userUid: ctx.me.uid, userName: ctx.me.name, createdAt: serverTimestamp() });
          m.close(); toast('Thanks — your report was sent');
        } catch (ex) { showError(m.$('#rp-error'), friendlyError(ex)); }
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// GLOBAL EVENTS
// ═══════════════════════════════════════════════════════════════
async function doSignOut() {
  redirectAfterSignOut = true;
  stopNotifications();
  try { await signOut(auth); }
  catch (e) { redirectAfterSignOut = false; toast(friendlyError(e), 'error'); }
}
document.addEventListener('click', async e => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest('[data-signout]')) { e.preventDefault(); return doSignOut(); }
  const nr = t.closest('[data-notif]');
  if (nr) { const n = notifItems().find(x => x.id === nr.dataset.notif); if (n) markNotifRead(n); if (nr.getAttribute('href') === '#') e.preventDefault(); }
  if (t.closest('[data-notif-readall]')) { markAllNotifsRead(); return; }
  const gt = t.closest('[data-group-toggle]');
  if (gt) {
    const g = gt.closest('.subnav-group'), open = g.classList.toggle('collapsed') === false;
    gt.setAttribute('aria-expanded', String(open));
    const st = navGroupState(); st[gt.dataset.groupToggle] = open; ls('ember_nav_groups', JSON.stringify(st));
    return;
  }
  if (t.closest('[data-sidebar-open]')) { document.body.classList.add('sidebar-open'); return; }
  if (t.closest('[data-sidebar-close]')) { closeSidebar(); return; }
  if (t.closest('[data-retry]')) { renderRoute(); return; }
  if (t.closest('[data-toggle-preview]')) { setViewAsStudent(!viewAsStudent); return; }
  if (t.closest('[data-exit-preview]')) { setViewAsStudent(false); return; }
  if (t.closest('[data-create-school]')) {
    const [, , id] = location.pathname.slice(BASE_PATH.length).split('/');
    const s = await getDoc(doc(db, 'districts', id)).catch(() => null);
    if (s?.exists()) openCreateSchoolModal(id, s.data());
    return;
  }
  const trayBtn = t.closest('[data-tray]');
  if (trayBtn) { e.preventDefault(); return openTray(trayBtn.dataset.tray); }
  if (t.closest('[data-subnav-toggle]')) { const on = document.body.classList.toggle('subnav-collapsed'); ls('ember_subnav_collapsed', on ? '1' : '0'); return; }
  if (t.closest('[data-profile]')) { closeTray(); if (layoutState.ctx) openProfileModal(layoutState.ctx); return; }
  if (t.closest('[data-add-child]')) { closeTray(); if (layoutState.ctx) (await import('./sis.js' + BUILD)).openAddStudentCode(layoutState.ctx); return; }
  if (t.closest('[data-concern]')) { closeTray(); const c = layoutState.ctx; if (c) (await import('./sis.js' + BUILD)).openIncidentModal(c, null, [], { concern: !c.can('safety') }); return; }
  const hp = t.closest('[data-help]');
  if (hp) return openHelp(hp.dataset.help);
  const tp = t.closest('[data-toggle-pass]');
  if (tp) {
    const input = document.getElementById(tp.dataset.togglePass); if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    tp.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    tp.innerHTML = ico(show ? 'eye-off' : 'eye'); refreshIcons();
    return;
  }
  const ga = t.closest('[data-goto-account]');
  if (ga) { e.preventDefault(); return withBusy(ga, 'Loading…', () => goToAccount()); }

  // Client-side navigation for same-app links.
  const a = t.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target === '_blank' || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  if (BASE_PATH && url.pathname !== BASE_PATH && !url.pathname.startsWith(BASE_PATH + '/')) return;
  e.preventDefault();
  if (url.pathname + url.search !== location.pathname + location.search) history.pushState(null, '', url.pathname + url.search);
  renderRoute();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !openModals.length && document.body.classList.contains('sidebar-open')) closeSidebar(); });
// Keyboard shortcuts (see Help → Keyboard shortcuts)
let gPending = 0;
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || openModals.length) return;
  if (e.key === 'Escape' && trayEl) { closeTray(); return; }
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const ctx = layoutState.ctx;
  if (e.key === '?' && (ctx || layoutState.district)) { e.preventDefault(); openTray('help'); return; }
  if (e.key === '/') { const sb = $('#main input[type=search]'); if (sb) { e.preventDefault(); sb.focus(); } return; }
  if (!ctx) return;
  if (e.key === 'g') { gPending = Date.now(); return; }
  if (Date.now() - gPending < 1200) {
    const dest = { d: '', c: '/calendar', i: '/inbox', a: '/courses' }[e.key];
    gPending = 0;
    if (dest !== undefined) { e.preventDefault(); navigate(`/${ctx.slug}${dest}`); }
  }
});
window.addEventListener('popstate', () => renderRoute());

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════
// ── Auto-update: GitHub Pages lets browsers keep old files for ~10 minutes, and a tab can stay open for days.
// We check the live index.html for a newer ?v= and reload on the next page change (or on the banner's button).
let newBuild = null, lastUpdateCheck = 0;
async function checkForUpdate(force = false) {
  if (!BUILD || (!force && Date.now() - lastUpdateCheck < 60000)) return;
  lastUpdateCheck = Date.now();
  try {
    const html = await (await fetch(`${BASE_PATH}/index.html?check=${Date.now()}`, { cache: 'no-store' })).text();
    const m = html.match(/js\/app\.js(\?v=[\w.-]+)/);
    if (m && m[1] !== BUILD && newBuild !== m[1]) { newBuild = m[1]; showUpdateBanner(); }
  } catch (e) { /* offline — try again later */ }
}
function reloadForUpdate() {
  // A one-off query string makes the browser fetch a fresh index.html instead of its cached copy.
  if (ss('ember_reloaded_for') === newBuild) return false; // already tried for this version: don't loop
  ss('ember_reloaded_for', newBuild);
  const u = new URL(location.href); u.searchParams.set('fresh', newBuild.replace('?v=', ''));
  location.replace(u.toString());
  return true;
}
function showUpdateBanner() {
  if ($('#update-banner')) return;
  const el = document.createElement('div');
  el.id = 'update-banner';
  el.className = 'fixed z-[95] bottom-4 left-1/2 -translate-x-1/2 card px-4 py-3 flex items-center gap-3 shadow-2xl border-[#F59E0B]/40';
  el.innerHTML = `${ico('sparkles', 'w-4 h-4 text-[#F59E0B]')}<span class="text-sm text-white">Ember was updated.</span><button class="btn btn-primary btn-sm" data-update-now>Reload</button>`;
  document.body.appendChild(el); refreshIcons();
  el.querySelector('[data-update-now]').addEventListener('click', () => { if (!reloadForUpdate()) location.reload(); });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(true); }); // coming back to the tab: always check
{ const u = new URL(location.href); if (u.searchParams.has('fresh')) { u.searchParams.delete('fresh'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } }

async function renderRoute() {
  if (newBuild && reloadForUpdate()) return; // a new version is live: switch to it as the user navigates
  checkForUpdate();
  if (!authReady) return;
  currentUser = auth.currentUser; // source of truth, even mid sign-in while routing is suppressed
  const t = ++routeToken;
  clearSubs(); closeAllModals(); closeSidebar(); closeTray();
  watchNotifications();
  contentCache.clear();
  layoutState = { ctx: null, district: null, course: null };
  const route = parseRoute();
  try {
    switch (route.type) {
      case 'landing': return viewLanding();
      case 'login': return viewLogin();
      case 'signup': return await viewSignup();
      case 'district': return await viewDistrict(route.segments[0], route.segments.slice(1));
      case 'tenant': return await viewTenant(route.tenant, route.segments);
      default: return viewNotFound();
    }
  } catch (e) {
    if (e?.stale) return;
    console.error('Render failed:', e);
    if (live(t)) viewFatal(e); // a late failure from a page the user already left must not replace the new one
  }
}

if (ls('ember_subnav_collapsed') === '1') document.body.classList.add('subnav-collapsed');
render(loadingScreen());

onAuthStateChanged(auth, async user => {
  const firstLoad = !authReady;
  if ((user?.uid || null) !== (currentUser?.uid || null)) { tenantCache.clear(); stopInbox(); invalidateCourses(); }
  currentUser = user;
  authReady = true;
  if (!user && viewAsStudent) { viewAsStudent = false; ss('ember_view_as_student', '0'); }
  if (suppressAuthRouting) return;
  if (!user && redirectAfterSignOut) {
    redirectAfterSignOut = false;
    signupWizard = null;
    toast('Signed out', 'info');
    return navigate('/login');
  }
  if (user && firstLoad && parseRoute().type === 'landing') {
    try {
      const dest = await resolveDestinationForUser(user);
      if (dest && dest !== '/') return navigate(dest, { replace: true });
    } catch (e) { console.warn('Redirect check failed', e); }
  }
  renderRoute();
});

// ── Shared with ./sis.js (loaded on demand) ─────────────────────
const routeTokenNow = () => routeToken;
// Lazy modules (sis.js, staff.js) read helpers from here instead of importing app.js, so a versioned
// app.js URL never loads a second copy of the app.
const EMBER_API = {
  notify, officeStaffUids, guardianUidsOf, notifItems, notifRow, notifUnread, markNotifRead, markAllNotifsRead, NOTIF_KINDS, hasOffice, schoolMenu, schoolMenuItems, schoolHome, createLogin, friendlyError, getTenant, districtShell, getDistrictSchools,
  db, $, $$, ico, refreshIcons, escapeHtml, plural, displayNameOf, toDate, tsMillis, recency, formatDate, formatDateTime,
  timeAgo, toDateInput, render, setTitle, showError, iconTile, badge, avatar, skeletonRows, emptyState, errorBox, dataTable,
  toast, copyText, withBusy, openModal, modalHeader, modalBody, modalFooter, confirmDialog, buildUrl, navigate, live, unsubs,
  pageHeader, tenantPage, previewToggle, courseCol, cHref, myCourses, loadAllItems, subsCol, hasGrade, itemPoints, typeMeta,
  GRADED_TYPES, courseHex, searchBox, panel, openComposeModal, ls, routeTokenNow, randInt, initials, renderRoute
};
globalThis.__ember = EMBER_API;
export {
  notify, officeStaffUids, guardianUidsOf, notifItems, notifRow, notifUnread, markNotifRead, markAllNotifsRead, NOTIF_KINDS, hasOffice, schoolMenu, schoolMenuItems, schoolHome, createLogin, friendlyError, getTenant, districtShell, getDistrictSchools,
  db, $, $$, ico, refreshIcons, escapeHtml, plural, displayNameOf, toDate, tsMillis, recency, formatDate, formatDateTime,
  timeAgo, toDateInput, render, setTitle, showError, iconTile, badge, avatar, skeletonRows, emptyState, errorBox, dataTable,
  toast, copyText, withBusy, openModal, modalHeader, modalBody, modalFooter, confirmDialog, buildUrl, navigate, live, unsubs,
  pageHeader, tenantPage, previewToggle, courseCol, cHref, myCourses, loadAllItems, subsCol, hasGrade, itemPoints, typeMeta,
  GRADED_TYPES, courseHex, searchBox, panel, openComposeModal, ls, routeTokenNow, randInt, initials, renderRoute
};
