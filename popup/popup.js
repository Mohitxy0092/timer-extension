import { createDial } from './dial.js';

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const send = (msg) => browser.runtime.sendMessage(msg);
const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
const setHidden = (el, v) => { if (el.hidden !== v) el.hidden = v; };
const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const human = (ms) => {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h && h + 'h', m && m + 'm', (sec || !(h || m)) && sec + 's'].filter(Boolean).join(' ');
};

let cd = { status: 'idle' };
let sw = { running: false, accumulated: 0, startedAt: 0 };
let tab = 'countdown';

/* ---------- dial (WebGL, with a flat fallback if WebGL is unavailable) ---------- */
const dial = createDial($('#gl'));
if (!dial) { $('#gl').hidden = true; $('#flat').hidden = false; }
function paint(v) {
  if (dial) return dial.set(v);
  setText($('#flat-time'), v.text);
  setText($('#flat-sub'), v.sub);
  $('#flat-bar').style.width = v.frac * 100 + '%';
  $('#flat').classList.toggle('alert', v.alert);
}

/* ---------- tabs ---------- */
function showTab(name) {
  tab = name;
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== name; });
  $('#stage').hidden = name === 'history';
  render();
  if (dial) dial.invalidate();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- countdown ---------- */
const inH = $('#in-h'), inM = $('#in-m'), inS = $('#in-s');
const MAX_MS = (99 * 3600 + 59 * 60 + 59) * 1000;
const readMs = () => Math.min(MAX_MS, Math.max(0, ((+inH.value || 0) * 3600 + (+inM.value || 0) * 60 + (+inS.value || 0)) * 1000));
const remaining = () => (cd.status === 'running' ? Math.max(0, cd.endTime - Date.now()) : cd.status === 'paused' ? cd.remaining : 0);

