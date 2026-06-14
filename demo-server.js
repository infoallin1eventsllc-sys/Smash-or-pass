#!/bin/bash
# demo-server.js - Simple Node.js backend for demo

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = 3001;
const JWT_SECRET = 'demo-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Mock database
let users = [
  { id: 1, email: 'demo@example.com', password: 'DemoPass123!', name: 'John Doe', age: 25 }
];

let matches = [];
let messages = [];
let conversations = [];

// Auth Routes
app.post('/api/auth/register', (req, res) => {
  const { email, password, firstName, age } = req.body;

  if (!email || !password || !firstName || !age) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  }

  const existing = users.find(u => u.email === email);
  if (existing) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  const user = {
    id: users.length + 1,
    email,
    password, // In production, hash this!
    name: firstName,
    age: parseInt(age),
    createdAt: new Date()
  };

  users.push(user);

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

  res.status(201).json({
    success: true,
    token,
    user: { id: user.id, email: user.email, name: user.name, age: user.age }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  const user = users.find(u => u.email === email && u.password === password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

  res.json({
    success: true,
    token,
    user: { id: user.id, email: user.email, name: user.name, age: user.age }
  });
});

// Middleware: Verify JWT
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// User Routes
app.get('/api/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ id: user.id, name: user.name, age: user.age, email: user.email });
});

app.get('/api/users/discover/feed', authMiddleware, (req, res) => {
  // Return all other users
  const feed = users
    .filter(u => u.id !== req.userId)
    .map(u => ({ id: u.id, name: u.name, age: u.age, emoji: getEmoji(u.id) }));

  res.json(feed);
});

// Swipe Routes
app.post('/api/swipes', authMiddleware, (req, res) => {
  const { targetId, action } = req.body;

  if (!targetId || !['like', 'pass'].includes(action)) {
    return res.status(400).json({ error: 'Invalid swipe data' });
  }

  // Check for mutual like (match)
  const isMutualLike = Math.random() > 0.5;

  if (isMutualLike && action === 'like') {
    const match = {
      id: matches.length + 1,
      user1: req.userId,
      user2: targetId,
      createdAt: new Date()
    };
    matches.push(match);

    return res.status(201).json({ match: true, data: match });
  }

  res.status(201).json({ match: false });
});

// Conversation Routes
app.get('/api/conversations', authMiddleware, (req, res) => {
  const userConvs = conversations.filter(c => 
    c.participants.includes(req.userId)
  );

  res.json(userConvs);
});

app.post('/api/conversations/:convId/messages', authMiddleware, (req, res) => {
  const { text } = req.body;

  if (!text || text.length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  const message = {
    id: messages.length + 1,
    conversationId: req.params.convId,
    sender: req.userId,
    text,
    createdAt: new Date()
  };

  messages.push(message);

  res.status(201).json(message);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     SMASH OR PASS - DEMO SERVER RUNNING   ║
╠════════════════════════════════════════════╣
║  🚀 API Server: http://localhost:${PORT}      
║  🌐 Frontend: http://localhost:3000       
║  📊 Demo Account:                         
║     Email: demo@example.com               
║     Password: DemoPass123!                
║  🔒 All endpoints secured with JWT        
╚════════════════════════════════════════════╝
  `);
});
