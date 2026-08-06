const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
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
app.use(express.json({ limit: '96kb' }));
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Đã kết nối MongoDB'))
  .catch((err) => console.error('Lỗi kết nối MongoDB:', err.message));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  displayName: { type: String, trim: true, default: '' },
  passwordHash: { type: String, required: true },
  token: { type: String, default: null },
  tokens: { type: [String], default: [] },
  avatarUrl: { type: String, default: '' },
  settings: {
    theme: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
    compactMode: { type: Boolean, default: false },
    sounds: { type: Boolean, default: true },
    desktopNotifications: { type: Boolean, default: false }
  },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const memberSchema = new mongoose.Schema({
  username: { type: String, required: true },
  nickname: { type: String, default: '' },
  role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
  joinedAt: { type: Date, default: Date.now }
}, { _id: false });

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  avatarUrl: { type: String, default: '' },
  createdBy: String,
  members: { type: [memberSchema], default: [] },
  leftMembers: { type: [String], default: [] },
  pinnedMessageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Group = mongoose.model('Group', groupSchema);

const attachmentSchema = new mongoose.Schema({
  url: String,
  type: { type: String, enum: ['image', 'video'] },
  name: String,
  size: Number
}, { _id: false });

const messageSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  name: String,
  displayName: String,
  avatarUrl: String,
  text: String,
  attachment: attachmentSchema,
  isMemory: { type: Boolean, default: false },
  time: { type: Date, default: Date.now, index: true }
});
const Message = mongoose.model('Message', messageSchema);

const eventSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  title: { type: String, required: true, trim: true },
  type: { type: String, enum: ['game', 'outing', 'other'], default: 'other' },
  startAt: { type: Date, required: true },
  location: { type: String, default: '' },
  note: { type: String, default: '' },
  createdBy: { type: String, required: true },
  participants: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});
const Event = mongoose.model('Event', eventSchema);

mongoose.connection.once('open', async () => {
  try {
    if ((await Group.countDocuments()) === 0) {
      await Group.create({ name: 'Nhóm chung', createdBy: 'system', members: [] });
    }
    await User.updateMany({ displayName: { $in: [null, ''] } }, [{ $set: { displayName: '$username' } }]);
  } catch (err) {
    console.error('Lỗi khởi tạo dữ liệu:', err.message);
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
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const allowedMimeTypes = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif',
  'video/mp4', 'video/webm', 'video/quicktime'
]);
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif', '.mp4', '.webm', '.mov']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!allowedMimeTypes.has(file.mimetype) && !allowedExtensions.has(extension)) {
      return cb(new Error('Chỉ hỗ trợ ảnh JPG, PNG, GIF, WEBP, AVIF, HEIC và video MP4, WEBM, MOV.'));
    }
    cb(null, true);
  }
});

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function tokenFromRequest(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

async function findUserByToken(token) {
  if (!token) return null;
  return User.findOne({ $or: [{ token }, { tokens: token }] });
}

async function requireAuth(req, res, next) {
  try {
    const token = tokenFromRequest(req);
    const user = await findUserByToken(token);
    if (!user) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
    req.user = user;
    req.authToken = token;
    next();
  } catch (_err) {
    res.status(500).json({ error: 'Lỗi máy chủ.' });
  }
}

function publicUser(user) {
  return {
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl || '',
    settings: user.settings || { theme: 'system', compactMode: false, sounds: true, desktopNotifications: false }
  };
}

function uploadBufferToCloudinary(file) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Tải file quá lâu. Hãy thử ảnh/video nhỏ hơn hoặc thử lại.'));
    }, 75000);

    const stream = cloudinary.uploader.upload_stream({
      folder: 'webchat-media',
      resource_type: 'auto',
      use_filename: true,
      unique_filename: true,
      overwrite: false
    }, (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) return reject(new Error(error.message || 'Cloudinary từ chối file.'));
      resolve(result);
    });

    stream.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    stream.end(file.buffer);
  });
}

app.get('/health', (_req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 }));

