import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'mongo-sanitize';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { setupWebSocket } from './websocket.js';
import routes from './routes.js';
import 'dotenv/config';

const app = express();
const httpServer = createServer(app);

// ====== SECURITY HEADERS ======

// Helmet - Set secure HTTP headers
app.use(helmet());

// Content Security Policy
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    imgSrc: ["'self'", 'https:', 'data:'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    connectSrc: ["'self'", 'https:', 'wss:'],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
  }
}));

// HSTS - Force HTTPS
app.use(helmet.hsts({
  maxAge: 63072000, // 2 years
  includeSubDomains: true,
  preload: true
}));

// Prevent clickjacking
app.use(helmet.frameguard({ action: 'deny' }));

// Prevent MIME-type sniffing
app.use(helmet.noSniff());

// Enable XSS filtering
app.use(helmet.xssFilter());

// Referrer Policy
app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));

// Enforce HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(`https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// ====== CORS ======

// Whitelist allowed origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin.trim())) {
      callback(null, true);
    } else {
      callback(new Error(`CORS not allowed for origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400 // 24 hours
}));

// ====== RATE LIMITING ======

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' // Don't rate limit health check
});

// Strict auth rate limiter (5 attempts per 15 min)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, try again later',
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false
});

// Swipe rate limiter (10 swipes per minute)
const swipeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'You swiped too fast, slow down',
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', generalLimiter);
app.post('/api/auth/login', authLimiter);
app.post('/api/auth/register', authLimiter);
app.post('/api/swipes', swipeLimiter);

// ====== BODY PARSER ======

// JSON parser with size limit
app.use(express.json({ limit: '10kb' }));

// URL encoded parser with size limit
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ====== DATA SANITIZATION ======

// Sanitize data against NoSQL injection
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.warn(`Suspicious input detected in ${key}`);
  }
}));

// ====== REQUEST TIMEOUT ======

// Set timeout for requests (30 seconds)
app.use((req, res, next) => {
  req.setTimeout(30000);
  res.setTimeout(30000);
  next();
});

// ====== LOGGING ======

// Simple request logger (use Winston in production)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ====== DATABASE CONNECTION ======

mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  minPoolSize: 2,
}).then(() => {
  console.log('✅ MongoDB connected securely');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
});

// ====== ROUTES ======

app.use('/api', routes);

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV
  });
});

// ====== 404 HANDLER ======

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// ====== ERROR HANDLER ======

app.use((err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  // Don't expose internal error details to client
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ====== WEBSOCKET SETUP ======

const io = setupWebSocket(httpServer);

// ====== SERVER STARTUP ======

const PORT = process.env.PORT || 5000;

const server = httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║        SMASH OR PASS - API SERVER (SECURE)        ║
╠════════════════════════════════════════════════════╣
║  🚀 Server: http://localhost:${PORT}                       
║  🔐 HTTPS:  ${process.env.NODE_ENV === 'production' ? '✅ Enforced' : '❌ Dev mode'}
║  📡 WebSocket: Ready                               
║  🗄️  Database: Connected                           
║  🌍 CORS: ${allowedOrigins.join(', ')}
║  📊 Environment: ${process.env.NODE_ENV || 'development'}
╚════════════════════════════════════════════════════╝
  `);
});

// ====== GRACEFUL SHUTDOWN ======

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB disconnected');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB disconnected');
      process.exit(0);
    });
  });
});

// ====== UNCAUGHT EXCEPTIONS ======

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export default app;
