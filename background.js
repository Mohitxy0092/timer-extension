// Owns the countdown, the alarm sound and history writes, so everything keeps
// working after the popup closes.
const MAX_HISTORY = 200;
const RING_SECONDS = 60;
let ctx = null, ringTimer = null, ringStopTimer = null;

const getState = async () => (await browser.storage.local.get('countdown')).countdown || { status: 'idle' };
const setState = (countdown) => browser.storage.local.set({ countdown });

function human(ms) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h && h + 'h', m && m + 'm', (sec || !(h || m)) && sec + 's'].filter(Boolean).join(' ');
}

async function addHistory(entry) {
  const { history = [] } = await browser.storage.local.get('history');
  history.unshift({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), at: Date.now(), ...entry });
  await browser.storage.local.set({ history: history.slice(0, MAX_HISTORY) });
}

/* ---------- countdown ---------- */
async function start({ ms, label }) {
  await stopRing();
  const endTime = Date.now() + ms;
  await setState({ status: 'running', total: ms, endTime, label: label || '' });
  browser.alarms.create('countdown', { when: endTime });
}

async function pause() {
  const s = await getState();
  if (s.status !== 'running') return;
  browser.alarms.clear('countdown');
  await setState({ ...s, status: 'paused', remaining: Math.max(0, s.endTime - Date.now()), endTime: null });
}

async function resume() {
  const s = await getState();
  if (s.status !== 'paused') return;
  const endTime = Date.now() + s.remaining;
  await setState({ ...s, status: 'running', endTime, remaining: null });
  browser.alarms.create('countdown', { when: endTime });
}

async function reset() {
  const s = await getState();
  browser.alarms.clear('countdown');
  await stopRing();
  if (s.status === 'running' || s.status === 'paused') {
    const left = s.status === 'running' ? Math.max(0, s.endTime - Date.now()) : s.remaining;
    const elapsed = s.total - left;
    if (elapsed >= 1000) {
      await addHistory({ type: 'countdown', label: s.label, duration: s.total, elapsed, completed: false });
    }
  }
  await setState({ status: 'idle' });
}

async function finish() {
  const s = await getState();
  if (s.status !== 'running') return;
  await addHistory({ type: 'countdown', label: s.label, duration: s.total, elapsed: s.total, completed: true });
  await setState({ ...s, status: 'ringing' });
  try { startRing(); } catch (e) { console.error('alarm sound failed', e); }
  const note = {
    type: 'basic',
    title: 'The hour has struck!',
    message: (s.label ? s.label + ' · ' : '') + human(s.total) + ' countdown finished. Click to stop the alarm.'
  };
  try {
    await browser.notifications.create('countdown-done', { ...note, iconUrl: browser.runtime.getURL('icons/icon.svg') });
  } catch (e) {
    try { await browser.notifications.create('countdown-done', note); } catch (_) { /* notification is optional */ }
  }
}

/* ---------- alarm sound (generated with Web Audio, no audio file needed) ---------- */
// A soft handbell: each note is a fundamental plus a bright overtone with a long decay.
function bell(c, t, freq) {
  [[freq, 0.4, 1.6], [freq * 2.76, 0.12, 0.7]].forEach(([f, vol, len]) => {
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + len + 0.05);
  });
}

function beeps(c) {
  const t = c.currentTime + 0.05;
  [659.25, 783.99, 987.77, 1318.51].forEach((f, i) => bell(c, t + i * 0.22, f));
}

function startRing() {
  if (ctx) return;
  ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  beeps(ctx);
  ringTimer = setInterval(() => ctx && beeps(ctx), 2000);
  ringStopTimer = setTimeout(stopRing, RING_SECONDS * 1000);
}

async function stopRing() {
  clearInterval(ringTimer);
  clearTimeout(ringStopTimer);
  ringTimer = ringStopTimer = null;
  if (ctx) { ctx.close(); ctx = null; }
  browser.notifications.clear('countdown-done');
  const s = await getState();
  if (s.status === 'ringing') await setState({ status: 'idle' });
}

function testSound() {
  if (ctx) return;
  const c = new AudioContext();
  beeps(c);
  setTimeout(() => c.close(), 2500);
}

/* ---------- wiring ---------- */
browser.alarms.onAlarm.addListener((a) => { if (a.name === 'countdown') finish(); });
browser.notifications.onClicked.addListener(() => stopRing());

browser.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'start': return start(msg);
    case 'pause': return pause();
    case 'resume': return resume();
    case 'reset': return reset();
    case 'stop-ring': return stopRing();
    case 'test-sound': return testSound();
    case 'history-add': return addHistory(msg.entry);
  }
});

// Runs on browser start / extension reload: re-arm a running countdown, or ring
// right away if it ended while the browser was closed.
(async function init() {
  const s = await getState();
  if (s.status === 'running') {
    if (s.endTime <= Date.now()) finish();
    else browser.alarms.create('countdown', { when: s.endTime });
  } else if (s.status === 'ringing') {
    await setState({ status: 'idle' });
  }
})();