app.post('/upload', requireAuth, (req, res) => {
  if (!hasCloudinaryConfig) {
    return res.status(503).json({ error: 'Máy chủ chưa cấu hình Cloudinary.' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Không đọc được file.' });
    if (!req.file) return res.status(400).json({ error: 'Không có file.' });
    try {
      const result = await uploadBufferToCloudinary(req.file);
      const extension = path.extname(req.file.originalname || '').toLowerCase();
      const isVideo = req.file.mimetype.startsWith('video/') || ['.mp4', '.webm', '.mov'].includes(extension);
      res.json({
        url: result.secure_url || result.url,
        type: isVideo ? 'video' : 'image',
        name: String(req.file.originalname || `${isVideo ? 'video' : 'image'}-${Date.now()}`).slice(0, 120),
        size: req.file.size
      });
    } catch (uploadError) {
      console.error('Lỗi upload:', uploadError.message);
      res.status(502).json({ error: uploadError.message || 'Gửi file thất bại.' });
    }
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
    await User.create({
      username,
      displayName: username,
      passwordHash: await bcrypt.hash(password, 10),
      token,
      tokens: [token]
    });
    res.json({ token, username });
  } catch (err) {
    console.error('Lỗi đăng ký:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ.' });
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
    const token = makeToken();
    user.tokens = [...new Set([...(user.tokens || []), token])].slice(-8);
    if (!user.token) user.token = token;
    if (!user.displayName) user.displayName = user.username;
    await user.save();
    res.json({ token, username: user.username });
  } catch (err) {
    console.error('Lỗi đăng nhập:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ.' });
  }
});

app.post('/api/logout', requireAuth, async (req, res) => {
  req.user.tokens = (req.user.tokens || []).filter((token) => token !== req.authToken);
  if (req.user.token === req.authToken) req.user.token = null;
  await req.user.save();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json(publicUser(req.user)));

app.patch('/api/me/profile', requireAuth, async (req, res) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body, 'displayName')) {
      const displayName = String(req.body.displayName || '').trim().slice(0, 32);
      if (displayName.length < 2) return res.status(400).json({ error: 'Tên hiển thị cần ít nhất 2 ký tự.' });
      req.user.displayName = displayName;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'avatarUrl')) {
      req.user.avatarUrl = String(req.body.avatarUrl || '').trim().slice(0, 1000);
    }
    if (req.body.settings && typeof req.body.settings === 'object') {
      req.user.settings ||= {};
      const next = req.body.settings;
      if (['system', 'light', 'dark'].includes(next.theme)) req.user.settings.theme = next.theme;
      if (typeof next.compactMode === 'boolean') req.user.settings.compactMode = next.compactMode;
      if (typeof next.sounds === 'boolean') req.user.settings.sounds = next.sounds;
      if (typeof next.desktopNotifications === 'boolean') req.user.settings.desktopNotifications = next.desktopNotifications;
    }
    await req.user.save();
    io.emit('profileChanged', publicUser(req.user));
    res.json(publicUser(req.user));
  } catch (err) {
    console.error('Lỗi cập nhật hồ sơ:', err.message);
    res.status(500).json({ error: 'Không cập nhật được hồ sơ.' });
  }
});

function isGroupOwner(group, username) {
  if (!group) return false;
  group.members ||= [];
  return group.createdBy === username || group.members.some((member) => member.username === username && member.role === 'owner');
}

function canAccessGroup(group, username) {
  if (!group) return false;
  group.leftMembers ||= [];
  return !group.leftMembers.includes(username);
}

async function ensureMembership(group, username) {
  group.members ||= [];
  group.leftMembers ||= [];
  const exists = group.members.some((member) => member.username === username);
  if (!exists) {
    group.members.push({
      username,
      nickname: '',
      role: group.createdBy === username ? 'owner' : 'member',
      joinedAt: new Date()
    });
    group.leftMembers = group.leftMembers.filter((item) => item !== username);
    group.updatedAt = new Date();
    await group.save();
  }
}

async function getGroupOr404(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ error: 'Mã nhóm không hợp lệ.' });
    return null;
  }
  const group = await Group.findById(req.params.id);
  if (!group) {
    res.status(404).json({ error: 'Không tìm thấy nhóm.' });
    return null;
  }
  if (!canAccessGroup(group, req.user.username)) {
    res.status(403).json({ error: 'Bạn đã rời nhóm này.' });
    return null;
  }
  return group;
}

