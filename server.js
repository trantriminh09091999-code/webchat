const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Database ----
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Đã kết nối MongoDB'))
  .catch((err) => console.error('Lỗi kết nối MongoDB:', err.message));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  token: { type: String, default: null }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  name: String,
  text: String,
  attachment: { url: String, type: String },
  time: { type: Date, default: Date.now },
  system: { type: Boolean, default: false }
});
const Message = mongoose.model('Message', messageSchema);

// ---- Cloudinary ----
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'rom-ra-chat',
    resource_type: 'auto',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov']
  }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file' });
  const isVideo = req.file.mimetype.startsWith('video');
  res.json({ url: req.file.path, type: isVideo ? 'video' : 'image' });
});

// ---- Auth ----
function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

app.post('/api/register', async (req, res) => {
  try {
    const username = (req.body.username || '').toString().trim().slice(0, 24);
    const password = (req.body.password || '').toString();
    if (!username || !password) return res.status(400).json({ error: 'Thiếu tên hoặc mật khẩu' });
    if (password.length < 4) return res.status(400).json({ error: 'Mật khẩu tối thiểu 4 ký tự' });

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: 'Tên tài khoản đã tồn tại' });

    const passwordHash = await bcrypt.hash(password, 10);
    const token = makeToken();
    await User.create({ username, passwordHash, token });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = (req.body.username || '').toString().trim();
    const password = (req.body.password || '').toString();
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Sai tên hoặc mật khẩu' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Sai tên hoặc mật khẩu' });
    const token = makeToken();
    user.token = token;
    await user.save();
    res.json({ token, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

app.get('/api/me', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
    const user = await User.findOne({ token });
    if (!user) return res.status(401).json({ error: 'Phiên hết hạn' });
    res.json({ username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// ---- Realtime ----
const onlineUsers = {}; // socket.id -> name

function broadcastUserList() {
  io.emit('userList', Object.values(onlineUsers));
}

io.on('connection', (socket) => {
  socket.on('join', async (token) => {
    try {
      const user = await User.findOne({ token });
      if (!user) {
        socket.emit('authError', 'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại.');
        return;
      }
      const name = user.username;
      socket.data.name = name;
      onlineUsers[socket.id] = name;

      const history = await Message.find().sort({ time: 1 }).limit(200).lean();
      socket.emit('history', history);
      broadcastUserList();
      socket.broadcast.emit('message', await systemMsg(`${name} đã tham gia phòng chat`));
    } catch (err) {
      socket.emit('authError', 'Lỗi kết nối máy chủ.');
    }
  });

  socket.on('chatMessage', async (msg) => {
    const name = socket.data.name;
    if (!name) return;
    const entry = {
      name,
      text: (msg.text || '').toString().slice(0, 2000),
      attachment: msg.attachment || null,
      time: new Date(),
      system: false
    };
    const saved = await Message.create(entry);
    io.emit('message', saved.toObject());
  });

  socket.on('typing', (isTyping) => {
    const name = socket.data.name;
    if (name) socket.broadcast.emit('typing', { name, isTyping });
  });

  socket.on('disconnect', async () => {
    const name = socket.data.name;
    if (name) {
      delete onlineUsers[socket.id];
      broadcastUserList();
      io.emit('message', await systemMsg(`${name} đã rời phòng chat`));
    }
  });
});

async function systemMsg(text) {
  const entry = { name: 'Hệ thống', text, attachment: null, time: new Date(), system: true };
  const saved = await Message.create(entry);
  return saved.toObject();
}

server.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
