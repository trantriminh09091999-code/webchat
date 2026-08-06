const socket = io({ autoConnect: true });
const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  token: localStorage.getItem('t4_token') || '',
  me: null,
  groups: [],
  activeGroupId: null,
  groupDetail: null,
  messages: [],
  events: [],
  memories: [],
  onlineUsers: [],
  unread: new Map(),
  pendingFile: null,
  previewUrl: '',
  mutedGroups: new Set(JSON.parse(localStorage.getItem('t4_muted_groups') || '[]')),
  activeView: 'home',
  selectedEventId: null,
  toastTimers: new Set()
};

const PAGE_META = {
  home: ['Squad Command Center', 'Chuyện quan trọng của hội, gói gọn trong một màn hình'],
  chat: ['Chat hội', 'Tin nhắn realtime, ảnh, video và các nhóm của bạn'],
  events: ['Kèo & sự kiện', 'Tạo lịch chơi game, đi chơi và xác nhận tham gia'],
  memories: ['Kho kỷ niệm', 'Những ảnh và video được cả hội chủ động lưu lại'],
  members: ['Thành viên', 'Vai trò, biệt danh và dấu ấn của từng người'],
  fund: ['Quỹ nhóm', 'Bản thử nghiệm cho chia tiền và khoản chi chung'],
  settings: ['Hồ sơ & cài đặt', 'Tên hiển thị, avatar, giao diện và thông báo']
};

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function setAvatar(element, url, name) {
  if (!element) return;
  element.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="">` : escapeHtml(initials(name));
}

function formatDateTime(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa xác định';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: options.withYear ? 'numeric' : undefined,
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function formatMessageTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatBytes(bytes = 0) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function toast(title, message = '', type = 'info') {
  const root = $('toastStack');
  if (!root) return;
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.innerHTML = `<div class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</div><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`;
  root.appendChild(item);
  const timer = setTimeout(() => {
    item.remove();
    state.toastTimers.delete(timer);
  }, 3800);
  state.toastTimers.add(timer);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(url, { ...options, headers, body });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(data.error || `Yêu cầu thất bại (${response.status}).`);
  return data;
}

function setTheme(theme) {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const actual = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = actual;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = actual === 'dark' ? '#0b111c' : '#edf1f5';
}

function applySettings() {
  const settings = state.me?.settings || {};
  setTheme(settings.theme || 'system');
  document.body.classList.toggle('reduce-motion', localStorage.getItem('t4_reduce_motion') === '1');
  document.body.classList.toggle('compact-chat', Boolean(settings.compactMode));
  if ($('themeSelect')) $('themeSelect').value = settings.theme || 'system';
  if ($('motionSwitch')) $('motionSwitch').checked = localStorage.getItem('t4_reduce_motion') === '1';
  if ($('compactSwitch')) $('compactSwitch').checked = Boolean(settings.compactMode);
  if ($('soundSwitch')) $('soundSwitch').checked = settings.sounds !== false;
  if ($('notificationSwitch')) $('notificationSwitch').checked = Boolean(settings.desktopNotifications);
}

function showAuth() {
  $('authScreen')?.classList.remove('hidden');
  $('appShell')?.classList.add('hidden');
}

function showApp() {
  $('authScreen')?.classList.add('hidden');
  $('appShell')?.classList.remove('hidden');
}

function setAuthTab(mode) {
  const login = mode === 'login';
  $('tabLogin')?.classList.toggle('active', login);
  $('tabRegister')?.classList.toggle('active', !login);
  $('loginForm')?.classList.toggle('hidden', !login);
  $('registerForm')?.classList.toggle('hidden', login);
  if ($('authTitle')) $('authTitle').textContent = login ? 'Vào phòng của hội' : 'Tạo chỗ ngồi của bạn';
  if ($('authSubtitle')) $('authSubtitle').textContent = login
    ? 'Đăng nhập để tiếp tục cuộc trò chuyện và các kèo đang chờ.'
    : 'Tạo tài khoản riêng để anh em thêm bạn vào nhóm.';
}

$('tabLogin')?.addEventListener('click', () => setAuthTab('login'));
$('tabRegister')?.addEventListener('click', () => setAuthTab('register'));

async function handleAuth(url, username, password, errorElement, button) {
  errorElement?.classList.add('hidden');
  button?.classList.add('loading');
  button && (button.disabled = true);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không thể đăng nhập.');
    state.token = data.token;
    localStorage.setItem('t4_token', data.token);
    await enterApp();
  } catch (error) {
    if (errorElement) {
      errorElement.textContent = error.message;
      errorElement.classList.remove('hidden');
    }
  } finally {
    button?.classList.remove('loading');
    button && (button.disabled = false);
  }
}

$('loginForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  handleAuth('/api/login', $('loginUsername').value.trim(), $('loginPassword').value, $('loginError'), $('loginBtn'));
});

$('registerForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  handleAuth('/api/register', $('registerUsername').value.trim(), $('registerPassword').value, $('registerError'), $('registerBtn'));
});

async function enterApp() {
  try {
    state.me = await api('/api/me');
    showApp();
    applySettings();
    renderOwnProfile();
    socket.emit('auth', state.token);
    await loadGroups();
    navigate(state.activeView || 'home');
  } catch (error) {
    state.token = '';
    localStorage.removeItem('t4_token');
    showAuth();
  }
}

function renderOwnProfile() {
  if (!state.me) return;
  const displayName = state.me.displayName || state.me.username;
  $('myNameLabel') && ($('myNameLabel').textContent = displayName);
  setAvatar($('myAvatar'), state.me.avatarUrl, displayName);
  setAvatar($('profileTopBtn'), state.me.avatarUrl, displayName);
  setAvatar($('profileAvatarBtn'), state.me.avatarUrl, displayName);
  $('profileUsernameLabel') && ($('profileUsernameLabel').textContent = `@${state.me.username}`);
  $('profileDisplayName') && ($('profileDisplayName').value = displayName);
}

function navigate(view) {
  if (!PAGE_META[view]) return;
  state.activeView = view;
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('[data-go-view]').forEach((button) => button.onclick = () => navigate(button.dataset.goView));
  const [title, subtitle] = PAGE_META[view];
  $('pageTitle') && ($('pageTitle').textContent = title);
  $('pageSubtitle') && ($('pageSubtitle').textContent = subtitle);
  document.title = `${title} — 4 Anh Tày`;
  closeSidebar();
  if (view === 'events') loadEvents();
  if (view === 'memories') loadMemories();
  if (view === 'members') renderMembersView();
  if (view === 'settings') renderOwnProfile();
}

$$('[data-view]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
$$('[data-go-view]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.goView)));

function openSidebar() { $('sidebar')?.classList.add('open'); }
function closeSidebar() { $('sidebar')?.classList.remove('open'); }
$('mobileMenuBtn')?.addEventListener('click', openSidebar);

function renderGroups() {
  const root = $('groupList');
  if (!root) return;
  root.innerHTML = '';
  $('groupCountText') && ($('groupCountText').textContent = `${state.groups.length} nhóm bạn đang tham gia`);
  $('homeGroupStat') && ($('homeGroupStat').textContent = String(state.groups.length).padStart(2, '0'));
  $('countGroups') && ($('countGroups').textContent = state.groups.length);
  state.groups.forEach((group) => {
    const item = document.createElement('button');
    const unread = state.unread.get(group._id) || 0;
    item.className = `channel group-channel${group._id === state.activeGroupId ? ' active' : ''}`;
    item.innerHTML = `<div class="avatar a2">${group.avatarUrl ? `<img src="${escapeHtml(group.avatarUrl)}" alt="">` : escapeHtml(initials(group.name))}</div><div class="channel-copy"><strong>${escapeHtml(group.name)}</strong><span>${group.memberCount || 0} thành viên</span></div>${unread ? `<span class="unread-badge">${unread}</span>` : ''}`;
    item.addEventListener('click', () => selectGroup(group._id));
    root.appendChild(item);
  });
  if (!state.groups.length) root.innerHTML = '<div class="empty-mini">Bạn chưa có nhóm nào. Hãy tạo nhóm mới.</div>';
}

async function loadGroups() {
  try {
    state.groups = await api('/api/groups');
    if (state.activeGroupId && !state.groups.some((group) => group._id === state.activeGroupId)) state.activeGroupId = null;
    renderGroups();
    if (!state.activeGroupId && state.groups[0]) await selectGroup(state.groups[0]._id, false);
    updateHome();
  } catch (error) {
    toast('Không tải được nhóm', error.message, 'error');
  }
}

async function selectGroup(groupId, goToChat = true) {
  state.activeGroupId = groupId;
  state.unread.delete(groupId);
  renderGroups();
  const group = state.groups.find((item) => item._id === groupId);
  if (!group) return;
  $('currentGroupName') && ($('currentGroupName').textContent = group.name);
  $('currentGroupStatus') && ($('currentGroupStatus').textContent = `${group.memberCount || 0} thành viên · Tin nhắn được lưu`);
  setAvatar($('currentGroupAvatar'), group.avatarUrl, group.name);
  $('chatMessages') && ($('chatMessages').innerHTML = '<div class="chat-empty"><div class="spinner"></div><p>Đang tải tin nhắn…</p></div>');
  state.messages = [];
  socket.emit('joinGroup', groupId);
  await loadGroupDetail();
  await Promise.allSettled([loadEvents(false), loadMemories(false)]);
  updateHome();
  if (goToChat) navigate('chat');
}

async function loadGroupDetail() {
  if (!state.activeGroupId) return null;
  try {
    state.groupDetail = await api(`/api/groups/${state.activeGroupId}`);
    renderMemberPane();
    renderPinnedBars();
    if (state.activeView === 'members') renderMembersView();
    return state.groupDetail;
  } catch (error) {
    toast('Không tải được thông tin nhóm', error.message, 'error');
    return null;
  }
}

function memberDisplayName(username, fallback = '') {
  const member = state.groupDetail?.members?.find((item) => item.username === username);
  return member?.nickname || member?.displayName || fallback || username;
}

function renderMemberPane() {
  const members = state.groupDetail?.members || [];
  $('memberPaneSubtitle') && ($('memberPaneSubtitle').textContent = `${members.length} thành viên`);
  $('countMembers') && ($('countMembers').textContent = members.length);
  const root = $('memberPaneList');
  if (root) {
    root.innerHTML = members.map((member, index) => `<div class="person-row"><div class="avatar a${(index % 4) + 1}">${member.avatarUrl ? `<img src="${escapeHtml(member.avatarUrl)}" alt="">` : escapeHtml(initials(member.nickname || member.displayName))}</div><div class="person-copy"><strong>${escapeHtml(member.nickname || member.displayName)}</strong><span>${member.role === 'owner' ? 'Chủ nhóm' : member.role === 'admin' ? 'Quản trị viên' : `@${escapeHtml(member.username)}`}</span></div></div>`).join('') || '<div class="empty-mini">Chưa có thành viên.</div>';
  }
  renderAvatarStacks();
}

function renderAvatarStacks() {
  const members = state.groupDetail?.members || [];
  ['heroAvatarStack', 'sidebarAvatarStack'].forEach((id) => {
    const root = $(id);
    if (!root) return;
    root.innerHTML = members.slice(0, 4).map((member, index) => `<div class="avatar a${(index % 4) + 1}" title="${escapeHtml(member.nickname || member.displayName)}">${member.avatarUrl ? `<img src="${escapeHtml(member.avatarUrl)}" alt="">` : escapeHtml(initials(member.nickname || member.displayName))}</div>`).join('');
  });
}

function linkify(text) {
  return escapeHtml(text).replace(/((https?:\/\/|www\.)[^\s<]+)/g, (url) => {
    const href = url.startsWith('http') ? url : `https://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

function renderMessage(message, append = true) {
  const root = $('chatMessages');
  if (!root || !state.me) return;
  const own = message.name === state.me.username;
  const row = document.createElement('article');
  row.className = `chat-message${own ? ' mine' : ''}`;
  row.dataset.id = message._id;
  if (!own) {
    const avatar = document.createElement('div');
    avatar.className = 'avatar large a2';
    setAvatar(avatar, message.avatarUrl, memberDisplayName(message.name, message.displayName));
    row.appendChild(avatar);
  }
  const content = document.createElement('div');
  content.className = 'message-content';
  const name = memberDisplayName(message.name, message.displayName);
  content.innerHTML = `<div class="message-name">${escapeHtml(name)}</div>`;
  if (message.text) {
    const bubble = document.createElement('div');
    bubble.className = 'message-body';
    bubble.innerHTML = `${linkify(message.text)}<span class="message-time">${formatMessageTime(message.time)}</span>`;
    content.appendChild(bubble);
  }
  if (message.attachment?.url) {
    const attachment = document.createElement('button');
    attachment.type = 'button';
    attachment.className = 'attachment-card';
    attachment.innerHTML = message.attachment.type === 'video'
      ? `<video src="${escapeHtml(message.attachment.url)}" preload="metadata" muted></video><span class="play-badge">▶</span>`
      : `<img src="${escapeHtml(message.attachment.url)}" loading="lazy" alt="Ảnh đính kèm">`;
    attachment.addEventListener('click', () => openMediaLightbox(message.attachment));
    content.appendChild(attachment);
  }
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.innerHTML = `<button class="message-action" title="Ghim tin">📌</button>${message.attachment ? '<button class="message-action" title="Lưu kỷ niệm">💫</button>' : ''}${own || state.groupDetail?.group?.isOwner ? '<button class="message-action" title="Xóa tin">🗑</button>' : ''}`;
  const buttons = actions.querySelectorAll('button');
  buttons[0]?.addEventListener('click', () => togglePin(message._id));
  let index = 1;
  if (message.attachment) buttons[index++]?.addEventListener('click', () => toggleMemory(message._id));
  buttons[index]?.addEventListener('click', () => deleteMessage(message._id));
  content.appendChild(actions);
  row.appendChild(content);
  if (append) root.appendChild(row);
  else root.prepend(row);
}

function renderHistory(messages) {
  state.messages = messages;
  const root = $('chatMessages');
  if (!root) return;
  root.innerHTML = '';
  if (!messages.length) {
    root.innerHTML = '<div class="chat-empty"><svg class="icon lg"><use href="#i-chat"/></svg><h3>Chưa có tin nhắn</h3><p>Hãy là người bắt đầu cuộc trò chuyện.</p></div>';
  } else messages.forEach((message) => renderMessage(message));
  scrollChatToBottom();
  renderHomeMessagePreview();
}

function scrollChatToBottom() {
  const root = $('chatMessages');
  if (root) root.scrollTop = root.scrollHeight;
}

socket.on('groupHistory', ({ groupId, messages }) => {
  if (String(groupId) !== String(state.activeGroupId)) return;
  renderHistory(messages || []);
});

socket.on('message', (message) => {
  if (String(message.groupId) === String(state.activeGroupId)) {
    $('chatMessages')?.querySelector('.chat-empty')?.remove();
    state.messages.push(message);
    renderMessage(message);
    scrollChatToBottom();
    renderHomeMessagePreview();
  } else {
    state.unread.set(String(message.groupId), (state.unread.get(String(message.groupId)) || 0) + 1);
    renderGroups();
  }
  if (message.name !== state.me?.username && document.hidden && !state.mutedGroups.has(String(message.groupId))) {
    showDesktopNotification(message);
    playNotificationSound();
  }
});

socket.on('messageDeleted', (messageId) => {
  state.messages = state.messages.filter((message) => String(message._id) !== String(messageId));
  document.querySelector(`[data-id="${CSS.escape(String(messageId))}"]`)?.remove();
  renderHomeMessagePreview();
});

socket.on('typing', ({ name, isTyping }) => {
  const root = $('typingIndicator');
  if (!root) return;
  root.classList.toggle('hidden', !isTyping);
  root.querySelector('span').textContent = isTyping ? `${name} đang nhập…` : '';
});

socket.on('presence', ({ users = [] }) => {
  state.onlineUsers = users;
  renderPresence();
});

socket.on('groupsChanged', loadGroups);
socket.on('groupDeleted', (id) => {
  if (String(state.activeGroupId) === String(id)) state.activeGroupId = null;
  loadGroups();
});
socket.on('groupUpdated', loadGroups);
socket.on('groupMembersChanged', loadGroupDetail);
socket.on('pinsChanged', loadGroupDetail);
socket.on('eventsChanged', () => loadEvents(false));
socket.on('memoryChanged', ({ messageId, isMemory }) => {
  const message = state.messages.find((item) => String(item._id) === String(messageId));
  if (message) message.isMemory = isMemory;
  loadMemories(false);
});
socket.on('profileChanged', (profile) => {
  if (profile.username === state.me?.username) {
    state.me = profile;
    renderOwnProfile();
    applySettings();
  }
  loadGroupDetail();
});
socket.on('groupActivity', ({ groupId }) => {
  if (String(groupId) !== String(state.activeGroupId)) {
    state.unread.set(String(groupId), (state.unread.get(String(groupId)) || 0) + 1);
    renderGroups();
  }
});

socket.on('connect', () => {
  $('connectionBanner')?.classList.remove('show');
  $('connectionSideText') && ($('connectionSideText').textContent = 'Đã kết nối realtime');
  if (state.token) socket.emit('auth', state.token);
});

socket.on('disconnect', () => {
  $('connectionBanner')?.classList.add('show');
  $('connectionSideText') && ($('connectionSideText').textContent = 'Đang kết nối lại…');
});

socket.on('authError', () => logout(false));
socket.on('sendError', (message) => toast('Tin nhắn chưa gửi', message, 'error'));

function renderPresence() {
  const users = state.onlineUsers;
  $('topOnlineCount') && ($('topOnlineCount').textContent = `${users.length} online`);
  $('countOnline') && ($('countOnline').textContent = users.length);
  $('homeOnlineStat') && ($('homeOnlineStat').textContent = `${users.length}/${state.groupDetail?.members?.length || 0}`);
  $('sidebarOnlineText') && ($('sidebarOnlineText').textContent = `${users.length} người đang online`);
  const home = $('homeOnlineList');
  if (home) {
    home.innerHTML = users.map((user, index) => `<div class="person-row"><div class="avatar a${(index % 4) + 1}">${user.avatarUrl ? `<img src="${escapeHtml(user.avatarUrl)}" alt="">` : escapeHtml(initials(user.displayName))}</div><div class="person-copy"><strong>${escapeHtml(user.displayName)}</strong><span>@${escapeHtml(user.username)}</span></div><span class="person-state">Online</span></div>`).join('') || '<div class="empty-mini">Chưa có ai trực tuyến.</div>';
  }
}

let typingTimer;
$('chatInput')?.addEventListener('input', () => {
  const input = $('chatInput');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
  socket.emit('typing', true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit('typing', false), 900);
});

$('chatInput')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('chatForm').requestSubmit();
  }
});

