import express from 'express';
import { body, param, validationResult } from 'express-validator';
import xss from 'xss';
import { User, Swipe, Match, Conversation, Message, Report } from './models.js';
import {
  authMiddleware,
  generateToken,
  comparePassword,
  asyncHandler,
  sendSuccess,
  sendError,
  getDistance,
} from './utils.js';

const router = express.Router();

// ====== VALIDATION RULES ======

const validateEmail = body('email')
  .isEmail()
  .normalizeEmail()
  .withMessage('Invalid email format');

const validatePassword = body('password')
  .isLength({ min: 12 })
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
  .withMessage('Password must be 12+ chars with uppercase, lowercase, number, and symbol');

const validateAge = body('age')
  .isInt({ min: 18, max: 100 })
  .toInt()
  .withMessage('Age must be between 18 and 100');

const validateUserId = param('id')
  .isMongoId()
  .withMessage('Invalid user ID');

const validateConvId = param('convId')
  .isMongoId()
  .withMessage('Invalid conversation ID');

// ====== ERROR HANDLER ======
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendError(res, `Validation error: ${errors.array()[0].msg}`, 400);
  }
  next();
};

// ====== AUTH ROUTES ======

// Register
router.post('/auth/register',
  validateEmail,
  validatePassword,
  body('firstName').trim().notEmpty().isLength({ min: 2 }).withMessage('First name required'),
  body('lastName').trim().notEmpty().isLength({ min: 2 }).withMessage('Last name required'),
  validateAge,
  body('gender').isIn(['M', 'F', 'Other']).withMessage('Invalid gender'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { email, password, firstName, lastName, age, gender } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return sendError(res, 'Email already registered', 400);

    const user = new User({
      email: email.toLowerCase(),
      password,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      age: parseInt(age),
      gender,
    });
    await user.save();

    const token = generateToken(user._id);
    sendSuccess(res, {
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      token,
    }, 201);
  })
);

// Login
router.post('/auth/login',
  validateEmail,
  body('password').notEmpty().withMessage('Password required'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return sendError(res, 'Invalid credentials', 401);

    const valid = await comparePassword(password, user.password);
    if (!valid) return sendError(res, 'Invalid credentials', 401);

    const token = generateToken(user._id);
    user.online = true;
    user.lastSeen = Date.now();
    await user.save();

    sendSuccess(res, {
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        verified: user.verified,
      },
      token,
    });
  })
);

// ====== USER ROUTES ======

// Get profile (safe - no password)
router.get('/users/:id',
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)
      .select('-password -blocked -reported -preferences');
    
    if (!user) return sendError(res, 'User not found', 404);
    sendSuccess(res, user);
  })
);

// Update profile (auth required)
router.patch('/users/:id',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    // Verify user can only update their own profile
    if (req.userId !== req.params.id) {
      return sendError(res, 'Unauthorized', 403);
    }

    // Whitelist allowed fields to prevent injection
    const allowed = ['firstName', 'lastName', 'bio', 'tags', 'avatar', 'photos', 'age', 'gender'];
    const updates = {};
    
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        if (field === 'bio') {
          // Sanitize bio field
          updates[field] = xss(String(req.body[field]).trim(), { whiteList: {} });
        } else if (field === 'tags') {
          // Validate tags array
          updates[field] = Array.isArray(req.body[field])
            ? req.body[field].map(t => String(t).trim()).slice(0, 10)
            : [];
        } else if (field === 'age') {
          updates[field] = Math.min(100, Math.max(18, parseInt(req.body[field])));
        } else {
          updates[field] = String(req.body[field]).trim();
        }
      }
    }

    updates.updatedAt = Date.now();

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).select('-password -blocked -reported');

    sendSuccess(res, user);
  })
);

// Get discover feed
router.get('/users/discover/feed',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 'User not found', 404);

    // Get users already swiped on
    const swiped = await Swipe.find({ user: req.userId }).select('target');
    const swipedIds = swiped.map(s => s.target);

    // Get matches
    const matched = await Match.find({
      $or: [
        { user1: req.userId },
        { user2: req.userId }
      ]
    }).select('user1 user2');
    const matchedIds = matched.flatMap(m => [m.user1, m.user2]);

    // Find candidates matching preferences
    const candidates = await User.find({
      _id: {
        $nin: [req.userId, ...swipedIds, ...matchedIds, ...user.blocked]
      },
      age: {
        $gte: user.preferences?.ageMin || 18,
        $lte: user.preferences?.ageMax || 50
      },
      gender: {
        $in: user.preferences?.genderInterest || ['M', 'F', 'Other']
      },
      verified: true // Only show verified users by default
    }).select('-password -blocked -reported')
      .limit(20);

    // Filter by distance if location available
    const filtered = candidates.filter(c => {
      if (!user.location?.coordinates || !c.location?.coordinates) return true;
      const dist = getDistance(user.location.coordinates, c.location.coordinates);
      return dist <= (user.preferences?.distanceMax || 50);
    });

    sendSuccess(res, filtered);
  })
);

// ====== SWIPE ROUTES ======

