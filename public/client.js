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

  Promise.all([
    addStyle('smooth-chat.css?v=3'),
    addStyle('mobile-scroll-fix.css?v=2'),
    addStyle('mobile-feature-hub.css?v=1'),
    addStyle('voice-message.css?v=1')
  ]).then(() => addScript('client-core.js?v=3'))
    .then(() => addScript('smooth-chat.js?v=3'))
    .then(() => addScript('mobile-scroll-fix.js?v=2'))
    .then(() => addScript('mobile-feature-hub.js?v=1'))
    .then(() => addScript('voice-message.js?v=1'))
    .catch((error) => console.error('Không tải được ứng dụng:', error));
})();
