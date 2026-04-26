require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
const promClient = require('prom-client');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const connectDB = require('./config/db');

// Import routes
const userRoutes = require('./routes/user');
const collabRoutes = require('./routes/collab');
const storyRoutes = require('./routes/story');
const purchaseRoutes = require('./routes/purchase');
const contactRoutes = require('./routes/contact');
const workspaceRoutes = require('./routes/workspace');
const aiRoutes = require('./routes/ai');
const commentsRoutes = require('./routes/comments');

// Import middleware
const errorHandler = require('./middleware/error');

const app = express();
const server = http.createServer(app);
const sessionSecret = process.env.SESSION_SECRET;
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const publicRoot = path.resolve(__dirname, 'public');
const socketAllowedOrigins = (process.env.SOCKET_CORS_ORIGIN || process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const redisUrl = String(process.env.REDIS_URL || '').trim();
const presenceTtlSeconds = Number(process.env.SOCKET_PRESENCE_TTL_SECONDS || 2 * 24 * 60 * 60);
const apiRateLimitWindowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const apiRateLimitMax = Number(process.env.API_RATE_LIMIT_MAX || 300);

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const metricsRegistry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: metricsRegistry, prefix: 'pixelscript_' });

const httpRequestsTotal = new promClient.Counter({
    name: 'pixelscript_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [metricsRegistry]
});

const httpRequestDurationMs = new promClient.Histogram({
    name: 'pixelscript_http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [50, 100, 300, 500, 1000, 3000, 5000, 10000],
    registers: [metricsRegistry]
});

function normalizeRouteForMetrics(value) {
    const route = String(value || '/unknown')
        .replace(/\/[0-9a-fA-F]{24}(?=\/|$)/g, '/:id')
        .replace(/\/\d+(?=\/|$)/g, '/:num');
    return route || '/unknown';
}

function resolveRouteLabel(req) {
    if (req.route && req.route.path) {
        const routePath = typeof req.route.path === 'string' ? req.route.path : String(req.route.path);
        return normalizeRouteForMetrics(`${req.baseUrl || ''}${routePath}`);
    }

    return normalizeRouteForMetrics(req.path || req.originalUrl || '/unknown');
}

let redisAdapterEnabled = false;
let redisPresenceClient = null;
const socketRoomIndex = new Map();

function getRoomUsersKey(room) {
    return `ps:presence:room:${room}:users`;
}

function getSocketMetaKey(socketId) {
    return `ps:presence:socket:${socketId}`;
}

function getRoomPrimaryKey(room) {
    return `ps:presence:room:${room}:primary`;
}

async function setupSocketRedisAdapter() {
    if (!redisUrl) {
        console.log('Socket.IO Redis adapter disabled (REDIS_URL is not set).');
        return;
    }

    try {
        const pubClient = createClient({ url: redisUrl });
        const subClient = pubClient.duplicate();
        redisPresenceClient = pubClient.duplicate();

        await Promise.all([pubClient.connect(), subClient.connect(), redisPresenceClient.connect()]);
        io.adapter(createAdapter(pubClient, subClient));
        redisAdapterEnabled = true;

        console.log('Socket.IO Redis adapter enabled.');
    } catch (error) {
        redisAdapterEnabled = false;
        redisPresenceClient = null;
        console.error('Failed to initialize Socket.IO Redis adapter:', error.message);
    }
}

async function updatePresenceJoin(room, socketId, isPrimary) {
    if (!redisAdapterEnabled || !redisPresenceClient) {
        return null;
    }

    const roomUsersKey = getRoomUsersKey(room);
    const socketMetaKey = getSocketMetaKey(socketId);

    await redisPresenceClient
        .multi()
        .sAdd(roomUsersKey, socketId)
        .expire(roomUsersKey, presenceTtlSeconds)
        .hSet(socketMetaKey, {
            room,
            isPrimary: isPrimary ? '1' : '0',
            joinedAt: String(Date.now())
        })
        .expire(socketMetaKey, presenceTtlSeconds)
        .exec();

    return redisPresenceClient.sCard(roomUsersKey);
}

async function updatePresenceLeave(room, socketId) {
    if (!redisAdapterEnabled || !redisPresenceClient) {
        return null;
    }

    const roomUsersKey = getRoomUsersKey(room);
    const socketMetaKey = getSocketMetaKey(socketId);

    await redisPresenceClient
        .multi()
        .sRem(roomUsersKey, socketId)
        .expire(roomUsersKey, presenceTtlSeconds)
        .del(socketMetaKey)
        .exec();

    return redisPresenceClient.sCard(roomUsersKey);
}

