# PixelScript - Ubuntu Setup Guide

**Date:** April 26, 2026  
**OS:** Ubuntu 24.04 LTS  
**Project:** PixelScript v1.0.0

---

## ✅ Completed Setup Steps

### 1. System Dependencies Installed
```bash
✓ Node.js: v18.19.1
✓ npm: 9.2.0
✓ Python: 3.12.3
✓ Build Tools: gcc, make, python3-dev (via build-essential)
```

**Installation Command Used:**
```bash
sudo apt update && sudo apt install -y nodejs npm build-essential python3
```

### 2. Project Dependencies Installed
```bash
✓ npm packages: 226 packages installed
✓ Vulnerabilities: 0 found
✓ Native modules: Rebuilt for Linux
```

**Installation Command:**
```bash
cd /home/rashi-kaur/Music/pixelscript/pixelscript
rm -rf node_modules package-lock.json
npm install
```

### 3. Git Configuration
```bash
✓ Git configured
✓ User: Rashi-1111
✓ Email: rashikaur2912@gmail.com
```

---

## 📋 Available npm Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Start production server |
| `npm run dev` | Start development server with auto-reload (requires nodemon) |
| `npm run backup:run` | Run backup to Cloudinary |
| `npm run backup:prune` | Prune old backups |
| `npm run backup:prune:dry` | Dry-run backup pruning |
| `npm run migrate:purchase-indexes` | Migrate purchase database indexes |
| `npm run e2e:roles` | Run all E2E role flow checks |
| `npm run e2e:roles:artist` | E2E check: Artist upload flow |
| `npm run e2e:roles:writer` | E2E check: Writer publish flow |
| `npm run e2e:roles:reader` | E2E check: Reader view flow |
| `npm run e2e:roles:purchase` | E2E check: Purchase/unlock flow |

---

## 🗄️ Database Setup

### MongoDB Setup

#### Option A: MongoDB Atlas (Cloud - Recommended)
**Status:** Already configured in `.env`

Your project is already connected to MongoDB Atlas:
```env
MONGO_URI=mongodb+srv://rashi_user:rashi321@cluster0.yonrzmb.mongodb.net/pixelscript?retryWrites=true&w=majority
```

#### Option B: Local MongoDB Installation

**Install MongoDB Community Edition:**
```bash
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
```

**Start MongoDB:**
```bash
sudo systemctl start mongod
sudo systemctl enable mongod  # Auto-start on boot
```

**Verify Connection:**
```bash
mongosh --uri "mongodb://localhost:27017/pixelscript"
```

**Update `.env` for local MongoDB:**
```env
MONGO_URI=mongodb://localhost:27017/pixelscript
```

---

### Redis Setup (Optional - For Socket.IO Scaling)

Redis is used for horizontal scaling of Socket.IO connections.

**Install Redis:**
```bash
sudo apt install -y redis-server
```

**Start Redis:**
```bash
sudo systemctl start redis-server
sudo systemctl enable redis-server  # Auto-start on boot
```

**Verify Connection:**
```bash
redis-cli ping
# Expected output: PONG
```

**Update `.env` to enable Redis:**
```env
REDIS_URL=redis://localhost:6379
SOCKET_PRESENCE_TTL_SECONDS=172800
```

---

## 🔧 Environment Configuration

### Current Environment Variables (`.env`)

The project is configured with:

**✅ Production Services:**
- MongoDB Atlas connection
- Cloudinary API keys
- Razorpay payment keys
- OpenAI/Groq AI provider keys

**⚠️ Update These for Development:**
```bash
# Development Server
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
SOCKET_CORS_ORIGIN=http://localhost:3000

# JWT & Session (Keep secure!)
JWT_SECRET=<keep-as-is>
SESSION_SECRET=<keep-as-is>
JWT_EXPIRES_IN=24h

# File Upload
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760  # 10MB

# API Rate Limiting
API_RATE_LIMIT_WINDOW_MS=900000
API_RATE_LIMIT_MAX=300
LOG_LEVEL=info

# Database
MONGO_URI=<already-configured>
MONGODB_URI=<already-configured>

# Redis (optional for horizontal scaling)
REDIS_URL=redis://localhost:6379
SOCKET_PRESENCE_TTL_SECONDS=172800
```

---

## 🚀 Starting the Application

### Development Mode (Recommended)
```bash
npm run dev
```
- Auto-reloads on file changes
- Verbose logging
- Accessible at: http://localhost:3000

### Production Mode
```bash
npm start
```

### Verify Server is Running
```bash
curl http://localhost:3000
# Should return HTML content
```

---

## 📊 Available Endpoints

**Metrics (Prometheus format):**
```bash
curl http://localhost:3000/metrics
```

**Health Check:**
Access the application at `http://localhost:3000`

---

## 📁 Project Structure

