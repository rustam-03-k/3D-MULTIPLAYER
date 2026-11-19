const $ = id => document.getElementById(id);
const SCREENS = ['menu', 'mpMenu', 'pauseMenu', 'gameOverMenu'];
let msgTimer = null;

function pop(id) {
  const el = $(id);
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

export const UI = {
  $,
  // show(null) = in game HUD only; show('menu'|'mpMenu'|'pauseMenu'|'gameOverMenu')
  show(name) {
    SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== name));
    $('hud').classList.toggle('hidden', !(name === null || name === 'pauseMenu'));
  },
  on(id, fn) { $(id).addEventListener('click', fn); },
  setHealth(h, max) {
    const p = Math.max(0, Math.round(h));
    $('hpFill').style.width = (p / max * 100) + '%';
    $('hpFill').classList.toggle('low', p < 30);
    $('hpText').textContent = p;
  },
  setAmmo(name, mag, reserve, reloading) {
    $('weaponName').textContent = name;
    $('ammoText').textContent = reloading ? 'RELOADING' : `${mag} / ${reserve}`;
  },
  setWave(n) { $('waveText').textContent = n; },
  setKills(n) { $('killText').textContent = n; },
  setScore(n) { $('scoreText').textContent = n; },
  message(text, ms = 2500) {
    const m = $('message');
    m.textContent = text;
    m.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => m.classList.remove('show'), ms);
  },
  prompt(text) {
    const p = $('prompt');
    if (text) { p.textContent = text; p.classList.remove('hidden'); } else p.classList.add('hidden');
  },
  hit() { pop('hitmarker'); },
  damage() { pop('damageFlash'); },
  setRoom(code, names) {
    $('roomInfo').classList.toggle('hidden', !code);
    if (code) { $('roomCode').textContent = code; $('playersList').textContent = names.join(', '); }
  },
  mpStatus(t) { $('mpStatus').textContent = t; },
  gameOver(s) {
    $('finalStats').innerHTML = `Waves survived: <b>${Math.max(0, s.wave - 1)}</b> (reached wave <b>${s.wave}</b>)<br>Zombies killed: <b>${s.kills}</b><br>Score: <b>${s.score}</b>`;
  }
};
