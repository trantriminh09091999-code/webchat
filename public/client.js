const socket = io({ autoConnect: true });
const $ = (id) => document.getElementById(id);

const authScreen = $('authScreen');
const chatScreen = $('chatScreen');
const tabLogin = $('tabLogin');
const tabRegister = $('tabRegister');
const loginForm = $('loginForm');
const registerForm = $('registerForm');
const loginUsername = $('loginUsername');
const loginPassword = $('loginPassword');
const loginError = $('loginError');
const registerUsername = $('registerUsername');
const registerPassword = $('registerPassword');
const registerError = $('registerError');
const myNameLabel = $('myNameLabel');
const myAvatar = $('myAvatar');
const logoutBtn = $('logoutBtn');
const groupList = $('groupList');
const groupCountLabel = $('groupCountLabel');
const createGroupBtn = $('createGroupBtn');
const quickAddGroupBtn = $('quickAddGroupBtn');
const createGroupModal = $('createGroupModal');
const newGroupName = $('newGroupName');
const createGroupError = $('createGroupError');
const cancelCreateGroup = $('cancelCreateGroup');
const confirmCreateGroup = $('confirmCreateGroup');
const currentGroupName = $('currentGroupName');
const currentGroupAvatar = $('currentGroupAvatar');
const groupStatus = $('groupStatus');
const messagesEl = $('messages');
const composer = $('composer');
const textInput = $('textInput');
const sendBtn = $('sendBtn');
const attachBtn = $('attachBtn');
const fileInput = $('fileInput');
const attachPreview = $('attachPreview');
const attachName = $('attachName');
const attachMeta = $('attachMeta');
const previewThumb = $('previewThumb');
const cancelAttach = $('cancelAttach');
const typingIndicator = $('typingIndicator');
const menuBtn = $('menuBtn');
const closeMenuBtn = $('closeMenuBtn');
const sidebar = document.querySelector('.sidebar');
const mobileOverlay = $('mobileOverlay');
const onlineUsers = $('onlineUsers');
const onlineCount = $('onlineCount');
const toast = $('toast');
const connectionDot = $('connectionDot');
const connectionText = $('connectionText');
const mediaModal = $('mediaModal');
const mediaModalContent = $('mediaModalContent');
const closeMediaModal = $('closeMediaModal');

let myName = '';
let myToken = '';
let groups = [];
let activeGroupId = null;
let pendingAttachment = null;
let previewUrl = null;
let typingTimeout = null;
let typingClearTimer = null;
let toastTimer = null;

function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function showError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}
function hideError(el) { el.classList.add('hidden'); }

function setAuthTab(mode) {
  const login = mode === 'login';
  tabLogin.classList.toggle('active', login);
  tabRegister.classList.toggle('active', !login);
  loginForm.classList.toggle('hidden', !login);
  registerForm.classList.toggle('hidden', login);
}
tabLogin.addEventListener('click', () => setAuthTab('login'));
tabRegister.addEventListener('click', () => setAuthTab('register'));

async function authRequest(url, username, password, errorEl) {
  hideError(errorEl);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok) return showError(errorEl, data.error || 'Không thể thực hiện yêu cầu.');
    localStorage.setItem('t4_token', data.token);
    localStorage.setItem('t4_username', data.username);
    await enterChat(data.username, data.token);
  } catch (_err) {
    showError(errorEl, 'Không thể kết nối máy chủ.');
  }
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  authRequest('/api/login', loginUsername.value.trim(), loginPassword.value, loginError);
});
registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  authRequest('/api/register', registerUsername.value.trim(), registerPassword.value, registerError);
});

async function enterChat(name, token) {
  myName = name;
  myToken = token;
  myNameLabel.textContent = name;
  myAvatar.textContent = initials(name);
  authScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  socket.emit('auth', token);
  await loadGroups();
  textInput.focus();
}

(async function autoLogin() {
  const token = localStorage.getItem('t4_token');
  const username = localStorage.getItem('t4_username');
  if (!token || !username) return;
  try {
    const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error();
    await enterChat(username, token);
  } catch (_err) {
    localStorage.removeItem('t4_token');
    localStorage.removeItem('t4_username');
  }
})();

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('t4_token');
  localStorage.removeItem('t4_username');
  location.reload();
});

