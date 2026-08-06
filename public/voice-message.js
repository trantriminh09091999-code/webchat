(() => {
  'use strict';

  const composerForm = document.getElementById('chatForm');
  const composer = composerForm?.closest('.composer');
  const sendButton = document.getElementById('sendChatBtn');
  if (!composerForm || !composer || !sendButton || typeof socket === 'undefined' || typeof state === 'undefined') return;

  let recorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let timer = null;
  let previewUrl = '';
  let voiceFile = null;
  let voiceDuration = 0;
  let sendingVoice = false;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'voiceRecordBtn';
  button.className = 'icon-btn voice-record-btn';
  button.title = 'Ghi âm';
  button.setAttribute('aria-label', 'Ghi âm');
  button.textContent = '🎤';
  composerForm.insertBefore(button, sendButton);

  const recordPanel = document.createElement('div');
  recordPanel.className = 'voice-record-panel hidden';
  recordPanel.innerHTML = '<span class="voice-record-dot"></span><strong>Đang ghi âm</strong><time>00:00</time><button type="button">Hủy</button>';
  composer.insertBefore(recordPanel, composerForm);

  const preview = document.createElement('div');
  preview.className = 'voice-preview hidden';
  preview.innerHTML = '<audio controls preload="metadata"></audio><button type="button" class="btn ghost small" data-action="delete">Xóa</button><button type="button" class="btn primary small" data-action="send">Gửi voice</button>';
  composer.insertBefore(preview, composerForm);

  const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  const chooseMime = () => {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return types.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  };

  const cleanupStream = () => {
    clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const clearVoice = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    voiceFile = null;
    voiceDuration = 0;
    preview.classList.add('hidden');
    preview.querySelector('audio').removeAttribute('src');
  };

  async function startRecording() {
    if (!state.activeGroupId) return toast('Chưa chọn nhóm', 'Hãy chọn một nhóm trước khi ghi âm.', 'error');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return toast('Thiết bị chưa hỗ trợ', 'Trình duyệt này không hỗ trợ ghi âm. Hãy dùng Chrome hoặc Edge mới.', 'error');
    }
    clearVoice();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mimeType = chooseMime();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined);
      chunks = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        // Backend hiện tại chấp nhận video/webm; nội dung vẫn là âm thanh và được hiển thị bằng audio player.
        voiceFile = new File([blob], `VOICE__${Date.now()}__${Math.round(voiceDuration)}s.webm`, { type: 'video/webm' });
        previewUrl = URL.createObjectURL(blob);
        const audio = preview.querySelector('audio');
        audio.src = previewUrl;
        preview.classList.remove('hidden');
        recordPanel.classList.add('hidden');
        button.classList.remove('recording');
        button.textContent = '🎤';
        cleanupStream();
      };
      recorder.start(250);
      startedAt = Date.now();
      recordPanel.classList.remove('hidden');
      button.classList.add('recording');
      button.textContent = '■';
      timer = setInterval(() => {
        voiceDuration = (Date.now() - startedAt) / 1000;
        recordPanel.querySelector('time').textContent = formatTime(voiceDuration);
        if (voiceDuration >= 180) stopRecording();
      }, 250);
    } catch (error) {
      cleanupStream();
      toast('Không mở được micro', error.name === 'NotAllowedError' ? 'Bạn cần cho phép trang web sử dụng micro.' : error.message, 'error');
    }
  }

  function stopRecording(cancel = false) {
    if (!recorder || recorder.state === 'inactive') return;
    if (cancel) {
      recorder.onstop = () => {
        recordPanel.classList.add('hidden');
        button.classList.remove('recording');
        button.textContent = '🎤';
        cleanupStream();
      };
    } else {
      voiceDuration = Math.max(.5, (Date.now() - startedAt) / 1000);
    }
    recorder.stop();
  }

  function emitVoice(payload) {
    return new Promise((resolve, reject) => {
      socket.timeout(15000).emit('chatMessage', payload, (error, response) => {
        if (error) return reject(new Error('Máy chủ không phản hồi.'));
        if (!response?.ok) return reject(new Error(response?.error || 'Không gửi được voice.'));
        resolve(response);
      });
    });
  }

  async function sendVoice() {
    if (!voiceFile || sendingVoice) return;
    if (!state.activeGroupId) return toast('Chưa chọn nhóm', 'Hãy chọn một nhóm trước.', 'error');
    sendingVoice = true;
    const send = preview.querySelector('[data-action="send"]');
    send.disabled = true;
    send.textContent = 'Đang gửi…';
    try {
      const attachment = await uploadFile(voiceFile);
      attachment.name = voiceFile.name;
      await emitVoice({ text: `[VOICE:${Math.round(voiceDuration)}]`, attachment });
      clearVoice();
      toast('Đã gửi voice', `${formatTime(voiceDuration)}`, 'success');
    } catch (error) {
      toast('Chưa gửi được voice', `${error.message} Bản ghi vẫn được giữ để thử lại.`, 'error');
    } finally {
      sendingVoice = false;
      send.disabled = false;
      send.textContent = 'Gửi voice';
    }
  }

  button.addEventListener('click', () => {
    if (recorder?.state === 'recording') stopRecording();
    else startRecording();
  });
  recordPanel.querySelector('button').addEventListener('click', () => stopRecording(true));
  preview.querySelector('[data-action="delete"]').addEventListener('click', clearVoice);
  preview.querySelector('[data-action="send"]').addEventListener('click', sendVoice);

  function enhanceVoiceRow(row) {
    if (!row || row.dataset.voiceEnhanced === '1') return;
    const body = row.querySelector('.message-body');
    const text = body?.textContent || '';
    const match = text.match(/\[VOICE:(\d+)\]/);
    const video = row.querySelector('.attachment-card video');
    if (!match || !video) return;
    row.dataset.voiceEnhanced = '1';
    body.classList.add('voice-marker');
    const attachmentCard = video.closest('.attachment-card');
    const src = video.currentSrc || video.src;
    const total = Number(match[1]) || 0;
    const player = document.createElement('div');
    player.className = 'voice-player';
    player.innerHTML = `<button type="button" class="voice-play">▶</button><div class="voice-track"><input type="range" min="0" max="${Math.max(1, total)}" value="0" step="0.1"><div class="voice-meta"><span>Voice</span><time>00:00 / ${formatTime(total)}</time></div></div><button type="button" class="voice-speed">1x</button><audio preload="metadata" src="${src}"></audio>`;
    attachmentCard.replaceWith(player);
    const audio = player.querySelector('audio');
    const play = player.querySelector('.voice-play');
    const range = player.querySelector('input');
    const time = player.querySelector('time');
    const speed = player.querySelector('.voice-speed');
    play.addEventListener('click', async () => {
      if (audio.paused) {
        document.querySelectorAll('.voice-player audio').forEach((other) => { if (other !== audio) other.pause(); });
        await audio.play().catch(() => toast('Không phát được voice', 'Hãy chạm lại nút phát.', 'error'));
      } else audio.pause();
    });
    audio.addEventListener('play', () => { play.textContent = '❚❚'; });
    audio.addEventListener('pause', () => { play.textContent = '▶'; });
    audio.addEventListener('ended', () => { play.textContent = '▶'; range.value = 0; });
    audio.addEventListener('timeupdate', () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : total;
      range.max = Math.max(1, duration || total);
      range.value = audio.currentTime;
      time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration || total)}`;
    });
    range.addEventListener('input', () => { audio.currentTime = Number(range.value); });
    speed.addEventListener('click', () => {
      const values = [1, 1.5, 2];
      const next = values[(values.indexOf(audio.playbackRate) + 1) % values.length];
      audio.playbackRate = next;
      speed.textContent = `${next}x`;
    });
  }

  const root = document.getElementById('chatMessages');
  const scan = () => root?.querySelectorAll('.chat-message').forEach(enhanceVoiceRow);
  new MutationObserver(scan).observe(root, { childList: true, subtree: true });
  scan();
})();
