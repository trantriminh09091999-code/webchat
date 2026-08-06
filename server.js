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
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());
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
  members: { type: [String], default: [] },
  nicknames: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now }
});
const Group = mongoose.model('Group', groupSchema);

const messageSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  name: String,
  text: String,
  attachment: { url: String, type: String },
  pinned: { type: Boolean, default: false },
  time: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

mongoose.connection.once('open', async () => {
  try {
    const count = await Group.countDocuments();
    if (count === 0) {
      await Group.create({ name: 'Nhóm chung', createdBy: 'system', members: [] });
      console.log('Đã tạo nhóm mặc định: Nhóm chung');
    }
    const broken = await Group.find({ members: { $exists: false } });
    for (const g of broken) {
      g.members = g.createdBy && g.createdBy !== 'system' ? [g.createdBy] : [];
      g.nicknames = g.nicknames || {};
      await g.save();
    }
    if (broken.length) console.log(`Đã vá dữ liệu cho ${broken.length} nhóm cũ`);
  } catch (err) {
    console.error('Lỗi tạo/vá nhóm:', err.message);
  }
});

const hasCloudinaryConfig =
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;
if (!hasCloudinaryConfig) console.error('THIẾU biến môi trường Cloudinary!');

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

app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('Lỗi upload file:', err.message);
      return res.status(400).json({ error: 'Gửi file thất bại: ' + err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'Không có file' });
    const isVideo = req.file.mimetype.startsWith('video');
    res.json({ url: req.file.path, type: isVideo ? 'video' : 'image' });
  });
});

function makeToken() { return crypto.randomBytes(24).toString('hex'); }

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

app.get('/api/groups', requireAuth, async (req, res) => {
  try {
    const groups = await Group.find().sort({ createdAt: 1 }).lean();
    res.json(groups);
  } catch (err) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});

app.get('/api/groups/:id', requireAuth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id).lean();
    if (!group) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    res.json(group);
  } catch (err) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});

app.post('/api/groups', requireAuth, async (req, res) => {
  try {
    const name = (req.body.name || '').toString().trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Tên nhóm không được để trống' });
    const group = await Group.create({ name, createdBy: req.user.username, members: [req.user.username] });
    io.emit('groupCreated', group);
    res.json(group);
  } catch (err) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});

app.delete('/api/groups/:id', requireAuth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    if (group.createdBy !== req.user.username) {
      return res.status(403).json({ error: 'Chỉ người tạo nhóm mới được xóa nhóm' });
    }
    await Message.deleteMany({ groupId: group._id });
    const groupIdStr = String(group._id);
    await group.deleteOne();
    io.emit('groupDeleted', groupIdStr);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});

app.post('/api/groups/:id/leave', requireAuth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    group.members = group.members.filter((m) => m !== req.user.username);
    await group.save();
    io.emit('groupUpdated', group);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});

app.post('/api/groups/:id/members', requireAuth, async (req, res) => {
  try {
    const username = (req.body.username || '').toString().trim();
    if (!username) return res.status(400).json({ error: 'Thiếu tên thành viên' });
    const targetUser = await User.findOne({ username });
    if (!targetUser) return res.status(404).json({ error: 'Không tìm thấy tài khoản này' });
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    if (!group.members.includes(username)) group.members.push(username);
    await group.save();
    io.emit('groupUpdated', group);
    res.json(group);
  } catch (err) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});

app.delete('/api/groups/:id/members/:username', requireAuth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    const isSelf = req.params.username === req.user.username;
    const isOwner = group.createdBy === req.user.username;
    if (!isSelf && !isOwner) return res.status(403).json({ error: 'Không có quyền' });
    group.members = group.members.filter((m) => m !== req.params.username);
    await group.save();
    io.emit('groupUpdated', group);
    res.json(group);
  } catch (err) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});

app.post('/api/groups/:id/nickname', requireAuth, async (req, res) => {
  try {
    const nickname = (req.body.nickname || '').toString().trim().slice(0, 24);
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    const nicknames = { ...(group.nicknames || {}) };
    if (nickname) nicknames[req.user.username] = nickname;
    else delete nicknames[req.user.username];
    group.nicknames = nicknames;
    group.markModified('nicknames');
    await group.save();
    io.emit('groupUpdated', group);
    res.json(group);
  } catch (err) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});

app.get('/api/groups/:id/media', requireAuth, async (req, res) => {
  try {
    const media = await Message.find({ groupId: req.params.id, attachment: { $ne: null } })
      .sort({ time: -1 }).limit(100).lean();
    res.json(media);
  } catch (err) { res.status(500).json({ error: 'Lỗi máy chủ' }); }
});

io.on('connection', (socket) => {
  socket.on('auth', async (token) => {
    try {
      const user = await User.findOne({ token });
      if (!user) { socket.emit('authError', 'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại.'); return; }
      socket.data.name = user.username;
      socket.emit('authOk', { username: user.username });
    } catch (err) { socket.emit('authError', 'Lỗi kết nối máy chủ.'); }
  });

  socket.on('joinGroup', async (groupId) => {
    if (!socket.data.name) return;
    try {
      if (socket.data.currentGroup) socket.leave(`group:${socket.data.currentGroup}`);
      socket.data.currentGroup = groupId;
      socket.join(`group:${groupId}`);
      const history = await Message.find({ groupId }).sort({ time: 1 }).limit(200).lean();
      socket.emit('groupHistory', { groupId, messages: history });
    } catch (err) { console.error('Lỗi joinGroup:', err.message); }
  });

  socket.on('chatMessage', async (msg) => {
    try {
      const name = socket.data.name;
      const groupId = socket.data.currentGroup;
      if (!name || !groupId) return;
      const entry = {
        groupId, name,
        text: (msg.text || '').toString().slice(0, 2000),
        attachment: msg.attachment || null,
        time: new Date()
      };
      const saved = await Message.create(entry);
      io.to(`group:${groupId}`).emit('message', saved.toObject());
    } catch (err) { console.error('Lỗi gửi tin nhắn:', err.message); }
  });

  socket.on('pinMessage', async ({ groupId, messageId }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg || String(msg.groupId) !== String(groupId)) return;
      msg.pinned = !msg.pinned;
      await msg.save();
      const pinned = await Message.find({ groupId, pinned: true }).sort({ time: -1 }).lean();
      io.to(`group:${groupId}`).emit('pinnedUpdate', { groupId, pinned });
    } catch (err) { console.error('Lỗi ghim tin nhắn:', err.message); }
  });

  socket.on('typing', (isTyping) => {
    const name = socket.data.name;
    const groupId = socket.data.currentGroup;
    if (name && groupId) socket.to(`group:${groupId}`).emit('typing', { name, isTyping });
  });
});

app.use((err, req, res, next) => {
  console.error('Lỗi Express không xác định:', err);
  res.status(500).json({ error: 'Đã có lỗi xảy ra, vui lòng thử lại.' });
});

server.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
