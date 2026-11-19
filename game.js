import * as THREE from 'three';
import { UI } from './ui.js';
import { Player } from './player.js';
import { WeaponSystem, sfx } from './weapons.js';
import { ZombieManager } from './zombies.js';
import { Multiplayer } from './multiplayer.js';

function canvasTex(size, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function noiseTex(base, rx, ry, lines = 0, size = 128) {
  return canvasTex(size, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let i = 0; i < s * s / 3; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.08)';
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    if (lines) { g.fillStyle = 'rgba(0,0,0,.35)'; for (let y = 0; y < s; y += s / lines) g.fillRect(0, y, s, 2); }
  }, rx, ry);
}
function roadTex(vertical) {
  const t = canvasTex(128, (g, s) => {
    g.fillStyle = '#26282b'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.05)'; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
    g.fillStyle = '#b9a84a'; g.fillRect(0, s / 2 - 2, s / 2, 4);
  }, vertical ? 1 : 20, vertical ? 15 : 1);
  if (vertical) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; }
  return t;
}
const std = o => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0.05 }, o));

class Game {
  constructor() {
    this.state = 'menu'; this.mode = 'solo';
    this.colliders = []; this.solidMeshes = []; this.crates = []; this.pickups = [];
    this.flick = []; this.particles = [];
    this.wave = 0; this.kills = 0; this.score = 0; this.waveBreak = 3; this.pickupTimer = 5;
    this.clock = new THREE.Clock();

    this.canvas = document.getElementById('gameCanvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.FogExp2(0x05070d, 0.03);
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
    this.scene.add(this.camera);
    window.addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    this.buildWorld();
    this.initFx();
    this.player = new Player(this);
    this.weapons = new WeaponSystem(this);
    this.zombies = new ZombieManager(this);
    this.net = new Multiplayer(this);
    this.bindUI();
    this.loop();
  }

  // ---------- helpers ----------
  free(x, z, m) {
    if (Math.abs(x) > 88 || Math.abs(z) > 88) return false;
    return !this.colliders.some(c => x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m);
  }
  loc(lx, lz, ox, oz, rot) { const c = Math.cos(rot), s = Math.sin(rot); return [ox + lx * c + lz * s, oz - lx * s + lz * c]; }

  bx(lx, ly, lz, w, h, d, mat, ox = 0, oz = 0, rot = 0, solid = true) {
    const [wx, wz] = this.loc(lx, lz, ox, oz, rot);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(wx, ly, wz); m.rotation.y = rot; m.castShadow = m.receiveShadow = true;
    this.scene.add(m); this.solidMeshes.push(m);
    if (solid) {
      const odd = Math.abs(Math.round(rot / (Math.PI / 2))) % 2 === 1;
      const hw = (odd ? d : w) / 2, hd = (odd ? w : d) / 2;
      this.colliders.push({ minX: wx - hw, maxX: wx + hw, minZ: wz - hd, maxZ: wz + hd });
    }
    return m;
  }

  // ---------- world ----------
  buildWorld() {
    const sc = this.scene;
    this.M = {
      wall1: std({ map: noiseTex('#7a6a58', 2, 1, 8) }), wall2: std({ map: noiseTex('#66717a', 2, 1, 8) }),
      wall3: std({ map: noiseTex('#80584a', 2, 1, 10) }), mil: std({ map: noiseTex('#4f5a45', 3, 1, 6) }),
      concrete: std({ map: noiseTex('#5a5c5d', 2, 1) }), wood: std({ map: noiseTex('#4a3626', 1, 1, 6) }),
      roof: std({ map: noiseTex('#3a2a25', 2, 2, 8) }), metal: std({ color: 0x2b2f33, metalness: 0.6, roughness: 0.5 }),
      glass: std({ color: 0x0b1620, emissive: 0x0a1822, roughness: 0.2 }),
      crate: std({ map: noiseTex('#6b4a25', 1, 1, 5), emissive: 0x2a1800 }),
      bed: std({ color: 0x4a4038 })
    };
    // lights
    sc.add(new THREE.AmbientLight(0x2a3a60, 0.55));
    sc.add(new THREE.HemisphereLight(0x25355a, 0x0a0a0a, 0.35));
    this.moon = new THREE.DirectionalLight(0x6f8fd0, 0.5);
    this.moon.castShadow = true; this.moon.shadow.mapSize.set(2048, 2048);
    const sh = this.moon.shadow.camera; sh.left = sh.bottom = -45; sh.right = sh.top = 45; sh.near = 1; sh.far = 140;
    sc.add(this.moon); sc.add(this.moon.target);
    // moon & stars
    const moonM = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 16), new THREE.MeshBasicMaterial({ color: 0xdde6ff, fog: false }));
    moonM.position.set(-120, 110, -180); sc.add(moonM);
    const sp = []; for (let i = 0; i < 600; i++) { const a = Math.random() * 6.28, b = Math.random() * 1.3 + 0.1, r = 250; sp.push(Math.cos(a) * Math.cos(b) * r, Math.sin(b) * r, Math.sin(a) * Math.cos(b) * r); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sc.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false })));
    // ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), std({ map: noiseTex('#26301f', 60, 60, 0, 128) }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground); this.solidMeshes.push(ground);
    // roads
    const r1 = new THREE.Mesh(new THREE.PlaneGeometry(190, 8), std({ map: roadTex(false) }));
    r1.rotation.x = -Math.PI / 2; r1.position.y = 0.02; r1.receiveShadow = true; sc.add(r1);
    const r2 = new THREE.Mesh(new THREE.PlaneGeometry(8, 120), std({ map: roadTex(true) }));
    r2.rotation.x = -Math.PI / 2; r2.position.set(0, 0.025, -5); r2.receiveShadow = true; sc.add(r2);

    const P = Math.PI;
    const M = this.M, walls = [M.wall1, M.wall2, M.wall3];
    const wp = () => walls[Math.floor(Math.random() * 3)];
    // houses (door faces road)
    [-56, -40, -24, 24, 40, 56].forEach((x, i) => {
      this.house(x, -13, 0, 10, 8, 3.5, wp(), { light: i === 1, crates: Math.random() < 0.6 });
      this.house(x, 13, P, 10, 8, 3.5, wp(), { light: i === 4, crates: Math.random() < 0.6 });
    });
    this.house(14, -28, -P / 2, 9, 8, 3.5, wp(), { crates: true }); this.house(-14, -28, P / 2, 9, 8, 3.5, wp(), { crates: true });
    this.house(14, 30, -P / 2, 9, 8, 3.5, wp(), { crates: true }); this.house(-14, 30, P / 2, 9, 8, 3.5, wp(), { crates: true });
    this.house(-45, -38, 0, 10, 8, 3.5, wp(), { crates: true }); this.house(45, -38, 0, 10, 8, 3.5, wp(), { crates: true });
    this.house(-45, 40, P, 10, 8, 3.5, wp(), { crates: true }); this.house(45, 40, P, 10, 8, 3.5, wp(), { crates: true });
    // military building
    this.house(0, -52, 0, 22, 14, 4.5, M.mil, { gap: 4, flat: true, noFurn: true, light: true, crates: [[-8, -4], [-5, -5.2], [5, -5.2], [8, -4], [0, -5.4], [-9, 3]] });
    for (let i = -3; i <= 3; i++) if (i !== 0) this.bx(i * 2.2, 0.45, 12, 2, 0.9, 0.8, std({ color: 0x6b6044 }), 0, -52, 0, true);
    this.bx(-16, 2.5, 0, 0.15, 5, 0.15, M.metal, 0, -45, 0, true);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ color: 0x7a1010, side: THREE.DoubleSide }));
    flag.position.set(-15.2, 4.4, -45); sc.add(flag);
    const red = new THREE.PointLight(0xff3322, 1.6, 14, 1.8); red.position.set(0, 4, -43); sc.add(red); this.flick.push({ l: red, base: 1.6 });
    // streetlights
    [[-60, 5], [-36, -5], [-12, 5], [12, -5], [36, 5], [60, -5], [5, -30], [-5, 30], [5, 30], [-5, -20]].forEach((p, i) => this.streetlight(p[0], p[1], i % 2 === 0));
    // cars
    [[-18, -2, P / 2, 0x6a2a22], [30, 2, P / 2 + 0.05, 0x2a4a6a], [2, 12, 0.1, 0x4a4a2a], [-2.5, -22, -0.12, 0x5a5a5a],
     [-50, -3, P / 2, 0x3a3a52], [50, 3.2, P / 2, 0x5a3a2a], [3, 36, 0, 0x2a5a3a], [-25, 2, P / 2 + 0.1, 0x6a6a2a]].forEach(c => this.car(...c));
    // trees
    for (let i = 0; i < 140 && this.trees !== 80; i++) {
      this.trees = this.trees || 0;
      const x = (Math.random() - 0.5) * 176, z = (Math.random() - 0.5) * 176;
      if (Math.abs(z) < 8 || Math.abs(x) < 8 || !this.free(x, z, 2.5)) continue;
      this.tree(x, z); this.trees++;
    }
    // dust
    const dp = []; for (let i = 0; i < 300; i++) dp.push((Math.random() - 0.5) * 140, Math.random() * 8 + 0.3, (Math.random() - 0.5) * 140);
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x9aa8b8, size: 0.08, transparent: true, opacity: 0.5 }));
    sc.add(this.dust);
  }

  house(ox, oz, rot, w, d, h, wm, o = {}) {
    const M = this.M, t = 0.4, hw = w / 2, hd = d / 2, g = o.gap || 2.4, sw = (w - g) / 2;
    const B = (lx, ly, lz, bw, bh, bd, mat, solid = true) => this.bx(lx, ly, lz, bw, bh, bd, mat, ox, oz, rot, solid);
    B(0, h / 2, -hd, w, h, t, wm); B(-hw, h / 2, 0, t, h, d, wm); B(hw, h / 2, 0, t, h, d, wm);
    B(-(g / 2 + sw / 2), h / 2, hd, sw, h, t, wm); B(g / 2 + sw / 2, h / 2, hd, sw, h, t, wm);
    B(0, h - 0.5, hd, g, 1, t, wm, false);
    B(0, 0.05, 0, w - 0.4, 0.1, d - 0.4, M.wood, false);
    if (o.flat) B(0, h + 0.15, 0, w + 0.6, 0.3, d + 0.6, M.concrete, false);
    else {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 2, 4), M.roof);
      roof.scale.set(w * 0.78, 1.3, d * 0.78); roof.rotation.y = rot + Math.PI / 4; roof.position.set(ox, h + 1.3, oz);
      roof.castShadow = true; this.scene.add(roof);
    }
    B(-w / 4, 1.8, -hd + 0.21, 1.2, 1, 0.06, M.glass, false); B(w / 4, 1.8, -hd + 0.21, 1.2, 1, 0.06, M.glass, false);
    B(-hw + 0.21, 1.8, 0, 0.06, 1, 1.2, M.glass, false); B(hw - 0.21, 1.8, 0, 0.06, 1, 1.2, M.glass, false);
    if (!o.noFurn) { B(-hw + 1.3, 0.4, -hd + 1.5, 1.4, 0.8, 2.2, M.bed); B(hw - 1.8, 0.4, -hd + 1.2, 1.6, 0.8, 0.9, M.wood); }
    if (o.light) {
      const l = new THREE.PointLight(0xffa860, 1.4, 14, 1.8); l.position.set(ox, h - 1, oz); this.scene.add(l);
      this.flick.push({ l, base: 1.4 });
    }
    const list = o.crates === true ? [[hw - 1.2, 1.2]] : (Array.isArray(o.crates) ? o.crates : []);
    list.forEach(c => { const [x, z] = this.loc(c[0], c[1], ox, oz, rot); this.addCrate(x, z); });
  }

  addCrate(x, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), this.M.crate);
    m.position.set(x, 0.35, z); m.castShadow = m.receiveShadow = true; this.scene.add(m); this.solidMeshes.push(m);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.95), this.M.metal); band.position.y = 0.2; m.add(band);
    this.colliders.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45 });
    this.crates.push({ mesh: m, x, z, opened: false });
  }

  streetlight(x, z, withLight) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 8), this.M.metal);
    pole.position.set(x, 3, z); pole.castShadow = true; this.scene.add(pole); this.solidMeshes.push(pole);
    this.colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
    lamp.position.set(x, 6, z); this.scene.add(lamp);
    if (withLight) {
      const l = new THREE.PointLight(0xffd9a0, 2.2, 24, 1.6); l.position.set(x, 5.7, z); this.scene.add(l);
      this.flick.push({ l, base: 2.2, bad: Math.random() < 0.5 });
    }
  }

  car(x, z, rot, color) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.2), std({ color, roughness: 0.7, metalness: 0.4 }));
    body.position.y = 0.65;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), this.M.glass); cab.position.set(0, 1.3, -0.2);
    [body, cab].forEach(m => { m.castShadow = m.receiveShadow = true; g.add(m); this.solidMeshes.push(m); });
    const wm = std({ color: 0x111111 });
    for (const sx of [-0.95, 0.95]) for (const sz of [-1.3, 1.3]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12), wm);
      w.rotation.z = Math.PI / 2; w.position.set(sx, 0.38, sz); g.add(w);
    }
    this.scene.add(g);
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)), ex = c * 0.95 + s * 2.1, ez = s * 0.95 + c * 2.1;
    this.colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez });
  }

  tree(x, z) {
    const h = 2.5 + Math.random() * 2, g = new THREE.Group(); g.position.set(x, 0, z);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, h, 7), std({ color: 0x3a2a1c }));
    tr.position.y = h / 2; tr.castShadow = true; g.add(tr);
    const fm = std({ color: 0x1a3320 });
    for (let i = 0; i < 2; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(1.6 - i * 0.5, 2.6, 7), fm); c.position.y = h + 0.4 + i * 1.3; c.castShadow = true; g.add(c); }
    this.scene.add(g); this.solidMeshes.push(tr);
    this.colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35 });
  }

  // ---------- particles ----------
  initFx() {
    const geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    this.fxMats = { blood: new THREE.MeshBasicMaterial({ color: 0x8a0b0b }), spark: new THREE.MeshBasicMaterial({ color: 0xffc060 }) };
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(geo, this.fxMats.spark); m.visible = false;
      m.userData = { life: 0, vel: new THREE.Vector3() }; this.scene.add(m); this.particles.push(m);
    }
  }
  emit(p, type, n, speed = 3, life = 0.5) {
    let c = 0;
    for (const m of this.particles) {
      if (m.userData.life > 0) continue;
      m.material = this.fxMats[type]; m.position.copy(p);
      m.userData.vel.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).multiplyScalar(speed * 1.5);
      m.userData.life = life * (0.6 + Math.random() * 0.6); m.visible = true;
      if (++c >= n) break;
    }
  }
  updateFx(dt) {
    for (const m of this.particles) {
      const u = m.userData; if (u.life <= 0) continue;
      u.life -= dt; u.vel.y -= 9 * dt; m.position.addScaledVector(u.vel, dt);
      if (m.position.y < 0.03) { m.position.y = 0.03; u.vel.multiplyScalar(0.3); }
      m.scale.setScalar(Math.max(0.01, Math.min(1.5, u.life * 3)));
      if (u.life <= 0) m.visible = false;
    }
  }

  // ---------- gameplay ----------
  reset() {
    this.wave = 0; this.kills = 0; this.score = 0; this.waveBreak = 3; this.pickupTimer = 4;
    this.pickups.forEach(p => this.scene.remove(p.g)); this.pickups = [];
    this.crates.forEach(c => { c.opened = false; c.mesh.material = this.M.crate; });
    this.player.reset(); this.weapons.reset(); this.zombies.reset();
    UI.setWave(0); UI.setKills(0); UI.setScore(0);
  }

  startGame() {
    this.reset();
    this.state = 'playing';
    UI.show(null);
    this.canvas.requestPointerLock();
    UI.message('SURVIVE THE NIGHT', 3000);
  }

  gameOver() {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.weapons.release();
    document.exitPointerLock();
    UI.prompt(null);
    UI.gameOver({ wave: this.wave, kills: this.kills, score: this.score });
    UI.show('gameOverMenu');
  }

  quit() {
    this.state = 'menu'; this.net.leave(); UI.prompt(null);
    document.exitPointerLock(); UI.show('menu');
  }

  onZombieKilled(z, head) {
    this.kills++; this.score += head ? 150 : 100;
    UI.setKills(this.kills); UI.setScore(this.score);
    sfx(110, 0.3, 0.15, 'sawtooth');
    if (Math.random() < 0.2) this.spawnPickup(Math.random() < 0.5 ? 'ammo' : 'health', z.group.position.x, z.group.position.z);
  }

  spawnPickup(type, x, z) {
    const g = new THREE.Group();
    const add = (w, h, d, c, e, px = 0, py = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std({ color: c, emissive: e })); m.position.set(px, py, 0); g.add(m); };
    if (type === 'ammo') { add(0.5, 0.32, 0.36, 0xb08a20, 0x6a4a00); add(0.1, 0.34, 0.38, 0x222222, 0x000000); }
    else { add(0.46, 0.46, 0.46, 0xeeeeee, 0x444444); add(0.3, 0.1, 0.48, 0xcc0000, 0xaa0000); add(0.1, 0.3, 0.48, 0xcc0000, 0xaa0000); }
    g.position.set(x, 0.7, z); this.scene.add(g);
    this.pickups.push({ g, type, t: Math.random() * 6, life: 60 });
  }

  updatePickups(dt) {
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      this.pickupTimer = 12;
      if (this.pickups.length < 8) {
        for (let i = 0; i < 30; i++) {
          const x = (Math.random() - 0.5) * 140, z = (Math.random() - 0.5) * 140;
          if (this.free(x, z, 1.5)) { this.spawnPickup(Math.random() < 0.55 ? 'ammo' : 'health', x, z); break; }
        }
      }
    }
    const p = this.player.pos;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i]; k.t += dt; k.life -= dt;
      k.g.rotation.y += dt * 2; k.g.position.y = 0.7 + Math.sin(k.t * 3) * 0.12;
      if (Math.hypot(k.g.position.x - p.x, k.g.position.z - p.z) < 1.7) {
        if (k.type === 'ammo') { this.weapons.addAmmo(1); UI.message('+ AMMO', 1200); }
        else { this.player.heal(35); UI.message('+ HEALTH', 1200); }
        sfx(800, 0.12, 0.12, 'sine'); k.life = 0;
      }
      if (k.life <= 0) { this.scene.remove(k.g); this.pickups.splice(i, 1); }
    }
  }

  nearestCrate() {
    const p = this.player.pos; let best = null, bd = 2.8;
    for (const c of this.crates) { if (c.opened) continue; const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  updateCrates() { UI.prompt(this.nearestCrate() ? '[E] Open loot crate' : null); }
  interact() {
    const c = this.nearestCrate(); if (!c) return;
    c.opened = true; c.mesh.material = std({ color: 0x2a2018 });
    const r = Math.random();
    if (r < 0.5) { this.weapons.addAmmo(1.5); UI.message('CRATE: AMMO', 1800); }
    else if (r < 0.75) { this.player.heal(45); UI.message('CRATE: MEDKIT', 1800); }
    else { this.weapons.addAmmo(1); this.player.heal(25); UI.message('CRATE: AMMO + MEDKIT', 1800); }
    sfx(250, 0.2, 0.15, 'triangle');
  }

  updateWaves(dt) {
    if (this.waveBreak > 0) {
      this.waveBreak -= dt;
      if (this.waveBreak <= 0) {
        this.wave++; this.zombies.startWave(this.wave);
        UI.setWave(this.wave); UI.message('WAVE ' + this.wave, 3000); sfx(70, 0.8, 0.2, 'sawtooth');
      }
      return;
    }
    if (this.zombies.waveCleared()) {
      const b = 100 * this.wave; this.score += b; UI.setScore(this.score);
      UI.message(`WAVE ${this.wave} CLEARED  +${b}`, 3000);
      this.weapons.addAmmo(0.5); this.player.heal(15);
      this.waveBreak = 8;
    }
  }

  // ---------- UI ----------
  bindUI() {
    UI.on('btnSolo', () => { this.mode = 'solo'; this.net.leave(); this.startGame(); });
    UI.on('btnMulti', () => { UI.mpStatus(''); UI.show('mpMenu'); });
    UI.on('btnMpBack', () => UI.show('menu'));
    const name = () => (UI.$('playerName').value.trim() || 'Survivor').slice(0, 12);
    UI.on('btnCreate', async () => {
      UI.mpStatus('Connecting...');
      const r = await this.net.createRoom(name());
      if (r.ok) { this.mode = 'mp'; this.startGame(); } else UI.mpStatus(r.error);
    });
    UI.on('btnJoin', async () => {
      const code = UI.$('joinCode').value.trim().toUpperCase();
      if (code.length !== 4) { UI.mpStatus('Enter the 4-letter room code'); return; }
      UI.mpStatus('Connecting...');
      const r = await this.net.joinRoom(code, name());
      if (r.ok) { this.mode = 'mp'; this.startGame(); } else UI.mpStatus(r.error);
    });
    UI.on('btnResume', () => this.canvas.requestPointerLock());
    UI.on('btnQuit', () => this.quit());
    UI.on('btnRestart', () => this.startGame());
    UI.on('btnMenu', () => this.quit());

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked && this.state === 'paused') { this.state = 'playing'; UI.show(null); }
      else if (!locked && this.state === 'playing') { this.state = 'paused'; this.weapons.release(); UI.prompt(null); UI.show('pauseMenu'); }
    });
    document.addEventListener('pointerlockerror', () => {
      if (this.state === 'playing') { this.state = 'paused'; UI.show('pauseMenu'); }
    });
  }

  // ---------- main loop ----------
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    const playing = this.state === 'playing';
    if (playing) {
      this.player.update(dt); this.weapons.update(dt); this.zombies.update(dt);
      this.updateWaves(dt); this.updatePickups(dt); this.updateCrates();
    } else if (this.state === 'menu') {
      const a = t * 0.08;
      this.camera.position.set(Math.cos(a) * 32, 9, Math.sin(a) * 32 - 8);
      this.camera.lookAt(0, 3, -8);
    }
    this.weapons.setVisible(this.state !== 'menu');
    this.player.flashlight.visible = this.player.flashOn && this.state !== 'menu';
    this.updateFx(dt);
    this.net.update(dt, playing);
    for (const f of this.flick) f.l.intensity = f.bad ? (Math.random() < 0.08 ? 0.2 : f.base) : f.base * (0.92 + Math.sin(t * 9 + f.base * 7) * 0.05 + Math.random() * 0.03);
    const cp = this.camera.position;
    this.moon.position.set(cp.x + 25, 60, cp.z + 15); this.moon.target.position.set(cp.x, 0, cp.z);
    const dp = this.dust.geometry.attributes.position;
    for (let i = 0; i < dp.count; i += 3) dp.setY(i, 0.5 + ((dp.getY(i) + dt * 0.15) % 8));
    dp.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}

new Game();
