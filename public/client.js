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
  addStyle('smooth-chat.css?v=1');
  addScript('client-core.js?v=1').then(() => addScript('smooth-chat.js?v=1')).catch((error) => console.error('Không tải được ứng dụng:', error));
})();