```
pixelscript/
├── config/
│   └── db.js                    # MongoDB connection
├── middleware/
│   ├── auth.js                  # JWT authentication
│   └── error.js                 # Error handling
├── models/                      # MongoDB schemas
│   ├── Collaboration.js
│   ├── Contact.js
│   ├── Purchase.js
│   ├── Room.js
│   ├── Story.js
│   ├── User.js
│   ├── Work.js
│   └── Workspace.js
├── routes/                      # API endpoints
│   ├── ai.js
│   ├── collab.js
│   ├── contact.js
│   ├── purchase.js
│   ├── story.js
│   ├── user.js
│   └── workspace.js
├── services/                    # Business logic
│   ├── cloudinary.js            # Media upload
│   └── storage.js
├── scripts/                     # Utilities
│   ├── backup-atlas-cloudinary.js
│   ├── e2e-role-flow-checks.js
│   ├── migrate-purchase-indexes.js
│   └── prune-backups.js
├── public/                      # Static files
│   ├── css/
│   ├── images/
│   ├── js/
│   ├── uploads/
│   └── *.html                   # UI pages
├── uploads/                     # User uploads
│   └── works/
├── docs/
│   └── backup-retention-policy.md
├── package.json
├── server.js                    # Main entry point
└── .env                         # Configuration (don't commit!)
```

---

## 🔄 CI/CD Pipeline

### GitHub Actions Workflow
**File:** `.github/workflows/e2e-role-flows.yml`

**Purpose:** Run end-to-end tests for all user roles

**Runs on:** `workflow_dispatch` (manual trigger)

**Environment Variables Required:**
```env
E2E_BASE_URL=http://localhost:3000
E2E_ARTIST_NAME=
E2E_ARTIST_USERNAME=
E2E_ARTIST_EMAIL=
E2E_ARTIST_PASSWORD=
E2E_WRITER_NAME=
E2E_WRITER_USERNAME=
E2E_WRITER_EMAIL=
E2E_WRITER_PASSWORD=
E2E_READER_NAME=
E2E_READER_USERNAME=
E2E_READER_EMAIL=
E2E_READER_PASSWORD=
RAZORPAY_KEY_SECRET=
```

**Flows Tested:**
1. Artist upload workflow
2. Writer publish workflow
3. Reader view workflow
4. Purchase/unlock workflow

---

## 🐛 Troubleshooting

### Node.js/npm Issues

**Issue:** Command not found: node
```bash
# Reinstall Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

**Issue:** npm install fails
```bash
# Clear npm cache
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### MongoDB Connection Issues

**Issue:** Cannot connect to MongoDB Atlas
```bash
# Check environment variables
grep MONGO_URI .env

# Test connection
mongosh --uri "mongodb+srv://rashi_user:rashi321@cluster0.yonrzmb.mongodb.net/pixelscript"
```

**Issue:** "Cannot connect to localhost:27017"
```bash
# Ensure MongoDB is running
sudo systemctl status mongod

# Start if needed
sudo systemctl start mongod
```

### Port Already in Use

**Issue:** Port 3000 already in use
```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill process (if needed)
sudo kill -9 <PID>

# Or use different port
PORT=3001 npm start
```

### Permission Issues with Uploads

**Issue:** Cannot write to uploads folder
```bash
# Fix permissions
chmod 755 /home/rashi-kaur/Music/pixelscript/pixelscript/uploads
chmod 755 /home/rashi-kaur/Music/pixelscript/pixelscript/public/uploads
```

---

## 📋 Pre-deployment Checklist

- [ ] Node.js v18+ installed
- [ ] npm dependencies installed (`npm install`)
- [ ] MongoDB connection verified
- [ ] Redis installed (optional)
- [ ] All environment variables set in `.env`
- [ ] Cloudinary API keys verified
- [ ] Razorpay credentials configured
- [ ] OpenAI/Groq API key set
- [ ] File upload directories have write permissions
- [ ] Server starts without errors (`npm run dev`)
- [ ] Can access http://localhost:3000

---

## 🔐 Security Notes

**Important:** Never commit `.env` to Git!

**Already in `.gitignore`:**
```
.env
.env.local
.env.*.local
node_modules/
uploads/
backups/
```

**Keep secure:**
- JWT_SECRET
- SESSION_SECRET
- API keys (Cloudinary, Razorpay, OpenAI)
- MongoDB connection URI

---

## 📞 Support Resources

- **Main README:** [README.md](./README.md)
- **Backup Policy:** [docs/backup-retention-policy.md](./docs/backup-retention-policy.md)
- **MongoDB Documentation:** https://docs.mongodb.com/
- **Express.js Guide:** https://expressjs.com/
- **Socket.IO Documentation:** https://socket.io/docs/

---

## 🎯 Next Steps

1. **Verify MongoDB connection:**
   ```bash
   mongosh --uri "mongodb+srv://rashi_user:rashi321@cluster0.yonrzmb.mongodb.net/pixelscript"
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```

3. **Test application:**
   - Open browser: http://localhost:3000
   - Check login page
   - Try creating an account

4. **Run E2E tests (optional):**
   ```bash
   npm run e2e:roles
   ```

---

**Setup Completed:** ✅  
**Last Updated:** 2026-04-26  
**System:** Ubuntu 24.04 LTS
