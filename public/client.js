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

const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const textInput = document.getElementById('textInput');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const attachPreview = document.getElementById('attachPreview');
const attachName = document.getElementById('attachName');
const cancelAttach = document.getElementById('cancelAttach');
const userListEl = document.getElementById('userList');
const typingIndicator = document.getElementById('typingIndicator');
const menuBtn = document.getElementById('menuBtn');
const sidebar = document.querySelector('.sidebar');

let myName = '';
let pendingAttachment = null;
let typingTimeout = null;

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

function showAuthError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideAuthError(el) {
  el.classList.add('hidden');
}

// ---- Register ----
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthError(registerError);
  const username = registerUsername.value.trim();
  const password = registerPassword.value;
  if (!username || !password) {
    showAuthError(registerError, 'Vui lòng nhập đủ tên và mật khẩu.');
    return;
  }
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      showAuthError(registerError, data.error || 'Đăng ký thất bại.');
      return;
    }
    localStorage.setItem('romra_token', data.token);
    localStorage.setItem('romra_username', data.username);
    enterChat(data.username, data.token);
  } catch (err) {
    showAuthError(registerError, 'Lỗi kết nối máy chủ.');
  }
});

// ---- Login ----
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthError(loginError);
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username || !password) {
    showAuthError(loginError, 'Vui lòng nhập đủ tên và mật khẩu.');
    return;
  }
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      showAuthError(loginError, data.error || 'Đăng nhập thất bại.');
      return;
    }
    localStorage.setItem('romra_token', data.token);
    localStorage.setItem('romra_username', data.username);
    enterChat(data.username, data.token);
  } catch (err) {
    showAuthError(loginError, 'Lỗi kết nối máy chủ.');
  }
});

// ---- Logout ----
logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('romra_token');
  localStorage.removeItem('romra_username');
  location.reload();
});

// ---- Enter chat ----
function enterChat(name, token) {
  myName = name;
  myNameLabel.textContent = name;
  authScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  socket.emit('join', token);
  textInput.focus();
}

// ---- Auto login nếu đã có token lưu sẵn ----
(function tryAutoLogin() {
  const token = localStorage.getItem('romra_token');
  const username = localStorage.getItem('romra_username');
  if (token && username) {
    enterChat(username, token);
  }
})();

socket.on('authError', (msg) => {
  localStorage.removeItem('romra_token');
  localStorage.removeItem('romra_username');
  alert(msg);
  location.reload();
});

menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));

// ---- Receiving ----
socket.on('history', (history) => {
  messagesEl.innerHTML = '';
  history.forEach(renderMessage);
  scrollToBottom();
});

socket.on('message', (msg) => {
  renderMessage(msg);
  scrollToBottom();
});

socket.on('userList', (users) => {
  userListEl.innerHTML = '';
  users.forEach((u) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot"></span>${escapeHtml(u)}`;
    userListEl.appendChild(li);
  });
});

let typingClearTimer = null;
socket.on('typing', ({ name, isTyping }) => {
  if (isTyping) {
    typingIndicator.textContent = `${name} đang nhập…`;
    clearTimeout(typingClearTimer);
    typingClearTimer = setTimeout(() => (typingIndicator.textContent = ''), 2500);
  }
});

// ---- Rendering ----
function renderMessage(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (msg.system ? ' system' : msg.name === myName ? ' own' : '');

  if (msg.system) {
    wrap.textContent = msg.text;
    messagesEl.appendChild(wrap);
    return;
  }

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

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---- Sending ----
composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text && !pendingAttachment) return;

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

// ---- Dán ảnh bằng Ctrl+V ----
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

// ---- Typing indicator ----
textInput.addEventListener('input', () => {
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 1200);
});
