import * as THREE from 'three';
import { resolveCollisions } from './player.js';
import { sfx } from './weapons.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const std = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
const SKIN = [0x6f8f62, 0x7d9a6c, 0x8a9a78].map(std);
const CLOTH = [0x3b2f2a, 0x2a3340, 0x40362a, 0x2e2e2e].map(std);
const EYE = new THREE.MeshBasicMaterial({ color: 0xff2200 });
const pick = a => a[Math.floor(Math.random() * a.length)];

function part(parent, mat, w, h, d, x, y, z, zomb, head = false) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true;
  m.userData = { zombie: zomb, head };
  parent.add(m); zomb.parts.push(m);
  return m;
}

class Zombie {
  constructor(mgr, pos, aggro, wave) {
    this.mgr = mgr; this.game = mgr.game;
    this.aggro = aggro; this.isWave = aggro;
    this.hp = 50 + wave * 10;
    this.speed = Math.min(4.4, 2.0 + Math.random() * 1.0 + wave * 0.1);
    this.dead = false; this.deadT = 0; this.atkCool = 0; this.t = Math.random() * 10;
    this.wanderT = 0; this.sideT = 0; this.side = 1; this.dmg = 8 + wave;
    this.target = new THREE.Vector3(pos.x, 0, pos.z);
    this.parts = [];
    const g = this.group = new THREE.Group();
    g.rotation.order = 'YXZ'; g.position.copy(pos); g.rotation.y = Math.random() * 6.28;
    const skin = pick(SKIN), cloth = pick(CLOTH);
    part(g, cloth, 0.6, 0.8, 0.32, 0, 1.2, 0, this);
    this.head = part(g, skin, 0.34, 0.34, 0.34, 0, 1.78, 0.03, this, true);
    part(g, EYE, 0.06, 0.05, 0.02, -0.08, 1.8, 0.21, this, true);
    part(g, EYE, 0.06, 0.05, 0.02, 0.08, 1.8, 0.21, this, true);
    this.legs = [-0.15, 0.15].map(x => { const l = new THREE.Group(); l.position.set(x, 0.8, 0); part(l, cloth, 0.22, 0.8, 0.24, 0, -0.4, 0, this); g.add(l); return l; });
    this.arms = [-0.4, 0.4].map(x => { const a = new THREE.Group(); a.position.set(x, 1.55, 0); part(a, skin, 0.16, 0.6, 0.16, 0, -0.3, 0, this); a.rotation.x = -1.4; g.add(a); return a; });
    this.game.scene.add(g);
  }

  damage(n, head) {
    if (this.dead) return;
    this.hp -= n; this.aggro = true;
    if (this.hp <= 0) { this.dead = true; this.deadT = 0; this.game.onZombieKilled(this, head); }
  }

