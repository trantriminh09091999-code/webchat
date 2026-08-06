(() => {
  'use strict';

  const chat = document.getElementById('chatMessages');
  if (!chat || typeof state === 'undefined' || typeof socket === 'undefined') return;

  let nearBottom = true;
  let lastStableTop = 0;
  let unseen = 0;
  let sending = false;
  let typingActive = false;
  let typingStopTimer = 0;

  const distanceToBottom = () => chat.scrollHeight - chat.scrollTop - chat.clientHeight;
  const updateScrollState = () => {
    nearBottom = distanceToBottom() < 120;
    if (!nearBottom) lastStableTop = chat.scrollTop;
    if (nearBottom) {
      unseen = 0;
      updateNewMessageButton();
    }
  };

  chat.addEventListener('scroll', updateScrollState, { passive: true });
  updateScrollState();

  const jumpButton = document.createElement('button');
  jumpButton.type = 'button';
  jumpButton.className = 'new-message-jump hidden';
  jumpButton.setAttribute('aria-label', 'Xem tin nhắn mới');
  jumpButton.addEventListener('click', () => {
    chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
    unseen = 0;
    nearBottom = true;
    updateNewMessageButton();
  });
  chat.parentElement?.appendChild(jumpButton);

  function updateNewMessageButton() {
    jumpButton.textContent = unseen > 1 ? `${unseen} tin nhắn mới ↓` : 'Tin nhắn mới ↓';
    jumpButton.classList.toggle('hidden', unseen === 0 || nearBottom);
  }

  function tuneMedia(root = chat) {
    root.querySelectorAll('img').forEach((image) => {
      image.loading = 'lazy';
      image.decoding = 'async';
    });
    root.querySelectorAll('video').forEach((video) => {
      video.preload = 'metadata';
      video.playsInline = true;
    });
  }

  function removeDuplicateRows() {
    const seen = new Set();
    chat.querySelectorAll('[data-id]').forEach((row) => {
      const id = row.dataset.id;
      if (!id) return;
      if (seen.has(id)) row.remove();
      else seen.add(id);
    });
  }

  const observer = new MutationObserver((records) => {
    let addedMessages = 0;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('[data-id], .message-row, .chat-message')) addedMessages += 1;
        tuneMedia(node);
      }
    }
    removeDuplicateRows();
    requestAnimationFrame(() => {
      if (nearBottom) chat.scrollTop = chat.scrollHeight;
      else if (addedMessages) {
        chat.scrollTop = lastStableTop;
        unseen += addedMessages;
        updateNewMessageButton();
      }
    });
  });
  observer.observe(chat, { childList: true, subtree: true });
  tuneMedia();

  try {
    if (typeof scrollChatToBottom === 'function') {
      scrollChatToBottom = (force = false) => {
        if (force || nearBottom) chat.scrollTop = chat.scrollHeight;
      };
    }
  } catch (_) {}
  try {
    if (typeof scrollBottom === 'function') {
      scrollBottom = (force = false) => {
        if (force || nearBottom) chat.scrollTop = chat.scrollHeight;
      };
    }
  } catch (_) {}

  const originalForm = document.getElementById('chatForm');
  if (originalForm) {
    const form = originalForm.cloneNode(true);
    originalForm.replaceWith(form);

    const input = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendChatBtn');
    const attachButton = document.getElementById('attachBtn');
    const fileInput = document.getElementById('fileInput');
    const cancelUpload = document.getElementById('cancelUpload');

    attachButton?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => chooseFile(fileInput.files?.[0]));
    cancelUpload?.addEventListener('click', clearPendingFile);

    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
      if (!typingActive) {
        typingActive = true;
        socket.emit('typing', true);
      }
      clearTimeout(typingStopTimer);
      typingStopTimer = setTimeout(() => {
        typingActive = false;
        socket.emit('typing', false);
      }, 850);
    }, { passive: true });

    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (sending) return;
      const text = input?.value.trim() || '';
      if (!state.activeGroupId) return toast('Chưa chọn nhóm', 'Hãy chọn một nhóm trước.', 'error');
      if (!text && !state.pendingFile) return;

      sending = true;
      if (sendButton) {
        sendButton.disabled = true;
        sendButton.classList.add('is-sending');
      }

      const tempId = `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const optimistic = document.createElement('article');
      optimistic.className = 'message-row own optimistic-message';
      optimistic.dataset.tempId = tempId;
      optimistic.innerHTML = `<div class="message-content"><div class="message-bubble">${text ? escapeHtml(text) : state.pendingFile?.type?.startsWith('video/') ? 'Đang gửi video…' : 'Đang gửi ảnh…'}</div><div class="optimistic-status">Đang gửi…</div></div>`;
      chat.appendChild(optimistic);
      chat.scrollTop = chat.scrollHeight;

      try {
        const attachment = state.pendingFile ? await uploadFile(state.pendingFile) : null;
        await emitChatMessage({ text, attachment });
        if (input) {
          input.value = '';
          input.style.height = 'auto';
        }
        clearPendingFile();
        optimistic.remove();
      } catch (error) {
        optimistic.classList.add('failed');
        const status = optimistic.querySelector('.optimistic-status');
        if (status) status.textContent = 'Gửi thất bại · chạm để thử lại';
        optimistic.addEventListener('click', () => form.requestSubmit(), { once: true });
        toast('Chưa gửi được', `${error.message} Nội dung vẫn được giữ lại.`, 'error');
      } finally {
        sending = false;
        if (sendButton) {
          sendButton.disabled = false;
          sendButton.classList.remove('is-sending');
        }
      }
    });
  }

  document.addEventListener('paste', (event) => {
    if (!state.me) return;
    const image = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    chooseFile(image.getAsFile());
  }, true);

  const visualViewport = window.visualViewport;
  const updateViewport = () => {
    const height = visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  };
  visualViewport?.addEventListener('resize', updateViewport, { passive: true });
  window.addEventListener('resize', updateViewport, { passive: true });
  updateViewport();

  socket.on('connect', () => document.body.classList.remove('socket-offline'));
  socket.on('disconnect', () => document.body.classList.add('socket-offline'));
})();