function groupSummary(group, username) {
  group.members ||= [];
  const membership = group.members.find((member) => member.username === username);
  return {
    _id: group._id,
    name: group.name,
    avatarUrl: group.avatarUrl || '',
    createdBy: group.createdBy,
    createdAt: group.createdAt,
    memberCount: group.members.length,
    isOwner: isGroupOwner(group, username),
    nickname: membership?.nickname || ''
  };
}

app.get('/api/groups', requireAuth, async (req, res) => {
  try {
    const groups = await Group.find({ leftMembers: { $ne: req.user.username } }).sort({ updatedAt: -1, createdAt: 1 });
    res.json(groups.map((group) => groupSummary(group, req.user.username)));
  } catch (_err) {
    res.status(500).json({ error: 'Không tải được danh sách nhóm.' });
  }
});

app.post('/api/groups', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Tên nhóm không được để trống.' });
    const group = await Group.create({
      name,
      createdBy: req.user.username,
      members: [{ username: req.user.username, role: 'owner', joinedAt: new Date() }],
      updatedAt: new Date()
    });
    io.emit('groupsChanged');
    res.json(groupSummary(group, req.user.username));
  } catch (_err) {
    res.status(500).json({ error: 'Không tạo được nhóm.' });
  }
});

app.get('/api/groups/:id', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    await ensureMembership(group, req.user.username);
    const usernames = group.members.map((member) => member.username);
    const users = await User.find({ username: { $in: usernames } }).lean();
    const profiles = new Map(users.map((user) => [user.username, user]));
    const members = group.members.map((member) => {
      const profile = profiles.get(member.username) || {};
      return {
        username: member.username,
        displayName: profile.displayName || member.username,
        avatarUrl: profile.avatarUrl || '',
        nickname: member.nickname || '',
        role: member.role,
        joinedAt: member.joinedAt
      };
    });
    const pinnedMessages = await Message.find({
      _id: { $in: group.pinnedMessageIds || [] },
      groupId: group._id
    }).sort({ time: -1 }).lean();
    res.json({
      group: groupSummary(group, req.user.username),
      members,
      pinnedMessages,
      myUsername: req.user.username
    });
  } catch (err) {
    console.error('Lỗi tải chi tiết nhóm:', err.message);
    res.status(500).json({ error: 'Không tải được thông tin nhóm.' });
  }
});

app.patch('/api/groups/:id', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    if (!isGroupOwner(group, req.user.username)) return res.status(403).json({ error: 'Chỉ chủ nhóm được sửa thông tin.' });
    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      const name = String(req.body.name || '').trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: 'Tên nhóm không được để trống.' });
      group.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'avatarUrl')) {
      group.avatarUrl = String(req.body.avatarUrl || '').trim().slice(0, 1000);
    }
    group.updatedAt = new Date();
    await group.save();
    io.emit('groupsChanged');
    io.to(`group:${group._id}`).emit('groupUpdated', groupSummary(group, req.user.username));
    res.json(groupSummary(group, req.user.username));
  } catch (_err) {
    res.status(500).json({ error: 'Không sửa được nhóm.' });
  }
});

app.delete('/api/groups/:id', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    if (!isGroupOwner(group, req.user.username)) return res.status(403).json({ error: 'Chỉ chủ nhóm được xóa nhóm.' });
    if (group.createdBy === 'system') return res.status(400).json({ error: 'Không thể xóa Nhóm chung.' });
    await Promise.all([
      Message.deleteMany({ groupId: group._id }),
      Event.deleteMany({ groupId: group._id }),
      group.deleteOne()
    ]);
    io.emit('groupDeleted', String(group._id));
    io.emit('groupsChanged');
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ error: 'Không xóa được nhóm.' });
  }
});

app.post('/api/groups/:id/leave', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    if (isGroupOwner(group, req.user.username)) {
      return res.status(400).json({ error: 'Chủ nhóm cần xóa nhóm hoặc chuyển quyền trước khi rời.' });
    }
    group.members = group.members.filter((member) => member.username !== req.user.username);
    group.leftMembers = [...new Set([...(group.leftMembers || []), req.user.username])];
    group.updatedAt = new Date();
    await group.save();
    io.emit('groupsChanged');
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ error: 'Không rời được nhóm.' });
  }
});

