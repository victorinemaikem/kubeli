/* ========================================
   Kubeli - Express Server
   Email collection for early access signups
   ======================================== */

const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Database Setup ─────────────────────────
const db = new Database(path.join(__dirname, 'database.sqlite'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create subscribers table if it doesn't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

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
app.post('/api/subscribe', (req, res) => {
    const { email } = req.body;

    // Validate presence
    if (!email || typeof email !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'Please provide a valid email address.'
        });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Validate format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
        return res.status(400).json({
            success: false,
            message: 'Please enter a valid email address.'
        });
    }

    // Check for duplicate
    const existing = findSubscriber.get(trimmedEmail);
    if (existing) {
        return res.status(409).json({
            success: false,
            message: "You're already on the list! We'll be in touch soon."
        });
    }

    // Insert
    try {
        insertSubscriber.run(trimmedEmail);
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

// List all subscribers (admin utility)
app.get('/api/subscribers', (req, res) => {
    try {
        const subscribers = getAllSubscribers.all();
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

// ── Start Server ───────────────────────────
app.listen(PORT, () => {
    console.log(`✨ Kubeli server running at http://localhost:${PORT}`);
});
