require('dotenv').config();
const express = require('express');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();
const helmet = require('helmet');
app.use(helmet());
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'super-secret-key-change-this';

// ── Middleware ──────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve static pages explicitly
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Rate Limiters
const subscribeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { success: false, message: 'Too many subscription attempts, please try again later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
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

    try {
        const payload = jwt.verify(token, SECRET_KEY);
        req.user = payload.user;
        next();
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
const sql = neon(process.env.DATABASE_URL);

// Create tables and seed super admin on startup
async function setupDatabase() {
    await sql`
        CREATE TABLE IF NOT EXISTS subscribers (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;

    await sql`
        CREATE TABLE IF NOT EXISTS admins (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;

    // Seed Super Admin if no admins exist
    const result = await sql`SELECT COUNT(*) as count FROM admins`;
    const adminCount = parseInt(result[0].count);

    if (adminCount === 0) {
    if (!process.env.ADMIN_PASSWORD) {
        throw new Error('ADMIN_PASSWORD environment variable is required to seed the super admin');
    }
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
    await sql`INSERT INTO admins (username, password_hash, role) VALUES ('admin', ${hash}, 'super_admin')`;
    console.log('✨ Created default super_admin: admin');
}

    console.log('✅ Database setup complete');
}

setupDatabase().catch(console.error);

// ── API Routes ─────────────────────────────

// Subscribe an email
app.post('/api/subscribe',
    subscribeLimiter,
    [
        body('email').isEmail().withMessage('Please enter a valid email address.')
            .normalizeEmail()
    ],
    validateRequest,
    async (req, res) => {
        const { email } = req.body;

        try {
            // Check for duplicate
            const existing = await sql`SELECT id FROM subscribers WHERE email = ${email}`;
            if (existing.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: "You're already on the list! We'll be in touch soon."
                });
            }

            // Insert
            await sql`INSERT INTO subscribers (email) VALUES (${email})`;
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
    async (req, res) => {
        const { username, password } = req.body;

        try {
            const result = await sql`SELECT * FROM admins WHERE username = ${username}`;
            const admin = result[0];

            if (admin && bcrypt.compareSync(password, admin.password_hash)) {
                const payload = {
                    user: { id: admin.id, username: admin.username, role: admin.role }
                };
                const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '24h' });
                res.json({ success: true, token, role: admin.role, username: admin.username });
            } else {
                res.status(401).json({ success: false, message: 'Invalid credentials' });
            }
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ success: false, message: 'Something went wrong.' });
        }
    });

// List all subscribers (protected, any admin)
app.get('/api/subscribers', authenticate, async (req, res) => {
    try {
        const subscribers = await sql`SELECT id, email, subscribed_at FROM subscribers ORDER BY subscribed_at DESC`;
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
app.get('/api/admins', authenticate, async (req, res) => {
    try {
        const admins = await sql`SELECT id, username, role, created_at FROM admins`;
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
    async (req, res) => {
        const { username, password, role } = req.body;
        const newRole = (role === 'super_admin') ? 'super_admin' : 'admin';

        try {
            const hash = bcrypt.hashSync(password, 10);
            const result = await sql`
                INSERT INTO admins (username, password_hash, role) 
                VALUES (${username}, ${hash}, ${newRole})
                RETURNING id
            `;
            res.json({ success: true, message: 'Admin created', id: result[0].id });
        } catch (err) {
            if (err.code === '23505') { // PostgreSQL unique violation code
                return res.status(409).json({ success: false, message: 'Username already exists' });
            }
            res.status(500).json({ success: false, message: 'Error creating admin' });
        }
    });

// Delete Admin (Super Admin Only)
app.delete('/api/admins/:id', authenticate, requireSuperAdmin, async (req, res) => {
    const id = req.params.id;

    // Prevent self-deletion
    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
    }

    try {
        const result = await sql`DELETE FROM admins WHERE id = ${id} RETURNING id`;
        if (result.length > 0) {
            res.json({ success: true, message: 'Admin deleted' });
        } else {
            res.status(404).json({ success: false, message: 'Admin not found' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error deleting admin' });
    }
});

// Update Admin (Self or Super Admin)
app.put('/api/admins/:id', authenticate, async (req, res) => {
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
            await sql`UPDATE admins SET password_hash = ${hash} WHERE id = ${id}`;
        }
        if (role) {
            await sql`UPDATE admins SET role = ${role} WHERE id = ${id}`;
        }
        res.json({ success: true, message: 'Admin updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error updating admin' });
    }
});

// ── Start Server ───────────────────────────
// NOTE: Vercel handles HTTPS automatically in production,
// so we only run plain HTTP here. HTTPS is not needed on Vercel.
app.listen(PORT, () => {
    console.log(`✨ Kubeli server running at http://localhost:${PORT}`);
});

// Export for Vercel serverless functions
module.exports = app;