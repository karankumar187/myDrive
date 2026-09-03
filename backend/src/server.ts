import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import passport from 'passport';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';

dotenv.config();

import { connectDatabase } from './config/database.js';
import { configurePassport } from './config/passport.js';
import { authRoutes } from './routes/auth.routes.js';
import { storageRoutes } from './routes/storage.routes.js';
import { fileRoutes } from './routes/file.routes.js';
import { deviceRoutes } from './routes/device.routes.js';
import { shortcutRoutes } from './routes/shortcut.routes.js';

const app = express();
const server = http.createServer(app);

// Global Socket.io instance
let io: SocketIOServer | null = null;

export function getSocketIoInstance(): SocketIOServer | null {
  return io;
}

// Parse allowed origins (comma-separated for multiple frontends)
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

// 1. Core Middlewares
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Be permissive for now; tighten in production
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// 2. Authentication Framework
configurePassport();
app.use(passport.initialize());

// 3. Socket.io Real-time Setup
io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Socket Handshake Authentication & Room Isolation (prevents IDOR on WebSockets)
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const deviceKey = socket.handshake.auth.deviceKey;

  if (token) {
    try {
      const secret = process.env.JWT_SECRET || 'fallback_secret_key_drive';
      const decoded = jwt.verify(token, secret) as any;
      socket.data.userId = decoded.userId;
      return next();
    } catch {
      return next(new Error('Authentication failed: Invalid JWT'));
    }
  }

  // Allow connection for paired devices or dev
  if (deviceKey) {
    socket.data.isDevice = true;
    return next();
  }

  next();
});

io.on('connection', (socket) => {
  if (socket.data.userId) {
    // Join isolated user room
    socket.join(`user:${socket.data.userId}`);
    console.log(`🔌 Client connected to room user:${socket.data.userId}`);
  }

  socket.on('disconnect', () => {
    // Connection closed
  });
});

// 4. API Endpoints
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/storage', storageRoutes);
app.use('/api/v1/files', fileRoutes);
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/shortcuts', shortcutRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'myDrive', timestamp: new Date() });
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

// 5. Server Startup
const PORT = process.env.PORT || 5001;

async function startServer() {
  await connectDatabase();

  server.listen(PORT, () => {
    console.log(`🚀 Unified Personal Cloud API running on http://localhost:${PORT}`);
  });
}

startServer();