function validateFile(file) {
  if (!file) return 'Không tìm thấy file.';
  if (file.size > 25 * 1024 * 1024) return 'File vượt quá giới hạn 25 MB.';
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return 'Chỉ hỗ trợ ảnh hoặc video.';
  return '';
}

async function optimizeImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 2 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
    bitmap.close();
    return new File([blob], (file.name || 'clipboard-image').replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
  } catch (_) {
    return file;
  }
}

async function chooseFile(file) {
  const error = validateFile(file);
  if (error) return toast('Không thể chọn file', error, 'error');
  clearPendingFile();
  state.pendingFile = await optimizeImage(file);
  state.previewUrl = URL.createObjectURL(state.pendingFile);
  $('uploadName').textContent = state.pendingFile.name || 'Ảnh từ clipboard';
  $('uploadStatus').textContent = `${state.pendingFile.type.startsWith('video/') ? 'Video' : 'Ảnh'} · ${formatBytes(state.pendingFile.size)}`;
  $('uploadThumb').innerHTML = state.pendingFile.type.startsWith('video/')
    ? `<video src="${state.previewUrl}" muted></video>`
    : `<img src="${state.previewUrl}" alt="Xem trước">`;
  $('uploadTray').classList.remove('hidden');
}

function clearPendingFile() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.pendingFile = null;
  state.previewUrl = '';
  if ($('fileInput')) $('fileInput').value = '';
  $('uploadTray')?.classList.add('hidden');
  if ($('uploadThumb')) $('uploadThumb').innerHTML = '<svg class="icon"><use href="#i-image"/></svg>';
  if ($('uploadProgress')) $('uploadProgress').style.width = '0%';
}

