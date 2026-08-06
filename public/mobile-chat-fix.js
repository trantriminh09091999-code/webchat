(() => {
  const root = document.documentElement;
  const setHeight = () => {
    const h = window.visualViewport?.height || window.innerHeight;
    root.style.setProperty('--app-height', `${Math.round(h)}px`);
  };
  setHeight();
  window.addEventListener('resize', setHeight, { passive: true });
  window.visualViewport?.addEventListener('resize', setHeight, { passive: true });
  window.visualViewport?.addEventListener('scroll', setHeight, { passive: true });

  const prepareChat = () => {
    const list = document.getElementById('chatMessages');
    if (!list || list.dataset.mobileFixed) return;
    list.dataset.mobileFixed = '1';
    list.style.webkitOverflowScrolling = 'touch';
    list.addEventListener('touchstart', () => {}, { passive: true });
    list.addEventListener('wheel', (event) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.stopPropagation();
    }, { passive: true });
  };

  const observer = new MutationObserver(prepareChat);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  prepareChat();

  document.addEventListener('focusin', (event) => {
    if (!event.target.matches?.('#chatInput')) return;
    requestAnimationFrame(() => {
      setHeight();
      setTimeout(() => event.target.scrollIntoView({ block: 'nearest', behavior: 'auto' }), 80);
    });
  });

  document.addEventListener('focusout', (event) => {
    if (!event.target.matches?.('#chatInput')) return;
    setTimeout(setHeight, 120);
  });
})();
