const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use('/three', express.static(path.join(__dirname, 'node_modules', 'three')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/js', express.static(__dirname)); // fallback: works even if JS files were saved next to server.js
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = {};
const MAX_PLAYERS = 4;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode() {
  let s;
  do { s = ''; for (let i = 0; i < 4; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)]; } while (rooms[s]);
  return s;
}
const cleanName = n => String(n || 'Survivor').replace(/[^\w \-]/g, '').trim().slice(0, 12) || 'Survivor';
const num = v => (Number.isFinite(+v) ? +v : 0);
const vec = a => (Array.isArray(a) ? a.slice(0, 3).map(num) : [0, 0, 0]);

io.on('connection', socket => {
  let room = null;

  function join(code, name, cb) {
    room = code;
    socket.join(code);
    rooms[code].players[socket.id] = { id: socket.id, name };
    socket.to(code).emit('playerJoined', { id: socket.id, name });
    cb({ ok: true, code, id: socket.id, players: Object.values(rooms[code].players) });
  }
  function leave() {
    if (!room) return;
    const r = rooms[room];
    if (r) {
      delete r.players[socket.id];
      socket.to(room).emit('playerLeft', socket.id);
      if (!Object.keys(r.players).length) delete rooms[room];
    }
    socket.leave(room);
    room = null;
  }

  socket.on('createRoom', (d, cb) => {
    if (typeof cb !== 'function') return;
    leave();
    const code = newCode();
    rooms[code] = { players: {} };
    join(code, cleanName(d && d.name), cb);
  });

  socket.on('joinRoom', (d, cb) => {
    if (typeof cb !== 'function') return;
    leave();
    const code = String((d && d.code) || '').toUpperCase().trim();
    const r = rooms[code];
    if (!r) return cb({ ok: false, error: 'Room not found' });
    if (Object.keys(r.players).length >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full (4/4)' });
    join(code, cleanName(d && d.name), cb);
  });

  socket.on('state', s => {
    if (!room || !s) return;
    socket.to(room).volatile.emit('state', { id: socket.id, x: num(s.x), y: num(s.y), z: num(s.z), yaw: num(s.yaw), pitch: num(s.pitch) });
  });

  socket.on('shoot', d => {
    if (!room || !d) return;
    socket.to(room).emit('shoot', { id: socket.id, o: vec(d.o), e: vec(d.e), w: num(d.w) });
  });

  socket.on('disconnect', leave);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NIGHT OPS: SURVIVAL running at http://localhost:${PORT}`));