$('attachBtn')?.addEventListener('click', () => $('fileInput').click());
$('fileInput')?.addEventListener('change', () => chooseFile($('fileInput').files[0]));
$('cancelUpload')?.addEventListener('click', clearPendingFile);
document.addEventListener('paste', (event) => {
  if (!state.me) return;
  const item = [...(event.clipboardData?.items || [])].find((candidate) => candidate.type.startsWith('image/'));
  if (item) {
    event.preventDefault();
    chooseFile(item.getAsFile());
  }
});

function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);
    xhr.open('POST', '/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);
    xhr.timeout = 90000;
    $('uploadStatus').textContent = 'Đang tải lên…';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) $('uploadProgress').style.width = `${Math.round(event.loaded / event.total * 100)}%`;
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || 'Gửi file thất bại.'));
      } catch (_) { reject(new Error('Máy chủ trả về dữ liệu không hợp lệ.')); }
    };
    xhr.onerror = () => reject(new Error('Mất kết nối khi tải file.'));
    xhr.ontimeout = () => reject(new Error('Tải file quá lâu. Hãy thử file nhỏ hơn.'));
    xhr.send(form);
  });
}

function emitChatMessage(payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(12000).emit('chatMessage', payload, (error, response) => {
      if (error) return reject(new Error('Máy chủ không phản hồi.'));
      if (!response?.ok) return reject(new Error(response?.error || 'Không gửi được tin nhắn.'));
      resolve(response);
    });
  });
}

