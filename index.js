const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');

const app = express();
const httpServer = createServer(app);
const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

const rooms = new Map();

function genId() {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += c[Math.floor(Math.random() * c.length)];
  return id;
}

function send(ws, type, payload) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type, payload, t: Date.now() }));
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok', rooms: rooms.size }));

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  
  ws.on('message', (raw) => {
    try {
      const { type, payload } = JSON.parse(raw);
      
      if (type === 'lua:join') {
        const rid = (payload.roomId || '').toUpperCase();
        let room = rooms.get(rid);
        if (!room) { room = { lua: null, viewers: new Set(), lastFrame: null }; rooms.set(rid, room); }
        if (room.lua && room.lua !== ws) room.lua.close();
        room.lua = ws; ws.clientType = 'lua'; ws.roomId = rid;
        send(ws, 'joined', { roomId: rid, role: 'lua' });
        room.viewers.forEach(v => send(v, 'lua:connected', { roomId: rid }));
      }
      else if (type === 'lua:frame') {
        const room = rooms.get(ws.roomId || '');
        if (!room) return;
        room.lastFrame = payload.frame;
        room.viewers.forEach(v => send(v, 'viewer:frame', { frame: payload.frame }));
      }
      else if (type === 'viewer:join') {
        const rid = (payload.roomId || '').toUpperCase();
        let room = rooms.get(rid);
        if (!room) { room = { lua: null, viewers: new Set(), lastFrame: null }; rooms.set(rid, room); }
        room.viewers.add(ws); ws.clientType = 'viewer'; ws.roomId = rid;
        send(ws, 'joined', { roomId: rid, role: 'viewer', hasLua: room.lua !== null, viewers: room.viewers.size });
        if (room.lastFrame) send(ws, 'viewer:frame', { frame: room.lastFrame });
      }
      else if (type === 'viewer:command') {
        const room = rooms.get(ws.roomId || '');
        if (room && room.lua) send(room.lua, 'lua:command', payload);
      }
    } catch(e) {}
  });
  
  ws.on('close', () => {
    const room = rooms.get(ws.roomId || '');
    if (!room) return;
    if (ws.clientType === 'lua') { room.lua = null; room.lastFrame = null; room.viewers.forEach(v => send(v, 'lua:disconnected', {})); }
    else room.viewers.delete(ws);
  });
});

setInterval(() => { wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }); }, 30000);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => console.log('Server on', PORT));
