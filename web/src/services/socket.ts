import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = localStorage.getItem('drive_token') || undefined;
    const serverUrl = import.meta.env.VITE_API_URL || '/';
    socket = io(serverUrl, {
      auth: { token },
      autoConnect: true,
      reconnection: true,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