app.post('/api/groups/:id/members', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    if (!isGroupOwner(group, req.user.username)) return res.status(403).json({ error: 'Chỉ chủ nhóm được thêm thành viên.' });
    const username = String(req.body.username || '').trim();
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản này.' });
    if (!group.members.some((member) => member.username === username)) {
      group.members.push({ username, role: 'member', joinedAt: new Date() });
    }
    group.leftMembers = group.leftMembers.filter((item) => item !== username);
    group.updatedAt = new Date();
    await group.save();
    io.emit('groupsChanged');
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ error: 'Không thêm được thành viên.' });
  }
});

app.delete('/api/groups/:id/members/:username', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    if (!isGroupOwner(group, req.user.username)) return res.status(403).json({ error: 'Chỉ chủ nhóm được xóa thành viên.' });
    const username = String(req.params.username || '');
    if (username === group.createdBy) return res.status(400).json({ error: 'Không thể xóa chủ nhóm.' });
    group.members = group.members.filter((member) => member.username !== username);
    group.leftMembers = [...new Set([...(group.leftMembers || []), username])];
    group.updatedAt = new Date();
    await group.save();
    io.emit('groupsChanged');
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ error: 'Không xóa được thành viên.' });
  }
});

app.patch('/api/groups/:id/nickname', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    await ensureMembership(group, req.user.username);
    const target = String(req.body.username || req.user.username).trim();
    if (target !== req.user.username && !isGroupOwner(group, req.user.username)) {
      return res.status(403).json({ error: 'Bạn chỉ được đổi biệt danh của mình.' });
    }
    const member = group.members.find((item) => item.username === target);
    if (!member) return res.status(404).json({ error: 'Thành viên không còn trong nhóm.' });
    member.nickname = String(req.body.nickname || '').trim().slice(0, 32);
    group.updatedAt = new Date();
    await group.save();
    io.to(`group:${group._id}`).emit('groupMembersChanged');
    res.json({ ok: true, nickname: member.nickname });
  } catch (_err) {
    res.status(500).json({ error: 'Không đổi được biệt danh.' });
  }
});

app.get('/api/groups/:id/media', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    const query = { groupId: group._id, 'attachment.url': { $exists: true, $ne: '' } };
    if (req.query.memory === '1') query.isMemory = true;
    const media = await Message.find(query).sort({ time: -1 }).limit(250).lean();
    res.json(media);
  } catch (_err) {
    res.status(500).json({ error: 'Không tải được ảnh và video.' });
  }
});

app.patch('/api/groups/:id/pins/:messageId', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ error: 'Tin nhắn không hợp lệ.' });
    const message = await Message.findOne({ _id: req.params.messageId, groupId: group._id });
    if (!message) return res.status(404).json({ error: 'Không tìm thấy tin nhắn.' });
    const id = String(message._id);
    const isPinned = (group.pinnedMessageIds || []).some((item) => String(item) === id);
    group.pinnedMessageIds = isPinned
      ? group.pinnedMessageIds.filter((item) => String(item) !== id)
      : [...group.pinnedMessageIds, message._id].slice(-30);
    group.updatedAt = new Date();
    await group.save();
    io.to(`group:${group._id}`).emit('pinsChanged');
    res.json({ pinned: !isPinned });
  } catch (_err) {
    res.status(500).json({ error: 'Không ghim được tin nhắn.' });
  }
});

app.patch('/api/messages/:id/memory', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Tin nhắn không hợp lệ.' });
    const message = await Message.findById(req.params.id);
    if (!message || !message.attachment?.url) return res.status(404).json({ error: 'Không tìm thấy ảnh hoặc video.' });
    const group = await Group.findById(message.groupId);
    if (!group || !canAccessGroup(group, req.user.username)) return res.status(403).json({ error: 'Bạn không còn trong nhóm.' });
    message.isMemory = !message.isMemory;
    await message.save();
    io.to(`group:${message.groupId}`).emit('memoryChanged', { messageId: String(message._id), isMemory: message.isMemory });
    res.json({ isMemory: message.isMemory });
  } catch (_err) {
    res.status(500).json({ error: 'Không cập nhật được kỷ niệm.' });
  }
});