$('chatForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('chatInput').value.trim();
  if (!state.activeGroupId) return toast('Chưa chọn nhóm', 'Hãy chọn hoặc tạo một nhóm trước.', 'error');
  if (!text && !state.pendingFile) return;
  const button = $('sendChatBtn');
  button.disabled = true;
  try {
    const attachment = state.pendingFile ? await uploadFile(state.pendingFile) : null;
    await emitChatMessage({ text, attachment });
    $('chatInput').value = '';
    $('chatInput').style.height = 'auto';
    clearPendingFile();
  } catch (error) {
    $('uploadStatus') && ($('uploadStatus').textContent = error.message);
    toast('Chưa gửi được', `${error.message} File vẫn được giữ để bạn thử lại.`, 'error');
  } finally {
    button.disabled = false;
  }
});

$('homeQuickSend')?.addEventListener('click', async () => {
  const input = $('homeQuickInput');
  const text = input.value.trim();
  if (!text) return;
  if (!state.activeGroupId) return toast('Chưa chọn nhóm', 'Mở Chat hội và chọn một nhóm.', 'error');
  try {
    await emitChatMessage({ text, attachment: null });
    input.value = '';
    toast('Đã gửi tin nhắn', '', 'success');
  } catch (error) { toast('Chưa gửi được', error.message, 'error'); }
});

async function togglePin(messageId) {
  try {
    const data = await api(`/api/groups/${state.activeGroupId}/pins/${messageId}`, { method: 'PATCH' });
    toast(data.pinned ? 'Đã ghim tin nhắn' : 'Đã bỏ ghim', '', 'success');
    await loadGroupDetail();
  } catch (error) { toast('Không ghim được', error.message, 'error'); }
}

async function toggleMemory(messageId) {
  try {
    const data = await api(`/api/messages/${messageId}/memory`, { method: 'PATCH' });
    toast(data.isMemory ? 'Đã lưu vào kỷ niệm' : 'Đã bỏ khỏi kỷ niệm', '', 'success');
    await loadMemories(false);
  } catch (error) { toast('Không cập nhật được', error.message, 'error'); }
}

async function deleteMessage(messageId) {
  if (!confirm('Xóa tin nhắn này?')) return;
  try { await api(`/api/messages/${messageId}`, { method: 'DELETE' }); }
  catch (error) { toast('Không xóa được', error.message, 'error'); }
}

function renderPinnedBars() {
  const pins = state.groupDetail?.pinnedMessages || [];
  const bar = $('pinnedChatBar');
  if (bar) {
    bar.classList.toggle('hidden', !pins.length);
    bar.textContent = pins.length ? `📌 ${pins.length} tin quan trọng đã ghim · Nhấn để xem` : '';
    bar.onclick = () => openGroupModal('pins');
  }
  if ($('pinnedPreview')) {
    const pin = pins[0];
    $('pinnedPreview').innerHTML = pin ? `${escapeHtml(pin.text || (pin.attachment?.type === 'video' ? 'Video đã ghim' : 'Ảnh đã ghim'))}<span>Ghim trong nhóm</span>` : 'Chưa có tin nhắn được ghim.';
  }
}

function openMediaLightbox(attachment) {
  $('mediaLightboxContent').innerHTML = attachment.type === 'video'
    ? `<video src="${escapeHtml(attachment.url)}" controls autoplay></video>`
    : `<img src="${escapeHtml(attachment.url)}" alt="Ảnh phóng lớn">`;
  $('mediaLightbox').classList.remove('hidden');
}

function closeMediaLightbox() {
  $('mediaLightbox').classList.add('hidden');
  $('mediaLightboxContent').innerHTML = '';
}
$('closeMediaLightbox')?.addEventListener('click', closeMediaLightbox);
$('mediaLightbox')?.addEventListener('click', (event) => { if (event.target === $('mediaLightbox')) closeMediaLightbox(); });

function openModal(id) { $(id)?.classList.add('open'); }
function closeModal(id) { $(id)?.classList.remove('open'); }
$$('.modal-close').forEach((button) => button.addEventListener('click', () => button.closest('.modal-backdrop')?.classList.remove('open')));
$$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.classList.remove('open'); }));

function openCreateGroup() {
  $('newGroupName').value = '';
  $('createGroupError').classList.add('hidden');
  openModal('createGroupModal');
  setTimeout(() => $('newGroupName').focus(), 80);
}
$('createGroupBtn')?.addEventListener('click', openCreateGroup);
$('quickCreateGroupBtn')?.addEventListener('click', openCreateGroup);

$('createGroupForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('newGroupName').value.trim();
  try {
    const group = await api('/api/groups', { method: 'POST', body: { name } });
    closeModal('createGroupModal');
    await loadGroups();
    await selectGroup(group._id);
    toast('Đã tạo nhóm mới', group.name, 'success');
  } catch (error) {
    $('createGroupError').textContent = error.message;
    $('createGroupError').classList.remove('hidden');
  }
});

async function openGroupModal(tab = 'overview') {
  if (!state.activeGroupId) return toast('Chưa chọn nhóm', 'Hãy chọn một nhóm trước.', 'error');
  await loadGroupDetail();
  openModal('groupModal');
  renderGroupModal(tab);
}

$('groupOptionsBtn')?.addEventListener('click', () => openGroupModal('overview'));
$('openGroupInfoBtn')?.addEventListener('click', () => openGroupModal('overview'));
$('openGroupPermissions')?.addEventListener('click', () => openGroupModal('members'));
$('inviteMemberBtn')?.addEventListener('click', () => openGroupModal('members'));
$('pinnedChatBar')?.addEventListener('click', () => openGroupModal('pins'));

$$('[data-group-tab]').forEach((button) => button.addEventListener('click', () => renderGroupModal(button.dataset.groupTab)));

