import * as THREE from 'three';
import { UI } from './ui.js';
import { sfx } from './weapons.js';

export class Multiplayer {
  constructor(game) {
    this.game = game; this.socket = null; this.room = null;
    this.myId = null; this.myName = 'Survivor';
    this.remotes = new Map(); this.tracers = []; this.sendT = 0;
  }

  get active() { return !!(this.socket && this.socket.connected && this.room); }

  connect() {
    return new Promise(resolve => {
      if (typeof io === 'undefined') return resolve(false);
      if (this.socket && this.socket.connected) return resolve(true);
      let done = false;
      const fin = v => { if (!done) { done = true; if (!v && this.socket) { this.socket.close(); this.socket = null; } resolve(v); } };
      const opts = { reconnection: false, timeout: 4000 };
      const s = window.NIGHTOPS_SERVER ? io(window.NIGHTOPS_SERVER, opts) : io(opts);
      this.socket = s;
      s.on('connect', () => fin(true));
      s.on('connect_error', () => fin(false));
      setTimeout(() => fin(s.connected), 4500);
      s.on('playerJoined', p => { this.addRemote(p); this.refresh(); UI.message(p.name + ' joined', 2000); });
      s.on('playerLeft', id => { this.removeRemote(id); this.refresh(); });
      s.on('state', st => {
        const r = this.remotes.get(st.id);
        if (r) { r.tp.set(st.x, st.y, st.z); r.tyaw = st.yaw; r.tpitch = st.pitch; }
      });
      s.on('shoot', d => this.remoteShoot(d));
      s.on('disconnect', () => {
        if (this.room) { UI.message('Server disconnected - continuing solo', 4000); this.cleanup(); }
      });
    });
  }

  async createRoom(name) {
    this.myName = name;
    if (!(await this.connect())) return { ok: false, error: 'Multiplayer server unavailable. Run "npm start" and open localhost:3000, or play Solo.' };
    return new Promise(res => this.socket.emit('createRoom', { name }, r => this.joined(r, res)));
  }

  async joinRoom(code, name) {
    this.myName = name;
    if (!(await this.connect())) return { ok: false, error: 'Multiplayer server unavailable. Run "npm start" and open localhost:3000, or play Solo.' };
    return new Promise(res => this.socket.emit('joinRoom', { code, name }, r => this.joined(r, res)));
  }

  joined(r, res) {
    if (r && r.ok) {
      this.room = r.code; this.myId = r.id;
      r.players.forEach(p => { if (p.id !== this.myId) this.addRemote(p); });
      this.refresh();
    }
    res(r || { ok: false, error: 'No response from server' });
  }

  refresh() {
    if (!this.room) return;
    const names = [this.myName + ' (you)'];
    this.remotes.forEach(r => names.push(r.name));
    UI.setRoom(this.room, names);
  }

  addRemote(p) {
    if (this.remotes.has(p.id)) return;
    let h = 0; for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) % 360;
    const col = new THREE.Color().setHSL(h / 360, 0.5, 0.45);
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 });
    const add = (w, hh, d, x, y, z, m) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh; };
    add(0.6, 0.9, 0.32, 0, 1.15, 0, mat);
    add(0.5, 0.75, 0.25, 0, 0.38, 0, new THREE.MeshStandardMaterial({ color: 0x2a2f38 }));
    const head = add(0.32, 0.32, 0.32, 0, 1.75, 0, new THREE.MeshStandardMaterial({ color: 0xc9a07c }));
    add(0.08, 0.1, 0.55, 0.3, 1.3, -0.35, new THREE.MeshStandardMaterial({ color: 0x222222 }));
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d'); x.font = 'bold 34px Arial'; x.textAlign = 'center';
    x.lineWidth = 6; x.strokeStyle = '#000'; x.strokeText(p.name, 128, 44); x.fillStyle = '#fff'; x.fillText(p.name, 128, 44);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    spr.scale.set(2, 0.5, 1); spr.position.y = 2.4; spr.renderOrder = 10;
    g.add(spr);
    g.position.set(0, 0, 20);
    this.game.scene.add(g);
    this.remotes.set(p.id, { name: p.name, g, head, tp: new THREE.Vector3(0, 0, 20), tyaw: 0, tpitch: 0, first: true });
  }

  removeRemote(id) {
    const r = this.remotes.get(id);
    if (r) { this.game.scene.remove(r.g); this.remotes.delete(id); }
  }

  sendShoot(o, e, w) {
    if (!this.active) return;
    this.socket.emit('shoot', { o: [o.x, o.y, o.z], e: [e.x, e.y, e.z], w });
  }

  remoteShoot(d) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...d.o), new THREE.Vector3(...d.e)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.9 }));
    this.game.scene.add(line);
    this.tracers.push({ line, life: 0.1 });
    this.game.emit(new THREE.Vector3(...d.e), 'spark', 3, 3, 0.25);
    sfx(d.w === 2 ? 200 : 380, 0.1, 0.06, 'square');
  }

  update(dt, playing) {
    this.remotes.forEach(r => {
      if (r.first) { r.g.position.copy(r.tp); r.first = false; }
      r.g.position.lerp(r.tp, Math.min(1, dt * 10));
      let dy = r.tyaw - r.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      r.g.rotation.y += dy * Math.min(1, dt * 12);
      r.head.rotation.x = r.tpitch;
    });
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]; t.life -= dt;
      if (t.life <= 0) { this.game.scene.remove(t.line); t.line.geometry.dispose(); this.tracers.splice(i, 1); }
    }
    if (playing && this.active) {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 1 / 15;
        const p = this.game.player;
        this.socket.volatile.emit('state', { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch });
      }
    }
  }

  cleanup() {
    this.remotes.forEach(r => this.game.scene.remove(r.g));
    this.remotes.clear(); this.room = null; this.socket = null; UI.setRoom(null);
  }

  leave() {
    if (this.socket) { const s = this.socket; this.socket = null; this.room = null; s.disconnect(); }
    this.cleanup();
  }
}
