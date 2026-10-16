import { rpc, select, deadlineFor, formatDate, formatCountdown, score, esc, registerSW } from './common.js';

registerSW();

const $ = (id) => document.getElementById(id);
const form = $('guess-form');
const msg = $('form-msg');

let state = { currentRound: null, rounds: [], guesses: [] };
let timer;

const LS_NAME = 'ps:name';
const ownKey = (date, name) => `ps:guess:${date}:${name.trim().toLowerCase()}`;

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

async function load() {
  try {
    const [currentRound, rounds, guesses] = await Promise.all([
      rpc('current_round_date'),
      select('rounds', 'select=*'),
      rpc('list_guesses'),
    ]);
    state = { currentRound, rounds, guesses };
    render();
  } catch (e) {
    $('this-week').innerHTML = `<span class="error">Kunde inte ladda: ${esc(e.message)}</span>`;
    $('leaderboard').innerHTML = '';
    $('history').innerHTML = '';
  }
}

function render() {
  renderHeader();
  renderThisWeek();
  renderLeaderboard();
  renderHistory();
  renderPlayersList();
  prefillOwn();
}

function renderHeader() {
  const d = state.currentRound;
  $('round-date').textContent = `${formatDate(d)} kl. 20:00`;
  const deadline = deadlineFor(d);
  clearInterval(timer);
  const tick = () => {
    const left = deadline - Date.now();
    $('countdown').textContent = formatCountdown(left);
    if (left <= 0) { clearInterval(timer); setTimeout(load, 2000); }
  };
  tick();
  timer = setInterval(tick, 1000);
}

function renderThisWeek() {
  const mine = (lsGet(LS_NAME) || '').trim().toLowerCase();
  const list = state.guesses.filter((g) => g.air_date === state.currentRound);
  if (!list.length) {
    $('this-week').innerHTML = '<span class="muted">Ingen har stämplat sin biljett än. Bli först!</span>';
    return;
  }
  $('this-week').innerHTML = list.map((g) => {
    const isMe = g.player.trim().toLowerCase() === mine;
    const own = isMe ? JSON.parse(lsGet(ownKey(g.air_date, g.player)) || 'null') : null;
    const detail = own ? `<small>${esc(own.city1)} · ${esc(own.city2)} · ${esc(own.city3)}</small>` : '<small>förseglad ✉️</small>';
    return `<span class="chip${isMe ? ' me' : ''}"><b>${esc(g.player)}</b>${detail}</span>`;
  }).join('');
}

function answersFor(date) {
  const r = state.rounds.find((x) => x.air_date === date);
  if (!r || !(r.answer1 || r.answer2 || r.answer3)) return null;
  return [r.answer1, r.answer2, r.answer3];
}

function renderLeaderboard() {
  const table = new Map();
  for (const g of state.guesses) {
    if (g.sealed) continue;
    const ans = answersFor(g.air_date);
    if (!ans) continue;
    const key = g.player.trim().toLowerCase();
    const row = table.get(key) || { name: g.player, points: 0, rounds: 0, best: 0, cities: 0 };
    const s = score(g, ans);
    row.points += s.total;
    row.rounds += 1;
    row.best = Math.max(row.best, s.total);
    row.cities += s.perCity.filter(Boolean).length;
    table.set(key, row);
  }
  const rows = [...table.values()].sort((a, b) => b.points - a.points || b.cities - a.cities || a.name.localeCompare(b.name, 'sv'));
  if (!rows.length) {
    $('leaderboard').innerHTML = '<span class="muted">Inga poäng än. Vänta tills första facit är inne.</span>';
    return;
  }
  const medal = ['🥇', '🥈', '🥉'];
  let rank = 0, prev = null;
  $('leaderboard').innerHTML = `<table class="board">
    <thead><tr><th></th><th>Namn</th><th class="num">Poäng</th><th class="num">Rätt städer</th><th class="num">Omg.</th></tr></thead>
    <tbody>${rows.map((r, i) => {
      if (r.points !== prev) { rank = i; prev = r.points; }
      return `<tr><td>${medal[rank] || rank + 1}</td><td>${esc(r.name)}</td><td class="num"><b>${r.points}</b></td><td class="num">${r.cities}</td><td class="num">${r.rounds}</td></tr>`;
    }).join('')}</tbody></table>`;
}