socket.on('connect', () => {
  connectionDot.classList.add('online');
  connectionText.textContent = 'Đã kết nối';
  if (myToken) socket.emit('auth', myToken);
});
socket.on('disconnect', () => {
  connectionDot.classList.remove('online');
  connectionText.textContent = 'Mất kết nối';
});
socket.on('authError', (message) => {
  showToast(message, 'error');
  localStorage.removeItem('t4_token');
  localStorage.removeItem('t4_username');
  setTimeout(() => location.reload(), 900);
});
socket.on('sendError', (message) => showToast(message, 'error'));
socket.on('groupsChanged', loadGroups);

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}
function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
function linkify(text) {
  return text.replace(/((https?:\/\/|www\.)[^\s<]+)/g, (url) => {
    const href = url.startsWith('http') ? url : `https://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}
function formatTime(value) {
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadGroups() {
  if (!myToken) return;
  try {
    const response = await fetch('/api/groups', { headers: { Authorization: `Bearer ${myToken}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    groups = data;
    renderGroups();
    if (activeGroupId && !groups.some((group) => group._id === activeGroupId)) activeGroupId = null;
    if (!activeGroupId && groups.length) selectGroup(groups[0]._id);
  } catch (_err) {
    showToast('Không tải được danh sách nhóm.', 'error');
  }
}

function renderGroups() {
  groupCountLabel.textContent = `${groups.length} nhóm`;
  groupList.innerHTML = '';
  groups.forEach((group) => {
    const item = document.createElement('li');
    item.className = `group-item${group._id === activeGroupId ? ' active' : ''}`;
    item.innerHTML = `<div class="group-avatar">${initials(group.name)}</div><div class="group-copy"><strong>${escapeHtml(group.name)}</strong><span>Nhấn để mở cuộc trò chuyện</span></div>`;
    item.addEventListener('click', () => selectGroup(group._id));
    groupList.appendChild(item);
  });
}

function selectGroup(groupId) {
  activeGroupId = groupId;
  const group = groups.find((item) => item._id === groupId);
  if (!group) return;
  currentGroupName.textContent = group.name;
  currentGroupAvatar.textContent = initials(group.name);
  groupStatus.textContent = 'Cuộc trò chuyện nhóm';
  typingIndicator.textContent = '';
  messagesEl.innerHTML = '<div class="loading-state">Đang tải tin nhắn…</div>';
  renderGroups();
  socket.emit('joinGroup', groupId);
  closeSidebar();
}

socket.on('groupHistory', ({ groupId, messages }) => {
  if (String(groupId) !== String(activeGroupId)) return;
  messagesEl.innerHTML = '';
  if (!messages.length) {
    messagesEl.innerHTML = '<div class="empty-state"><div>👋</div><h3>Chưa có tin nhắn</h3><p>Hãy là người bắt đầu cuộc trò chuyện.</p></div>';
    return;
  }
  messages.forEach(renderMessage);
  scrollToBottom();
});

socket.on('message', (message) => {
  if (String(message.groupId) !== String(activeGroupId)) return;
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) messagesEl.innerHTML = '';
  renderMessage(message);
  scrollToBottom();
});

function renderMessage(message) {
  const own = message.name === myName;
  const row = document.createElement('article');
  row.className = `message-row${own ? ' own' : ''}`;
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = initials(message.name);

  const content = document.createElement('div');
  content.className = 'message-content';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.innerHTML = `<strong>${escapeHtml(message.name)}</strong><span>${formatTime(message.time)}</span>`;
  content.appendChild(meta);

  if (message.text) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = linkify(escapeHtml(message.text));
    content.appendChild(bubble);
  }

  if (message.attachment?.url) {
    const attachment = document.createElement('button');
    attachment.type = 'button';
    attachment.className = 'attachment-card';
    if (message.attachment.type === 'video') {
      attachment.innerHTML = `<video src="${escapeHtml(message.attachment.url)}" preload="metadata" muted></video><span class="play-badge">▶</span>`;
    } else {
      attachment.innerHTML = `<img src="${escapeHtml(message.attachment.url)}" alt="Ảnh đính kèm" loading="lazy">`;
    }
    attachment.addEventListener('click', () => openMedia(message.attachment));
    content.appendChild(attachment);
  }

  if (!own) row.appendChild(avatar);
  row.appendChild(content);
  messagesEl.appendChild(row);
}

socket.on('typing', ({ name, isTyping }) => {
  clearTimeout(typingClearTimer);
  typingIndicator.textContent = isTyping ? `${name} đang nhập…` : '';
  if (isTyping) typingClearTimer = setTimeout(() => (typingIndicator.textContent = ''), 2500);
});

socket.on('presence', ({ users }) => {
  const uniqueUsers = Array.isArray(users) ? users : [];
  onlineCount.textContent = uniqueUsers.length;
  onlineUsers.innerHTML = '';
  if (!uniqueUsers.length) {
    onlineUsers.innerHTML = '<span class="muted">Chưa có ai trực tuyến</span>';
    return;
  }
  uniqueUsers.forEach((name) => {
    const item = document.createElement('div');
    item.className = 'online-user';
    item.innerHTML = `<div class="mini-avatar">${initials(name)}<i></i></div><span>${escapeHtml(name)}${name === myName ? ' (bạn)' : ''}</span>`;
    onlineUsers.appendChild(item);
  });
  groupStatus.textContent = `${uniqueUsers.length} người đang trực tuyến`;
});

