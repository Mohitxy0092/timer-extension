import * as THREE from '../lib/three.module.min.js';

const W = 288, H = 190, SEG = 180;
const ALERT = '#ff5a4d';
const SERIF = '"Palatino Linotype","Book Antiqua",Palatino,"P052","URW Palladio L","Noto Serif",serif';

// Returns null if WebGL is unavailable so the popup can fall back to a flat display.
export function createDial(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

  let theme = { glow: '#ffcf5a', metal: '#d8b45a', body: '#2a1d36', face: '#0b0916' };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 50);
  camera.position.set(0, 0, 7.2);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 4, 6);
  scene.add(sun);
  const rim = new THREE.PointLight(theme.glow, 30, 12);
  rim.position.set(-3.5, -2.5, 3);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.25, ...o });
  const metal = std(theme.metal, { metalness: 0.35, roughness: 0.3 }); // bezel, ticks, rim
  const bodyMat = std(theme.body);
  const faceMat = std(theme.face, { roughness: 0.8, metalness: 0 });
  const add = (geo, m, z) => { const o = new THREE.Mesh(geo, m); o.position.z = z; group.add(o); return o; };

  // thick disc with a gold edge, enamel ring, recessed face, groove and ticks
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.52, 1.58, 0.5, 72), [metal, bodyMat, bodyMat]);
  body.rotation.x = Math.PI / 2;
  group.add(body);
  add(new THREE.TorusGeometry(1.52, 0.07, 16, 96), metal, 0.25);
  add(new THREE.CircleGeometry(1.34, 72), faceMat, 0.252);
  add(new THREE.TorusGeometry(1.12, 0.06, 12, 96), std(0x1a1226), 0.262);
  add(new THREE.TorusGeometry(0.97, 0.014, 8, 96), metal, 0.262);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tick = add(new THREE.BoxGeometry(0.035, i % 3 ? 0.07 : 0.13, 0.04), metal, 0.27);
    tick.position.set(Math.cos(a) * 1.26, Math.sin(a) * 1.26, 0.27);
    tick.rotation.z = a - Math.PI / 2;
  }

  // progress arc plus a glowing ember riding its moving end
  const arcMat = new THREE.MeshStandardMaterial({ color: theme.glow, emissive: theme.glow, emissiveIntensity: 0.8, roughness: 0.4 });
  const arc = add(new THREE.TorusGeometry(1.12, 0.075, 12, 8, 1), arcMat, 0.285);
  arc.visible = false;
  const emberMat = new THREE.MeshBasicMaterial({ color: theme.glow });
  const haloMat = new THREE.MeshBasicMaterial({ color: theme.glow, transparent: true, opacity: 0.28, depthWrite: false });
  const ember = add(new THREE.SphereGeometry(0.1, 16, 12), emberMat, 0.3);
  const halo = add(new THREE.SphereGeometry(0.2, 16, 12), haloMat, 0.3);
  ember.visible = halo.visible = false;

  // time readout drawn to a canvas, floating in front of the face
  const lab = document.createElement('canvas');
  lab.width = 1024;
  lab.height = 512;
  const lc = lab.getContext('2d');
  const tex = new THREE.CanvasTexture(lab);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  add(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true }), 0.31);

  function drawLabel(text, sub, alert) {
    lc.clearRect(0, 0, 1024, 512);
    lc.textAlign = 'center';
    lc.textBaseline = 'middle';
    lc.font = `700 138px ${SERIF}`;
    // fixed-width cells (widest digit) so the numbers never jitter
    const digitW = Math.max(...[...'0123456789'].map((d) => lc.measureText(d).width)) + 6;
    const colonW = lc.measureText(':').width + 14;
    const cell = (ch) => (ch === ':' ? colonW : digitW);
    lc.fillStyle = alert ? '#ffd9d5' : '#f6ecd0';
    lc.shadowColor = alert ? ALERT : theme.glow;
    lc.shadowBlur = 28;
    let x = 512 - [...text].reduce((w, ch) => w + cell(ch), 0) / 2;
    for (const ch of text) { lc.fillText(ch, x + cell(ch) / 2, 225); x += cell(ch); }
    lc.shadowBlur = 0;
    lc.font = `italic 600 48px ${SERIF}`;
    lc.fillStyle = alert ? '#ff8a82' : '#c9b98f';
    lc.fillText(sub.length > 22 ? sub.slice(0, 21) + '…' : sub, 512, 345);
    tex.needsUpdate = true;
  }

  // animation: only runs while tilting or ringing, otherwise the GPU sleeps
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  let ringing = false, swing = 0, raf = 0;
  function loop(t) {
    raf = 0;
    cur.x += (target.x - cur.x) * 0.14;
    cur.y += (target.y - cur.y) * 0.14;
    swing += ((ringing && !reduce ? Math.sin(t / 170) * 0.6 : 0) - swing) * 0.25;
    group.rotation.set(cur.x, cur.y + swing, 0);
    renderer.render(scene, camera);
    if ((ringing && !reduce) || Math.abs(target.x - cur.x) > 0.001 || Math.abs(target.y - cur.y) > 0.001 || Math.abs(swing) > 0.003) {
      raf = requestAnimationFrame(loop);
    }
  }
  const invalidate = () => { if (!raf) raf = requestAnimationFrame(loop); };

  let lastKey = '', arcQ = -1, arcAlert = null, last = null;
  function setArc(frac, alert) {
    const q = Math.round(Math.max(0, Math.min(1, frac)) * SEG);
    if (q === arcQ && alert === arcAlert) return false;
    arcQ = q;
    arcAlert = alert;
    arc.geometry.dispose();
    arc.visible = ember.visible = halo.visible = q > 0;
    if (q > 0) {
      const len = (q / SEG) * Math.PI * 2;
      arc.geometry = new THREE.TorusGeometry(1.12, 0.075, 12, Math.max(3, q), len);
      arc.rotation.z = Math.PI / 2 - len; // start at 12 o'clock, sweep clockwise
      const a = Math.PI / 2 - len;
      ember.position.set(Math.cos(a) * 1.12, Math.sin(a) * 1.12, 0.3);
      halo.position.copy(ember.position);
    }
    const c = alert ? ALERT : theme.glow;
    arcMat.color.set(c);
    arcMat.emissive.set(c);
    emberMat.color.set(c);
    haloMat.color.set(c);
    return true;
  }

  const api = {
    set(view) {
      last = view;
      const { text, sub = '', frac = 0, alert = false } = view;
      let dirty = false;
      const key = text + '|' + sub + '|' + alert;
      if (key !== lastKey) { lastKey = key; drawLabel(text, sub, alert); dirty = true; }
      if (setArc(frac, alert)) dirty = true;
      if (ringing !== alert) { ringing = alert; dirty = true; }
      if (dirty) invalidate();
    },
    setTheme(t) {
      theme = t;
      metal.color.set(t.metal);
      metal.emissive.set(t.metal).multiplyScalar(0.16);
      bodyMat.color.set(t.body);
      faceMat.color.set(t.face);
      rim.color.set(t.glow);
      lastKey = '';
      arcAlert = null;
      if (last) api.set(last); else invalidate();
    },
    tilt(nx, ny) {
      if (reduce) return;
      target.y = Math.max(-0.5, Math.min(0.5, nx)) * 0.7;
      target.x = Math.max(-0.5, Math.min(0.5, ny)) * 0.5;
      invalidate();
    },
    invalidate
  };
  metal.emissive.set(theme.metal).multiplyScalar(0.16);
  return api;
}
