(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

  function clickExisting(selector) {
    const target = qs(selector);
    if (!target) return false;
    target.click();
    return true;
  }

  function goView(view) {
    const target = qs(`[data-view="${view}"]`) || qs(`[data-go-view="${view}"]`);
    if (target) target.click();
  }

  const hub = document.createElement('div');
  hub.id = 'mobileFeatureHub';
  hub.className = 'mobile-feature-hub';
  hub.innerHTML = `
    <button class="feature-hub-backdrop" type="button" aria-label="Đóng bảng tính năng"></button>
    <section class="feature-hub-sheet" role="dialog" aria-modal="true" aria-label="Tất cả tính năng">
      <div class="feature-hub-handle"></div>
      <div class="feature-hub-head">
        <div><strong>Tất cả tính năng</strong><span>4 Anh Tày · Squad OS</span></div>
        <button class="feature-hub-close" type="button" aria-label="Đóng">×</button>
      </div>
      <div class="feature-hub-grid">
        <button data-feature="group"><i>👥</i><strong>Thông tin nhóm</strong><span>Thành viên, ghim, media</span></button>
        <button data-feature="create-group"><i>＋</i><strong>Tạo nhóm</strong><span>Mở phòng chat mới</span></button>
        <button data-feature="events"><i>🎮</i><strong>Kèo Liên Quân</strong><span>Lịch chơi và tham gia</span></button>
        <button data-feature="memories"><i>📸</i><strong>Kho kỷ niệm</strong><span>Ảnh và video đã lưu</span></button>
        <button data-feature="members"><i>🧑‍🤝‍🧑</i><strong>Thành viên</strong><span>Biệt danh và vai trò</span></button>
        <button data-feature="fund"><i>💰</i><strong>Quỹ nhóm</strong><span>Chi phí chung</span></button>
        <button data-feature="settings"><i>⚙️</i><strong>Cài đặt</strong><span>Avatar, tên, sáng tối</span></button>
        <button data-feature="search"><i>🔎</i><strong>Tìm kiếm</strong><span>Tìm tin trong nhóm</span></button>
      </div>
      <p class="feature-hub-note">Nút ⋯ trong Chat mở quản lý nhóm. Các mục chỉ hoạt động sau khi bạn chọn một nhóm.</p>
    </section>`;
  document.body.appendChild(hub);

  const launcher = document.createElement('button');
  launcher.id = 'mobileFeatureLauncher';
  launcher.className = 'mobile-feature-launcher';
  launcher.type = 'button';
  launcher.innerHTML = '<span>✦</span><b>Tính năng</b>';
  launcher.setAttribute('aria-label', 'Mở tất cả tính năng');
  document.body.appendChild(launcher);

  function openHub() {
    hub.classList.add('open');
    document.body.classList.add('feature-hub-open');
  }
  function closeHub() {
    hub.classList.remove('open');
    document.body.classList.remove('feature-hub-open');
  }

  launcher.addEventListener('click', openHub);
  qs('.feature-hub-close', hub).addEventListener('click', closeHub);
  qs('.feature-hub-backdrop', hub).addEventListener('click', closeHub);

  hub.addEventListener('click', (event) => {
    const button = event.target.closest('[data-feature]');
    if (!button) return;
    const feature = button.dataset.feature;
    closeHub();
    requestAnimationFrame(() => {
      if (feature === 'group') {
        if (!clickExisting('#groupOptionsBtn') && !clickExisting('#openGroupInfoBtn')) {
          goView('chat');
          setTimeout(() => clickExisting('#groupOptionsBtn'), 250);
        }
      } else if (feature === 'create-group') {
        if (!clickExisting('#createGroupBtn') && !clickExisting('#quickCreateGroupBtn')) {
          goView('chat');
          setTimeout(() => clickExisting('#createGroupBtn'), 250);
        }
      } else if (feature === 'search') {
        goView('chat');
        setTimeout(() => clickExisting('#chatSearchBtn'), 250);
      } else {
        goView(feature);
      }
    });
  });

  // Add a clear label to the existing three-dot button on mobile.
  const groupOptions = $('groupOptionsBtn');
  if (groupOptions) {
    groupOptions.setAttribute('title', 'Thông tin và quản lý nhóm');
    groupOptions.setAttribute('aria-label', 'Thông tin và quản lý nhóm');
  }

  // Keep the launcher above the browser keyboard and bottom navigation.
  function updateLauncherPosition() {
    const viewport = window.visualViewport;
    const keyboard = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    launcher.style.setProperty('--keyboard-offset', `${keyboard}px`);
  }
  window.visualViewport?.addEventListener('resize', updateLauncherPosition);
  window.visualViewport?.addEventListener('scroll', updateLauncherPosition);
  updateLauncherPosition();
})();
