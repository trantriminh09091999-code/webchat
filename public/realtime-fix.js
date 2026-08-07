(() => {
  'use strict';
  if (typeof socket === 'undefined' || typeof state === 'undefined') return;

  let realtimeReady = false;
  let authTimer = null;

  const setStatus = (text) => {
    const el = document.getElementById('groupStatus');
    if (el && state.active) el.textContent = text;
  };

  function authenticateAndRejoin() {
    if (!state.token || !socket.connected) return;
    realtimeReady = false;
    clearTimeout(authTimer);
    setStatus('Đang kết nối realtime…');
    socket.emit('auth', state.token);
    authTimer = setTimeout(() => {
      if (!realtimeReady) setStatus('Kết nối chậm · đang thử lại…');
    }, 5000);
  }

  socket.on('authOk', () => {
    realtimeReady = true;
    clearTimeout(authTimer);
    if (state.active) {
      socket.emit('joinGroup', state.active);
      const group = state.groups?.find?.((g) => String(g._id) === String(state.active));
      setStatus(`${group?.memberCount || 0} thành viên · Đã kết nối`);
    }
  });

  socket.on('authError', () => {
    realtimeReady = false;
    setStatus('Phiên đăng nhập lỗi · hãy đăng nhập lại');
  });

  socket.on('connect', authenticateAndRejoin);
  socket.on('disconnect', () => {
    realtimeReady = false;
    setStatus('Mất kết nối · đang kết nối lại…');
  });

  // Sau khi nhóm được chọn, authOk có thể đến muộn. Rejoin thêm một lần khi socket đã sẵn sàng.
  document.getElementById('groupList')?.addEventListener('click', () => {
    setTimeout(() => {
      if (realtimeReady && state.active) socket.emit('joinGroup', state.active);
    }, 60);
  });

  // Chặn gửi trong khoảng socket chưa xác thực để tránh lỗi "Bạn chưa vào nhóm".
  const composer = document.getElementById('composer');
  composer?.addEventListener('submit', (event) => {
    if (realtimeReady) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    authenticateAndRejoin();
    if (typeof toast === 'function') toast('Đang kết nối lại…', 'error');
  }, true);

  // Khi history về là bằng chứng phòng đã join thành công.
  socket.on('groupHistory', ({ groupId }) => {
    if (String(groupId) !== String(state.active)) return;
    realtimeReady = true;
    const group = state.groups?.find?.((g) => String(g._id) === String(state.active));
    setStatus(`${group?.memberCount || 0} thành viên · Đã kết nối`);
  });

  if (socket.connected) authenticateAndRejoin();
})();
