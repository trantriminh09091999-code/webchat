(() => {
  const addStyle = (href) => new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
  const addScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });

  // Ưu tiên độ ổn định: client-core giữ toàn bộ chức năng chính.
  // Không nạp smooth-chat.js vì lớp thay form thử nghiệm có thể làm mất listener trên một số trình duyệt di động.
  Promise.all([
    addStyle('smooth-chat.css?v=4'),
    addStyle('mobile-scroll-fix.css?v=3'),
    addStyle('mobile-feature-hub.css?v=2'),
    addStyle('voice-message.css?v=2')
  ])
    .then(() => addScript('client-core.js?v=4'))
    .then(() => addScript('realtime-reliability.js?v=1'))
    .then(() => addScript('mobile-scroll-fix.js?v=3'))
    .then(() => addScript('mobile-feature-hub.js?v=2'))
    .then(() => addScript('voice-message.js?v=2'))
    .catch((error) => {
      console.error('Không tải được ứng dụng:', error);
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:99999;background:#b42318;color:#fff;padding:12px 14px;border-radius:12px;font:600 14px system-ui';
      banner.textContent = 'Ứng dụng chưa tải đủ. Hãy tải lại trang hoặc kiểm tra kết nối.';
      document.body.appendChild(banner);
    });
})();
