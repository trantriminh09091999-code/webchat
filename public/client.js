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

const currentGroupNameEl = document.getElementById('currentGroupName');
const currentGroupAvatar = document.getElementById('currentGroupAvatar');
const groupSettingsBtn = document.getElementById('groupSettingsBtn');

const pinnedBar = document.getElementById('pinnedBar');
const pinnedText = document.getElementById('pinnedText');

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
const sendBtn = document.getElementById('sendBtn');

// Settings panel elements
const groupSettingsOverlay = document.getElementById('groupSettingsOverlay');
const closeGroupSettings = document.getElementById('closeGroupSettings');
const muteToggle = document.getElementById('muteToggle');
const nicknameInput = document.getElementById('nicknameInput');
const saveNicknameBtn = document.getElementById('saveNicknameBtn');
const memberList = document.getElementById('memberList');
const memberCount = document.getElementById('memberCount');
const addMemberInput = document.getElementById('addMemberInput');
const addMemberBtn = document.getElementById('addMemberBtn');
const memberError = document.getElementById('memberError');
const mediaGrid = document.getElementById('mediaGrid');
const mediaEmpty = document.getElementById('mediaEmpty');
const pinnedList = document.getElementById('pinnedList');
const pinnedEmpty = document.getElementById('pinnedEmpty');
const leaveGroupBtn = document.getElementById('leaveGroupBtn');
const deleteGroupBtn = document.getElementById('deleteGroupBtn');

let myName = '';
let myToken = '';
let pendingAttachment = null;
let isSending = false;
let typingTimeout = null;
let groups = [];
let activeGroupId = null;
let activeGroupData = null;
let pinnedMessages = [];

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
  return words.map((w) => w[0]).join('').toUpperCase();
}

function isMuted(groupId) {
  const muted = JSON.parse(localStorage.getItem('t4_muted') || '[]');
  return muted.includes(groupId);
}
function setMuted(groupId, muted) {
  let list = JSON.parse(localStorage.getItem('t4_muted') || '[]');
  if (muted && !list.includes(groupId)) list.push(groupId);
  if (!muted) list = list.filter((id) => id !== groupId);
  localStorage.setItem('t4_muted', JSON.stringify(list));
}

async function loadGroups() {
  try {
    const res = await fetch('/api/groups', { headers: { Authorization: 'Bearer ' + myToken } });
    groups = await res.json();
    renderGroupList();
    if (groups.length && !activeGroupId) selectGroup(groups[0]._id);
  } catch (err) { console.error('Không tải được danh sách nhóm', err); }
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
  activeGroupData = g || null;
  if (g) {
    currentGroupNameEl.textContent = g.name;
    currentGroupAvatar.textContent = groupInitials(g.name);
  }
  renderGroupList();
  messagesEl.innerHTML = '';
  pinnedMessages = [];
  updatePinnedBar();
  socket.emit('joinGroup', groupId);
  sidebar.classList.remove('open');
}

socket.on('groupHistory', ({ groupId, messages }) => {
  if (groupId !== activeGroupId) return;
  messagesEl.innerHTML = '';
  messages.forEach(renderMessage);
  pinnedMessages = messages.filter((m) => m.pinned);
  updatePinnedBar();
  scrollToBottom();
});

socket.on('message', (msg) => {
  if (msg.groupId !== activeGroupId) return;
  renderMessage(msg);
  scrollToBottom();
});

socket.on('groupCreated', (group) => {
  if (!groups.find((g) => g._id === group._id)) {
    groups.push(group);
    renderGroupList();
  }
});

socket.on('groupUpdated', (group) => {
  const idx = groups.findIndex((g) => g._id === group._id);
  if (idx >= 0) groups[idx] = group;
  if (activeGroupId === group._id) activeGroupData = group;
  renderGroupList();
});

