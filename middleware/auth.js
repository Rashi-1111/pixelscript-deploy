const jwt = require('jsonwebtoken');
const User = require('../models/User');

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
    throw new Error('Missing JWT_SECRET environment variable');
}

const AUTH_COOKIE_NAME = 'ps_auth';

function extractCookieValue(cookieHeader, key) {
    if (!cookieHeader || !key) {
        return null;
    }

    const parts = String(cookieHeader).split(';');
    for (const part of parts) {
        const [rawName, ...rawValue] = part.trim().split('=');
        if (rawName === key) {
            return decodeURIComponent(rawValue.join('='));
        }
    }

    return null;
}

module.exports = async (req, res, next) => {
    try {
        // Prefer secure HttpOnly auth cookie, fall back to Bearer token for compatibility.
        const cookieToken = extractCookieValue(req.headers.cookie, AUTH_COOKIE_NAME);
        const authHeader = req.header('Authorization');
        const headerToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
        const token = cookieToken || headerToken;

        if (!token) {
            return res.status(401).json({ message: 'No token provided' });
        }

        // Verify token
        const decoded = jwt.verify(token, jwtSecret);
        
        // Find user by ID
        const user = await User.findById(decoded.userId).select('-password');
        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }

        // Normalize identity fields so all routes can safely use
        // req.user.id, req.user.userId, or req.user._id.
        req.user = user;
        req.user.id = user._id.toString();
        req.user.userId = user._id.toString();
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Invalid token' });
        }
        res.status(401).json({ message: 'Authentication failed' });
    }
}; 
