import * as THREE from 'three';
import { UI } from './ui.js';
import { sfx } from './weapons.js';

// Push a circle (pos, r) out of axis-aligned boxes in the XZ plane.
export function resolveCollisions(pos, r, cols) {
  for (let it = 0; it < 2; it++) {
    for (const c of cols) {
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), p = r - d;
          pos.x += dx / d * p; pos.z += dz / d * p;
        } else {
          const l = pos.x - c.minX, rr = c.maxX - pos.x, t = pos.z - c.minZ, b = c.maxZ - pos.z;
          const m = Math.min(l, rr, t, b);
          if (m === l) pos.x = c.minX - r; else if (m === rr) pos.x = c.maxX + r;
          else if (m === t) pos.z = c.minZ - r; else pos.z = c.maxZ + r;
        }
      }
    }
  }
}

export class Player {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.camera.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(0, 0, 20);
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.health = 100; this.maxHealth = 100;
    this.onGround = true; this.moving = false; this.bobT = 0;
    this.keys = {}; this.flashOn = true;
    this.radius = 0.45; this.eye = 1.7;

    this.flashlight = new THREE.SpotLight(0xfff2d0, 3.2, 45, 0.45, 0.55, 1.6);
    this.flashlight.position.set(0.15, -0.1, 0);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.bias = -0.002;
    this.flashlight.target.position.set(0, 0, -5);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);
    this.bind();
  }

  reset() {
    this.pos.set(0, 0, 20);
    this.vx = this.vy = this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.health = this.maxHealth;
    this.flashOn = true;
    UI.setHealth(this.health, this.maxHealth);
  }

  bind() {
    const g = this.game;
    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (g.state !== 'playing') return;
      if (e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyR') g.weapons.reload();
      else if (e.code === 'KeyE') g.interact();
      else if (e.code === 'KeyF') this.flashOn = !this.flashOn;
      else if (e.code === 'Digit1') g.weapons.switchTo(0);
      else if (e.code === 'Digit2') g.weapons.switchTo(1);
      else if (e.code === 'Digit3') g.weapons.switchTo(2);
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; g.weapons.release(); });
    document.addEventListener('mousemove', e => {
      if (g.state !== 'playing' || !document.pointerLockElement) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.0022));
    });
    document.addEventListener('mousedown', e => {
      if (e.button === 0 && g.state === 'playing' && document.pointerLockElement) g.weapons.pull();
    });
    document.addEventListener('mouseup', e => { if (e.button === 0) g.weapons.release(); });
    document.addEventListener('wheel', e => {
      if (g.state !== 'playing') return;
      const n = g.weapons.cur + (e.deltaY > 0 ? 1 : -1);
      g.weapons.switchTo((n + 3) % 3);
    });
  }

  update(dt) {
    const k = this.keys;
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const sprint = (k.ShiftLeft || k.ShiftRight) && f > 0;
    const spd = sprint ? 8.5 : 5.2;
    let dx = -Math.sin(this.yaw) * f + Math.cos(this.yaw) * r;
    let dz = -Math.cos(this.yaw) * f - Math.sin(this.yaw) * r;
    const len = Math.hypot(dx, dz);
    this.moving = len > 0;
    if (len > 0) { dx /= len; dz /= len; }
    const a = Math.min(1, (this.onGround ? 12 : 3) * dt);
    this.vx += (dx * spd - this.vx) * a;
    this.vz += (dz * spd - this.vz) * a;

    if (k.Space && this.onGround) { this.vy = 7.5; this.onGround = false; }
    this.vy -= 22 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.onGround = true; }

    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    resolveCollisions(this.pos, this.radius, this.game.colliders);
    this.pos.x = Math.max(-95, Math.min(95, this.pos.x));
    this.pos.z = Math.max(-95, Math.min(95, this.pos.z));

    if (this.moving && this.onGround) this.bobT += dt * (sprint ? 12 : 8);
    const bob = this.moving && this.onGround ? Math.sin(this.bobT) * 0.045 : 0;
    this.camera.position.set(this.pos.x, this.pos.y + this.eye + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  damage(n) {
    if (this.health <= 0) return;
    this.health -= n;
    UI.damage();
    sfx(140, 0.25, 0.25, 'sawtooth');
    UI.setHealth(this.health, this.maxHealth);
    if (this.health <= 0) { this.health = 0; UI.setHealth(0, this.maxHealth); this.game.gameOver(); }
  }

  heal(n) {
    this.health = Math.min(this.maxHealth, this.health + n);
    UI.setHealth(this.health, this.maxHealth);
  }
}
