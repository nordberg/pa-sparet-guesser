import { rpc, select, formatDate, esc } from './common.js';

const $ = (id) => document.getElementById(id);
const PW_KEY = 'ps:admin';
let password = null;
let rounds = [];
let guesses = [];
let currentRound = null;

function ssGet() { try { return sessionStorage.getItem(PW_KEY); } catch { return null; } }
function ssSet(v) { try { v ? sessionStorage.setItem(PW_KEY, v) : sessionStorage.removeItem(PW_KEY); } catch { /* ignore */ } }

async function login(pw) {
  const ok = await rpc('admin_ok', { p_password: pw });
  if (!ok) throw new Error('Fel lösenord. Biljettkontroll misslyckad.');
  password = pw;
  ssSet(pw);
  $('login-card').hidden = true;
  $('admin').hidden = false;
  await load();
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

async function load() {
  [currentRound, rounds, guesses] = await Promise.all([
    rpc('current_round_date'),
    select('rounds', 'select=*'),
    rpc('admin_list_guesses', { p_password: password }),
  ]);
  // Offer: current Friday, the previous few Fridays, and any date with data.
  const dates = new Set([currentRound]);
  for (let i = 1; i <= 4; i++) dates.add(addDays(currentRound, -7 * i));
  rounds.forEach((r) => dates.add(r.air_date));
  guesses.forEach((g) => dates.add(g.air_date));
  const sel = $('round-select');
  const prevValue = sel.value;
  // Default: the most recent Friday that has started airing (or tonight's).
  const now = new Date();
  const defaultDate = [...dates].sort().reverse().find((d) => new Date(`${d}T00:00:00Z`) <= now) || currentRound;
  sel.innerHTML = [...dates].sort().reverse().map((d) => {
    const r = rounds.find((x) => x.air_date === d);
    const done = r && r.answer1 && r.answer2 && r.answer3 ? ' ✅' : '';
    return `<option value="${d}">${esc(formatDate(d, { day: 'numeric', month: 'short', year: 'numeric' }))}${done}</option>`;
  }).join('');
  sel.value = prevValue && dates.has(prevValue) ? prevValue : defaultDate;
  fillAnswers();
  renderGuesses();
}

function fillAnswers() {
  const f = $('answers-form');
  const r = rounds.find((x) => x.air_date === $('round-select').value) || {};
  f.elements.a1.value = r.answer1 || '';
  f.elements.a2.value = r.answer2 || '';
  f.elements.a3.value = r.answer3 || '';
}

function renderGuesses() {
  if (!guesses.length) {
    $('all-guesses').innerHTML = '<span class="muted">Inga gissningar än.</span>';
    return;
  }
  $('all-guesses').innerHTML = `<table class="guesses">
    <thead><tr><th>Fredag</th><th>Namn</th><th>1</th><th>2</th><th>3</th><th></th></tr></thead>
    <tbody>${guesses.map((g) => `<tr>
      <td>${esc(formatDate(g.air_date, { day: 'numeric', month: 'short' }))}</td>
      <td><b>${esc(g.player)}</b></td>
      <td>${esc(g.city1)}</td><td>${esc(g.city2)}</td><td>${esc(g.city3)}</td>
      <td><button class="link danger" data-del="${g.id}" title="Ta bort">✕</button></td>
    </tr>`).join('')}</tbody></table>`;
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-msg').className = 'msg';
  $('login-msg').textContent = 'Kontrollerar…';
  try {
    await login($('password').value);
  } catch (err) {
    $('login-msg').className = 'msg error';
    $('login-msg').textContent = err.message;
  }
});

$('round-select').addEventListener('change', fillAnswers);

$('answers-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const m = $('answers-msg');
  m.className = 'msg';
  m.textContent = 'Sparar…';
  try {
    await rpc('admin_set_answers', {
      p_password: password,
      p_air_date: $('round-select').value,
      p_a1: f.a1.value, p_a2: f.a2.value, p_a3: f.a3.value,
    });
    await load();
    m.className = 'msg ok';
    m.textContent = 'Facit sparat! 🎉';
  } catch (err) {
    m.className = 'msg error';
    m.textContent = err.message;
  }
});

$('all-guesses').addEventListener('click', async (e) => {
  const id = e.target.dataset?.del;
  if (!id) return;
  const g = guesses.find((x) => String(x.id) === id);
  if (!confirm(`Ta bort ${g?.player}s gissning?`)) return;
  try {
    await rpc('admin_delete_guess', { p_password: password, p_id: Number(id) });
    await load();
  } catch (err) {
    alert(err.message);
  }
});

$('logout').addEventListener('click', () => {
  ssSet(null);
  location.reload();
});

const saved = ssGet();
if (saved) login(saved).catch(() => ssSet(null));
