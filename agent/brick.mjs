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
    SIGN_OFFS[s.mode] ?? SIGN_OFFS['The Splash Chef'],
  ].join('\n');
}