function openCreateGroup() {
  newGroupName.value = '';
  hideError(createGroupError);
  createGroupModal.classList.remove('hidden');
  setTimeout(() => newGroupName.focus(), 50);
}
function closeCreateGroup() { createGroupModal.classList.add('hidden'); }
createGroupBtn.addEventListener('click', openCreateGroup);
quickAddGroupBtn.addEventListener('click', openCreateGroup);
cancelCreateGroup.addEventListener('click', closeCreateGroup);
createGroupModal.addEventListener('click', (event) => { if (event.target === createGroupModal) closeCreateGroup(); });
newGroupName.addEventListener('keydown', (event) => { if (event.key === 'Enter') confirmCreateGroup.click(); });
confirmCreateGroup.addEventListener('click', async () => {
  const name = newGroupName.value.trim();
  if (!name) return showError(createGroupError, 'Vui lòng nhập tên nhóm.');
  confirmCreateGroup.disabled = true;
  try {
    const response = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${myToken}` },
      body: JSON.stringify({ name })
    });
    const data = await response.json();
    if (!response.ok) return showError(createGroupError, data.error || 'Tạo nhóm thất bại.');
    closeCreateGroup();
    await loadGroups();
    selectGroup(data._id);
    showToast('Đã tạo nhóm mới.', 'success');
  } catch (_err) {
    showError(createGroupError, 'Không thể kết nối máy chủ.');
  } finally {
    confirmCreateGroup.disabled = false;
  }
});

function validateFile(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
  if (!allowed.includes(file.type)) return 'Định dạng file chưa được hỗ trợ.';
  if (file.size > 25 * 1024 * 1024) return 'File vượt quá giới hạn 25 MB.';
  return '';
}
function chooseFile(file) {
  const error = validateFile(file);
  if (error) return showToast(error, 'error');
  clearAttachment();
  pendingAttachment = file;
  previewUrl = URL.createObjectURL(file);
  attachName.textContent = file.name;
  attachMeta.textContent = `${file.type.startsWith('video/') ? 'Video' : 'Ảnh'} · ${formatBytes(file.size)}`;
  previewThumb.innerHTML = file.type.startsWith('video/')
    ? `<video src="${previewUrl}" muted></video>`
    : `<img src="${previewUrl}" alt="Xem trước">`;
  attachPreview.classList.remove('hidden');
}
function clearAttachment() {
  pendingAttachment = null;
  fileInput.value = '';
  attachPreview.classList.add('hidden');
  previewThumb.innerHTML = '';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => fileInput.files[0] && chooseFile(fileInput.files[0]));
cancelAttach.addEventListener('click', clearAttachment);
textInput.addEventListener('paste', (event) => {
  const file = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith('image/'))?.getAsFile();
  if (file) { event.preventDefault(); chooseFile(file); }
});

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${myToken}` },
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Gửi file thất bại.');
  return data;
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = textInput.value.trim();
  if ((!text && !pendingAttachment) || !activeGroupId) return;
  sendBtn.disabled = true;
  sendBtn.classList.add('sending');
  try {
    const attachment = pendingAttachment ? await uploadFile(pendingAttachment) : null;
    socket.emit('chatMessage', { text, attachment });
    textInput.value = '';
    autoResize();
    clearAttachment();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.classList.remove('sending');
    textInput.focus();
  }
});

function autoResize() {
  textInput.style.height = 'auto';
  textInput.style.height = `${Math.min(textInput.scrollHeight, 120)}px`;
}
textInput.addEventListener('input', () => {
  autoResize();
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 1000);
});
textInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }
function openSidebar() {
  sidebar.classList.add('open');
  mobileOverlay.classList.remove('hidden');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  mobileOverlay.classList.add('hidden');
}
menuBtn.addEventListener('click', openSidebar);
closeMenuBtn.addEventListener('click', closeSidebar);
mobileOverlay.addEventListener('click', closeSidebar);

function openMedia(attachment) {
  mediaModalContent.innerHTML = attachment.type === 'video'
    ? `<video src="${escapeHtml(attachment.url)}" controls autoplay></video>`
    : `<img src="${escapeHtml(attachment.url)}" alt="Ảnh phóng to">`;
  mediaModal.classList.remove('hidden');
}
function closeMedia() {
  mediaModal.classList.add('hidden');
  mediaModalContent.innerHTML = '';
}
closeMediaModal.addEventListener('click', closeMedia);
mediaModal.addEventListener('click', (event) => { if (event.target === mediaModal) closeMedia(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeMedia(); closeCreateGroup(); closeSidebar(); }
});
