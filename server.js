// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Basit bir HTTP sunucusu (index.html servisi için)
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    const filePath = path.join(__dirname, 'public', 'index.html');
    const fileStream = fs.createReadStream(filePath);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fileStream.pipe(res);
  }
});

// WebSocket sunucusunu HTTP sunucusuna bağlıyoruz
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Bir kullanıcı bağlandı.');

  ws.on('message', (message) => {
    console.log(`Gelen mesaj: ${message}`);

    // Diğer istemcilere gönder
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.send('Sohbete hoş geldin!');
});

server.listen(3000, () => {
  console.log('Sunucu çalışıyor: http://localhost:3000');
});
