import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getServerUrl(): string {
  if (typeof window !== 'undefined') {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
      return import.meta.env.VITE_API_URL || 'http://localhost:5001';
    }
  }
  return import.meta.env.VITE_API_URL || 'https://drive-edge-cache.karan9302451907.workers.dev';
}

export function getSocket(): Socket {
  if (!socket) {
    const serverUrl = getServerUrl();

    socket = io(serverUrl, {
      auth: (cb) => {
        const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('drive_token') || '') : '';
        cb({ token });
      },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 4000,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });

    // Automatic token transmission on connection
    socket.on('connect', () => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('drive_token') : null;
      if (token && socket) {
        socket.emit('authenticate', { token });
      }
    });

    // PWA & Mobile WebKit Lifecycle: aggressive recovery from background suspension
    if (typeof window !== 'undefined') {
      const handleWake = () => {
        if (!socket) return;
        const token = localStorage.getItem('drive_token');
        if (!socket.connected) {
          if (token) {
            socket.auth = { token };
          }
          socket.connect();
        } else if (token) {
          socket.emit('authenticate', { token });
        }
      };

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          handleWake();
        }
      });
      window.addEventListener('pageshow', handleWake);
      window.addEventListener('online', handleWake);
      window.addEventListener('focus', handleWake);
    }
  }

  return socket;
}

export function refreshSocketAuth(): void {
  if (!socket) {
    getSocket();
    return;
  }
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('drive_token') : null;
  socket.auth = { token: token || '' };
  if (socket.connected && token) {
    socket.emit('authenticate', { token });
  } else if (!socket.connected) {
    socket.connect();
  }
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
