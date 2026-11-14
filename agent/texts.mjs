// Brick Report texts: reply to "report" iMessages. Run in its own terminal: npm run texts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chertHeaders, formatReport, lastSession, phonesEndingIn } from './brick.mjs';

const API = 'https://app.trychert.com/api/v1';
const REPLIED = new URL('./brick-replied.json', import.meta.url);
const replied = new Set(existsSync(REPLIED) ? JSON.parse(readFileSync(REPLIED, 'utf8')) : []);

// Inbound messages only carry masked_recipient (last 4 digits), so match it to phones that have called.
const last4 = m => String(m.masked_recipient ?? '').replace(/\D/g, '').slice(-4);

async function tick() {
  const res = await fetch(`${API}/shared-messages`, { headers: chertHeaders() });
  if (!res.ok) return console.log(`poll failed: HTTP ${res.status}`);
  const items = (await res.json())?.data?.items ?? [];
  for (const m of items) {
    if (m.direction !== 'inbound' || replied.has(m.id) || typeof m.text !== 'string') continue;
    if (m.text.trim().toLowerCase().replace(/[^a-z]/g, '') !== 'report') continue;
    const matches = phonesEndingIn(last4(m));
    if (matches.length !== 1) { console.log(`report text ${m.id}: ${matches.length} known phones end in ${last4(m)}, not replying`); replied.add(m.id); continue; }
    const phone = matches[0], id = m.id;
    const send = await fetch(`${API}/shared-messages`, {
      method: 'POST',
      headers: chertHeaders({ 'Content-Type': 'application/json', 'Idempotency-Key': `brick-${id}` }),
      body: JSON.stringify({ line_id: process.env.CHERT_LINE_ID, recipient: phone, text: formatReport(lastSession(phone)) }),
    });
    console.log(`report reply for message ${id}: HTTP ${send.status}`);
    if (send.ok) { replied.add(id); writeFileSync(REPLIED, JSON.stringify([...replied])); }
  }
}

console.log('Brick Report texts: watching for "report"…');
for (;;) { try { await tick(); } catch (e) { console.log('poll error:', e.message); } await new Promise(r => setTimeout(r, 5000)); }