function renderHistory() {
  const dates = new Set([
    ...state.guesses.filter((g) => !g.sealed).map((g) => g.air_date),
    ...state.rounds.filter((r) => r.air_date < state.currentRound).map((r) => r.air_date),
  ]);
  const sorted = [...dates].sort().reverse();
  if (!sorted.length) {
    $('history').innerHTML = '<div class="card"><span class="muted">Inga avgångar än. Det här blir historiskt.</span></div>';
    return;
  }
  $('history').innerHTML = sorted.map((date) => {
    const ans = answersFor(date);
    const gs = state.guesses.filter((g) => g.air_date === date && !g.sealed);
    const scored = gs.map((g) => ({ g, s: ans ? score(g, ans) : null }))
      .sort((a, b) => (b.s?.total ?? 0) - (a.s?.total ?? 0));
    const top = scored.length && scored[0].s?.total ? scored[0].s.total : 0;
    const answerHtml = ans
      ? `<ol class="answers">${ans.map((a) => `<li>${esc(a || '?')}</li>`).join('')}</ol>`
      : '<p class="muted">Facit är inte inlagt än.</p>';
    const rows = scored.map(({ g, s }) => {
      const cls = (i) => (!s ? '' : s.perCity[i] === 2 ? 'hit' : s.perCity[i] === 1 ? 'near' : 'miss');
      const crown = s && top > 0 && s.total === top ? ' 👑' : '';
      return `<tr>
        <td><b>${esc(g.player)}</b>${crown}</td>
        <td class="${cls(0)}">${esc(g.city1)}</td>
        <td class="${cls(1)}">${esc(g.city2)}</td>
        <td class="${cls(2)}">${esc(g.city3)}</td>
        <td class="num">${s ? `<b>${s.total}</b>` : '–'}</td>
      </tr>`;
    }).join('');
    return `<article class="card round">
      <h3>${esc(formatDate(date))}</h3>
      ${answerHtml}
      ${gs.length ? `<div class="scroll"><table class="guesses">
        <thead><tr><th>Namn</th><th>1</th><th>2</th><th>3</th><th class="num">P</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<p class="muted">Ingen gissade den här veckan.</p>'}
    </article>`;
  }).join('');
}

function renderPlayersList() {
  const names = [...new Map(state.guesses.map((g) => [g.player.trim().toLowerCase(), g.player])).values()];
  $('players').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
}

function prefillOwn() {
  const nameInput = form.elements.player;
  if (!nameInput.value) nameInput.value = lsGet(LS_NAME) || '';
  fillCitiesFor(nameInput.value);
}

function fillCitiesFor(name) {
  if (!name || !state.currentRound) return;
  const own = JSON.parse(lsGet(ownKey(state.currentRound, name)) || 'null');
  if (own) {
    form.elements.city1.value = own.city1;
    form.elements.city2.value = own.city2;
    form.elements.city3.value = own.city3;
    $('submit-btn').textContent = 'Uppdatera biljetten';
  } else {
    $('submit-btn').textContent = 'Stämpla biljetten';
  }
}

form.elements.player.addEventListener('change', (e) => fillCitiesFor(e.target.value));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const btn = $('submit-btn');
  btn.disabled = true;
  msg.className = 'msg';
  msg.textContent = 'Stämplar…';
  try {
    const date = await rpc('submit_guess', {
      p_player: f.player.trim(),
      p_city1: f.city1.trim(),
      p_city2: f.city2.trim(),
      p_city3: f.city3.trim(),
    });
    lsSet(LS_NAME, f.player.trim());
    lsSet(ownKey(date, f.player), JSON.stringify({ city1: f.city1.trim(), city2: f.city2.trim(), city3: f.city3.trim() }));
    msg.className = 'msg ok';
    msg.textContent = `Biljetten är stämplad för ${formatDate(date)}. Lycka till! 🎫`;
    await load();
  } catch (err) {
    msg.className = 'msg error';
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

load();
