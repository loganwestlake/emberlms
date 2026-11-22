// "How Ember works": the role-by-role flow — who signs in where, what they do every day, and who they hand
// off to. Opened from Help → How Ember works.
const { ico, escapeHtml, openModal, modalHeader, modalBody, refreshIcons } = globalThis.__ember;

export const ROLE_FLOW = [
  { id: 'district', icon: 'landmark', tone: 'violet', who: 'District administrators', signin: 'District tab · username + password (no school to pick)', lands: 'District dashboard',
    does: ['Create every account for every school (People) — each person is tied to one school', 'Watch attendance, students and safety across all schools', 'Set district-wide Ember Pass rules', 'Open any school as its administrator'],
    hands: 'Schools run day to day; the district sets policy and creates accounts.' },
  { id: 'admin', icon: 'shield-check', tone: 'red', who: 'School administrators', signin: 'Staff tab · school + username', lands: 'Admin → Today',
    does: ['Create staff, parent and student accounts for their school (no join code)', 'Review discipline referrals and decide consequences', 'Set school rules (passes, schedule, report cards)', 'See every workspace — food service is view-only'],
    hands: 'Referrals come from teachers; families see the reviewed report.' },
  { id: 'teacher', icon: 'presentation', tone: 'green', who: 'Teachers & substitutes', signin: 'Staff tab · school + username', lands: 'Teacher dashboard',
    does: ['Take attendance, enter grades, view rosters', 'Approve and send hall passes; run a classroom kiosk', 'Write discipline referrals and staff comments'],
    hands: 'Referrals → administrators. Students to the nurse → Health Office.' },
  { id: 'counselor', icon: 'heart-handshake', tone: 'blue', who: 'Counselors & SPED staff', signin: 'Staff tab · school + username', lands: 'Workspace → Counseling & SPED',
    does: ['Caseload of IEP / 504 / ELL students', 'Confidential session log with check-in / check-out times', 'Graduation credit check and IEP / 504 meetings'],
    hands: 'Teachers and the nurse refer students; parents are contacted from the log.' },
  { id: 'nurse', icon: 'briefcase-medical', tone: 'red', who: 'Nurses', signin: 'Staff tab · school + username', lands: 'Workspace → Health Office',
    does: ['Sign students in → mark them seen → time out with treatment and disposition', 'Health conditions, IHP forms, injuries, medications given', 'Numbered supply inventory'],
    hands: 'Students sent home → parents are notified; the Front Office releases them.' },
  { id: 'office', icon: 'building-2', tone: 'teal', who: 'Office staff & registrars', signin: 'Staff tab · school + username', lands: 'Workspace → Front Office',
    does: ['Sign late students in (tardy + late pass to the class)', 'Early dismissal to authorized pickup people only', 'Enrollment, today’s absences, parent contacts'],
    hands: 'Late passes go to the teacher; dismissals notify parents.' },
  { id: 'support', icon: 'bus', tone: 'amber', who: 'Support staff', signin: 'Staff tab · school + username', lands: 'Their own workspace only',
    does: ['Food service: serve meals and take lunch deposits (the only role that charges students)', 'Transportation: buses, riders, bus log', 'Library & devices: numbered books / Chromebooks, check out and in', 'Athletics: rosters, eligibility, equipment'],
    hands: 'Each person sees only the area their title (or admin) assigns.' },
  { id: 'it', icon: 'server-cog', tone: 'violet', who: 'IT & data staff', signin: 'Staff tab · school + username', lands: 'Workspace → IT & Data',
    does: ['Turn staff access and workspaces on or off (every change logged)', 'Device and asset inventory', 'State-reporting exports'],
    hands: 'Assigns who sees which workspace.' },
  { id: 'student', icon: 'graduation-cap', tone: 'amber', who: 'Students', signin: 'Student tab · school + username', lands: 'Student dashboard',
    does: ['Classes, grades, attendance, schedule', 'Ember Pass (and the kiosk with their student ID)', 'My Info: student ID, discipline report, health'], hands: '' },
  { id: 'parent', icon: 'users', tone: 'violet', who: 'Parents & guardians', signin: 'Parent tab · school + username', lands: 'Family Access',
    does: ['Grades, attendance, schedule, busing', 'Detailed discipline reports, health info', 'Notifications when their child is signed out or sent home'], hands: '' },
];

export function openFlowGuide(highlight = null) {
  const m = openModal({ size: 'lg', align: 'top', html: modalHeader({ title: 'How Ember works', subtitle: 'Who does what, where they sign in, and how work moves between people.', icon: 'workflow' }) + modalBody(`
    <ol class="flow-steps mb-6">${['District creates accounts for each school', 'Everyone signs in with a username', 'Each role lands on its own dashboard', 'Work hands off: teacher → office / nurse / admin → family'].map((s, i) => `<li><span>${i + 1}</span>${escapeHtml(s)}</li>`).join('')}</ol>
    <div class="space-y-3">${ROLE_FLOW.map(r => `<details class="card ${r.id === highlight ? 'ring-1 ring-[#F59E0B]/60' : ''}" ${r.id === highlight ? 'open' : ''}><summary class="flex items-center gap-3 p-4 cursor-pointer"><div class="tile tile-${r.tone}">${ico(r.icon, 'w-4 h-4')}</div><div class="flex-1 min-w-0"><div class="text-white">${escapeHtml(r.who)}</div><div class="text-[11px] text-gray-500">${escapeHtml(r.signin)} → ${escapeHtml(r.lands)}</div></div>${ico('chevron-down', 'w-4 h-4 text-gray-500')}</summary>
      <div class="px-4 pb-4 pl-[3.75rem]"><ul class="space-y-1.5">${r.does.map(d => `<li class="text-sm text-gray-300 flex gap-2">${ico('check', 'w-4 h-4 text-[#6ee06e] shrink-0 mt-0.5')}<span>${escapeHtml(d)}</span></li>`).join('')}</ul>${r.hands ? `<p class="text-xs text-gray-500 mt-3">${ico('arrow-right-left', 'w-3.5 h-3.5 inline -mt-0.5')} ${escapeHtml(r.hands)}</p>` : ''}</div></details>`).join('')}</div>`) });
  refreshIcons();
  return m;
}