async function renderGroupModal(tab) {
  $$('[data-group-tab]').forEach((button) => button.classList.toggle('active', button.dataset.groupTab === tab));
  const root = $('groupModalContent');
  const detail = state.groupDetail;
  if (!root || !detail) return;
  $('groupModalTitle').textContent = detail.group.name;
  $('groupModalSubtitle').textContent = `${detail.members.length} thành viên · ${detail.group.isOwner ? 'Bạn là chủ nhóm' : 'Bạn là thành viên'}`;
  if (tab === 'overview') renderGroupOverview(root);
  if (tab === 'members') renderGroupMembers(root);
  if (tab === 'media') await renderGroupMedia(root);
  if (tab === 'pins') renderGroupPins(root);
}

function renderGroupOverview(root) {
  const group = state.groupDetail.group;
  root.innerHTML = `<div class="group-setting-card"><h3>Thông tin nhóm</h3><p>Đổi tên nhóm hoặc tắt thông báo trên thiết bị này.</p><div class="field"><label>Tên nhóm</label><input class="input" id="groupRenameInput" maxlength="40" value="${escapeHtml(group.name)}"></div><div class="group-action-row" style="margin-top:10px"><button class="btn primary small" id="saveGroupName">Lưu tên</button><button class="btn secondary small" id="toggleMuteGroup">${state.mutedGroups.has(String(state.activeGroupId)) ? 'Bật thông báo' : 'Tắt thông báo'}</button></div></div><div class="group-setting-card danger-zone"><h3>Khu vực quản lý</h3><p>${group.isOwner ? 'Xóa nhóm sẽ xóa toàn bộ tin nhắn và lịch hẹn.' : 'Bạn có thể rời nhóm này.'}</p><div class="group-action-row">${group.isOwner ? '<button class="btn danger small" id="deleteGroupBtn">Xóa nhóm</button>' : '<button class="btn danger small" id="leaveGroupBtn">Rời nhóm</button>'}</div></div>`;
  $('saveGroupName')?.addEventListener('click', async () => {
    try {
      await api(`/api/groups/${state.activeGroupId}`, { method: 'PATCH', body: { name: $('groupRenameInput').value.trim() } });
      await loadGroups();
      toast('Đã đổi tên nhóm', '', 'success');
    } catch (error) { toast('Không đổi được tên', error.message, 'error'); }
  });
  $('toggleMuteGroup')?.addEventListener('click', () => {
    const id = String(state.activeGroupId);
    state.mutedGroups.has(id) ? state.mutedGroups.delete(id) : state.mutedGroups.add(id);
    localStorage.setItem('t4_muted_groups', JSON.stringify([...state.mutedGroups]));
    renderGroupOverview(root);
    toast(state.mutedGroups.has(id) ? 'Đã tắt thông báo nhóm' : 'Đã bật thông báo nhóm', '', 'success');
  });
  $('deleteGroupBtn')?.addEventListener('click', async () => {
    if (!confirm('Xóa nhóm và toàn bộ tin nhắn, lịch hẹn?')) return;
    try {
      await api(`/api/groups/${state.activeGroupId}`, { method: 'DELETE' });
      closeModal('groupModal');
      state.activeGroupId = null;
      await loadGroups();
    } catch (error) { toast('Không xóa được nhóm', error.message, 'error'); }
  });
  $('leaveGroupBtn')?.addEventListener('click', async () => {
    if (!confirm('Rời nhóm này?')) return;
    try {
      await api(`/api/groups/${state.activeGroupId}/leave`, { method: 'POST' });
      closeModal('groupModal');
      state.activeGroupId = null;
      await loadGroups();
    } catch (error) { toast('Không rời được nhóm', error.message, 'error'); }
  });
}

function renderGroupMembers(root) {
  const detail = state.groupDetail;
  root.innerHTML = `${detail.group.isOwner ? '<div class="group-setting-card"><h3>Thêm thành viên</h3><p>Nhập chính xác tên đăng nhập của người đã tạo tài khoản.</p><div class="group-action-row"><input class="input" id="newMemberUsername" placeholder="Tên đăng nhập" style="flex:1"><button class="btn primary small" id="addMemberButton">Thêm</button></div></div>' : ''}<div>${detail.members.map((member, index) => `<div class="member-manage-row"><div class="avatar a${(index % 4) + 1}">${member.avatarUrl ? `<img src="${escapeHtml(member.avatarUrl)}" alt="">` : escapeHtml(initials(member.nickname || member.displayName))}</div><div class="person-copy"><strong>${escapeHtml(member.nickname || member.displayName)}</strong><span>@${escapeHtml(member.username)} · ${member.role === 'owner' ? 'Chủ nhóm' : 'Thành viên'}</span></div><button class="btn ghost small" data-nickname="${escapeHtml(member.username)}">Biệt danh</button>${detail.group.isOwner && member.role !== 'owner' ? `<button class="btn danger small" data-remove-member="${escapeHtml(member.username)}">Xóa</button>` : ''}</div>`).join('')}</div>`;
  $('addMemberButton')?.addEventListener('click', async () => {
    try {
      await api(`/api/groups/${state.activeGroupId}/members`, { method: 'POST', body: { username: $('newMemberUsername').value.trim() } });
      await loadGroupDetail();
      renderGroupModal('members');
      toast('Đã thêm thành viên', '', 'success');
    } catch (error) { toast('Không thêm được', error.message, 'error'); }
  });
  $$('[data-nickname]', root).forEach((button) => button.addEventListener('click', async () => {
    const member = detail.members.find((item) => item.username === button.dataset.nickname);
    const nickname = prompt(`Biệt danh cho ${member.displayName}:`, member.nickname || '');
    if (nickname === null) return;
    try {
      await api(`/api/groups/${state.activeGroupId}/nickname`, { method: 'PATCH', body: { username: member.username, nickname } });
      await loadGroupDetail();
      renderGroupModal('members');
    } catch (error) { toast('Không đổi được biệt danh', error.message, 'error'); }
  }));
  $$('[data-remove-member]', root).forEach((button) => button.addEventListener('click', async () => {
    if (!confirm(`Xóa @${button.dataset.removeMember} khỏi nhóm?`)) return;
    try {
      await api(`/api/groups/${state.activeGroupId}/members/${encodeURIComponent(button.dataset.removeMember)}`, { method: 'DELETE' });
      await loadGroupDetail();
      renderGroupModal('members');
    } catch (error) { toast('Không xóa được thành viên', error.message, 'error'); }
  }));
}

async function renderGroupMedia(root) {
  root.innerHTML = '<div class="empty-mini">Đang tải media…</div>';
  try {
    const media = await api(`/api/groups/${state.activeGroupId}/media`);
    root.innerHTML = `<div class="media-grid-live">${media.map((message) => `<button data-media-index="${escapeHtml(message._id)}">${message.attachment.type === 'video' ? `<video src="${escapeHtml(message.attachment.url)}" muted></video>` : `<img src="${escapeHtml(message.attachment.url)}" alt="">`}</button>`).join('') || '<div class="empty-mini">Chưa có ảnh hoặc video.</div>'}</div>`;
    $$('[data-media-index]', root).forEach((button) => {
      const message = media.find((item) => String(item._id) === button.dataset.mediaIndex);
      button.addEventListener('click', () => openMediaLightbox(message.attachment));
    });
  } catch (error) { root.innerHTML = `<div class="auth-error">${escapeHtml(error.message)}</div>`; }
}

