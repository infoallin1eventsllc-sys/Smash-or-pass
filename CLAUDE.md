# CLAUDE.md — Smash or Pass (Match, Chat, Love)

This file documents the codebase structure, development conventions, and workflow guidelines for AI assistants (and human developers) working in this repository.

---

## Project Overview

**Smash or Pass** is a swipe-based dating/matching app with real-time chat. This repository contains:

1. **A security audit and bug-fix delivery package** — documentation of 20 security vulnerabilities and 10 bugs fixed, plus hardened server code (`server-SECURE.js`, `routes-SECURE.js`, `websocket-SECURE.js`).
2. **A standalone demo server** (`demo-server.js`) — a self-contained Express app that runs an interactive demo of the full app in a browser without requiring MongoDB.

The **full production app** (React frontend + Node backend + MongoDB) is referenced in the architecture docs but lives in a separate deployment. The files in this repo are the security-hardened backend replacements to be copied into that app.

---

## Repository Contents

```
smash-or-pass/
├── server-SECURE.js              # Hardened Express server (replaces backend/src/server.js)
├── routes-SECURE.js              # Hardened API routes (replaces backend/src/routes.js)
├── websocket-SECURE.js           # Hardened Socket.io handler (replaces backend/src/websocket.js)
├── demo-server.js                # Self-contained demo (Express + in-memory data, no MongoDB)
├── DEMO.html                     # Full single-file demo UI (served by demo-server.js)
├── package.json                  # Demo server deps: express, cors, jsonwebtoken
│
├── README_START_HERE.md          # Primary entry point — read this first
├── COMPLETE_UPDATE_SUMMARY.md    # Overview of all 30 changes (20 security + 10 bugs)
├── IMPLEMENTATION_GUIDE.md       # Step-by-step instructions for applying the fixes
├── SECURITY_AUDIT.md             # Detailed vulnerability analysis (20 issues)
├── BUG_FIXES_TESTING.md          # Bug details and test procedures (10 bugs)
├── SECURITY_UPDATE_SUMMARY.md    # Concise changelog of what changed and why
├── MASTER_TROUBLESHOOTING.md     # Diagnosis guide for common failures
├── MALWARE_DETECTION.md          # Procedures for detecting malware/viruses
├── DEBUGGING_PROFILING.md        # Performance profiling and memory analysis
├── ADVANCED_THREAT_DETECTION.md  # Advanced security monitoring
├── QUICK_START.md                # 5-minute quick start for the demo
├── DEMO_SETUP_GUIDE.md           # Full demo setup instructions
├── COMPLETION_CHECKLIST.md       # Final pre-ship checklist
└── SUMMARY.md                    # High-level project summary
```

---

## Full App Architecture (Production Target)

The secure files in this repo are written to drop into a production app with this structure:

```
Frontend (React SPA — Vite)
  └── Screens: Auth, Discover (swipe), Chat, Messages, Profile, Match
  └── Talks to backend via REST API + Socket.io WebSocket

Backend (Node.js + Express)
  ├── REST routes: /auth/*, /users/*, /swipes/*, /conversations/*, /reports/*
  ├── WebSocket (Socket.io): message:send, typing:start/stop, match:notify
  └── Middleware: JWT auth, CORS, rate limiting, error handling

Database: MongoDB Atlas
  Collections: users, matches, messages, conversations, swipes, reports

External: Cloudinary (images), SendGrid/Resend (email)
```

### Data flow for a swipe
```
User swipes → POST /api/swipes (with JWT)
    → Backend checks for mutual like in DB
    → If match: create conversation + emit match:new via WebSocket
    → Browser shows match animation
    → User sends message via WebSocket message:send
    → Server broadcasts to recipient in real-time
```

---

## Tech Stack (Full Production App)

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 6, Tailwind CSS 3, Socket.io-client |
| Backend | Node.js 20 LTS, Express 4.18, Socket.io 4.7 |
| Database | MongoDB 7 (Atlas), Mongoose 8 |
| Auth | bcryptjs (password hashing), jsonwebtoken (JWT) |
| Security | helmet, cors, express-rate-limit, xss, express-validator, mongo-sanitize |
| DevOps | Docker, Docker Compose, GitHub Actions |

---

## Running the Demo

The demo requires only Node.js — no MongoDB needed.