async function claimPrimaryUser(room, socketId, requestedPrimary) {
    if (!requestedPrimary) {
        return false;
    }

    if (!redisAdapterEnabled || !redisPresenceClient) {
        const collab = activeCollaborations.get(room);
        if (collab && !collab.primaryUser) {
            collab.primaryUser = socketId;
            return true;
        }
        return collab ? collab.primaryUser === socketId : false;
    }

    const primaryKey = getRoomPrimaryKey(room);
    const created = await redisPresenceClient.set(primaryKey, socketId, {
        NX: true,
        EX: presenceTtlSeconds
    });

    if (created) {
        return true;
    }

    const primarySocketId = await redisPresenceClient.get(primaryKey);
    return primarySocketId === socketId;
}

async function releasePrimaryUser(room, socketId) {
    if (!room) {
        return;
    }

    if (!redisAdapterEnabled || !redisPresenceClient) {
        const collab = activeCollaborations.get(room);
        if (collab && collab.primaryUser === socketId) {
            collab.primaryUser = null;
        }
        return;
    }

    const primaryKey = getRoomPrimaryKey(room);
    const currentPrimary = await redisPresenceClient.get(primaryKey);
    if (currentPrimary === socketId) {
        await redisPresenceClient.del(primaryKey);
    }
}

if (!sessionSecret) {
    throw new Error('Missing SESSION_SECRET environment variable');
}

if (!mongoUri) {
    throw new Error('Missing MONGO_URI (or MONGODB_URI) environment variable');
}

function resolveSafePublicPath(requestPath = '') {
    const normalized = path.posix.normalize(`/${String(requestPath || '')}`).replace(/^\/+/, '');
    const resolved = path.resolve(publicRoot, normalized);
    if (resolved === publicRoot || resolved.startsWith(`${publicRoot}${path.sep}`)) {
        return resolved;
    }
    return null;
}

const io = socketIo(server, {
    cors: {
        origin: socketAllowedOrigins,
        methods: ["GET", "POST"]
    }
});

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(pinoHttp({
    logger,
    autoLogging: {
        ignore: (req) => req.url === '/metrics'
    },
    customLogLevel: (req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    }
}));

app.use((req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const isApiRequest = req.path.startsWith('/api/') || req.path === '/api';
        if (!isApiRequest) {
            return;
        }

        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        const labels = {
            method: req.method,
            route: resolveRouteLabel(req),
            status_code: String(res.statusCode)
        };

        httpRequestsTotal.inc(labels);
        httpRequestDurationMs.observe(labels, durationMs);
    });

    next();
});

const apiRateLimiter = rateLimit({
    windowMs: apiRateLimitWindowMs,
    max: apiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many API requests from this IP. Please try again later.'
    }
});

app.use('/api', apiRateLimiter);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
});

app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path === '/') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Add session middleware
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: mongoUri,
        ttl: 24 * 60 * 60 // 1 day
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        sameSite: 'lax'
    }
}));