function renderGroupPins(root) {
  const pins = state.groupDetail?.pinnedMessages || [];
  root.innerHTML = pins.map((pin) => `<div class="group-setting-card"><h3>${escapeHtml(memberDisplayName(pin.name, pin.displayName))}</h3><p>${escapeHtml(formatDateTime(pin.time))}</p><div>${escapeHtml(pin.text || (pin.attachment?.type === 'video' ? 'Video đã ghim' : 'Ảnh đã ghim'))}</div></div>`).join('') || '<div class="empty-mini">Chưa có tin nhắn được ghim.</div>';
}

async function loadEvents(render = true) {
  if (!state.activeGroupId) {
    state.events = [];
    if (render) renderEvents();
    return;
  }
  try {
    state.events = await api(`/api/groups/${state.activeGroupId}/events`);
    if (!state.selectedEventId || !state.events.some((event) => event._id === state.selectedEventId)) state.selectedEventId = state.events[0]?._id || null;
    if (render || state.activeView === 'events') renderEvents();
    updateHome();
  } catch (error) { if (render) toast('Không tải được lịch hẹn', error.message, 'error'); }
}

function renderEvents() {
  const root = $('eventList');
  if (!root) return;
  $('eventCountTag').textContent = `${state.events.length} kèo`;
  $('homeEventStat').textContent = String(state.events.length).padStart(2, '0');
  $('countEvents').textContent = state.events.length;
  const selected = state.events.find((event) => event._id === state.selectedEventId) || state.events[0];
  renderEventHero(selected);
  if (!state.events.length) {
    root.innerHTML = '<div class="empty-live"><svg class="icon lg"><use href="#i-calendar"/></svg><p>Chưa có lịch hẹn nào.</p></div>';
    return;
  }
  root.innerHTML = state.events.map((event) => {
    const date = new Date(event.startAt);
    return `<article class="event-list-item"><div class="date-block"><strong>${String(date.getDate()).padStart(2, '0')}</strong><span>Tháng ${date.getMonth() + 1}</span></div><div class="event-title"><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(formatDateTime(event.startAt))} · ${escapeHtml(event.location || 'Chưa chốt địa điểm')}</p></div><span class="tag ${event.type === 'game' ? 'live' : 'open'}">${event.type === 'game' ? 'Game' : event.type === 'outing' ? 'Đi chơi' : 'Khác'}</span><div class="event-list-actions"><button class="btn secondary small" data-select-event="${event._id}">Xem</button>${event.createdBy === state.me.username || state.groupDetail?.group?.isOwner ? `<button class="btn danger small" data-delete-event="${event._id}">Xóa</button>` : ''}</div></article>`;
  }).join('');
  $$('[data-select-event]', root).forEach((button) => button.addEventListener('click', () => {
    state.selectedEventId = button.dataset.selectEvent;
    renderEvents();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  $$('[data-delete-event]', root).forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Xóa lịch hẹn này?')) return;
    try { await api(`/api/events/${button.dataset.deleteEvent}`, { method: 'DELETE' }); await loadEvents(); }
    catch (error) { toast('Không xóa được lịch', error.message, 'error'); }
  }));
}

function renderEventHero(event) {
  if (!event) {
    $('eventHeroEyebrow').textContent = 'Chưa có kèo';
    $('eventHeroTitle').textContent = 'Tạo kèo đầu tiên cho nhóm';
    $('eventHeroDescription').textContent = 'Chọn ngày giờ, địa điểm và để anh em xác nhận tham gia.';
    $('eventTime').textContent = 'Chưa chốt';
    $('eventLocation').textContent = 'Chưa chốt';
    $('eventParticipants').textContent = '0 người';
    $('rsvpSummary').textContent = 'Chưa có phản hồi.';
    $('eventAvatarStack').innerHTML = '';
    return;
  }
  $('eventHeroEyebrow').textContent = event.type === 'game' ? 'Kèo game' : event.type === 'outing' ? 'Kèo đi chơi' : 'Sự kiện';
  $('eventHeroTitle').textContent = event.title;
  $('eventHeroDescription').textContent = event.note || 'Anh em xác nhận tham gia ngay bên cạnh.';
  $('eventTime').textContent = formatDateTime(event.startAt);
  $('eventLocation').textContent = event.location || 'Chưa chốt';
  $('eventParticipants').textContent = `${event.participants?.length || 0} người`;
  $('rsvpHint').textContent = `Phản hồi cho “${event.title}”`;
  const joined = event.participants?.includes(state.me?.username);
  $$('[data-rsvp]').forEach((button) => button.classList.toggle('active', button.dataset.rsvp === (joined ? 'join' : 'skip')));
  $('rsvpSummary').textContent = joined ? 'Bạn đã xác nhận tham gia.' : 'Bạn chưa tham gia kèo này.';
  const members = state.groupDetail?.members || [];
  $('eventAvatarStack').innerHTML = (event.participants || []).slice(0, 5).map((username, index) => {
    const member = members.find((item) => item.username === username);
    return `<div class="avatar a${(index % 4) + 1}" title="${escapeHtml(member?.displayName || username)}">${member?.avatarUrl ? `<img src="${escapeHtml(member.avatarUrl)}" alt="">` : escapeHtml(initials(member?.nickname || member?.displayName || username))}</div>`;
  }).join('');
}

$('createEventBtn')?.addEventListener('click', () => {
  if (!state.activeGroupId) return toast('Chưa chọn nhóm', 'Chọn nhóm trước khi tạo kèo.', 'error');
  const tomorrow = new Date(Date.now() + 86400000);
  $('newEventDate').value = tomorrow.toISOString().slice(0, 10);
  $('newEventTime').value = '20:30';
  openModal('eventModal');
});
$('openEventMode')?.addEventListener('click', () => toast('Event Mode', 'Bản này đã gom chat, RSVP và lịch hẹn. Checklist và chi phí sẽ làm ở vòng sau.', 'info'));
$('quickPollEvent')?.addEventListener('click', () => toast('Bình chọn nhanh', 'Tính năng bình chọn đang nằm trong roadmap vòng tiếp theo.', 'info'));

$('eventForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const startAt = new Date(`${$('newEventDate').value}T${$('newEventTime').value}`);
  try {
    await api(`/api/groups/${state.activeGroupId}/events`, {
      method: 'POST',
      body: {
        title: $('newEventTitle').value.trim(),
        type: $('newEventType').value,
        startAt: startAt.toISOString(),
        location: $('newEventLocation').value.trim(),
        note: $('newEventNote').value.trim()
      }
    });
    closeModal('eventModal');
    $('eventForm').reset();
    await loadEvents();
    toast('Đã tạo kèo mới', '', 'success');
  } catch (error) { toast('Không tạo được kèo', error.message, 'error'); }
});

