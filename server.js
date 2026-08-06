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

process.on('uncaughtException', (err) => console.error('LỖI KHÔNG BẮT ĐƯỢC:', err));
process.on('unhandledRejection', (err) => console.error('PROMISE LỖI:', err));

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 2 * 1024 * 1024,
  pingTimeout: 20000,
  pingInterval: 25000
});
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
  attachment: { url: String, type: String, name: String },
  time: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

mongoose.connection.once('open', async () => {
  try {
    if ((await Group.countDocuments()) === 0) {
      await Group.create({ name: 'Nhóm chung', createdBy: 'system' });
    }
  } catch (err) {
    console.error('Lỗi tạo nhóm mặc định:', err.message);
  }
});

const hasCloudinaryConfig = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (_req, file) => ({
    folder: 'webchat-media',
    resource_type: 'auto',
    public_id: `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov']
  })
});

const allowedMimeTypes = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime'
]);

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error('Chỉ hỗ trợ JPG, PNG, GIF, WEBP, MP4, WEBM hoặc MOV.'));
    }
    cb(null, true);
  }
});

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
    const user = await User.findOne({ token });
    if (!user) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
    req.user = user;
    next();
  } catch (_err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
}

app.post('/upload', requireAuth, (req, res) => {
  if (!hasCloudinaryConfig) {
    return res.status(503).json({ error: 'Máy chủ chưa cấu hình nơi lưu ảnh và video.' });
  }
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Gửi file thất bại' });
    if (!req.file) return res.status(400).json({ error: 'Không có file' });
    const isVideo = req.file.mimetype.startsWith('video/');
    res.json({
      url: req.file.path,
      type: isVideo ? 'video' : 'image',
      name: String(req.file.originalname || '').slice(0, 120)
    });
  });
});

app.post('/api/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().slice(0, 24);
    const password = String(req.body.password || '');
    if (!/^[\p{L}\p{N}_. -]{2,24}$/u.test(username)) {
      return res.status(400).json({ error: 'Tên tài khoản cần từ 2–24 ký tự.' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự.' });
    if (await User.findOne({ username })) return res.status(400).json({ error: 'Tên tài khoản đã tồn tại.' });

    const token = makeToken();
    await User.create({ username, passwordHash: await bcrypt.hash(password, 10), token });
    res.json({ token, username });
  } catch (err) {
    console.error('Lỗi đăng ký:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(400).json({ error: 'Sai tên hoặc mật khẩu.' });
    }
    user.token = makeToken();
    await user.save();
    res.json({ token: user.token, username: user.username });
  } catch (err) {
    console.error('Lỗi đăng nhập:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

app.get('/api/me', requireAuth, (req, res) => res.json({ username: req.user.username }));

app.get('/api/groups', requireAuth, async (_req, res) => {
  try {
    res.json(await Group.find().sort({ createdAt: 1 }).lean());
  } catch (_err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

app.post('/api/groups', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Tên nhóm không được để trống.' });
    const group = await Group.create({ name, createdBy: req.user.username });
    io.emit('groupsChanged');
    res.json(group);
  } catch (_err) {
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

const onlineUsers = new Map();
function onlineSnapshot() {
  const counts = new Map();
  for (const username of onlineUsers.values()) {
    counts.set(username, (counts.get(username) || 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => a.localeCompare(b, 'vi'));
}
function broadcastPresence() {
  io.emit('presence', { users: onlineSnapshot() });
}

io.on('connection', (socket) => {
  socket.on('auth', async (token) => {
    try {
      const user = await User.findOne({ token });
      if (!user) return socket.emit('authError', 'Phiên đăng nhập không hợp lệ.');
      socket.data.name = user.username;
      onlineUsers.set(socket.id, user.username);
      socket.emit('authOk', { username: user.username });
      broadcastPresence();
    } catch (_err) {
      socket.emit('authError', 'Lỗi kết nối máy chủ.');
    }
  });

  socket.on('joinGroup', async (groupId) => {
    if (!socket.data.name || !mongoose.isValidObjectId(groupId)) return;
    try {
      if (socket.data.currentGroup) socket.leave(`group:${socket.data.currentGroup}`);
      socket.data.currentGroup = String(groupId);
      socket.join(`group:${groupId}`);
      const history = await Message.find({ groupId }).sort({ time: -1 }).limit(200).lean();
      socket.emit('groupHistory', { groupId: String(groupId), messages: history.reverse() });
    } catch (err) {
      console.error('Lỗi joinGroup:', err.message);
    }
  });

  socket.on('chatMessage', async (msg = {}) => {
    try {
      const name = socket.data.name;
      const groupId = socket.data.currentGroup;
      if (!name || !groupId) return;
      const text = String(msg.text || '').trim().slice(0, 2000);
      const attachment = msg.attachment && ['image', 'video'].includes(msg.attachment.type)
        ? {
            url: String(msg.attachment.url || '').slice(0, 1000),
            type: msg.attachment.type,
            name: String(msg.attachment.name || '').slice(0, 120)
          }
        : null;
      if (!text && !attachment) return;

      const saved = await Message.create({ groupId, name, text, attachment, time: new Date() });
      io.to(`group:${groupId}`).emit('message', saved.toObject());
    } catch (err) {
      console.error('Lỗi gửi tin nhắn:', err.message);
      socket.emit('sendError', 'Tin nhắn chưa gửi được.');
    }
  });

  socket.on('typing', (isTyping) => {
    const { name, currentGroup } = socket.data;
    if (name && currentGroup) {
      socket.to(`group:${currentGroup}`).emit('typing', { name, isTyping: Boolean(isTyping) });
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    broadcastPresence();
  });
});

app.use((err, _req, res, _next) => {
  console.error('Lỗi Express:', err);
  res.status(500).json({ error: 'Đã có lỗi xảy ra, vui lòng thử lại.' });
});

server.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
