import * as THREE from 'three';
import { UI } from './ui.js';

let actx = null;
export function sfx(freq, dur, vol = 0.2, type = 'square', noise = false) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const a = actx, t = a.currentTime, g = a.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(a.destination);
    if (noise) {
      const n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const s = a.createBufferSource(); s.buffer = b; s.connect(g); s.start(t);
    } else {
      const o = a.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freq / 3), t + dur);
      o.connect(g); o.start(t); o.stop(t + dur);
    }
  } catch (e) { /* audio unavailable */ }
}

export const WEAPONS = [
  { name: 'PISTOL', dmg: 30, rate: 0.28, mag: 12, reserve: 60, spread: 0.006, recoil: 0.03, auto: false, pellets: 1, reload: 1.1, range: 90 },
  { name: 'ASSAULT RIFLE', dmg: 22, rate: 0.095, mag: 30, reserve: 120, spread: 0.014, recoil: 0.018, auto: true, pellets: 1, reload: 1.8, range: 120 },
  { name: 'SHOTGUN', dmg: 14, rate: 0.85, mag: 6, reserve: 30, spread: 0.07, recoil: 0.09, auto: false, pellets: 8, reload: 2.2, range: 35 }
];

export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.ray = new THREE.Raycaster();
    this.root = new THREE.Group();
    game.camera.add(this.root);
    this.models = []; this.muzzles = [];
    this.build();
    this.reset();
  }

  build() {
    const skin = 0xb98a6a, dark = 0x1b1d20, metal = 0x30343b, cloth = 0x2d3a2b, wood = 0x5a3b22;
    const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3, emissive: 0x141414 });
    const mk = (g, w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); g.add(m); return m; };
    const cyl = (g, r, l, x, y, z, c) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 10), mat(c)); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };

    // Pistol
    let g = new THREE.Group();
    mk(g, 0.06, 0.07, 0.3, 0, 0, -0.15, metal); mk(g, 0.05, 0.14, 0.07, 0, -0.1, -0.02, dark);
    mk(g, 0.09, 0.09, 0.12, 0, -0.1, 0.0, skin); mk(g, 0.11, 0.11, 0.45, 0.02, -0.13, 0.25, cloth);
    this.addModel(g, -0.32, new THREE.Vector3(0.2, -0.2, -0.42));
    // Assault rifle
    g = new THREE.Group();
    mk(g, 0.06, 0.09, 0.6, 0, 0, -0.3, metal); cyl(g, 0.016, 0.35, 0, 0.01, -0.75, dark);
    mk(g, 0.05, 0.1, 0.25, 0, -0.02, 0.12, dark); mk(g, 0.045, 0.16, 0.08, 0, -0.12, -0.3, dark);
    mk(g, 0.04, 0.04, 0.05, 0, 0.065, -0.55, dark);
    mk(g, 0.08, 0.08, 0.12, 0, -0.07, -0.5, skin); mk(g, 0.09, 0.09, 0.4, -0.05, -0.1, -0.2, cloth);
    mk(g, 0.09, 0.09, 0.12, 0.02, -0.1, 0.0, skin);
    this.addModel(g, -0.93, new THREE.Vector3(0.22, -0.2, -0.45));
    // Shotgun
    g = new THREE.Group();
    cyl(g, 0.022, 0.75, 0, 0.02, -0.45, metal); cyl(g, 0.02, 0.6, 0, -0.03, -0.4, dark);
    mk(g, 0.06, 0.09, 0.25, 0, -0.01, -0.05, metal); mk(g, 0.07, 0.06, 0.2, 0, -0.06, -0.45, wood);
    mk(g, 0.05, 0.1, 0.3, 0, -0.04, 0.2, wood);
    mk(g, 0.08, 0.08, 0.12, 0, -0.06, -0.45, skin); mk(g, 0.09, 0.09, 0.4, -0.05, -0.1, -0.15, cloth);
    mk(g, 0.09, 0.09, 0.12, 0.02, -0.08, 0.05, skin);
    this.addModel(g, -0.85, new THREE.Vector3(0.22, -0.21, -0.45));

    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffaa44, 0, 12);
  }

  addModel(g, muzzleZ, base) {
    g.position.copy(base); g.userData.base = base.clone();
    const m = new THREE.Object3D(); m.position.set(0, 0.02, muzzleZ); g.add(m);
    g.visible = false;
    this.root.add(g);
    this.models.push(g); this.muzzles.push(m);
  }

  reset() {
    this.ammo = WEAPONS.map(w => ({ mag: w.mag, reserve: w.reserve }));
    this.cur = 0; this.cool = 0; this.reloadT = 0; this.trigger = false; this.kick = 0; this.flashT = 0;
    this.apply();
  }

  apply() {
    this.models.forEach((m, i) => { m.visible = i === this.cur; m.rotation.set(0, 0, 0); });
    this.muzzles[this.cur].add(this.flash);
    this.muzzles[this.cur].add(this.flashLight);
  }

  setVisible(v) { this.root.visible = v; }
  pull() { this.trigger = true; this.fire(); }
  release() { this.trigger = false; }

  switchTo(i) {
    if (i === this.cur || i < 0 || i >= WEAPONS.length) return;
    this.reloadT = 0; this.cur = i; this.cool = 0.25;
    this.apply(); sfx(900, 0.06, 0.08, 'square');
  }

  reload() {
    const w = WEAPONS[this.cur], a = this.ammo[this.cur];
    if (this.reloadT > 0 || a.mag >= w.mag || a.reserve <= 0) return;
    this.reloadT = w.reload;
    sfx(300, 0.12, 0.1, 'square');
  }

  addAmmo(f) {
    WEAPONS.forEach((w, i) => { this.ammo[i].reserve = Math.min(w.mag * 8, this.ammo[i].reserve + Math.ceil(w.mag * f * 2)); });
  }

  fire() {
    const w = WEAPONS[this.cur], a = this.ammo[this.cur], game = this.game;
    if (this.cool > 0 || this.reloadT > 0 || game.state !== 'playing') return;
    if (a.mag <= 0) { sfx(200, 0.05, 0.15, 'square'); this.cool = 0.25; if (a.reserve > 0) this.reload(); return; }
    a.mag--; this.cool = w.rate; this.kick = 1; this.flashT = 0.05;
    const cam = game.camera;
    cam.updateMatrixWorld();
    const o = new THREE.Vector3(); cam.getWorldPosition(o);
    let end = null;
    for (let i = 0; i < w.pellets; i++) {
      const d = new THREE.Vector3((Math.random() - 0.5) * w.spread * 2, (Math.random() - 0.5) * w.spread * 2, -1).applyQuaternion(cam.quaternion).normalize();
      const e = this.castRay(o, d, w);
      if (!end) end = e;
    }
    const p = game.player;
    p.pitch = Math.min(1.5, p.pitch + w.recoil * (0.8 + Math.random() * 0.4));
    p.yaw += (Math.random() - 0.5) * w.recoil * 0.6;
    if (this.cur === 2) sfx(0, 0.25, 0.35, 'square', true); else sfx(this.cur === 1 ? 420 : 560, 0.12, 0.25, 'square');
    game.net.sendShoot(o, end, this.cur);
  }

  castRay(o, d, w) {
    const game = this.game;
    this.ray.set(o, d);
    this.ray.far = w.range;
    const zs = this.ray.intersectObjects(game.zombies.hitMeshes(), false);
    const ws = this.ray.intersectObjects(game.solidMeshes, false);
    const z = zs[0], wl = ws[0];
    if (z && (!wl || z.distance < wl.distance)) {
      const head = !!z.object.userData.head;
      z.object.userData.zombie.damage(w.dmg * (head ? 2 : 1), head);
      game.emit(z.point, 'blood', 6, 3, 0.5);
      UI.hit();
      return z.point.clone();
    }
    if (wl) { game.emit(wl.point, 'spark', 4, 3, 0.3); return wl.point.clone(); }
    return o.clone().addScaledVector(d, w.range);
  }

  update(dt) {
    const w = WEAPONS[this.cur], a = this.ammo[this.cur], p = this.game.player;
    const g = this.models[this.cur], b = g.userData.base;
    this.cool -= dt;
    this.kick = Math.max(0, this.kick - dt * 8);
    let rl = 0;
    if (this.reloadT > 0) {
      rl = Math.sin((1 - this.reloadT / w.reload) * Math.PI);
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const n = Math.min(w.mag - a.mag, a.reserve);
        a.mag += n; a.reserve -= n; this.reloadT = 0;
        sfx(700, 0.06, 0.1, 'square');
      }
    }
    const bob = p.moving && p.onGround ? Math.sin(p.bobT) * 0.012 : 0;
    const sway = p.moving && p.onGround ? Math.cos(p.bobT * 0.5) * 0.01 : 0;
    g.position.set(b.x + sway, b.y + bob - rl * 0.25, b.z + this.kick * 0.08);
    g.rotation.set(this.kick * 0.12 - rl * 0.6, 0, rl * 0.3);
    if (this.flashT > 0) {
      this.flashT -= dt; this.flash.visible = true; this.flashLight.intensity = 3; this.flash.rotation.z = Math.random() * 6;
    } else { this.flash.visible = false; this.flashLight.intensity = 0; }
    if (this.trigger && w.auto) this.fire();
    UI.setAmmo(w.name, a.mag, a.reserve, this.reloadT > 0);
  }
}
