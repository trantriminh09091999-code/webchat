(() => {
  'use strict';
  const originalIo = window.io;
  if (typeof originalIo !== 'function') return;

  window.io = function wrappedIo(...args) {
    const socket = originalIo(...args);
    const originalEmit = socket.emit.bind(socket);

    socket.emit = function wrappedEmit(eventName, ...eventArgs) {
      if (eventName === 'joinGroup' && eventArgs[0]) {
        window.__fourTayActiveGroupId = String(eventArgs[0]);
      }
      return originalEmit(eventName, ...eventArgs);
    };

    window.__fourTaySocket = socket;
    return socket;
  };

  Object.assign(window.io, originalIo);
})();
