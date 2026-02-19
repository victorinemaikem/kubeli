const db = require('better-sqlite3')('database.sqlite');
const bcrypt = require('bcryptjs');

console.log('Setting up database tables...');

// Create tables
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

console.log('Tables created successfully');

// Check if admin exists
const count = db.prepare('SELECT count(*) as count FROM admins').get();
console.log('Admin count:', count.count);

if (count.count === 0) {
    const hash = bcrypt.hashSync('Kubeli@@@Admin2026!Secured-PassWD!@', 10);
    db.prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'super_admin');
    console.log('✅ Default admin created: admin / Kubeli@@@Admin2026!Secured-PassWD!@');
} else {
    console.log('ℹ️  Admin account already exists');
}

db.close();
console.log('Database setup complete!');
