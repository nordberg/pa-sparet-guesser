// Shared bits: Supabase RPC, dates, scoring.

export const SUPABASE_URL = 'https://fwrccffsyynbahglidfq.supabase.co';
// Publishable (public) key — safe to ship; all writes go through RPC functions.
export const SUPABASE_KEY = 'sb_publishable_4bPBboWjvsrOa23Db1xT2A_9U8CrTBC';

const headers = {
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

export async function rpc(fn, args = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || `Något gick fel (${res.status})`);
  return data;
}

export async function select(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Något gick fel (${res.status})`);
  return data;
}

// ---------- Dates (everything is Swedish time) ----------

const TZ = 'Europe/Stockholm';

function stockholmOffsetMinutes(date) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName').value; // "GMT+02:00"
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** Friday 20:00 Stockholm time for an ISO date string (YYYY-MM-DD) → Date */
export function deadlineFor(isoDate) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, 20, 0));
  const off = stockholmOffsetMinutes(guess);
  return new Date(guess.getTime() - off * 60000);
}

export function formatDate(isoDate, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('sv-SE', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, mo - 1, d)));
}

export function formatCountdown(ms) {
  if (ms <= 0) return 'Nu kör vi!';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} d ${h} h ${m} min`;
  if (h > 0) return `${h} h ${m} min ${sec} s`;
  return `${m} min ${sec} s`;
}

// ---------- Scoring ----------

const ALIASES = {
  gothenburg: 'goteborg', gbg: 'goteborg',
  copenhagen: 'kopenhamn', kobenhavn: 'kopenhamn',
  rome: 'rom', roma: 'rom',
  munich: 'munchen', vienna: 'wien', prague: 'prag', praha: 'prag',
  athens: 'aten', lisbon: 'lissabon', lisboa: 'lissabon',
  brussels: 'bryssel', bruxelles: 'bryssel', brussel: 'bryssel',
  warsaw: 'warszawa', moscow: 'moskva', venice: 'venedig', venezia: 'venedig',
  florence: 'florens', firenze: 'florens', naples: 'neapel', napoli: 'neapel',
  milan: 'milano', geneva: 'geneve', cologne: 'koln', nuremberg: 'nurnberg',
  krakow: 'krakow', cracow: 'krakow', beijing: 'peking',
  stpetersburg: 'sanktpetersburg', petersburg: 'sanktpetersburg',
  newyorkcity: 'newyork', nyc: 'newyork', helsingfors: 'helsinki',
  abo: 'turku', reval: 'tallinn', danzig: 'gdansk', mexico: 'mexikocity',
  mexicocity: 'mexikocity', capetown: 'kapstaden', lyon: 'lyon',
  seville: 'sevilla', antwerp: 'antwerpen', thehague: 'haag', denhaag: 'haag',
};

export function normalizeCity(s) {
  const n = (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
  return ALIASES[n] || n;
}

/**
 * 1 p per guessed city that is among the answers — order doesn't matter.
 * Returns { total, perCity: [0|1, ...] }
 */
export function score(guess, answers) {
  const remaining = answers.map(normalizeCity).filter(Boolean);
  const perCity = [guess.city1, guess.city2, guess.city3].map((c) => {
    const i = remaining.indexOf(normalizeCity(c));
    if (!c || i === -1) return 0;
    remaining.splice(i, 1); // the same answer can't be matched twice
    return 1;
  });
  return { total: perCity.reduce((a, b) => a + b, 0), perCity };
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
