const socket = io();

const joinScreen = document.getElementById('joinScreen');
const chatScreen = document.getElementById('chatScreen');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');

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
let pendingAttachment = null; // { url, type, file }
let typingTimeout = null;

// ---- Join flow ----
function doJoin() {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  myName = name;
  joinScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  socket.emit('join', name);
  textInput.focus();
}
joinBtn.addEventListener('click', doJoin);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

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
      box.innerHTML = `<img src="${msg.attachment.url}" alt="Ảnh đính kèm" />`;
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
    if (!attachment) return; // upload failed
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
