const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../database');

const router = express.Router();

// Register — only works via invitation token, or if no users exist (first user = admin)
router.post('/register', async (req, res) => {
  try {
    const { email, name, password, invite_token } = req.body;
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    let role = 'user';

    if (userCount === 0) {
      // First user becomes admin — no invite needed
      role = 'admin';
    } else if (!invite_token) {
      return res.status(403).json({ error: 'Registration requires an invitation. Contact your admin.' });
    } else {
      // Validate invitation
      const invitation = db.prepare(
        "SELECT * FROM invitations WHERE token = ? AND accepted = 0 AND expires_at > datetime('now')"
      ).get(invite_token);

      if (!invitation) {
        return res.status(403).json({ error: 'Invalid or expired invitation link' });
      }
      if (invitation.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(403).json({ error: 'Email does not match the invitation' });
      }

      role = invitation.role;
      db.prepare('UPDATE invitations SET accepted = 1 WHERE id = ?').run(invitation.id);
    }

    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(email, name, hash, role);

    req.session.userId = result.lastInsertRowid;
    req.session.userName = name;
    req.session.userEmail = email;
    req.session.userRole = role;

    res.json({ id: result.lastInsertRowid, email, name, role });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact your admin.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;

    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out' });
  });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    id: req.session.userId,
    name: req.session.userName,
    email: req.session.userEmail,
    role: req.session.userRole
  });
});

// Check if any users exist (to show register vs invite-only message)
router.get('/setup-status', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  res.json({ needs_setup: userCount === 0 });
});

// Validate an invitation token
router.get('/invite/:token', (req, res) => {
  const invitation = db.prepare(
    "SELECT id, email, name, role, expires_at FROM invitations WHERE token = ? AND accepted = 0 AND expires_at > datetime('now')"
  ).get(req.params.token);

  if (!invitation) {
    return res.status(404).json({ error: 'Invalid or expired invitation' });
  }

  res.json(invitation);
});

module.exports = router;
