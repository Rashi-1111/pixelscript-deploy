# PixelScript

A collaborative platform for artists and writers to work together on creative projects in real-time. Create stories, share artwork, and build amazing creative works together!

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)

## 🎨 Features

- **Real-time Collaboration** - Work together simultaneously with artists and writers
- **Live Drawing Canvas** - Interactive drawing tools for creative sketching
- **Real-time Chat** - Communicate instantly within collaboration rooms
- **User Authentication** - Secure JWT-based authentication system
- **Profile Management** - Customize your profile and showcase your work
- **Rating & Reviews** - Rate and review collaborations
- **Genre-based Matching** - Find collaborators based on genres and interests
- **User Roles** - Support for artists, writers, collaborators, and readers

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | HTML5, CSS3, JavaScript (ES6+) |
| **Backend** | Node.js, Express.js |
| **Database** | MongoDB |
| **Object Storage** | Cloudinary |
| **Real-time** | Socket.IO |
| **Authentication** | JWT (JSON Web Tokens) |
| **Security** | bcryptjs |
| **File Upload** | Multer |

## 📋 Prerequisites

- Node.js (>=14.0.0)
- MongoDB (local or cloud instance)
- npm or yarn package manager
- Git

## 🚀 Installation & Setup

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/pixelscript.git
cd pixelscript
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Copy `.env.example` to `.env` and update with your configuration:
```bash
cp .env.example .env
```

Edit `.env` with your values:
```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/pixelscript
JWT_SECRET=your_secure_jwt_secret_key
JWT_EXPIRES_IN=24h
NODE_ENV=development
SESSION_SECRET=your_session_secret
MAX_FILE_SIZE=10485760

# Browser / Socket CORS
CORS_ORIGIN=http://localhost:3000
SOCKET_CORS_ORIGIN=http://localhost:3000

# Cloudinary (media storage)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_FOLDER=pixelscript

# Payments
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# API rate limiting and logging
API_RATE_LIMIT_WINDOW_MS=900000
API_RATE_LIMIT_MAX=300
LOG_LEVEL=info

# Socket.IO horizontal scaling (optional)
REDIS_URL=redis://localhost:6379
SOCKET_PRESENCE_TTL_SECONDS=172800

# AI provider
OPENAI_API_KEY=your_openai_compatible_api_key_here
OPENAI_MODEL=qwen/qwen3-32b
OPENAI_BASE_URL=https://api.groq.com/openai
AI_HTTP_REFERER=http://localhost:3000
AI_APP_TITLE=PixelScript

# Contact email notifications (optional)
EMAIL_SERVICE=
EMAIL_USER=
EMAIL_PASS=
```

Metrics endpoint: `GET /metrics`

Backup scripts:
- `npm run backup:run`
- `npm run backup:prune`
- `npm run backup:prune:dry`

Role flow e2e check:
- `npm run e2e:roles`
- `npm run e2e:roles:artist`
- `npm run e2e:roles:writer`
- `npm run e2e:roles:reader`
- `npm run e2e:roles:purchase`

### 4. Start the server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The server will start at `http://localhost:3000`

## 💾 Backups and Retention

Deployment policy and checklist:
- `docs/backup-retention-policy.md`

Environment variables:
```env
BACKUP_OUTPUT_DIR=./backups
BACKUP_RETENTION_DAYS=30
```

## ✅ Role Flow Production Checks

Run end-to-end checks for:
- artist upload
- writer publish
- reader view
- purchase unlock

Command:
```bash
npm run e2e:roles
```

Per-flow commands:
```bash
npm run e2e:roles:artist
npm run e2e:roles:writer
npm run e2e:roles:reader
npm run e2e:roles:purchase
```

Flow-specific exit codes:
- auth/setup failure: `20`
- artist-upload failure: `21`
- writer-publish failure: `22`
- reader-view failure: `23`
- purchase-unlock failure: `24`

Optional env overrides:
- `E2E_BASE_URL`
- `E2E_ARTIST_*`
- `E2E_WRITER_*`
- `E2E_READER_*`

Note: purchase unlock check requires `RAZORPAY_KEY_SECRET` in env.

GitHub Actions workflow:
- `.github/workflows/e2e-role-flows.yml`

## 📁 Project Structure

```
pixelscript/
├── config/              # Database configuration
├── middleware/          # Express middleware (auth, error handling)
├── models/              # MongoDB schemas
├── public/              # Static HTML, CSS, JS, images
├── routes/              # API route handlers
│   ├── ai.js
│   ├── collab.js
│   ├── contact.js
│   ├── purchase.js
│   ├── story.js
│   ├── user.js
│   └── workspace.js
├── scripts/             # Backup, migration, and E2E utilities
├── services/            # Business logic and external integrations
├── uploads/             # Local file storage
├── server.js            # Express + Socket.IO entrypoint
└── package.json         # Dependencies and npm scripts
```

## 🔌 API Endpoints

### User and Auth Routes (`/api/users`)
- `POST /register` - Register a new user
- `POST /login` - Sign in and set the `ps_auth` cookie
- `POST /logout` - Clear the auth cookie
- `GET /me` - Fetch the current user
- `PUT /profile` - Update the current user profile
- `GET /discover` - Find users by role and profile filters
- `GET /works` / `POST /works` - Manage portfolio items

### Collaboration Routes (`/api/collab`)
- Create, discover, update, publish, and review collaborations
- Upload cover images and collaboration files
- Fetch collaboration details and the current user's collaboration lists

### Story Routes (`/api/stories`)
- Create and update stories
- Publish stories
- Fetch the public feed and full story details

### Supporting Routes
- `/api/purchases` - Razorpay order creation, payment verification, and access checks
- `/api/contact` - Contact form submissions and admin review
- `/api/workspaces` - Collaboration workspace state and assets
- `/api/ai` - AI-assisted generation helpers

## 🔌 Real-time Features (Socket.IO)

Connected clients can listen to and emit:
- `drawing` - Live canvas drawing data
- `chat` - Real-time chat messages
- `collaboration-update` - Collaboration status changes
- `user-joined` - User joined collaboration room
- `user-left` - User left collaboration room

## 🔐 Authentication

The application uses JWT-backed authentication. In the browser, login sets an HttpOnly `ps_auth` cookie. Protected APIs also accept a bearer token for compatibility with scripts and external clients.

If you are calling protected endpoints outside the browser, send:
```
Authorization: Bearer <jwt_token>
```

## 📝 Usage Examples

### Register a new user
```bash
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"username":"artist123","name":"Artist One","email":"artist@example.com","password":"secure_pass","role":"artist"}'
```

### Create a story
```bash
curl -X POST http://localhost:3000/api/stories \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Amazing Story","description":"Collaborative project","genre":"fantasy","price":3,"chapters":[{"title":"Chapter 1","content":"Once upon a time"}]}'
```

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure:
- Code follows the existing style
- Changes include appropriate documentation
- All features are tested

## 🐛 Known Issues & TODO

- [ ] Add unit tests
- [ ] Implement email verification
- [ ] Expand payment-provider test coverage
- [ ] Optimize socket.io connections
- [ ] Add TypeScript support

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👥 Authors

- **PixelScript Team** - Initial development

## 🙏 Acknowledgments

- Socket.IO for real-time communication
- MongoDB for flexible data storage
- Express.js community

## 📞 Support

For support, email support@pixelscript.com or open an issue on GitHub.

---

**Happy Creating! 🎨📝** 