socket.on('groupDeleted', (groupId) => {
  groups = groups.filter((g) => g._id !== groupId);
  if (activeGroupId === groupId) {
    activeGroupId = null;
    activeGroupData = null;
    messagesEl.innerHTML = '';
    currentGroupNameEl.textContent = '—';
    currentGroupAvatar.textContent = '';
    groupSettingsOverlay.classList.add('hidden');
    if (groups.length) selectGroup(groups[0]._id);
  }
  renderGroupList();
});

socket.on('pinnedUpdate', ({ groupId, pinned }) => {
  if (groupId !== activeGroupId) return;
  pinnedMessages = pinned;
  updatePinnedBar();
  document.querySelectorAll('.pin-btn').forEach((btn) => {
    const id = btn.dataset.msgId;
    btn.classList.toggle('pinned', pinned.some((p) => p._id === id));
  });
});

function updatePinnedBar() {
  if (pinnedMessages.length === 0) {
    pinnedBar.classList.add('hidden');
    return;
  }
  pinnedBar.classList.remove('hidden');
  const latest = pinnedMessages[0];
  pinnedText.textContent = `${latest.name}: ${latest.text || '[tệp đính kèm]'}`;
}

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
function closeCreateGroupModal() { createGroupModal.classList.add('hidden'); }
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
  } catch (err) { showAuthError(createGroupError, 'Lỗi kết nối máy chủ.'); }
});

// ---- Panel cài đặt nhóm ----
groupSettingsBtn.addEventListener('click', openGroupSettings);
closeGroupSettings.addEventListener('click', () => groupSettingsOverlay.classList.add('hidden'));

async function openGroupSettings() {
  if (!activeGroupId) return;
  hideAuthError(memberError);
  muteToggle.checked = isMuted(activeGroupId);
  const myNick = (activeGroupData?.nicknames || {})[myName] || '';
  nicknameInput.value = myNick;
  renderMemberList();
  await loadMedia();
  renderPinnedList();
  groupSettingsOverlay.classList.remove('hidden');
}

muteToggle.addEventListener('change', () => {
  setMuted(activeGroupId, muteToggle.checked);
});

saveNicknameBtn.addEventListener('click', async () => {
  try {
    const res = await fetch(`/api/groups/${activeGroupId}/nickname`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + myToken },
      body: JSON.stringify({ nickname: nicknameInput.value.trim() })
    });
    const data = await res.json();
    if (res.ok) activeGroupData = data;
  } catch (err) { /* im lặng */ }
});