// Routes
app.use('/api/users', userRoutes);
app.use('/api/collab', collabRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/comments', commentsRoutes);


// Public routes that don't require authentication
app.get('/collaborations/:page', (req, res) => {
    const safePath = resolveSafePublicPath(`collaborations/${req.params.page}`);
    if (!safePath) {
        return res.status(400).send('Invalid path');
    }

    return res.sendFile(safePath, error => {
        if (error) {
            return res.redirect('/login.html');
        }
    });
});

// Handle all other routes by serving the appropriate HTML file
app.get('*', (req, res) => {
    const safePath = resolveSafePublicPath(req.path);
    const indexPath = path.join(publicRoot, 'index.html');

    if (!safePath) {
        return res.status(400).send('Invalid path');
    }

    if (req.path.startsWith('/collaborations/') && !(req.session && req.session.userId)) {
        return res.redirect('/login.html');
    }

    return res.sendFile(safePath, error => {
        if (error) {
            return res.sendFile(indexPath);
        }
    });
});

// Store active collaborations
const activeCollaborations = new Map();

function touchCollaboration(collaboration) {
    if (collaboration) {
        collaboration.lastActivity = Date.now();
    }
}

setInterval(() => {
    const cutoff = Date.now() - ROOM_TTL_MS;
    activeCollaborations.forEach((collaboration, room) => {
        if ((collaboration.lastActivity || 0) < cutoff) {
            activeCollaborations.delete(room);
        }
    });
}, ROOM_CLEANUP_INTERVAL_MS);

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Join collaboration room
    socket.on('joinRoom', async ({ room, isPrimaryUser }) => {
        if (!room || typeof room !== 'string') {
            return;
        }

        socket.join(room);
        socketRoomIndex.set(socket.id, room);

        if (!activeCollaborations.has(room)) {
            activeCollaborations.set(room, {
                users: new Map(), // Changed to Map to store user type
                canvasState: null,
                chat: [],
                primaryUser: isPrimaryUser ? socket.id : null,
                lastActivity: Date.now()
            });
        }
        const collab = activeCollaborations.get(room);
        touchCollaboration(collab);

        const isPrimary = await claimPrimaryUser(room, socket.id, Boolean(isPrimaryUser));
        if (isPrimary) {
            collab.primaryUser = socket.id;
        }

        // Store user type
        collab.users.set(socket.id, {
            isPrimary
        });

        const globalUserCount = await updatePresenceJoin(room, socket.id, isPrimary);

        // Send current canvas state to new user
        if (collab.canvasState) {
            socket.emit('canvasState', collab.canvasState);
        }

        // Notify all users in the room about new user
        io.to(room).emit('userJoined', {
            userCount: globalUserCount || collab.users.size,
            isPrimaryUser: isPrimary
        });
    });

    // Handle chat messages
    socket.on('chatMessage', payload => {
        const room = payload?.room;
        if (!room || !activeCollaborations.has(room)) {
            return;
        }

        const collab = activeCollaborations.get(room);
        touchCollaboration(collab);

        socket.to(room).emit('chatMessage', {
            message: String(payload?.message || ''),
            sender: String(payload?.sender || 'Collaborator'),
            sentAt: payload?.sentAt || new Date().toISOString(),
            attachment: payload?.attachment || null
        });
    });

    // Handle drawing events - only allow from primary user
    socket.on('draw', (data) => {
        const collab = activeCollaborations.get(data.room);
        if (collab && socket.id === collab.primaryUser) {
            touchCollaboration(collab);
            socket.to(data.room).emit('draw', data);
        }
    });

    // Handle canvas state updates - only allow from primary user
    socket.on('canvasState', (data) => {
        const collab = activeCollaborations.get(data.room);
        if (collab && socket.id === collab.primaryUser) {
            touchCollaboration(collab);
            collab.canvasState = data.state;
            socket.to(data.room).emit('canvasState', data.state);
        }
    });

    // Handle clear canvas - only allow from primary user
    socket.on('clear', (data) => {
        const collab = activeCollaborations.get(data.room);
        if (collab && socket.id === collab.primaryUser) {
            touchCollaboration(collab);
            if (typeof data.state === 'string') {
                collab.canvasState = data.state;
            }
            socket.to(data.room).emit('clear', { state: data.state || '' });
        }
    });

    // Handle undo/redo - only allow from primary user
    socket.on('undo', (data) => {
        const collab = activeCollaborations.get(data.room);
        if (collab && socket.id === collab.primaryUser) {
            touchCollaboration(collab);
            if (typeof data.state === 'string') {
                collab.canvasState = data.state;
            }
            socket.to(data.room).emit('undo', { state: data.state || '' });
        }
    });

    socket.on('redo', (data) => {
        const collab = activeCollaborations.get(data.room);
        if (collab && socket.id === collab.primaryUser) {
            touchCollaboration(collab);
            if (typeof data.state === 'string') {
                collab.canvasState = data.state;
            }
            socket.to(data.room).emit('redo', { state: data.state || '' });
        }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
        console.log('Client disconnected:', socket.id);
        const knownRoom = socketRoomIndex.get(socket.id);
        socketRoomIndex.delete(socket.id);

        if (!knownRoom) {
            return;
        }

        const collab = activeCollaborations.get(knownRoom);
        if (collab && collab.users.has(socket.id)) {
            collab.users.delete(socket.id);
        }

        await releasePrimaryUser(knownRoom, socket.id);
        const globalUserCount = await updatePresenceLeave(knownRoom, socket.id);

        const nextUserCount = globalUserCount !== null
            ? globalUserCount
            : (collab ? collab.users.size : 0);

        io.to(knownRoom).emit('userLeft', {
            userCount: nextUserCount
        });

        if (collab && collab.users.size === 0) {
            activeCollaborations.delete(knownRoom);
        }
    });
});

// Error handling middleware
app.use(errorHandler);

// Only start server if MongoDB connects successfully
mongoose.connection.once('open', () => {
    const PORT = process.env.PORT || 3000;
    setupSocketRedisAdapter()
        .finally(() => {
            server.listen(PORT, () => {
                console.log(`Server running on port ${PORT}`);
            });
        });
});

mongoose.connection.on('error', (err) => {
    console.error(`MongoDB connection error: ${err}`);
    process.exit(1);
});