```bash
npm install
npm start           # starts demo-server.js on http://localhost:3000
# or:
node demo-server.js
```

Open `http://localhost:3000` in a browser. The demo uses in-memory mock data and JWT tokens for a realistic preview without a real database.

---

## Applying the Security Fixes to the Production App

```bash
# 1. Copy the hardened files
cp server-SECURE.js    backend/src/server.js
cp routes-SECURE.js    backend/src/routes.js
cp websocket-SECURE.js backend/src/websocket.js

# 2. Install new security dependencies
npm install xss express-validator mongo-sanitize

# 3. Generate a strong JWT secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Update .env
#    JWT_SECRET=<generated secret>
#    ALLOWED_ORIGINS=https://your-domain.com

# 5. Run tests and security audit
npm test
npm audit
nx snyk test    # optional

# 6. Deploy
docker compose build && docker compose up -d
```

For the full step-by-step, read `IMPLEMENTATION_GUIDE.md`.

---

## Security Fixes Summary (20 issues)

| Severity | Count | Examples |
|---|---|---|
| Critical | 10 | SQL/NoSQL injection, hardcoded JWT secret, no rate limiting, missing auth on WebSocket |
| High | 2 | Weak password hashing rounds, missing CORS validation |
| Medium | 5 | XSS in messages, missing input sanitisation, insecure file upload |
| Low | 3 | Missing security headers, verbose error messages, missing logging |

Security score improved from **40% → 95%**.

Key protections added:
- Passwords: 12-round bcrypt hashing
- Tokens: JWT verified on every request, including WebSocket connections
- Messages: XSS-sanitised with `xss` library
- Database: NoSQL injection protected with `mongo-sanitize`
- Network: HTTPS enforced, strict CORS allowlist
- Rate limiting: tightened across all endpoints
- File uploads: type/size validation enforced

---

## Bug Fixes Summary (10 bugs)

| Category | Count |
|---|---|
| Frontend | 5 |
| Backend | 5 |

See `BUG_FIXES_TESTING.md` for details and test procedures.

---

## Authentication Flow

```
POST /auth/register
  → validate input → check email unique → hash password (bcrypt, 12 rounds)
  → save user to MongoDB → generate JWT → return token

POST /auth/login
  → validate input → find user by email → compare password hash
  → generate JWT → return token

All subsequent requests:
  Header: Authorization: Bearer <token>
  Middleware verifies token with JWT_SECRET before any route handler runs

WebSocket connections:
  Auth token passed in handshake query/headers
  Server verifies token before accepting the socket connection
```

---

## Environment Variables (Production)

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Secret for signing/verifying JWTs (32+ random bytes) |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins |
| `PORT` | Server port (default 3000) |
| `CLOUDINARY_*` | Image hosting credentials |
| `SENDGRID_API_KEY` | Email service key |

Never commit `.env`. Use `.env.example` as the template.

---

## Documentation Map

| Question | Document |
|---|---|
| Where do I start? | `README_START_HERE.md` |
| What changed overall? | `COMPLETE_UPDATE_SUMMARY.md` |
| How do I apply the fixes? | `IMPLEMENTATION_GUIDE.md` |
| What vulnerabilities were fixed? | `SECURITY_AUDIT.md` |
| What bugs were fixed? | `BUG_FIXES_TESTING.md` |
| Something broke | `MASTER_TROUBLESHOOTING.md` |
| Performance issues | `DEBUGGING_PROFILING.md` |
| Malware suspected | `MALWARE_DETECTION.md` |
| Architecture deep-dive | `ARCHITECTURE.md` |

---

## Notes for AI Assistants

- The `-SECURE.js` files are the canonical hardened versions. Do not modify the logic in these files without a security review. Changes should be additive (more validation, stricter rules), not reductive.
- The `demo-server.js` uses in-memory mock data and is intentionally simplified for demo purposes — it is not the production server.
- When adding new API endpoints, always: validate input with `express-validator`, sanitise with `mongo-sanitize`, require JWT auth middleware, apply rate limiting.
- WebSocket event handlers must verify the user's JWT before processing any event.
- MongoDB queries must sanitise all user-supplied fields before use (use `mongo-sanitize` at the route level).
- Docker Compose is the standard way to run the full stack locally in development.
