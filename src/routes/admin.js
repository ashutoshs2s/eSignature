const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all users
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, email, name, role, is_active, created_at,
      (SELECT COUNT(*) FROM documents WHERE owner_id = users.id) as document_count
    FROM users ORDER BY created_at DESC
  `).all();
  res.json(users);
});

// Update user role
router.patch('/users/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "admin" or "user"' });
  }

  const userId = parseInt(req.params.id, 10);
  if (userId === req.session.userId && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot remove your own admin role' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  res.json({ message: 'Role updated' });
});

// Activate/deactivate user
router.patch('/users/:id/status', requireAdmin, (req, res) => {
  const { is_active } = req.body;
  const userId = parseInt(req.params.id, 10);

  if (userId === req.session.userId) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }

  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, userId);
  res.json({ message: is_active ? 'User activated' : 'User deactivated' });
});

// Invite a user
router.post('/invite', requireAdmin, (req, res) => {
  const { email, name, role } = req.body;
  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name are required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }

  const pendingInvite = db.prepare(
    "SELECT id FROM invitations WHERE email = ? AND accepted = 0 AND expires_at > datetime('now')"
  ).get(email);
  if (pendingInvite) {
    return res.status(409).json({ error: 'An active invitation already exists for this email' });
  }

  const id = uuidv4();
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO invitations (id, email, name, role, token, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, email, name, role || 'user', token, req.session.userId, expiresAt);

  res.json({ id, email, name, token, expires_at: expiresAt });
});

// List invitations
router.get('/invitations', requireAdmin, (req, res) => {
  const invitations = db.prepare(`
    SELECT i.*, u.name as invited_by_name
    FROM invitations i
    JOIN users u ON i.invited_by = u.id
    ORDER BY i.created_at DESC
  `).all();
  res.json(invitations);
});

// Revoke invitation
router.delete('/invitations/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM invitations WHERE id = ? AND accepted = 0').run(req.params.id);
  res.json({ message: 'Invitation revoked' });
});

// Admin dashboard stats
router.get('/stats', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const activeUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get().count;
  const documents = db.prepare('SELECT COUNT(*) as count FROM documents').get().count;
  const pendingSignatures = db.prepare("SELECT COUNT(*) as count FROM signature_requests WHERE status = 'pending'").get().count;
  const completedDocuments = db.prepare("SELECT COUNT(*) as count FROM documents WHERE status = 'completed'").get().count;
  const pendingInvitations = db.prepare("SELECT COUNT(*) as count FROM invitations WHERE accepted = 0 AND expires_at > datetime('now')").get().count;

  res.json({ users, activeUsers, documents, pendingSignatures, completedDocuments, pendingInvitations });
});

// All documents (admin view)
router.get('/documents', requireAdmin, (req, res) => {
  const documents = db.prepare(`
    SELECT d.*, u.name as owner_name, u.email as owner_email,
      (SELECT COUNT(*) FROM signature_requests sr WHERE sr.document_id = d.id) as total_signers,
      (SELECT COUNT(*) FROM signature_requests sr WHERE sr.document_id = d.id AND sr.status = 'signed') as signed_count
    FROM documents d
    JOIN users u ON d.owner_id = u.id
    ORDER BY d.created_at DESC
  `).all();
  res.json(documents);
});

// Reset user password (admin)
router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const hash = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ message: 'Password reset successfully' });
});

module.exports = router;
