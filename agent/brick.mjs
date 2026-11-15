// Brick Report helpers: caller phone lookup, a tiny JSON session store, and the report text.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const API = 'https://app.trychert.com/api/v1';
const STORE = new URL('./brick-sessions.json', import.meta.url);

export const NO_FILM = 'No film on you yet. FaceTime me and let\'s debug that jumper.';
export const SIGN_OFFS = {
  'The Assassin': "Rest is earned. You haven't earned it yet. ...Okay, maybe a little.",
  'The Splash Chef': "Kitchen's closed. Go get buckets.",
  'The Closer': 'Champions are boring. They do the same thing perfectly forever. Go be boring.',
};

export function chertHeaders(extra = {}) {
  return { Authorization: `Bearer ${process.env.CHERT_API_KEY}`, 'X-Chert-Project-Id': process.env.CHERT_PROJECT_ID, ...extra };
}

/** The caller's phone number for a call id (the participant identity is chert-bridge-<call id>). */
export async function phoneForCall(callId) {
  const res = await fetch(`${API}/calls/${callId}`, { headers: chertHeaders() });
  if (!res.ok) throw new Error(`call lookup failed: HTTP ${res.status}`);
  return (await res.json())?.data?.from?.value ?? null;
}

function load() {
  try { return existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {}; } catch { return {}; }
}
export const lastSession = phone => load()[phone] ?? null;
export function saveSession(phone, session) {
  const all = load();
  all[phone] = { ...session, savedAt: new Date().toISOString() };
  writeFileSync(STORE, JSON.stringify(all, null, 2));
}

/** Remember a phone that has called, so a text (which only carries the last 4 digits) can be matched to it. */
export function rememberPhone(phone) {
  const all = load();
  if (!(phone in all)) { all[phone] = null; writeFileSync(STORE, JSON.stringify(all, null, 2)); }
}
export const phonesEndingIn = last4 => Object.keys(load()).filter(p => p.endsWith(last4));

// Drill videos, rotated one per call. Paste real links here: { name: 'Wall shooting', url: 'https://...' }. Empty list = no drill link in the report.
export const DRILL_LINKS = [
  { name: 'Stationary shooting drill', url: 'https://youtu.be/tbn9CEJMRo0' },
  { name: 'The best D1 shooting workout', url: 'https://youtu.be/m5gWO3flDfs' },
  { name: 'How Luke Kennard shoots', url: 'https://youtu.be/RuozRqJhyoQ' },
  { name: 'Shoot more consistently', url: 'https://youtu.be/HFL1wFGaRj4' },
];

// Copy by score tier (out of 20). i picks a variant so repeat callers don't see the same line.
const TIERS = {
  low: ['"I\'ve missed more than 9,000 shots in my career... and that is why I succeed." Michael Jordan. Run it back.', 'Every shooter you\'ve ever seen bricked a thousand first. Keep going.'],
  improving: ["You're improving fast. Keep stacking reps.", 'That jumper is getting cleaner every call.'],
  solid: ['Solid work. The details are where the buckets are.', 'Good base. Now make it automatic.'],
  perfect: ['Perfect 20 out of 20. Have you considered changing careers?', '20/20. Scouts are going to want your number.'],
};
export function tierLine(s, i = 0) {
  const t = s.after >= 20 ? 'perfect' : s.after <= 9 ? 'low' : s.prevAfter != null && s.after > s.prevAfter ? 'improving' : 'solid';
  return TIERS[t][i % TIERS[t].length];
}

export function formatReport(s) {
  if (!s) return NO_FILM;
  if (s.partial) return 'Call dropped before the wrap-up, so no score yet. FaceTime me again and let\'s finish the run.';
  return [
    '🧱 BRICK REPORT',
    `Coach: ${s.mode}`,
    `Form Score: ${s.before} → ${s.after} /20`,
    ...(s.prevAfter == null ? [] : [`Progress: ${s.after - s.prevAfter >= 0 ? '+' : ''}${s.after - s.prevAfter} since last time (${s.prevAfter} → ${s.after})`]),
    `#1 bug: ${s.bug}`,
    `Drill: ${s.drill}`,
    ...(DRILL_LINKS.length ? [`Watch: ${DRILL_LINKS[(s.drillIdx ?? 0) % DRILL_LINKS.length].name} ${DRILL_LINKS[(s.drillIdx ?? 0) % DRILL_LINKS.length].url}`] : []),
    tierLine(s, s.drillIdx ?? 0),
    SIGN_OFFS[s.mode] ?? SIGN_OFFS['The Splash Chef'],
  ].join('\n');
}
