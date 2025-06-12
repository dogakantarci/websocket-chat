const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));  // 'public' klasöründeki dosyaları servis eder

const users = new Map();

function broadcastUserList() {
  const userList = Array.from(users.keys());
  const message = JSON.stringify({
    type: 'userList',
    users: userList,
  });

  for (const ws of users.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

wss.on('connection', (ws) => {
  let currentUsername = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'register':
          if (typeof data.username === 'string' && data.username.trim()) {
            currentUsername = data.username.trim();
            users.set(currentUsername, ws);
            console.log(`📥 ${currentUsername} bağlandı.`);
            broadcastUserList();
          }
          break;

        case 'privateMessage':
          const { to, from, message: msg } = data;
          if (to && users.has(to) && users.get(to).readyState === WebSocket.OPEN) {
            users.get(to).send(JSON.stringify({
              type: 'privateMessage',
              from,
              message: msg,
            }));
          }
          break;

        default:
          console.log('Bilinmeyen mesaj türü:', data.type);
      }
    } catch (err) {
      console.error('Mesaj işlenirken hata:', err);
    }
  });

  ws.on('close', () => {
    if (currentUsername) {
      users.delete(currentUsername);
      console.log(`📤 ${currentUsername} ayrıldı.`);
      broadcastUserList();
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
