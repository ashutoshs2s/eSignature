const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
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
      role = 'admin';
    } else if (!invite_token) {
      return res.status(403).json({ error: 'Registration requires an invitation. Contact your admin.' });
    } else {
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

    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses social login. Please sign in with Google or Apple.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      must_change_password: !!user.must_change_password
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Force password change
router.post('/change-password', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If user has a password, verify current one (unless must_change_password is set — allow skipping current check)
    if (user.password_hash && !user.must_change_password) {
      if (!current_password) {
        return res.status(400).json({ error: 'Current password is required' });
      }
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    const hash = await bcrypt.hash(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
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
  const user = db.prepare('SELECT id, name, email, role, must_change_password FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    must_change_password: !!user.must_change_password
  });
});

// Check if any users exist
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

// ==================== Google OAuth ====================

// Step 1: Redirect to Google
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'Google OAuth not configured' });
  }
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2: Google callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error || !code) {
      return res.redirect('/?auth_error=google_denied');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${appUrl}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return res.redirect('/?auth_error=google_token_failed');
    }

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await userRes.json();
    if (!profile.email) {
      return res.redirect('/?auth_error=google_no_email');
    }

    // Find or create user
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(profile.email);

    if (user) {
      // Link OAuth if not already linked
      if (!user.oauth_provider) {
        db.prepare('UPDATE users SET oauth_provider = ?, oauth_id = ? WHERE id = ?')
          .run('google', profile.id, user.id);
      }
      if (!user.is_active) {
        return res.redirect('/?auth_error=account_deactivated');
      }
    } else {
      // Check if registration is open (only if first user) or closed
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      const role = userCount === 0 ? 'admin' : 'user';

      // For non-first users, require an invitation OR allow social signup
      // Social login users get auto-created as regular users
      const result = db.prepare(
        'INSERT INTO users (email, name, password_hash, role, oauth_provider, oauth_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(profile.email, profile.name || profile.email.split('@')[0], '', role, 'google', profile.id);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;

    res.redirect('/');
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect('/?auth_error=google_failed');
  }
});

// ==================== Apple Sign In ====================

// Step 1: Redirect to Apple
router.get('/apple', (req, res) => {
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'Apple Sign In not configured' });
  }
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const redirectUri = `${appUrl}/api/auth/apple/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code id_token',
    scope: 'name email',
    response_mode: 'form_post',
    state: crypto.randomBytes(16).toString('hex'),
  });

  res.redirect(`https://appleid.apple.com/auth/authorize?${params}`);
});

// Step 2: Apple callback (form_post)
router.post('/apple/callback', async (req, res) => {
  try {
    const { code, id_token, user: appleUser, error: appleError } = req.body;
    if (appleError || !id_token) {
      return res.redirect('/?auth_error=apple_denied');
    }

    // Decode the id_token JWT (Apple's id_token contains the user info)
    const payload = decodeJwtPayload(id_token);
    if (!payload || !payload.sub) {
      return res.redirect('/?auth_error=apple_invalid_token');
    }

    const email = payload.email;
    const appleId = payload.sub;

    // Apple only sends user info on first authorization
    let userName = null;
    if (appleUser) {
      try {
        const parsed = typeof appleUser === 'string' ? JSON.parse(appleUser) : appleUser;
        if (parsed.name) {
          userName = [parsed.name.firstName, parsed.name.lastName].filter(Boolean).join(' ');
        }
      } catch {}
    }

    if (!email) {
      return res.redirect('/?auth_error=apple_no_email');
    }

    // Find or create user
    let user = db.prepare('SELECT * FROM users WHERE email = ? OR (oauth_provider = ? AND oauth_id = ?)').get(email, 'apple', appleId);

    if (user) {
      if (!user.oauth_provider) {
        db.prepare('UPDATE users SET oauth_provider = ?, oauth_id = ? WHERE id = ?')
          .run('apple', appleId, user.id);
      }
      // Update name if Apple provided it and current name is generic
      if (userName && user.name === user.email.split('@')[0]) {
        db.prepare('UPDATE users SET name = ? WHERE id = ?').run(userName, user.id);
        user.name = userName;
      }
      if (!user.is_active) {
        return res.redirect('/?auth_error=account_deactivated');
      }
    } else {
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      const role = userCount === 0 ? 'admin' : 'user';
      const name = userName || email.split('@')[0];

      const result = db.prepare(
        'INSERT INTO users (email, name, password_hash, role, oauth_provider, oauth_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(email, name, '', role, 'apple', appleId);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;

    res.redirect('/');
  } catch (err) {
    console.error('Apple Sign In error:', err);
    res.redirect('/?auth_error=apple_failed');
  }
});

// Check OAuth availability
router.get('/oauth-config', (req, res) => {
  res.json({
    google: !!process.env.GOOGLE_CLIENT_ID,
    apple: !!process.env.APPLE_CLIENT_ID,
  });
});

// Helper: decode JWT payload without verification (Apple id_token)
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

module.exports = router;