  update(dt) {
    const game = this.game, pl = game.player, p = pl.pos, pos = this.group.position;
    if (this.dead) {
      this.deadT += dt;
      this.group.rotation.x = -Math.min(1, this.deadT * 3) * Math.PI / 2;
      pos.y = 0.15;
      return this.deadT > 6;
    }
    this.atkCool -= dt; this.t += dt;
    const dist = Math.hypot(p.x - pos.x, p.z - pos.z);
    if (!this.aggro && dist < 16 && pl.health > 0) this.aggro = true;
    let tx, tz, speed;
    if (this.aggro && pl.health > 0) { tx = p.x; tz = p.z; speed = this.speed; }
    else {
      this.wanderT -= dt;
      if (this.wanderT <= 0 || Math.hypot(this.target.x - pos.x, this.target.z - pos.z) < 1) {
        this.target.set(Math.max(-85, Math.min(85, pos.x + (Math.random() - 0.5) * 24)), 0, Math.max(-85, Math.min(85, pos.z + (Math.random() - 0.5) * 24)));
        this.wanderT = 4 + Math.random() * 4;
      }
      tx = this.target.x; tz = this.target.z; speed = this.speed * 0.4;
    }
    let mx = tx - pos.x, mz = tz - pos.z;
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const attacking = this.aggro && dist < 1.5 && pl.health > 0;
    let moved = 0;
    if (attacking) {
      if (this.atkCool <= 0) { this.atkCool = 1.1; pl.damage(this.dmg); sfx(90, 0.2, 0.12, 'sawtooth'); }
    } else {
      if (this.sideT > 0) this.sideT -= dt;
      const px = pos.x, pz = pos.z;
      let vx = mx, vz = mz;
      if (this.sideT > 0) { vx = mx - mz * this.side * 1.2; vz = mz + mx * this.side * 1.2; const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l; }
      pos.x += vx * speed * dt; pos.z += vz * speed * dt;
      for (const o of this.mgr.list) {
        if (o === this || o.dead) continue;
        const ox = pos.x - o.group.position.x, oz = pos.z - o.group.position.z, d = Math.hypot(ox, oz);
        if (d < 0.8 && d > 0.001) { pos.x += ox / d * (0.8 - d) * 0.5; pos.z += oz / d * (0.8 - d) * 0.5; }
      }
      resolveCollisions(pos, 0.4, game.colliders);
      moved = Math.hypot(pos.x - px, pos.z - pz);
      if (moved < speed * dt * 0.25 && this.sideT <= 0 && dist > 2) { this.sideT = 0.8; this.side = Math.random() < 0.5 ? -1 : 1; }
    }
    const ty = Math.atan2(mx, mz);
    let dy = ty - this.group.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.group.rotation.y += dy * Math.min(1, dt * 8);
    const sw = Math.sin(this.t * speed * 3.2) * (moved > 0 ? 0.6 : 0.05);
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    const lunge = attacking ? Math.sin(this.t * 14) * 0.3 : 0;
    this.arms[0].rotation.x = -1.4 + Math.sin(this.t * 2) * 0.1 + lunge;
    this.arms[1].rotation.x = -1.4 + Math.cos(this.t * 2) * 0.1 - lunge;
    this.head.rotation.z = Math.sin(this.t * 1.5) * 0.12;
  }
}

export class ZombieManager {
  constructor(game) {
    this.game = game; this.list = []; this.queue = 0; this.spawnT = 0; this.ambT = 0; this.wave = 1;
  }

  reset() {
    this.list.forEach(z => this.game.scene.remove(z.group));
    this.list = []; this.queue = 0; this.wave = 1;
    for (let i = 0; i < 5; i++) this.spawn(false);
  }

  randomSpawn(minDist) {
    const p = this.game.player.pos;
    for (let i = 0; i < 60; i++) {
      const x = (Math.random() - 0.5) * 170, z = (Math.random() - 0.5) * 170;
      if (!this.game.free(x, z, 1.5) || Math.hypot(x - p.x, z - p.z) < minDist) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(-80, 0, -80);
  }

  spawn(aggro) { this.list.push(new Zombie(this, this.randomSpawn(aggro ? 35 : 25), aggro, this.wave)); }
  startWave(n) { this.wave = n; this.queue = 5 + (n - 1) * 3; this.spawnT = 0; }
  alive() { return this.list.filter(z => !z.dead).length; }
  waveCleared() { return this.queue === 0 && !this.list.some(z => z.isWave && !z.dead); }
  hitMeshes() { const a = []; for (const z of this.list) if (!z.dead) for (const m of z.parts) a.push(m); return a; }

  update(dt) {
    if (this.queue > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.alive() < 40) { this.spawn(true); this.queue--; this.spawnT = 0.7; }
    }
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 5;
      if (this.list.filter(z => !z.isWave && !z.dead).length < 5) this.spawn(false);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].update(dt)) { this.game.scene.remove(this.list[i].group); this.list.splice(i, 1); }
    }
  }
}
