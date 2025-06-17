const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

const users = new Map();
// Her kullanıcı için aktif chat session'ları tut
const chatSessions = new Map();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_USERNAME = 'AI Assistant';

// Gemini Chat Session oluştur
function createChatSession(username) {
  return {
    history: [],
    model: 'gemini-1.5-flash',
    systemInstruction: `Sen arkadaş canlısı bir AI asistanısın ve şu anda ${username} ile sohbet ediyorsun. 
    
    Kişilik özeliklerin:
    - Samimi ve sıcakkanlı
    - Esprili ama saygılı
    - Türkçe konuşuyorsun
    - Kısa ve öz cevaplar vermeyi tercih ediyorsun
    - Kullanıcının ismini bazen kullanabilirsin ama abartma
    - Emoji kullanmayı seviyorsun ama abartmıyorsun
    - Doğal ve akıcı konuşma yaparsın
    
    Önemli: 
    - Her zaman akıcı bir sohbet sürdürmeye odaklan, robotik cevaplar verme
    - İsim kullanırken doğal ol, her cümlede kullanıcının ismini söyleme
    - Kullanıcının ismini sadece gerekli olduğunda veya samimi anlar için kullan`,
    createdAt: new Date()
  };
}

function getChatSession(username) {
  if (!chatSessions.has(username)) {
    chatSessions.set(username, createChatSession(username));
  }
  return chatSessions.get(username);
}

async function sendToGemini(messages, systemInstruction) {
  try {
    const contents = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: contents,
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        generationConfig: {
          temperature: 0.9,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH", 
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );

    return response.data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Gemini API Hatası:', error.response?.data || error.message);
    throw error;
  }
}

async function getAIResponse(userMessage, username) {
  try {
    const session = getChatSession(username);
    
    // Kullanıcı mesajını geçmişe ekle
    session.history.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    });

    // Gemini'ye gönder
    const aiResponse = await sendToGemini(session.history, session.systemInstruction);
    
    // AI cevabını geçmişe ekle
    session.history.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date()
    });

    // Geçmiş çok uzarsa eski mesajları sil (son 20 mesaj tut)
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }

    return aiResponse;

  } catch (error) {
    const errorMessages = [
      `Ah, şu anda biraz kafam karışık 😵 Tekrar dener misin?`,
      `Ups! Bir sorun yaşıyorum, biraz sonra tekrar konuşalım 🤖💭`,
      `Pardon, sistem biraz yavaş bugün. Hemen toparlanıyorum! ⚡`,
      `Teknik bir sorunla karşılaştım. Sabırlı olursan çok memnun olurum 🛠️`
    ];
    
    return errorMessages[Math.floor(Math.random() * errorMessages.length)];
  }
}

function broadcastUserList() {
  const userList = Array.from(users.keys());
  if (!userList.includes(AI_USERNAME)) {
    userList.push(AI_USERNAME);
  }
  
  const message = JSON.stringify({
    type: 'userList',
    users: userList
  });

  for (const ws of users.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

wss.on('connection', (ws) => {
  let currentUsername = null;

  ws.on('message', async (message) => {
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
          
          if (to === AI_USERNAME) {
            console.log(`🤖 ${from} → AI: ${msg}`);
            
            try {
              const aiResponse = await getAIResponse(msg, from);
              
              // Cevabı gönder
              if (users.has(from)) {
                users.get(from).send(JSON.stringify({
                  type: 'privateMessage',
                  from: AI_USERNAME,
                  message: aiResponse
                }));
              }
              
              console.log(`🤖 AI → ${from}: ${aiResponse.substring(0, 50)}...`);
              
            } catch (error) {
              console.error(`AI Response Error for ${from}:`, error);
            }
          }
          else if (to && users.has(to) && users.get(to).readyState === WebSocket.OPEN) {
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
      
      // 30 dakika sonra session'ı temizle (bellek yönetimi)
      setTimeout(() => {
        if (chatSessions.has(currentUsername) && !users.has(currentUsername)) {
          chatSessions.delete(currentUsername);
          console.log(`🧹 ${currentUsername} session temizlendi (timeout).`);
        }
      }, 30 * 60 * 1000);
    }
  });
});

// Periyodik temizlik (her saat çalışır)
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;
  
  for (const [username, session] of chatSessions.entries()) {
    // 2 saat boyunca aktif olmayan session'ları temizle
    const timeDiff = now - session.createdAt;
    if (timeDiff > 2 * 60 * 60 * 1000 && !users.has(username)) {
      chatSessions.delete(username);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 ${cleanedCount} eski chat session temizlendi.`);
  }
  
  console.log(`📊 Aktif: ${users.size} kullanıcı, ${chatSessions.size} chat session`);
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Chat Sunucusu ${PORT} portunda çalışıyor!`);
  console.log(`🤖 AI Assistant hazır!`);
});