function renderMemberList() {
  const members = activeGroupData?.members || [];
  memberCount.textContent = members.length;
  memberList.innerHTML = '';
  members.forEach((m) => {
    const li = document.createElement('li');
    li.className = 'member-item';
    const isOwner = activeGroupData.createdBy === m;
    const nick = (activeGroupData.nicknames || {})[m];
    li.innerHTML = `
      <div class="member-avatar">${escapeHtml(m[0]?.toUpperCase() || '?')}</div>
      <div class="member-name">${escapeHtml(nick ? `${nick} (${m})` : m)}</div>
      ${isOwner ? '<span class="member-owner-tag">Chủ nhóm</span>' : ''}
      ${(!isOwner && (activeGroupData.createdBy === myName || m === myName)) ? '<button class="member-remove-btn" title="Xóa khỏi nhóm">✕</button>' : ''}
    `;
    const removeBtn = li.querySelector('.member-remove-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        try {
          const res = await fetch(`/api/groups/${activeGroupId}/members/${encodeURIComponent(m)}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + myToken }
          });
          const data = await res.json();
          if (res.ok) { activeGroupData = data; renderMemberList(); }
        } catch (err) { /* im lặng */ }
      });
    }
    memberList.appendChild(li);
  });
}

addMemberBtn.addEventListener('click', async () => {
  hideAuthError(memberError);
  const username = addMemberInput.value.trim();
  if (!username) return;
  try {
    const res = await fetch(`/api/groups/${activeGroupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + myToken },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(memberError, data.error || 'Thêm thất bại.');
    activeGroupData = data;
    addMemberInput.value = '';
    renderMemberList();
  } catch (err) { showAuthError(memberError, 'Lỗi kết nối máy chủ.'); }
});

async function loadMedia() {
  mediaGrid.innerHTML = '';
  try {
    const res = await fetch(`/api/groups/${activeGroupId}/media`, { headers: { Authorization: 'Bearer ' + myToken } });
    const media = await res.json();
    mediaEmpty.classList.toggle('hidden', media.length > 0);
    media.forEach((m) => {
      const el = document.createElement(m.attachment.type === 'video' ? 'video' : 'img');
      el.src = m.attachment.url;
      if (m.attachment.type === 'video') el.muted = true;
      mediaGrid.appendChild(el);
    });
  } catch (err) { mediaEmpty.classList.remove('hidden'); }
}

function renderPinnedList() {
  pinnedList.innerHTML = '';
  pinnedEmpty.classList.toggle('hidden', pinnedMessages.length > 0);
  pinnedMessages.forEach((m) => {
    const li = document.createElement('li');
    li.className = 'pinned-item';
    const time = new Date(m.time);
    const hh = String(time.getHours()).padStart(2, '0');
    const mm = String(time.getMinutes()).padStart(2, '0');
    li.innerHTML = `<div class="pinned-item-meta">${escapeHtml(m.name)} · ${hh}:${mm}</div>${escapeHtml(m.text || '[tệp đính kèm]')}`;
    pinnedList.appendChild(li);
  });
}

leaveGroupBtn.addEventListener('click', async () => {
  if (!confirm('Bạn chắc chắn muốn rời nhóm này?')) return;
  try {
    await fetch(`/api/groups/${activeGroupId}/leave`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + myToken }
    });
    groupSettingsOverlay.classList.add('hidden');
    await loadGroups();
  } catch (err) { alert('Lỗi kết nối máy chủ.'); }
});

deleteGroupBtn.addEventListener('click', async () => {
  if (!confirm('Xóa nhóm sẽ mất toàn bộ tin nhắn. Bạn chắc chắn?')) return;
  try {
    const res = await fetch(`/api/groups/${activeGroupId}`, {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + myToken }
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Xóa nhóm thất bại.');
    groupSettingsOverlay.classList.add('hidden');
  } catch (err) { alert('Lỗi kết nối máy chủ.'); }
});

// ---- Rendering tin nhắn ----
function renderMessage(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (msg.name === myName ? ' own' : '');

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = new Date(msg.time);
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  const pinnedNow = pinnedMessages.some((p) => p._id === msg._id);
  meta.innerHTML = `<span class="msg-name">${escapeHtml(msg.name)}</span><span>${hh}:${mm}</span><button class="pin-btn${pinnedNow ? ' pinned' : ''}" data-msg-id="${msg._id}" title="Ghim tin nhắn">📌</button>`;

  const pinBtn = meta.querySelector('.pin-btn');
  pinBtn.addEventListener('click', () => {
    socket.emit('pinMessage', { groupId: activeGroupId, messageId: msg._id });
  });

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

// ---- Gửi tin nhắn (đã sửa: khóa nút khi đang gửi, chỉ cần bấm 1 lần) ----
composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isSending) return;

  const text = textInput.value.trim();
  if ((!text && !pendingAttachment) || !activeGroupId) return;

  isSending = true;
  sendBtn.disabled = true;
  attachBtn.disabled = true;
  const originalLabel = sendBtn.textContent;
  sendBtn.textContent = 'Đang gửi...';

  try {
    let attachment = null;
    if (pendingAttachment) {
      attachment = await uploadFile(pendingAttachment.file);
      if (!attachment) return;
    }
    socket.emit('chatMessage', { text, attachment });
    textInput.value = '';
    clearAttachment();
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    attachBtn.disabled = false;
    sendBtn.textContent = originalLabel;
    textInput.focus();
  }
});

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      alert('Gửi file thất bại: ' + (data.error || 'lỗi không xác định'));
      return null;
    }
    return data;
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
