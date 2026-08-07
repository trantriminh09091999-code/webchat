(() => {
  'use strict';
  if (typeof socket === 'undefined' || typeof state === 'undefined') return;

  let authenticated = false;
  let rejoinTimer = 0;

  function setConnectionText(text) {
    const side = document.getElementById('connectionSideText');
    const status = document.getElementById('currentGroupStatus');
    if (side) side.textContent = text;
    if (status && state.activeGroupId && /kết nối|realtime|Tin nhắn được lưu/i.test(status.textContent || '')) {
      const group = state.groups?.find?.((item) => String(item._id) === String(state.activeGroupId));
      status.textContent = `${group?.memberCount || state.groupDetail?.members?.length || 0} thành viên · ${text}`;
    }
  }

  function rejoinActiveGroup(delay = 0) {
    clearTimeout(rejoinTimer);
    rejoinTimer = setTimeout(() => {
      if (!authenticated || !state.activeGroupId || !socket.connected) return;
      socket.emit('joinGroup', state.activeGroupId);
    }, delay);
  }

  socket.on('authOk', () => {
    authenticated = true;
    setConnectionText('Đã kết nối realtime');
    rejoinActiveGroup(30);
  });

  socket.on('connect', () => {
    authenticated = false;
    setConnectionText('Đang xác thực…');
    if (state.token) socket.emit('auth', state.token);
  });

  socket.on('disconnect', () => {
    authenticated = false;
    setConnectionText('Mất kết nối · đang thử lại…');
  });

  socket.on('connect_error', () => {
    authenticated = false;
    setConnectionText('Không kết nối được máy chủ');
  });

  // selectGroup có thể chạy trước khi server xử lý xong auth trên mạng chậm.
  // Theo dõi thay đổi nhóm và tự join lại sau khi auth hoàn tất.
  let lastGroupId = state.activeGroupId;
  setInterval(() => {
    if (state.activeGroupId !== lastGroupId) {
      lastGroupId = state.activeGroupId;
      rejoinActiveGroup(40);
    }
  }, 250);

  // Nếu tab ngủ lâu trên điện thoại, socket có thể reconnect nhưng phòng chat chưa join lại.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && socket.connected) {
      if (state.token) socket.emit('auth', state.token);
      rejoinActiveGroup(120);
    }
  });

  window.addEventListener('online', () => {
    if (!socket.connected) socket.connect();
    else if (state.token) socket.emit('auth', state.token);
    rejoinActiveGroup(150);
  });

  // Hiển thị lỗi JS rõ ràng thay vì để nút bấm im lặng.
  window.addEventListener('error', (event) => {
    console.error('Squad OS UI error:', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Squad OS async error:', event.reason);
  });
})();