$$('[data-rsvp]').forEach((button) => button.addEventListener('click', async () => {
  const eventId = state.selectedEventId || state.events[0]?._id;
  if (!eventId) return toast('Chưa có kèo', 'Tạo một lịch hẹn trước.', 'error');
  const event = state.events.find((item) => item._id === eventId);
  const joined = event?.participants?.includes(state.me.username);
  if (button.dataset.rsvp === 'skip' && !joined) return;
  try { await api(`/api/events/${eventId}/rsvp`, { method: 'PATCH' }); await loadEvents(); }
  catch (error) { toast('Không cập nhật được RSVP', error.message, 'error'); }
}));

async function loadMemories(render = true) {
  if (!state.activeGroupId) {
    state.memories = [];
    if (render) renderMemories();
    return;
  }
  try {
    state.memories = await api(`/api/groups/${state.activeGroupId}/media?memory=1`);
    if (render || state.activeView === 'memories') renderMemories();
    updateHome();
  } catch (error) { if (render) toast('Không tải được kỷ niệm', error.message, 'error'); }
}

function renderMemories() {
  const root = $('memoryGrid');
  if (!root) return;
  $('homeMemoryStat').textContent = String(state.memories.length).padStart(2, '0');
  if (!state.memories.length) {
    root.innerHTML = '<div class="empty-live"><svg class="icon lg"><use href="#i-image"/></svg><p>Chưa có kỷ niệm nào được lưu.</p></div>';
    $('memoryTimeline').innerHTML = '<div class="timeline-item"><time>Hôm nay</time><h3>Kho kỷ niệm đã sẵn sàng</h3><p>Vào chat, nhấn 💫 dưới ảnh hoặc video để lưu vào đây.</p></div>';
    return;
  }
  root.innerHTML = state.memories.map((message) => `<article class="card memory-card"><button class="attachment-card" data-memory-id="${message._id}">${message.attachment.type === 'video' ? `<video class="memory-card-media" src="${escapeHtml(message.attachment.url)}" muted></video>` : `<img class="memory-card-media" src="${escapeHtml(message.attachment.url)}" alt="">`}</button><div class="memory-card-body"><h3>${escapeHtml(message.text || message.attachment.name || 'Khoảnh khắc của hội')}</h3><p>${escapeHtml(memberDisplayName(message.name, message.displayName))} · ${escapeHtml(formatDateTime(message.time, { withYear: true }))}</p></div></article>`).join('');
  $$('[data-memory-id]', root).forEach((button) => {
    const message = state.memories.find((item) => String(item._id) === button.dataset.memoryId);
    button.addEventListener('click', () => openMediaLightbox(message.attachment));
  });
  $('memoryTimeline').innerHTML = state.memories.slice(0, 8).map((message) => `<article class="timeline-item"><time>${escapeHtml(formatDateTime(message.time, { withYear: true }))}</time><h3>${escapeHtml(message.text || 'Một khoảnh khắc được lưu')}</h3><p>Được lưu bởi ${escapeHtml(memberDisplayName(message.name, message.displayName))}.</p></article>`).join('');
}

$('refreshMemoriesBtn')?.addEventListener('click', () => loadMemories());
$('addMemoryBtn')?.addEventListener('click', () => { navigate('chat'); toast('Lưu kỷ niệm', 'Nhấn nút 💫 dưới ảnh hoặc video trong chat.', 'info'); });

function renderMembersView() {
  const root = $('memberGrid');
  if (!root) return;
  const members = state.groupDetail?.members || [];
  if (!members.length) {
    root.innerHTML = '<div class="empty-live"><svg class="icon lg"><use href="#i-users"/></svg><p>Chọn một nhóm để xem thành viên.</p></div>';
    return;
  }
  root.innerHTML = members.map((member, index) => `<article class="card member-card"><div class="avatar xl a${(index % 4) + 1}">${member.avatarUrl ? `<img src="${escapeHtml(member.avatarUrl)}" alt="">` : escapeHtml(initials(member.nickname || member.displayName))}</div><h3>${escapeHtml(member.displayName)}</h3><div class="nickname">${escapeHtml(member.nickname || `@${member.username}`)} · ${member.role === 'owner' ? 'Chủ nhóm' : 'Thành viên'}</div><p>Tham gia từ ${escapeHtml(new Date(member.joinedAt).toLocaleDateString('vi-VN'))}</p><div class="member-badges"><span class="tag">${member.role === 'owner' ? 'Người mở phòng' : 'Thành viên hội'}</span></div></article>`).join('');
}

async function updateHome() {
  $('homeGroupStat') && ($('homeGroupStat').textContent = String(state.groups.length).padStart(2, '0'));
  const group = state.groups.find((item) => item._id === state.activeGroupId);
  $('countdownTitle') && ($('countdownTitle').textContent = group?.name || 'Chưa chọn nhóm');
  $('countdownSubtitle') && ($('countdownSubtitle').textContent = group ? `${group.memberCount || 0} thành viên` : 'Mở chat để bắt đầu');
  $('countMembers') && ($('countMembers').textContent = state.groupDetail?.members?.length || 0);
  $('heroTitle') && ($('heroTitle').textContent = group ? `Phòng “${group.name}” đã sẵn sàng.` : 'Chào mừng trở lại với hội.');
  $('homeChatSubtitle') && ($('homeChatSubtitle').textContent = group ? `Đang gửi tới ${group.name}` : 'Chọn nhóm để trò chuyện');
  renderHomeMessagePreview();
  renderHomeEventPreview();
  renderHomeMemoryPreview();
}

function renderHomeMessagePreview() {
  const root = $('homeMessagePreview');
  if (!root) return;
  const messages = state.messages.slice(-3);
  root.innerHTML = messages.map((message) => `<div class="msg-row${message.name === state.me?.username ? ' mine' : ''}"><div class="msg-bubble">${escapeHtml(message.text || (message.attachment?.type === 'video' ? '🎬 Video' : '📷 Ảnh'))}<span class="msg-meta">${escapeHtml(memberDisplayName(message.name, message.displayName))} · ${formatMessageTime(message.time)}</span></div></div>`).join('') || '<div class="empty-mini">Tin nhắn mới sẽ hiển thị tại đây.</div>';
}

function renderHomeEventPreview() {
  const event = state.events[0];
  if (!event) {
    $('homeEventDay') && ($('homeEventDay').textContent = '--');
    $('homeEventMonth') && ($('homeEventMonth').textContent = 'Tháng');
    $('homeEventTitle') && ($('homeEventTitle').textContent = 'Chưa có kèo');
    $('homeEventInfo') && ($('homeEventInfo').textContent = 'Tạo một lịch mới để anh em xác nhận.');
    return;
  }
  const date = new Date(event.startAt);
  $('homeEventDay').textContent = String(date.getDate()).padStart(2, '0');
  $('homeEventMonth').textContent = `Tháng ${date.getMonth() + 1}`;
  $('homeEventTitle').textContent = event.title;
  $('homeEventInfo').textContent = `${formatDateTime(event.startAt)} · ${event.location || 'Chưa chốt địa điểm'}`;
}

