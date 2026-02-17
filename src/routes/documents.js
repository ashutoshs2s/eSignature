const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// List all documents for the current user
router.get('/', requireAuth, (req, res) => {
  const documents = db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM signature_requests sr WHERE sr.document_id = d.id) as total_signers,
      (SELECT COUNT(*) FROM signature_requests sr WHERE sr.document_id = d.id AND sr.status = 'signed') as signed_count
    FROM documents d
    WHERE d.owner_id = ?
    ORDER BY d.created_at DESC
  `).all(req.session.userId);

  res.json(documents);
});

// Get documents where current user is a signer
router.get('/to-sign', requireAuth, (req, res) => {
  const documents = db.prepare(`
    SELECT d.title, d.id as document_id, sr.id as request_id, sr.status, sr.token,
           d.created_at, u.name as from_name, u.email as from_email
    FROM signature_requests sr
    JOIN documents d ON sr.document_id = d.id
    JOIN users u ON d.owner_id = u.id
    WHERE sr.signer_email = ?
    ORDER BY sr.created_at DESC
  `).all(req.session.userEmail);

  res.json(documents);
});

// Upload a new document
router.post('/upload', requireAuth, upload.single('document'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const id = uuidv4();
  const title = req.body.title || req.file.originalname;

  db.prepare(`
    INSERT INTO documents (id, title, filename, original_path, owner_id, status)
    VALUES (?, ?, ?, ?, ?, 'draft')
  `).run(id, title, req.file.originalname, req.file.path, req.session.userId);

  db.prepare(`
    INSERT INTO audit_log (document_id, action, actor, details, ip_address)
    VALUES (?, 'uploaded', ?, 'Document uploaded', ?)
  `).run(id, req.session.userEmail, req.ip);

  res.json({ id, title, filename: req.file.originalname, status: 'draft' });
});

// Get single document details
router.get('/:id', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.session.userId);

  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const signers = db.prepare('SELECT id, signer_email, signer_name, status, signed_at FROM signature_requests WHERE document_id = ?')
    .all(req.params.id);

  const auditLog = db.prepare('SELECT action, actor, details, created_at FROM audit_log WHERE document_id = ? ORDER BY created_at DESC')
    .all(req.params.id);

  res.json({ ...doc, signers, auditLog });
});

// Send document for signature
router.post('/:id/send', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.session.userId);

  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const { signers } = req.body;
  if (!signers || !Array.isArray(signers) || signers.length === 0) {
    return res.status(400).json({ error: 'At least one signer is required' });
  }

  const insertSigner = db.prepare(`
    INSERT INTO signature_requests (id, document_id, signer_email, signer_name, token)
    VALUES (?, ?, ?, ?, ?)
  `);

  const requests = [];
  const insertMany = db.transaction((signerList) => {
    for (const signer of signerList) {
      const id = uuidv4();
      const token = uuidv4();
      insertSigner.run(id, doc.id, signer.email, signer.name, token);
      requests.push({ id, email: signer.email, name: signer.name, token });
    }
  });

  insertMany(signers);

  db.prepare("UPDATE documents SET status = 'pending', updated_at = datetime('now') WHERE id = ?")
    .run(doc.id);

  db.prepare(`
    INSERT INTO audit_log (document_id, action, actor, details, ip_address)
    VALUES (?, 'sent_for_signature', ?, ?, ?)
  `).run(doc.id, req.session.userEmail, `Sent to ${signers.map(s => s.email).join(', ')}`, req.ip);

  res.json({ message: 'Document sent for signature', requests });
});

// Download the original PDF
router.get('/:id/download', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.session.userId);

  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const filePath = doc.signed_path || doc.original_path;
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.download(filePath, doc.filename);
});

// Delete a document
router.delete('/:id', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.session.userId);

  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  db.prepare('DELETE FROM signatures WHERE request_id IN (SELECT id FROM signature_requests WHERE document_id = ?)').run(doc.id);
  db.prepare('DELETE FROM signature_requests WHERE document_id = ?').run(doc.id);
  db.prepare('DELETE FROM audit_log WHERE document_id = ?').run(doc.id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);

  // Clean up files
  if (fs.existsSync(doc.original_path)) fs.unlinkSync(doc.original_path);
  if (doc.signed_path && fs.existsSync(doc.signed_path)) fs.unlinkSync(doc.signed_path);

  res.json({ message: 'Document deleted' });
});

module.exports = router;