document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  const sec = +c.dataset.sec;
  inH.value = Math.floor(sec / 3600);
  inM.value = Math.floor((sec % 3600) / 60);
  inS.value = sec % 60;
  $('#cd-hint').textContent = '';
  render();
}));
// Time boxes: digits only, never empty (clearing a box shows 0), arrow keys step the value.
document.querySelectorAll('#cd-setup .hms input').forEach((i) => {
  const set = (v) => { i.value = v; render(); };
  i.addEventListener('input', () => {
    const emptied = i.value === '';
    const v = i.value.replace(/\D/g, '').slice(0, i.maxLength);
    i.value = v === '' ? '0' : String(+v);
    if (emptied) i.select(); // typing next replaces the 0
    render();
  });
  i.addEventListener('focus', () => setTimeout(() => i.select()));
  i.addEventListener('blur', () => { if (i.value === '') set('0'); });
  i.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const max = 10 ** i.maxLength - 1;
    set(String(Math.max(0, Math.min(max, (+i.value || 0) + (e.key === 'ArrowUp' ? 1 : -1)))));
  });
});
document.querySelectorAll('#cd-setup input').forEach((i) =>
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#cd-main').click(); }));

$('#cd-main').addEventListener('click', () => {
  switch (cd.status) {
    case 'idle': {
      const ms = readMs();
      if (ms < 1000) { $('#cd-hint').textContent = 'Enter a time longer than zero.'; return; }
      $('#cd-hint').textContent = '';
      send({ type: 'start', ms, label: $('#cd-label').value.trim() });
      break;
    }
    case 'running': send({ type: 'pause' }); break;
    case 'paused': send({ type: 'resume' }); break;
    case 'ringing': send({ type: 'stop-ring' }); break;
  }
});
$('#cd-reset').addEventListener('click', () => send({ type: 'reset' }));
$('#test-sound').addEventListener('click', () => send({ type: 'test-sound' }));

function renderCountdown() {
  const s = cd.status, active = s !== 'idle';
  setHidden($('#cd-setup'), active);
  setHidden($('#cd-info'), !active);
  setHidden($('#cd-reset'), !active || s === 'ringing');
  setText($('#cd-main'), { idle: 'Start', running: 'Pause', paused: 'Resume', ringing: 'Silence bell' }[s] || 'Start');
  $('#cd-main').classList.toggle('alert', s === 'ringing');
  if (!active) return;
  setText($('#cd-status'), { running: 'Running', paused: 'Paused', ringing: "Time's up" }[s] || '');
  setText($('#cd-end'), s === 'running'
    ? 'Rings at ' + new Date(cd.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : s === 'paused' ? human(remaining()) + ' left' : 'Press Silence bell to stop the chime');
}

/* ---------- stopwatch ---------- */
const swElapsed = () => sw.accumulated + (sw.running ? Date.now() - sw.startedAt : 0);
const saveSw = (next) => { sw = next; return browser.storage.local.set({ stopwatch: sw }); };

$('#sw-main').addEventListener('click', () => saveSw(sw.running
  ? { running: false, accumulated: swElapsed(), startedAt: 0 }
  : { running: true, accumulated: sw.accumulated, startedAt: Date.now() }));

$('#sw-reset').addEventListener('click', async () => {
  const el = swElapsed();
  if (el >= 1000) await send({ type: 'history-add', entry: { type: 'stopwatch', duration: el, elapsed: el, completed: true } });
  await saveSw({ running: false, accumulated: 0, startedAt: 0 });
});

function renderStopwatch() {
  const el = swElapsed();
  setText($('#sw-main'), sw.running ? 'Pause' : sw.accumulated > 0 ? 'Resume' : 'Start');
  const r = $('#sw-reset');
  if (r.disabled !== (el === 0)) r.disabled = el === 0;
}

/* ---------- dial content for the active tab ---------- */
function renderDial() {
  if (tab === 'history') return;
  if (tab === 'stopwatch') {
    const el = swElapsed();
    return paint({ text: clock(el), sub: sw.running ? 'running' : el ? 'paused' : 'ready', frac: (el % 60000) / 60000, alert: false });
  }
  const s = cd.status;
  if (s === 'idle') {
    const ms = readMs();
    return paint({ text: clock(ms), sub: ms ? 'ready' : 'set a time', frac: ms ? 1 : 0, alert: false });
  }
  const rem = remaining();
  paint({
    text: clock(Math.ceil(rem / 1000) * 1000),
    sub: s === 'ringing' ? "Time's up" : s === 'paused' ? 'paused' : cd.label || 'of ' + human(cd.total),
    frac: s === 'ringing' ? 1 : cd.total ? rem / cd.total : 0,
    alert: s === 'ringing'
  });
}

/* ---------- history ---------- */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function renderHistory(list) {
  const ul = $('#hist-list');
  ul.textContent = '';
  $('#hist-empty').hidden = list.length > 0;
  $('#hist-clear').hidden = list.length === 0;
  for (const e of list) {
    const li = el('li', e.type === 'countdown' && e.completed ? 'done' : '');
    const row = el('div', 'row');
    row.append(el('b', '', e.label || (e.type === 'countdown' ? 'Countdown' : 'Stopwatch')), el('span', '', clock(e.elapsed)));
    const status = e.type === 'stopwatch' ? 'Stopwatch' : e.completed ? 'Completed' : `Stopped early (of ${human(e.duration)})`;
    const when = new Date(e.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    li.append(row, el('div', 'meta', `${status}, ${when}`));
    ul.append(li);
  }
}

let armed = null;
$('#hist-clear').addEventListener('click', (ev) => {
  const b = ev.currentTarget;
  if (!armed) {
    b.textContent = 'Click again to clear';
    armed = setTimeout(() => { armed = null; b.textContent = 'Clear history'; }, 3000);
    return;
  }
  clearTimeout(armed);
  armed = null;
  b.textContent = 'Clear history';
  browser.storage.local.set({ history: [] });
});

/* ---------- colours ---------- */
const HOUSES = {
  scarlet: { glow: '#ffcf5a', metal: '#d8b45a', body: '#2a1d36', face: '#0b0916' },
  emerald: { glow: '#b8f3dc', metal: '#c3cdd3', body: '#13281f', face: '#07120e' },
  sapphire: { glow: '#a9d0ff', metal: '#b98a52', body: '#16213d', face: '#080c1a' },
  amber: { glow: '#ffe27a', metal: '#8d8696', body: '#241f1a', face: '#0a0907' }
};
function setHouse(name, save = true) {
  if (!HOUSES[name]) name = 'scarlet';
  document.body.dataset.house = name;
  document.querySelectorAll('.gem').forEach((g) => g.setAttribute('aria-checked', g.dataset.house === name));
  if (dial) dial.setTheme(HOUSES[name]);
  if (save) browser.storage.local.set({ house: name });
}
document.querySelectorAll('.gem').forEach((g) => g.addEventListener('click', () => setHouse(g.dataset.house)));

/* ---------- boot ---------- */
function render() { renderCountdown(); renderStopwatch(); renderDial(); }

browser.storage.onChanged.addListener((ch) => {
  if (ch.countdown) cd = ch.countdown.newValue || { status: 'idle' };
  if (ch.stopwatch) sw = ch.stopwatch.newValue || sw;
  if (ch.history) renderHistory(ch.history.newValue || []);
  render();
});

if (dial && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.body.addEventListener('pointermove', (e) => dial.tilt(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5));
  document.body.addEventListener('pointerleave', () => dial.tilt(0, 0));
}

(async () => {
  const d = await browser.storage.local.get(['countdown', 'stopwatch', 'history', 'house']);
  cd = d.countdown || cd;
  sw = d.stopwatch || sw;
  renderHistory(d.history || []);
  setHouse(d.house || 'scarlet', false);
  showTab(cd.status === 'idle' && sw.running ? 'stopwatch' : 'countdown');
  setInterval(render, 200);
})();