function renderHomeMemoryPreview() {
  const root = $('homeMemoryPreview');
  if (!root) return;
  const memory = state.memories[0];
  if (!memory) {
    root.innerHTML = '<div class="memory-visual"><div class="memory-overlay"><strong>Chưa có kỷ niệm</strong><span>Nhấn 💫 dưới ảnh trong chat</span></div></div>';
    return;
  }
  root.innerHTML = `<button class="attachment-card" id="homeMemoryButton">${memory.attachment.type === 'video' ? `<video class="memory-visual" src="${escapeHtml(memory.attachment.url)}" muted></video>` : `<img class="memory-visual" src="${escapeHtml(memory.attachment.url)}" alt="">`}<div class="memory-overlay"><strong>${escapeHtml(memory.text || 'Khoảnh khắc của hội')}</strong><span>${escapeHtml(formatDateTime(memory.time))}</span></div></button>`;
  $('homeMemoryButton')?.addEventListener('click', () => openMediaLightbox(memory.attachment));
}

async function uploadProfileAvatar(file) {
  const error = validateFile(file);
  if (error || !file.type.startsWith('image/')) return toast('Không thể dùng ảnh', error || 'Avatar phải là ảnh.', 'error');
  try {
    const optimized = await optimizeImage(file);
    toast('Đang tải avatar', 'Vui lòng chờ…', 'info');
    const attachment = await uploadFile(optimized);
    state.me = await api('/api/me/profile', { method: 'PATCH', body: { avatarUrl: attachment.url } });
    renderOwnProfile();
    toast('Đã đổi avatar', '', 'success');
  } catch (error) { toast('Không đổi được avatar', error.message, 'error'); }
}

$('profileAvatarBtn')?.addEventListener('click', () => $('profileAvatarInput').click());
$('profileAvatarInput')?.addEventListener('change', () => uploadProfileAvatar($('profileAvatarInput').files[0]));
$('profileSideBtn')?.addEventListener('click', () => navigate('settings'));
$('profileTopBtn')?.addEventListener('click', () => navigate('settings'));

$('saveProfileBtn')?.addEventListener('click', async () => {
  try {
    state.me = await api('/api/me/profile', { method: 'PATCH', body: { displayName: $('profileDisplayName').value.trim() } });
    renderOwnProfile();
    toast('Đã lưu hồ sơ', '', 'success');
  } catch (error) { toast('Không lưu được hồ sơ', error.message, 'error'); }
});

async function saveSettings(patch) {
  try {
    state.me = await api('/api/me/profile', { method: 'PATCH', body: { settings: patch } });
    applySettings();
  } catch (error) { toast('Không lưu được cài đặt', error.message, 'error'); }
}

$('themeSelect')?.addEventListener('change', () => saveSettings({ theme: $('themeSelect').value }));
$('compactSwitch')?.addEventListener('change', () => saveSettings({ compactMode: $('compactSwitch').checked }));
$('soundSwitch')?.addEventListener('change', () => saveSettings({ sounds: $('soundSwitch').checked }));
$('motionSwitch')?.addEventListener('change', () => {
  localStorage.setItem('t4_reduce_motion', $('motionSwitch').checked ? '1' : '0');
  applySettings();
});
$('notificationSwitch')?.addEventListener('change', async () => {
  let enabled = $('notificationSwitch').checked;
  if (enabled && 'Notification' in window && Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    enabled = permission === 'granted';
    $('notificationSwitch').checked = enabled;
  }
  saveSettings({ desktopNotifications: enabled });
});
$('themeBtn')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  saveSettings({ theme: next });
});

async function logout(callServer = true) {
  try { if (callServer && state.token) await api('/api/logout', { method: 'POST' }); } catch (_) {}
  localStorage.removeItem('t4_token');
  state.token = '';
  state.me = null;
  state.groups = [];
  showAuth();
}
$('logoutBtn')?.addEventListener('click', () => logout(true));

function showDesktopNotification(message) {
  if (!state.me?.settings?.desktopNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(message.displayName || message.name, { body: message.text || (message.attachment ? 'Đã gửi một tệp' : 'Tin nhắn mới') });
}

function playNotificationSound() {
  if (state.me?.settings?.sounds === false) return;
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 620;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.13);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.14);
  } catch (_) {}
}

$('searchBtn')?.addEventListener('click', () => {
  $('searchOverlay').classList.add('open');
  $('globalSearch').focus();
});
$('chatSearchBtn')?.addEventListener('click', () => {
  $('searchOverlay').classList.add('open');
  $('globalSearch').focus();
});
$('closeSearch')?.addEventListener('click', () => $('searchOverlay').classList.remove('open'));
$('searchOverlay')?.addEventListener('click', (event) => { if (event.target === $('searchOverlay')) $('searchOverlay').classList.remove('open'); });
$('globalSearch')?.addEventListener('input', () => {
  const query = $('globalSearch').value.trim().toLocaleLowerCase('vi');
  const results = [];
  if (query) {
    state.groups.filter((group) => group.name.toLocaleLowerCase('vi').includes(query)).forEach((group) => results.push({ type: 'Nhóm', title: group.name, action: () => selectGroup(group._id) }));
    (state.groupDetail?.members || []).filter((member) => `${member.displayName} ${member.nickname} ${member.username}`.toLocaleLowerCase('vi').includes(query)).forEach((member) => results.push({ type: 'Thành viên', title: member.nickname || member.displayName, subtitle: `@${member.username}`, action: () => navigate('members') }));
    state.events.filter((event) => `${event.title} ${event.location}`.toLocaleLowerCase('vi').includes(query)).forEach((event) => results.push({ type: 'Kèo', title: event.title, subtitle: formatDateTime(event.startAt), action: () => { state.selectedEventId = event._id; navigate('events'); } }));
    state.messages.filter((message) => message.text?.toLocaleLowerCase('vi').includes(query)).slice(-12).forEach((message) => results.push({ type: 'Tin nhắn', title: message.text.slice(0, 80), subtitle: memberDisplayName(message.name, message.displayName), action: () => navigate('chat') }));
  }
  $('searchResults').innerHTML = results.map((result, index) => `<button class="search-result" data-search-result="${index}"><strong>${escapeHtml(result.type)} · ${escapeHtml(result.title)}</strong><span>${escapeHtml(result.subtitle || '')}</span></button>`).join('') || '<div class="empty-mini">Không tìm thấy kết quả phù hợp.</div>';
  $$('[data-search-result]', $('searchResults')).forEach((button) => button.addEventListener('click', () => {
    results[Number(button.dataset.searchResult)].action();
    $('searchOverlay').classList.remove('open');
  }));
});

$('notificationBtn')?.addEventListener('click', () => toast('Thông báo', `${state.onlineUsers.length} người đang online · ${[...state.unread.values()].reduce((a, b) => a + b, 0)} tin chưa đọc`, 'info'));
$('fundIdeaBtn')?.addEventListener('click', () => toast('Quỹ nhóm', 'Phần backend chia tiền sẽ được phát triển ở vòng tiếp theo.', 'info'));

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (state.me?.settings?.theme === 'system') applySettings();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  $$('.modal-backdrop.open').forEach((modal) => modal.classList.remove('open'));
  $('searchOverlay')?.classList.remove('open');
  closeMediaLightbox();
  closeSidebar();
});

if (state.token) enterApp(); else showAuth();