app.delete('/api/messages/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Tin nhắn không hợp lệ.' });
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Không tìm thấy tin nhắn.' });
    const group = await Group.findById(message.groupId);
    if (!group) return res.status(404).json({ error: 'Nhóm không còn tồn tại.' });
    if (message.name !== req.user.username && !isGroupOwner(group, req.user.username)) {
      return res.status(403).json({ error: 'Bạn không có quyền xóa tin nhắn này.' });
    }
    await message.deleteOne();
    group.pinnedMessageIds = (group.pinnedMessageIds || []).filter((item) => String(item) !== String(message._id));
    await group.save();
    io.to(`group:${message.groupId}`).emit('messageDeleted', String(message._id));
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ error: 'Không xóa được tin nhắn.' });
  }
});

app.get('/api/groups/:id/events', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    const events = await Event.find({ groupId: group._id }).sort({ startAt: 1 }).limit(100).lean();
    res.json(events);
  } catch (_err) {
    res.status(500).json({ error: 'Không tải được lịch hẹn.' });
  }
});

app.post('/api/groups/:id/events', requireAuth, async (req, res) => {
  try {
    const group = await getGroupOr404(req, res);
    if (!group) return;
    await ensureMembership(group, req.user.username);
    const title = String(req.body.title || '').trim().slice(0, 80);
    const startAt = new Date(req.body.startAt);
    const type = ['game', 'outing', 'other'].includes(req.body.type) ? req.body.type : 'other';
    if (!title || Number.isNaN(startAt.getTime())) return res.status(400).json({ error: 'Thiếu tên hoặc thời gian của lịch hẹn.' });
    const event = await Event.create({
      groupId: group._id,
      title,
      type,
      startAt,
      location: String(req.body.location || '').trim().slice(0, 120),
      note: String(req.body.note || '').trim().slice(0, 500),
      createdBy: req.user.username,
      participants: [req.user.username]
    });
    io.to(`group:${group._id}`).emit('eventsChanged');
    res.json(event);
  } catch (_err) {
    res.status(500).json({ error: 'Không tạo được lịch hẹn.' });
  }
});

app.patch('/api/events/:id/rsvp', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Lịch hẹn không hợp lệ.' });
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Lịch hẹn không tồn tại.' });
    const group = await Group.findById(event.groupId);
    if (!group || !canAccessGroup(group, req.user.username)) return res.status(403).json({ error: 'Bạn không còn trong nhóm.' });
    const joined = event.participants.includes(req.user.username);
    event.participants = joined
      ? event.participants.filter((name) => name !== req.user.username)
      : [...event.participants, req.user.username];
    await event.save();
    io.to(`group:${event.groupId}`).emit('eventsChanged');
    res.json({ joined: !joined, participants: event.participants });
  } catch (_err) {
    res.status(500).json({ error: 'Không cập nhật được tham gia.' });
  }
});

app.delete('/api/events/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Lịch hẹn không hợp lệ.' });
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Lịch hẹn không tồn tại.' });
    const group = await Group.findById(event.groupId);
    if (!group) return res.status(404).json({ error: 'Nhóm không còn tồn tại.' });
    if (event.createdBy !== req.user.username && !isGroupOwner(group, req.user.username)) {
      return res.status(403).json({ error: 'Bạn không có quyền xóa lịch hẹn.' });
    }
    await event.deleteOne();
    io.to(`group:${event.groupId}`).emit('eventsChanged');
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ error: 'Không xóa được lịch hẹn.' });
  }
});

