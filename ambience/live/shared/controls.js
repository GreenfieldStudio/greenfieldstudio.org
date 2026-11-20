// web-ambient scene controls (BRIEF.md section 4, W23): "Pause all" (picture and sound), fullscreen, keys
// (space = sound on/off, f = fullscreen, Esc = leave fullscreen), and an overlay that fades after 3 s without input and
// comes back on any move, tap, key or focus. A focused control never fades (:focus-within in ui.css).
//
//   import { mountControls } from '../shared/controls.js';
//   const sound = mountSound({ ... }); mountControls({ stage: document.getElementById('stage'), sound }); run({ ... });
//
// `sound` is the controller mountSound() returns (toggle, suspend, resume); `wa` defaults to window.WA, looked up at
// the moment of use (run() sets it after this call); `doc`/`win` are injectable for tests.

export const IDLE_MS = 3000;

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ACTIVATES = new Set(['BUTTON', 'A', 'SUMMARY']);

function fsElement(doc) { return doc.fullscreenElement || doc.webkitFullscreenElement || null; }

export function mountControls({ stage, wa = null, sound = null, doc = document, win = window, idleMs = IDLE_MS }) {
  const st = { paused: false, idle: false, timer: 0 };
  const bar = doc.createElement('div');
  bar.className = 'wa-controls';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Scene controls');

  const pauseBtn = doc.createElement('button');
  pauseBtn.type = 'button'; pauseBtn.className = 'wa-btn wa-ctl'; pauseBtn.textContent = 'Pause all';
  pauseBtn.setAttribute('aria-pressed', 'false');
  bar.appendChild(pauseBtn);

  // iPhone Safari has no element fullscreen: no button there rather than one that does nothing.
  const canFs = !!(stage.requestFullscreen || stage.webkitRequestFullscreen);
  let fsBtn = null;
  if (canFs) {
    fsBtn = doc.createElement('button');
    fsBtn.type = 'button'; fsBtn.className = 'wa-btn wa-ctl'; fsBtn.textContent = 'Fullscreen';
    fsBtn.setAttribute('aria-pressed', 'false');
    bar.appendChild(fsBtn);
  }

  const status = doc.createElement('p');
  status.className = 'wa-sr';
  status.setAttribute('aria-live', 'polite');
  bar.appendChild(status);
  stage.appendChild(bar);
  const say = (t) => { status.textContent = t; };

  async function togglePause() {
    st.paused = !st.paused;
    pauseBtn.textContent = st.paused ? 'Resume' : 'Pause all';
    pauseBtn.setAttribute('aria-pressed', String(st.paused));
    say(st.paused ? 'Scene and sound paused.' : 'Scene resumed.');
    const scene = wa || win.WA;
    if (st.paused) { if (scene) scene.pause(); if (sound && sound.suspend) await sound.suspend(); }
    else { if (scene) (scene.resume || scene.start).call(scene); if (sound && sound.resume) await sound.resume(); }
  }

  function toggleFullscreen() {
    if (!canFs) return;
    if (fsElement(doc)) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) Promise.resolve(exit.call(doc)).catch(() => {});
    } else {
      const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
      Promise.resolve(req.call(stage)).catch(() => say('Fullscreen is not allowed here.'));
    }
  }
  function onFsChange() {
    const on = fsElement(doc) === stage;
    if (fsBtn) { fsBtn.textContent = on ? 'Exit fullscreen' : 'Fullscreen'; fsBtn.setAttribute('aria-pressed', String(on)); }
  }

  pauseBtn.addEventListener('click', togglePause);
  if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
  doc.addEventListener('fullscreenchange', onFsChange);
  doc.addEventListener('webkitfullscreenchange', onFsChange);

  // Idle fade: the class goes on the stage; ui.css fades the bar and hides the cursor over the picture.
  function wake() {
    if (st.idle) { st.idle = false; stage.classList.remove('wa-idle'); }
    if (st.timer) win.clearTimeout(st.timer);
    st.timer = win.setTimeout(() => { st.idle = true; st.timer = 0; stage.classList.add('wa-idle'); }, idleMs);
  }
  for (const type of ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'focusin']) {
    doc.addEventListener(type, wake, { passive: true });
  }
  wake();

  doc.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target || {};
    if (TYPING.has(t.tagName) || t.isContentEditable) return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      // Space on a focused button or link activates that control natively; only elsewhere it means sound.
      if (ACTIVATES.has(t.tagName) || !sound || !sound.toggle) return;
      e.preventDefault();
      sound.toggle();
    } else if (e.key === 'f' || e.key === 'F') {
      if (!canFs) return;
      e.preventDefault();
      toggleFullscreen();
    } else if (e.key === 'Escape') {
      if (fsElement(doc)) toggleFullscreen();
    }
  });

  const api = {
    togglePause, toggleFullscreen,
    state: () => ({ paused: st.paused, idle: st.idle, fullscreen: fsElement(doc) === stage, canFullscreen: canFs }),
  };
  win.WA_CONTROLS = api;
  return api;
}
