import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Message, User, Conversation } from './models.js';
import xss from 'xss';

export const setupWebSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
      credentials: true,
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 10e4, // 100KB max message size
    pingInterval: 25000,
    pingTimeout: 20000
  });

  const userSockets = new Map(); // userId -> socketId
  const userTyping = new Map(); // conversationId -> Set<userId>

  // ====== AUTHENTICATION MIDDLEWARE ======
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication required: no token provided'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new Error('Token expired'));
      }
      return next(new Error('Invalid token'));
    }
  });

  // ====== CONNECTION HANDLER ======
  io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.userId} (${socket.id})`);

    // ====== USER JOIN ======
    socket.on('user:join', async (userId) => {
      // Verify token matches user ID
      if (socket.userId !== userId) {
        socket.emit('error', 'User ID mismatch');
        return;
      }

      userSockets.set(userId, socket.id);
      socket.join(`user:${userId}`);

      // Update user online status
      await User.findByIdAndUpdate(userId, {
        online: true,
        lastSeen: Date.now()
      }).catch(err => console.error('DB error:', err));

      // Broadcast user online
      io.emit('user:online', {
        userId,
        online: true,
        timestamp: Date.now()
      });

      socket.emit('connection:success', {
        userId,
        timestamp: Date.now()
      });

      console.log(`👤 User ${userId} marked as online`);
    });

    // ====== TYPING INDICATOR ======
    socket.on('typing:start', (convId) => {
      // Validate conversation exists
      if (!convId || convId.length !== 24) {
        socket.emit('error', 'Invalid conversation ID');
        return;
      }

      if (!userTyping.has(convId)) {
        userTyping.set(convId, new Set());
      }
      userTyping.get(convId).add(socket.userId);

      socket.broadcast.emit('typing:status', {
        conversationId: convId,
        userId: socket.userId,
        typing: true,
        timestamp: Date.now()
      });
    });

    socket.on('typing:stop', (convId) => {
      if (userTyping.has(convId)) {
        userTyping.get(convId).delete(socket.userId);
      }

      socket.broadcast.emit('typing:status', {
        conversationId: convId,
        userId: socket.userId,
        typing: false,
        timestamp: Date.now()
      });
    });

    // ====== MESSAGE SENDING ======
    socket.on('message:send', async (data) => {
      try {
        const { conversationId, text, image } = data;

        // Validate input
        if (!conversationId || !text) {
          socket.emit('error', 'Missing required fields');
          return;
        }

        if (text.length > 5000) {
          socket.emit('error', 'Message too long (max 5000 chars)');
          return;
        }

        // Verify conversation exists and user is participant
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          socket.emit('error', 'Conversation not found');
          return;
        }

        if (!conversation.participants.includes(socket.userId)) {
          socket.emit('error', 'Not a participant in this conversation');
          return;
        }

        // Sanitize message content (XSS protection)
        const cleanText = xss(String(text).trim(), {
          whiteList: {},
          stripIgnoredTag: true,
          stripLeadingAndTrailingWhitespace: true
        });

        if (!cleanText) {
          socket.emit('error', 'Message cannot be empty');
          return;
        }

        // Create message
        const message = new Message({
          conversation: conversationId,
          sender: socket.userId,
          text: cleanText,
          image: image ? String(image).substring(0, 500) : null
        });

        await message.save();
        await message.populate('sender', 'firstName lastName avatar');

        // Update conversation
        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: message._id,
          lastMessageText: cleanText.substring(0, 100),
          updatedAt: Date.now()
        });

        // Broadcast to all participants
        io.emit('message:new', {
          conversationId,
          message,
          timestamp: Date.now()
        });

        console.log(`💬 Message sent in ${conversationId}`);
      } catch (err) {
        console.error('Message send error:', err);
        socket.emit('error', 'Failed to send message');
      }
    });

    // ====== MESSAGE READ ======
    socket.on('message:read', async (messageId) => {
      try {
        if (!messageId || messageId.length !== 24) {
          socket.emit('error', 'Invalid message ID');
          return;
        }

        const message = await Message.findByIdAndUpdate(messageId, {
          read: true,
          readAt: Date.now()
        });

        if (!message) {
          socket.emit('error', 'Message not found');
          return;
        }

        io.emit('message:marked-read', {
          messageId,
          userId: socket.userId,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('Message read error:', err);
        socket.emit('error', 'Failed to mark message as read');
      }
    });

    // ====== MESSAGE REACTION ======
    socket.on('message:react', async (data) => {
      try {
        const { messageId, emoji } = data;

        if (!messageId || !emoji) {
          socket.emit('error', 'Missing required fields');
          return;
        }

        // Validate emoji (basic check)
        if (!/^[\p{Emoji}]+$/u.test(emoji) || emoji.length > 4) {
          socket.emit('error', 'Invalid emoji');
          return;
        }

        const message = await Message.findByIdAndUpdate(messageId, {
          reaction: emoji
        });

        if (!message) {
          socket.emit('error', 'Message not found');
          return;
        }

        io.emit('message:reaction', {
          messageId,
          emoji,
          userId: socket.userId,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('Reaction error:', err);
        socket.emit('error', 'Failed to add reaction');
      }
    });

    // ====== MATCH NOTIFICATION ======
    socket.on('match:notify', async (data) => {
      try {
        const { targetUserId } = data;

        if (!targetUserId) {
          socket.emit('error', 'Target user ID required');
          return;
        }

        const targetSocketId = userSockets.get(targetUserId);
        if (targetSocketId) {
          io.to(targetSocketId).emit('match:new', {
            matchedWith: socket.userId,
            timestamp: Date.now()
          });
        }

        console.log(`❤️ Match notification sent to ${targetUserId}`);
      } catch (err) {
        console.error('Match notification error:', err);
        socket.emit('error', 'Failed to send match notification');
      }
    });

    // ====== DISCONNECT ======
    socket.on('disconnect', async () => {
      try {
        if (socket.userId) {
          userSockets.delete(socket.userId);

          // Update user offline status
          await User.findByIdAndUpdate(socket.userId, {
            online: false,
            lastSeen: Date.now()
          });

          // Broadcast user offline
          io.emit('user:offline', {
            userId: socket.userId,
            timestamp: Date.now()
          });

          // Clean up typing status
          for (const [convId, typingUsers] of userTyping.entries()) {
            if (typingUsers.has(socket.userId)) {
              typingUsers.delete(socket.userId);
              if (typingUsers.size === 0) {
                userTyping.delete(convId);
              }
            }
          }

          console.log(`👋 User disconnected: ${socket.userId}`);
        }
      } catch (err) {
        console.error('Disconnect error:', err);
      }
    });

    // ====== ERROR HANDLER ======
    socket.on('error', (error) => {
      console.error('Socket error:', {
        userId: socket.userId,
        error: error.message
      });

      socket.emit('error', {
        message: 'An error occurred',
        timestamp: Date.now()
      });
    });
  });

  // ====== MONITORING ======
  setInterval(() => {
    console.log(`📊 WebSocket Stats: ${io.engine.clientsCount} connected users`);
  }, 60000);

  return io;
};
