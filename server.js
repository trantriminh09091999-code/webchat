const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --- File upload setup (images / videos) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|webm|mov|ogg/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Định dạng file không được hỗ trợ'), ok);
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file' });
  res.json({
    url: '/uploads/' + req.file.filename,
    type: req.file.mimetype.startsWith('video') ? 'video' : 'image'
  });
});

// --- In-memory state ---
const MAX_HISTORY = 200;
let history = [];
const users = {}; // socket.id -> name

function broadcastUserList() {
  io.emit('userList', Object.values(users));
}

io.on('connection', (socket) => {
  socket.on('join', (name) => {
    const clean = (name || 'Ẩn danh').toString().slice(0, 24).trim() || 'Ẩn danh';
    users[socket.id] = clean;
    socket.emit('history', history);
    broadcastUserList();
    socket.broadcast.emit('message', systemMsg(`${clean} đã tham gia phòng chat`));
  });

  socket.on('chatMessage', (msg) => {
    const name = users[socket.id] || 'Ẩn danh';
    const entry = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      name,
      text: (msg.text || '').toString().slice(0, 2000),
      attachment: msg.attachment || null, // { url, type }
      time: new Date().toISOString(),
      system: false
    };
    history.push(entry);
    if (history.length > MAX_HISTORY) history.shift();
    io.emit('message', entry);
  });

  socket.on('typing', (isTyping) => {
    const name = users[socket.id];
    if (name) socket.broadcast.emit('typing', { name, isTyping });
  });

  socket.on('disconnect', () => {
    const name = users[socket.id];
    if (name) {
      delete users[socket.id];
      broadcastUserList();
      io.emit('message', systemMsg(`${name} đã rời phòng chat`));
    }
  });
});

function systemMsg(text) {
  return {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    name: 'Hệ thống',
    text,
    attachment: null,
    time: new Date().toISOString(),
    system: true
  };
}

server.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