const onlineUsers = new Map();
function onlineSnapshot() {
  const usernames = [...new Set(onlineUsers.values())];
  return usernames;
}
async function broadcastPresence() {
  try {
    const usernames = onlineSnapshot();
    const users = await User.find({ username: { $in: usernames } }).lean();
    const byName = new Map(users.map((user) => [user.username, user]));
    io.emit('presence', {
      users: usernames
        .map((username) => {
          const user = byName.get(username) || {};
          return { username, displayName: user.displayName || username, avatarUrl: user.avatarUrl || '' };
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'))
    });
  } catch (err) {
    console.error('Lỗi presence:', err.message);
  }
}

io.on('connection', (socket) => {
  socket.on('auth', async (token) => {
    try {
      const user = await findUserByToken(String(token || ''));
      if (!user) return socket.emit('authError', 'Phiên đăng nhập không hợp lệ.');
      socket.data.name = user.username;
      socket.data.displayName = user.displayName || user.username;
      socket.data.avatarUrl = user.avatarUrl || '';
      onlineUsers.set(socket.id, user.username);
      socket.emit('authOk', publicUser(user));
      broadcastPresence();
    } catch (_err) {
      socket.emit('authError', 'Lỗi kết nối máy chủ.');
    }
  });

  socket.on('joinGroup', async (groupId) => {
    if (!socket.data.name || !mongoose.isValidObjectId(groupId)) return;
    try {
      const group = await Group.findById(groupId);
      if (!group || !canAccessGroup(group, socket.data.name)) return socket.emit('sendError', 'Bạn không còn trong nhóm này.');
      await ensureMembership(group, socket.data.name);
      if (socket.data.currentGroup) socket.leave(`group:${socket.data.currentGroup}`);
      socket.data.currentGroup = String(groupId);
      socket.join(`group:${groupId}`);
      const history = await Message.find({ groupId }).sort({ time: -1 }).limit(200).lean();
      socket.emit('groupHistory', { groupId: String(groupId), messages: history.reverse() });
    } catch (err) {
      console.error('Lỗi joinGroup:', err.message);
    }
  });

  socket.on('chatMessage', async (msg = {}, ack) => {
    const reply = (payload) => { if (typeof ack === 'function') ack(payload); };
    try {
      const username = socket.data.name;
      const groupId = socket.data.currentGroup;
      if (!username || !groupId) return reply({ ok: false, error: 'Bạn chưa vào nhóm.' });
      const now = Date.now();
      if (socket.data.lastMessageAt && now - socket.data.lastMessageAt < 300) return reply({ ok: false, error: 'Bạn gửi quá nhanh.' });
      socket.data.lastMessageAt = now;

      const group = await Group.findById(groupId);
      if (!group || !canAccessGroup(group, username)) return reply({ ok: false, error: 'Bạn không còn trong nhóm.' });
      const user = await User.findOne({ username });
      if (!user) return reply({ ok: false, error: 'Không tìm thấy tài khoản.' });
      const text = String(msg.text || '').trim().slice(0, 2000);
      const attachment = msg.attachment && ['image', 'video'].includes(msg.attachment.type)
        ? {
            url: String(msg.attachment.url || '').slice(0, 1000),
            type: msg.attachment.type,
            name: String(msg.attachment.name || '').slice(0, 120),
            size: Number(msg.attachment.size || 0)
          }
        : null;
      if (!text && !attachment) return reply({ ok: false, error: 'Tin nhắn đang trống.' });

      const saved = await Message.create({
        groupId,
        name: username,
        displayName: user.displayName || username,
        avatarUrl: user.avatarUrl || '',
        text,
        attachment,
        time: new Date()
      });
      group.updatedAt = new Date();
      await group.save();
      const payload = saved.toObject();
      io.to(`group:${groupId}`).emit('message', payload);
      io.emit('groupActivity', {
        groupId: String(groupId),
        sender: username,
        displayName: user.displayName || username,
        text: text || (attachment?.type === 'video' ? 'Đã gửi một video' : 'Đã gửi một ảnh'),
        time: payload.time
      });
      reply({ ok: true, messageId: String(saved._id) });
    } catch (err) {
      console.error('Lỗi gửi tin nhắn:', err.message);
      socket.emit('sendError', 'Tin nhắn chưa gửi được.');
      reply({ ok: false, error: 'Tin nhắn chưa gửi được.' });
    }
  });

  socket.on('typing', (isTyping) => {
    const { name, displayName, currentGroup } = socket.data;
    if (name && currentGroup) {
      socket.to(`group:${currentGroup}`).emit('typing', {
        username: name,
        name: displayName || name,
        isTyping: Boolean(isTyping)
      });
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