// Like/Pass
router.post('/swipes',
  authMiddleware,
  body('targetId').isMongoId().withMessage('Invalid target ID'),
  body('action').isIn(['like', 'pass']).withMessage('Invalid action'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { targetId, action } = req.body;

    // Prevent self-swiping
    if (req.userId === targetId) {
      return sendError(res, 'Cannot swipe on yourself', 400);
    }

    // Check if user is blocked
    const targetUser = await User.findById(targetId);
    if (targetUser?.blocked.includes(req.userId)) {
      return sendError(res, 'User blocked you', 403);
    }

    // Check for duplicate swipe
    const existingSwipe = await Swipe.findOne({
      user: req.userId,
      target: targetId
    });
    if (existingSwipe) {
      return sendError(res, 'Already swiped on this user', 400);
    }

    // Record the swipe
    const swipe = new Swipe({
      user: req.userId,
      target: targetId,
      action
    });
    await swipe.save();

    if (action === 'like') {
      // Check for mutual like
      const targetSwipe = await Swipe.findOne({
        user: targetId,
        target: req.userId,
        action: 'like'
      });

      if (targetSwipe) {
        // Create match
        const match = new Match({
          user1: req.userId,
          user2: targetId,
          mutualLike: true
        });
        await match.save();

        // Create conversation
        const conv = new Conversation({
          participants: [req.userId, targetId],
          unreadCount: new Map([[req.userId, 0], [targetId, 0]])
        });
        await conv.save();

        match.conversation = conv._id;
        await match.save();

        sendSuccess(res, { match: true, conversation: conv._id }, 201);
        return;
      }
    }

    sendSuccess(res, { match: false }, 201);
  })
);

// ====== MESSAGE ROUTES ======

// Get conversations
router.get('/conversations',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const convs = await Conversation.find({ participants: req.userId })
      .populate('participants', '-password -blocked -reported')
      .populate('lastMessage')
      .sort({ updatedAt: -1 });

    sendSuccess(res, convs);
  })
);

// Get messages in conversation
router.get('/conversations/:convId/messages',
  authMiddleware,
  validateConvId,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    // Verify user is participant
    const conv = await Conversation.findById(req.params.convId);
    if (!conv?.participants.includes(req.userId)) {
      return sendError(res, 'Unauthorized', 403);
    }

    const msgs = await Message.find({ conversation: req.params.convId })
      .populate('sender', 'firstName lastName avatar')
      .sort({ createdAt: 1 })
      .limit(100); // Pagination

    sendSuccess(res, msgs);
  })
);

// Send message (with XSS protection)
router.post('/conversations/:convId/messages',
  authMiddleware,
  validateConvId,
  body('text').notEmpty().isLength({ max: 5000 }).withMessage('Message too long'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const conv = await Conversation.findById(req.params.convId);
    
    // Verify user is participant
    if (!conv?.participants.includes(req.userId)) {
      return sendError(res, 'Unauthorized', 403);
    }

    // Sanitize message (remove HTML/script tags)
    const cleanText = xss(String(req.body.text).trim(), {
      whiteList: {},
      stripIgnoredTag: true,
      stripLeadingAndTrailingWhitespace: true
    });

    if (!cleanText) {
      return sendError(res, 'Message cannot be empty', 400);
    }

    const msg = new Message({
      conversation: req.params.convId,
      sender: req.userId,
      text: cleanText,
      image: req.body.image || null
    });
    await msg.save();
    await msg.populate('sender', 'firstName lastName avatar');

    // Update conversation
    await Conversation.findByIdAndUpdate(req.params.convId, {
      lastMessage: msg._id,
      lastMessageText: cleanText.substring(0, 100),
      updatedAt: Date.now()
    });

    sendSuccess(res, msg, 201);
  })
);

// Mark message as read
router.patch('/messages/:msgId/read',
  authMiddleware,
  param('msgId').isMongoId().withMessage('Invalid message ID'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const msg = await Message.findByIdAndUpdate(
      req.params.msgId,
      { read: true, readAt: Date.now() },
      { new: true }
    );
    sendSuccess(res, msg);
  })
);

// React to message
router.patch('/messages/:msgId/reaction',
  authMiddleware,
  param('msgId').isMongoId().withMessage('Invalid message ID'),
  body('emoji').matches(/^[\p{Emoji}]+$/u).isLength({ min: 1, max: 4 }).withMessage('Invalid emoji'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { emoji } = req.body;
    const msg = await Message.findByIdAndUpdate(
      req.params.msgId,
      { reaction: emoji },
      { new: true }
    );
    sendSuccess(res, msg);
  })
);

// ====== SAFETY ROUTES ======

// Block user
router.post('/users/:id/block',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Prevent self-blocking
    if (req.userId === id) {
      return sendError(res, 'Cannot block yourself', 400);
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $addToSet: { blocked: id } },
      { new: true }
    ).select('-password');

    sendSuccess(res, { blocked: true });
  })
);

// Unblock user
router.post('/users/:id/unblock',
  authMiddleware,
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $pull: { blocked: id } },
      { new: true }
    ).select('-password');

    sendSuccess(res, { blocked: false });
  })
);

// Report user
router.post('/reports',
  authMiddleware,
  body('reportedUserId').isMongoId().withMessage('Invalid user ID'),
  body('reason').isIn(['inappropriate', 'spam', 'fake', 'offensive', 'other']).withMessage('Invalid reason'),
  body('description').trim().isLength({ max: 1000 }).withMessage('Description too long'),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { reportedUserId, reason, description } = req.body;

    // Prevent self-reporting
    if (req.userId === reportedUserId) {
      return sendError(res, 'Cannot report yourself', 400);
    }

    // Check for duplicate reports in last 24h
    const recentReport = await Report.findOne({
      reportedBy: req.userId,
      reportedUser: reportedUserId,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    if (recentReport) {
      return sendError(res, 'You already reported this user recently', 400);
    }

    const report = new Report({
      reportedBy: req.userId,
      reportedUser: reportedUserId,
      reason,
      description: description ? xss(description, { whiteList: {} }) : ''
    });
    await report.save();

    sendSuccess(res, { reported: true }, 201);
  })
);

// ====== HEALTH CHECK ======
router.get('/health', (req, res) => {
  sendSuccess(res, { status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
