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

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  createdBy: String,
  createdAt: { type: Date, default: Date.now }
});
const Group = mongoose.model('Group', groupSchema);

const messageSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  name: String,
  text: String,
  attachment: { url: String, type: String },
  time: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

mongoose.connection.once('open', async () => {
  const count = await Group.countDocuments();
  if (count === 0) {
    await Group.create({ name: 'Nhóm chung', createdBy: 'system' });
    console.log('Đã tạo nhóm mặc định: Nhóm chung');
  }
});

// ---- Cloudinary ----
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: '4-anh-tay-chat',
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

// ---- Auth helpers ----
function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
    const user = await User.findOne({ token });
    if (!user) return res.status(401).json({ error: 'Phiên hết hạn' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
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

// ---- Groups API ----
app.get('/api/groups', requireAuth, async (req, res) => {
  const groups = await Group.find().sort({ createdAt: 1 }).lean();
  res.json(groups);
});

app.post('/api/groups', requireAuth, async (req, res) => {
  const name = (req.body.name || '').toString().trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Tên nhóm không được để trống' });
  const group = await Group.create({ name, createdBy: req.user.username });
  res.json(group);
});

// ---- Realtime ----
io.on('connection', (socket) => {
  socket.on('auth', async (token) => {
    try {
      const user = await User.findOne({ token });
      if (!user) {
        socket.emit('authError', 'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại.');
        return;
      }
      socket.data.name = user.username;
      socket.emit('authOk', { username: user.username });
    } catch (err) {
      socket.emit('authError', 'Lỗi kết nối máy chủ.');
    }
  });

  socket.on('joinGroup', async (groupId) => {
    if (!socket.data.name) return;
    try {
      if (socket.data.currentGroup) {
        socket.leave(`group:${socket.data.currentGroup}`);
      }
      socket.data.currentGroup = groupId;
      socket.join(`group:${groupId}`);
      const history = await Message.find({ groupId }).sort({ time: 1 }).limit(200).lean();
      socket.emit('groupHistory', { groupId, messages: history });
    } catch (err) {
      // groupId không hợp lệ, bỏ qua
    }
  });

  socket.on('chatMessage', async (msg) => {
    const name = socket.data.name;
    const groupId = socket.data.currentGroup;
    if (!name || !groupId) return;
    const entry = {
      groupId,
      name,
      text: (msg.text || '').toString().slice(0, 2000),
      attachment: msg.attachment || null,
      time: new Date()
    };
    const saved = await Message.create(entry);
    io.to(`group:${groupId}`).emit('message', saved.toObject());
  });

  socket.on('typing', (isTyping) => {
    const name = socket.data.name;
    const groupId = socket.data.currentGroup;
    if (name && groupId) {
      socket.to(`group:${groupId}`).emit('typing', { name, isTyping });
    }
  });
});

server.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
