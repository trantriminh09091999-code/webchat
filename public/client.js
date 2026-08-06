const socket = io();

// ---- Elements ----
const authScreen = document.getElementById('authScreen');
const chatScreen = document.getElementById('chatScreen');

const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');
const registerUsername = document.getElementById('registerUsername');
const registerPassword = document.getElementById('registerPassword');
const registerError = document.getElementById('registerError');

const myNameLabel = document.getElementById('myNameLabel');
const logoutBtn = document.getElementById('logoutBtn');

const groupList = document.getElementById('groupList');
const groupCountLabel = document.getElementById('groupCountLabel');
const createGroupBtn = document.getElementById('createGroupBtn');
const quickAddGroupBtn = document.getElementById('quickAddGroupBtn');
const createGroupModal = document.getElementById('createGroupModal');
const newGroupName = document.getElementById('newGroupName');
const createGroupError = document.getElementById('createGroupError');
const cancelCreateGroup = document.getElementById('cancelCreateGroup');
const confirmCreateGroup = document.getElementById('confirmCreateGroup');

const currentGroupName = document.getElementById('currentGroupName');
const currentGroupAvatar = document.getElementById('currentGroupAvatar');

const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const textInput = document.getElementById('textInput');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const attachPreview = document.getElementById('attachPreview');
const attachName = document.getElementById('attachName');
const cancelAttach = document.getElementById('cancelAttach');
const typingIndicator = document.getElementById('typingIndicator');
const menuBtn = document.getElementById('menuBtn');
const sidebar = document.querySelector('.sidebar');

let myName = '';
let myToken = '';
let pendingAttachment = null;
let typingTimeout = null;
let groups = [];
let activeGroupId = null;

// ---- Auth tabs ----
tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
});
tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerForm.classList.remove('hidden');
  loginForm.classList.add('hidden');
});

function showAuthError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function hideAuthError(el) { el.classList.add('hidden'); }

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthError(registerError);
  const username = registerUsername.value.trim();
  const password = registerPassword.value;
  if (!username || !password) return showAuthError(registerError, 'Vui lòng nhập đủ tên và mật khẩu.');
  try {
    const res = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(registerError, data.error || 'Đăng ký thất bại.');
    localStorage.setItem('t4_token', data.token);
    localStorage.setItem('t4_username', data.username);
    enterChat(data.username, data.token);
  } catch (err) { showAuthError(registerError, 'Lỗi kết nối máy chủ.'); }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthError(loginError);
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username || !password) return showAuthError(loginError, 'Vui lòng nhập đủ tên và mật khẩu.');
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(loginError, data.error || 'Đăng nhập thất bại.');
    localStorage.setItem('t4_token', data.token);
    localStorage.setItem('t4_username', data.username);
    enterChat(data.username, data.token);
  } catch (err) { showAuthError(loginError, 'Lỗi kết nối máy chủ.'); }
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('t4_token');
  localStorage.removeItem('t4_username');
  location.reload();
});

// ---- Enter chat ----
async function enterChat(name, token) {
  myName = name;
  myToken = token;
  myNameLabel.textContent = name;
  authScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  socket.emit('auth', token);
  await loadGroups();
  textInput.focus();
}

(function tryAutoLogin() {
  const token = localStorage.getItem('t4_token');
  const username = localStorage.getItem('t4_username');
  if (token && username) enterChat(username, token);
})();

socket.on('authError', (msg) => {
  localStorage.removeItem('t4_token');
  localStorage.removeItem('t4_username');
  alert(msg);
  location.reload();
});

menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));

// ---- Groups ----
function groupInitials(name) {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map(w => w[0]).join('').toUpperCase();
}

async function loadGroups() {
  try {
    const res = await fetch('/api/groups', { headers: { Authorization: 'Bearer ' + myToken } });
    groups = await res.json();
    renderGroupList();
    if (groups.length && !activeGroupId) {
      selectGroup(groups[0]._id);
    }
  } catch (err) {
    console.error('Không tải được danh sách nhóm', err);
  }
}

function renderGroupList() {
  groupCountLabel.textContent = `${groups.length} nhóm`;
  groupList.innerHTML = '';
  groups.forEach((g) => {
    const li = document.createElement('li');
    li.className = 'group-item' + (g._id === activeGroupId ? ' active' : '');
    li.innerHTML = `<div class="group-avatar">${groupInitials(g.name)}</div><div class="group-name">${escapeHtml(g.name)}</div>`;
    li.addEventListener('click', () => selectGroup(g._id));
    groupList.appendChild(li);
  });
}

