require('dotenv').config();
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'super-secret-key-change-this';

// ── Middleware ──────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rate Limiters
const subscribeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // limit each IP to 5 requests per windowMs
    message: { success: false, message: 'Too many subscription attempts, please try again later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Increased for dev/testing
    message: { success: false, message: 'Too many login attempts, please try again later.' }
});

// Validation Middleware
const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }
    next();
};

// Auth Middleware
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Simple token verification (In real app use JWT)
    try {
        const payload = JSON.parse(Buffer.from(token, 'base64').toString());
        if (payload.secret === SECRET_KEY) {
            req.user = payload.user;
            next();
        } else {
            throw new Error('Invalid token');
        }
    } catch (e) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

const requireSuperAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'super_admin') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Forbidden: Super Admin only' });
    }
};

// ── Database Setup ─────────────────────────
const db = new Database(path.join(__dirname, 'database.sqlite'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'admin', -- 'super_admin' or 'admin'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Seed Super Admin if no admins exist
const adminCount = db.prepare('SELECT count(*) as count FROM admins').get();
if (adminCount.count === 0) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    db.prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'super_admin');
    console.log('✨ Created default super_admin: admin');
}

// Prepared statements for performance
const insertSubscriber = db.prepare(
    'INSERT INTO subscribers (email) VALUES (?)'
);
const findSubscriber = db.prepare(
    'SELECT id FROM subscribers WHERE email = ?'
);
const getAllSubscribers = db.prepare(
    'SELECT id, email, subscribed_at FROM subscribers ORDER BY subscribed_at DESC'
);

// ── API Routes ─────────────────────────────

// Subscribe an email
app.post('/api/subscribe',
    subscribeLimiter,
    [
        body('email').isEmail().withMessage('Please enter a valid email address.')
            .normalizeEmail()
    ],
    validateRequest,
    (req, res) => {
        const { email } = req.body;

        // Check for duplicate
        const existing = findSubscriber.get(email);
        if (existing) {
            return res.status(409).json({
                success: false,
                message: "You're already on the list! We'll be in touch soon."
            });
        }

        // Insert
        try {
            insertSubscriber.run(email);
            return res.status(201).json({
                success: true,
                message: "Thank you! You're on the early access list."
            });
        } catch (err) {
            console.error('DB insert error:', err);
            return res.status(500).json({
                success: false,
                message: 'Something went wrong. Please try again later.'
            });
        }
    });

// Login
app.post('/api/login',
    loginLimiter,
    [
        body('username').trim().notEmpty().withMessage('Username is required'),
        body('password').notEmpty().withMessage('Password is required')
    ],
    validateRequest,
    (req, res) => {
        const { username, password } = req.body;

        const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);

        if (admin && bcrypt.compareSync(password, admin.password_hash)) {
            // Create simple token
            const payload = {
                user: { id: admin.id, username: admin.username, role: admin.role },
                secret: SECRET_KEY
            };
            const token = Buffer.from(JSON.stringify(payload)).toString('base64');
            res.json({ success: true, token, role: admin.role, username: admin.username });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    });

// List all subscribers (protected, any admin)
app.get('/api/subscribers', authenticate, (req, res) => {
    try {
        const subscribers = db.prepare('SELECT id, email, subscribed_at FROM subscribers ORDER BY subscribed_at DESC').all();
        return res.json({
            success: true,
            count: subscribers.length,
            subscribers
        });
    } catch (err) {
        console.error('DB query error:', err);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve subscribers.'
        });
    }
});

// ── Admin Management Routes ────────────────

// List Admins
app.get('/api/admins', authenticate, (req, res) => {
    try {
        const admins = db.prepare('SELECT id, username, role, created_at FROM admins').all();
        res.json({ success: true, admins });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching admins' });
    }
});

// Create Admin (Super Admin Only)
app.post('/api/admins',
    authenticate,
    requireSuperAdmin,
    [
        body('username').trim().notEmpty().withMessage('Username is required')
            .isLength({ min: 3 }).withMessage('Username must be at least 3 chars'),
        body('password').notEmpty().withMessage('Password is required')
            .isLength({ min: 6 }).withMessage('Password must be at least 6 chars')
    ],
    validateRequest,
    (req, res) => {
        const { username, password, role } = req.body;

        // Default role to 'admin' if not provided or invalid
        const newRole = (role === 'super_admin') ? 'super_admin' : 'admin';

        try {
            const hash = bcrypt.hashSync(password, 10);
            const result = db.prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, newRole);
            res.json({ success: true, message: 'Admin created', id: result.lastInsertRowid });
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ success: false, message: 'Username already exists' });
            }
            res.status(500).json({ success: false, message: 'Error creating admin' });
        }
    });

// Delete Admin (Super Admin Only)
app.delete('/api/admins/:id', authenticate, requireSuperAdmin, (req, res) => {
    const id = req.params.id;

    // Prevent self-deletion
    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
    }

    try {
        const result = db.prepare('DELETE FROM admins WHERE id = ?').run(id);
        if (result.changes > 0) {
            res.json({ success: true, message: 'Admin deleted' });
        } else {
            res.status(404).json({ success: false, message: 'Admin not found' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error deleting admin' });
    }
});

// Update Admin (Self or Super Admin)
app.put('/api/admins/:id', authenticate, (req, res) => {
    const id = parseInt(req.params.id);
    const { password, role } = req.body;

    // Only Super Admin or the user themselves can update
    if (req.user.role !== 'super_admin' && req.user.id !== id) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    // Only Super Admin can change roles
    if (role && req.user.role !== 'super_admin') {
        return res.status(403).json({ success: false, message: 'Only Super Admin can change roles' });
    }

    try {
        if (password) {
            const hash = bcrypt.hashSync(password, 10);
            db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, id);
        }
        if (role) {
            // Prevent removing the last super admin (basic check, can be improved)
            // For now, allow it but client side should warn.
            db.prepare('UPDATE admins SET role = ? WHERE id = ?').run(role, id);
        }
        res.json({ success: true, message: 'Admin updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error updating admin' });
    }
});

// ── Start Server ───────────────────────────
app.listen(PORT, () => {
    console.log(`✨ Kubeli server running at http://localhost:${PORT}`);
});