function selectGroup(groupId) {
  activeGroupId = groupId;
  const g = groups.find((x) => x._id === groupId);
  if (g) {
    currentGroupName.textContent = g.name;
    currentGroupAvatar.textContent = groupInitials(g.name);
  }
  renderGroupList();
  messagesEl.innerHTML = '';
  socket.emit('joinGroup', groupId);
  sidebar.classList.remove('open');
}

socket.on('groupHistory', ({ groupId, messages }) => {
  if (groupId !== activeGroupId) return;
  messagesEl.innerHTML = '';
  messages.forEach(renderMessage);
  scrollToBottom();
});

socket.on('message', (msg) => {
  if (msg.groupId !== activeGroupId) return;
  renderMessage(msg);
  scrollToBottom();
});

let typingClearTimer = null;
socket.on('typing', ({ name, isTyping }) => {
  if (isTyping) {
    typingIndicator.textContent = `${name} đang nhập…`;
    clearTimeout(typingClearTimer);
    typingClearTimer = setTimeout(() => (typingIndicator.textContent = ''), 2500);
  }
});

// ---- Modal tạo nhóm ----
function openCreateGroupModal() {
  newGroupName.value = '';
  hideAuthError(createGroupError);
  createGroupModal.classList.remove('hidden');
  newGroupName.focus();
}
function closeCreateGroupModal() {
  createGroupModal.classList.add('hidden');
}
createGroupBtn.addEventListener('click', openCreateGroupModal);
quickAddGroupBtn.addEventListener('click', openCreateGroupModal);
cancelCreateGroup.addEventListener('click', closeCreateGroupModal);

confirmCreateGroup.addEventListener('click', async () => {
  const name = newGroupName.value.trim();
  if (!name) return showAuthError(createGroupError, 'Vui lòng nhập tên nhóm.');
  try {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + myToken },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(createGroupError, data.error || 'Tạo nhóm thất bại.');
    closeCreateGroupModal();
    await loadGroups();
    selectGroup(data._id);
  } catch (err) {
    showAuthError(createGroupError, 'Lỗi kết nối máy chủ.');
  }
});

// ---- Rendering ----
function renderMessage(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (msg.name === myName ? ' own' : '');

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = new Date(msg.time);
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  meta.innerHTML = `<span class="msg-name">${escapeHtml(msg.name)}</span><span>${hh}:${mm}</span>`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (msg.text) bubble.innerHTML = linkify(escapeHtml(msg.text));

  wrap.appendChild(meta);
  wrap.appendChild(bubble);

  if (msg.attachment) {
    const box = document.createElement('div');
    box.className = 'attachment';
    if (msg.attachment.type === 'video') {
      box.innerHTML = `<video src="${msg.attachment.url}" controls></video>`;
    } else {
      const img = document.createElement('img');
      img.src = msg.attachment.url;
      img.alt = 'Ảnh đính kèm';
      img.onload = scrollToBottom;
      box.appendChild(img);
    }
    wrap.appendChild(box);
  }

  messagesEl.appendChild(wrap);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function linkify(text) {
  const urlRegex = /((https?:\/\/|www\.)[^\s<]+)/g;
  return text.replace(urlRegex, (url) => {
    const href = url.startsWith('http') ? url : 'https://' + url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// ---- Sending ----
composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if ((!text && !pendingAttachment) || !activeGroupId) return;

  let attachment = null;
  if (pendingAttachment) {
    attachment = await uploadFile(pendingAttachment.file);
    if (!attachment) return;
  }

  socket.emit('chatMessage', { text, attachment });
  textInput.value = '';
  clearAttachment();
});

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    if (!res.ok) throw new Error('upload failed');
    return await res.json();
  } catch (err) {
    alert('Gửi file thất bại: ' + err.message);
    return null;
  }
}

textInput.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        pendingAttachment = { file };
        attachName.textContent = '📎 Ảnh đã dán';
        attachPreview.classList.remove('hidden');
      }
      e.preventDefault();
      break;
    }
  }
});

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  pendingAttachment = { file };
  attachName.textContent = '📎 ' + file.name;
  attachPreview.classList.remove('hidden');
});
cancelAttach.addEventListener('click', clearAttachment);
function clearAttachment() {
  pendingAttachment = null;
  fileInput.value = '';
  attachPreview.classList.add('hidden');
}

textInput.addEventListener('input', () => {
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 1200);
});
