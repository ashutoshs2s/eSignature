const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');
const { sendSigningInvitation, sendReminderEmail } = require('../email');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});
const ALLOWED_MIMETYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
]);
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMETYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type. Please upload PDF, Word, or spreadsheet files.'));
  }
});

// Recipient colors for field editor
const RECIPIENT_COLORS = [
  '#5B21B6', '#0891B2', '#059669', '#D97706', '#DC2626',
  '#7C3AED', '#2563EB', '#10B981', '#F59E0B', '#EF4444'
];

// ===================== Envelopes =====================

// List envelopes
router.get('/', requireAuth, (req, res) => {
  const { status, search } = req.query;
  let query = `
    SELECT e.*,
      (SELECT COUNT(*) FROM recipients r WHERE r.envelope_id = e.id AND r.role = 'signer') as total_signers,
      (SELECT COUNT(*) FROM recipients r WHERE r.envelope_id = e.id AND r.role = 'signer' AND r.status = 'signed') as signed_count,
      (SELECT COUNT(*) FROM envelope_documents ed WHERE ed.envelope_id = e.id) as document_count
    FROM envelopes e WHERE e.owner_id = ?
  `;
  const params = [req.session.userId];

  if (status && status !== 'all') {
    query += ' AND e.status = ?';
    params.push(status);
  }
  if (search) {
    query += ' AND e.title LIKE ?';
    params.push(`%${search}%`);
  }
  query += ' ORDER BY e.updated_at DESC';

  res.json(db.prepare(query).all(...params));
});

// Inbox — envelopes where current user is a recipient
router.get('/inbox', requireAuth, (req, res) => {
  const items = db.prepare(`
    SELECT e.id, e.title, e.message, e.status as envelope_status, e.created_at,
           r.id as recipient_id, r.status as my_status, r.token, r.order_num,
           u.name as sender_name, u.email as sender_email
    FROM recipients r
    JOIN envelopes e ON r.envelope_id = e.id
    JOIN users u ON e.owner_id = u.id
    WHERE r.email = ? AND e.status IN ('sent', 'completed')
    ORDER BY r.created_at DESC
  `).all(req.session.userEmail);
  res.json(items);
});

// Create envelope
router.post('/', requireAuth, (req, res) => {
  const id = uuidv4();
  const { title, message, expires_at } = req.body;

  db.prepare(`
    INSERT INTO envelopes (id, title, message, owner_id, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, title || 'Untitled Envelope', message || '', req.session.userId, expires_at || null);

  db.prepare(`
    INSERT INTO audit_log (envelope_id, action, actor, details, ip_address)
    VALUES (?, 'created', ?, 'Envelope created', ?)
  `).run(id, req.session.userEmail, req.ip);

  res.json({ id, title: title || 'Untitled Envelope', status: 'draft' });
});

// Get envelope detail
router.get('/:id', requireAuth, (req, res) => {
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found' });

  const documents = db.prepare('SELECT * FROM envelope_documents WHERE envelope_id = ? ORDER BY order_num')
    .all(envelope.id);
  const recipients = db.prepare('SELECT * FROM recipients WHERE envelope_id = ? ORDER BY order_num')
    .all(envelope.id);

  // Assign colors to recipients
  recipients.forEach((r, i) => { r.color = RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]; });

  const fields = db.prepare('SELECT * FROM fields WHERE envelope_id = ?').all(envelope.id);
  const auditLog = db.prepare('SELECT * FROM audit_log WHERE envelope_id = ? ORDER BY created_at DESC')
    .all(envelope.id);

  res.json({ ...envelope, documents, recipients, fields, auditLog });
});

// Update envelope
router.put('/:id', requireAuth, (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'draft'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found or not editable' });

  const { title, message, expires_at } = req.body;
  db.prepare("UPDATE envelopes SET title = ?, message = ?, expires_at = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title || envelope.title, message ?? envelope.message, expires_at ?? envelope.expires_at, envelope.id);

  res.json({ message: 'Envelope updated' });
});

// Delete envelope (draft only)
router.delete('/:id', requireAuth, (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ?")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found' });

  // Clean up files
  const docs = db.prepare('SELECT file_path FROM envelope_documents WHERE envelope_id = ?').all(envelope.id);
  docs.forEach(d => { if (fs.existsSync(d.file_path)) fs.unlinkSync(d.file_path); });

  db.prepare('DELETE FROM envelopes WHERE id = ?').run(envelope.id);
  res.json({ message: 'Envelope deleted' });
});

// Send envelope
router.post('/:id/send', requireAuth, (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'draft'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found or already sent' });

  const docs = db.prepare('SELECT id FROM envelope_documents WHERE envelope_id = ?').all(envelope.id);
  if (docs.length === 0) return res.status(400).json({ error: 'Add at least one document' });

  const signers = db.prepare("SELECT * FROM recipients WHERE envelope_id = ? AND role = 'signer' ORDER BY order_num")
    .all(envelope.id);
  if (signers.length === 0) return res.status(400).json({ error: 'Add at least one signer' });

  const fieldCount = db.prepare('SELECT COUNT(*) as count FROM fields WHERE envelope_id = ?').get(envelope.id);
  if (fieldCount.count === 0) return res.status(400).json({ error: 'Place at least one field' });

  // Mark first signer(s) as 'sent' (for sequential signing)
  const firstOrder = signers[0].order_num;
  db.prepare("UPDATE recipients SET status = 'sent' WHERE envelope_id = ? AND order_num = ?")
    .run(envelope.id, firstOrder);

  // Mark CC recipients as 'sent'
  db.prepare("UPDATE recipients SET status = 'sent' WHERE envelope_id = ? AND role = 'cc'")
    .run(envelope.id);

  db.prepare("UPDATE envelopes SET status = 'sent', updated_at = datetime('now') WHERE id = ?")
    .run(envelope.id);

  db.prepare(`INSERT INTO audit_log (envelope_id, action, actor, details, ip_address) VALUES (?, 'sent', ?, ?, ?)`)
    .run(envelope.id, req.session.userEmail, `Sent to ${signers.map(s => s.email).join(', ')}`, req.ip);

  // Return signing links for all recipients
  const allRecipients = db.prepare("SELECT id, name, email, role, token, order_num, status FROM recipients WHERE envelope_id = ? ORDER BY order_num").all(envelope.id);

  // Send emails to first-round signers (non-blocking)
  const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.session.userId);
  const APP_URL = process.env.APP_URL || 'https://sign.datastacksignal.com';

  const firstRoundRecipients = allRecipients.filter(r => r.status === 'sent' && r.role === 'signer');
  for (const r of firstRoundRecipients) {
    sendSigningInvitation({
      recipientName: r.name,
      recipientEmail: r.email,
      senderName: owner.name,
      senderEmail: owner.email,
      envelopeTitle: envelope.title,
      message: envelope.message,
      signingUrl: `${APP_URL}/sign/${r.token}`
    }).catch(err => console.error('Failed to send invitation email:', err));
  }

  res.json({ message: 'Envelope sent', recipients: allRecipients });
});

// Void envelope
router.post('/:id/void', requireAuth, (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'sent'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found or cannot be voided' });

  const { reason } = req.body;
  db.prepare("UPDATE envelopes SET status = 'voided', voided_at = datetime('now'), void_reason = ?, updated_at = datetime('now') WHERE id = ?")
    .run(reason || 'Voided by sender', envelope.id);

  db.prepare(`INSERT INTO audit_log (envelope_id, action, actor, details, ip_address) VALUES (?, 'voided', ?, ?, ?)`)
    .run(envelope.id, req.session.userEmail, reason || 'Voided by sender', req.ip);

  res.json({ message: 'Envelope voided' });
});

// Resend to a recipient
router.post('/:id/resend/:recipientId', requireAuth, (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'sent'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found' });

  const recipient = db.prepare("SELECT * FROM recipients WHERE id = ? AND envelope_id = ? AND status IN ('sent', 'delivered')")
    .get(req.params.recipientId, envelope.id);
  if (!recipient) return res.status(404).json({ error: 'Recipient not found or already signed' });

  db.prepare(`INSERT INTO audit_log (envelope_id, action, actor, details, ip_address) VALUES (?, 'reminder_sent', ?, ?, ?)`)
    .run(envelope.id, req.session.userEmail, `Reminder sent to ${recipient.email}`, req.ip);

  // Send reminder email (non-blocking)
  const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.session.userId);
  const APP_URL = process.env.APP_URL || 'https://sign.datastacksignal.com';
  sendReminderEmail({
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    senderName: owner.name,
    senderEmail: owner.email,
    envelopeTitle: envelope.title,
    signingUrl: `${APP_URL}/sign/${recipient.token}`
  }).catch(err => console.error('Failed to send reminder email:', err));

  res.json({ message: 'Reminder sent', token: recipient.token });
});

// ===================== Documents within Envelope =====================

// Upload document to envelope
router.post('/:id/documents', requireAuth, upload.single('file'), async (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'draft'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found or not editable' });

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Convert non-PDF files to PDF using LibreOffice
  let filePath = req.file.path;
  if (req.file.mimetype !== 'application/pdf') {
    try {
      const outDir = path.dirname(filePath);
      execSync(`libreoffice --headless --convert-to pdf --outdir "${outDir}" "${filePath}"`, { timeout: 30000 });
      const pdfPath = filePath.replace(path.extname(filePath), '.pdf');
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(filePath);
        filePath = pdfPath;
      } else {
        throw new Error('Conversion failed');
      }
    } catch (e) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Failed to convert file to PDF. Please upload a valid document.' });
    }
  }

  // Get page count using pdf-lib
  let pageCount = 1;
  try {
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    pageCount = pdfDoc.getPageCount();
  } catch (e) {
    // If we can't read page count, default to 1
  }

  const existingCount = db.prepare('SELECT COUNT(*) as count FROM envelope_documents WHERE envelope_id = ?')
    .get(envelope.id).count;

  const docId = uuidv4();
  const title = req.body.title || req.file.originalname;

  db.prepare(`
    INSERT INTO envelope_documents (id, envelope_id, title, filename, file_path, page_count, order_num)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(docId, envelope.id, title, req.file.originalname, filePath, pageCount, existingCount);

  db.prepare("UPDATE envelopes SET updated_at = datetime('now') WHERE id = ?").run(envelope.id);

  res.json({ id: docId, title, filename: req.file.originalname, page_count: pageCount, order_num: existingCount });
});

// Remove document from envelope
router.delete('/:id/documents/:docId', requireAuth, (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'draft'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found or not editable' });

  const doc = db.prepare('SELECT * FROM envelope_documents WHERE id = ? AND envelope_id = ?')
    .get(req.params.docId, envelope.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  if (fs.existsSync(doc.file_path)) fs.unlinkSync(doc.file_path);
  db.prepare('DELETE FROM fields WHERE document_id = ?').run(doc.id);
  db.prepare('DELETE FROM envelope_documents WHERE id = ?').run(doc.id);
  res.json({ message: 'Document removed' });
});

// Serve PDF for viewing (owner)
router.get('/:id/documents/:docId/pdf', requireAuth, (req, res) => {
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found' });

  const doc = db.prepare('SELECT * FROM envelope_documents WHERE id = ? AND envelope_id = ?')
    .get(req.params.docId, envelope.id);
  if (!doc || !fs.existsSync(doc.file_path)) return res.status(404).json({ error: 'Document not found' });

  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(path.resolve(doc.file_path));
});

// ===================== Recipients =====================

// Add recipient
router.post('/:id/recipients', requireAuth, (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'draft'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found or not editable' });

  const { name, email, role, order_num, access_code } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

  const existingCount = db.prepare('SELECT COUNT(*) as count FROM recipients WHERE envelope_id = ?')
    .get(envelope.id).count;

  const id = uuidv4();
  const token = uuidv4();

  db.prepare(`
    INSERT INTO recipients (id, envelope_id, name, email, role, order_num, token, access_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, envelope.id, name, email, role || 'signer', order_num ?? (existingCount + 1), token, access_code || null);

  const recipient = db.prepare('SELECT * FROM recipients WHERE id = ?').get(id);
  recipient.color = RECIPIENT_COLORS[existingCount % RECIPIENT_COLORS.length];

  res.json(recipient);
});

// Update recipient
router.put('/:id/recipients/:rid', requireAuth, (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'draft'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found or not editable' });

  const { name, email, role, order_num, access_code } = req.body;
  db.prepare(`
    UPDATE recipients SET name = COALESCE(?, name), email = COALESCE(?, email),
    role = COALESCE(?, role), order_num = COALESCE(?, order_num), access_code = ?
    WHERE id = ? AND envelope_id = ?
  `).run(name, email, role, order_num, access_code || null, req.params.rid, envelope.id);

  res.json({ message: 'Recipient updated' });
});

// Remove recipient
router.delete('/:id/recipients/:rid', requireAuth, (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'draft'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found or not editable' });

  db.prepare('DELETE FROM fields WHERE recipient_id = ?').run(req.params.rid);
  db.prepare('DELETE FROM recipients WHERE id = ? AND envelope_id = ?').run(req.params.rid, envelope.id);
  res.json({ message: 'Recipient removed' });
});

// ===================== Fields =====================

// Save fields (bulk replace for a document)
router.post('/:id/fields', requireAuth, (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'draft'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found or not editable' });

  const { fields } = req.body;
  if (!Array.isArray(fields)) return res.status(400).json({ error: 'Fields array required' });

  // Delete existing fields for this envelope and re-insert
  db.prepare('DELETE FROM fields WHERE envelope_id = ?').run(envelope.id);

  const insert = db.prepare(`
    INSERT INTO fields (id, envelope_id, document_id, recipient_id, type, page_number, x, y, width, height, required, label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((fieldList) => {
    for (const f of fieldList) {
      insert.run(
        f.id || uuidv4(), envelope.id, f.document_id, f.recipient_id,
        f.type, f.page_number || 1, f.x, f.y, f.width, f.height,
        f.required !== false ? 1 : 0, f.label || ''
      );
    }
  });

  insertMany(fields);
  db.prepare("UPDATE envelopes SET updated_at = datetime('now') WHERE id = ?").run(envelope.id);

  res.json({ message: 'Fields saved', count: fields.length });
});

// Get fields for envelope
router.get('/:id/fields', requireAuth, (req, res) => {
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found' });

  const fields = db.prepare('SELECT * FROM fields WHERE envelope_id = ?').all(envelope.id);
  res.json(fields);
});

// ===================== Certificate of Completion =====================

router.get('/:id/certificate', requireAuth, async (req, res) => {
  const envelope = db.prepare("SELECT * FROM envelopes WHERE id = ? AND owner_id = ? AND status = 'completed'")
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found or not completed' });

  const recipients = db.prepare("SELECT * FROM recipients WHERE envelope_id = ? AND role = 'signer' ORDER BY order_num")
    .all(envelope.id);
  const documents = db.prepare('SELECT title, filename FROM envelope_documents WHERE envelope_id = ? ORDER BY order_num')
    .all(envelope.id);
  const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(envelope.owner_id);

  try {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const purple = rgb(0.357, 0.129, 0.714);
    const gray = rgb(0.4, 0.4, 0.4);
    const black = rgb(0, 0, 0);

    let y = 720;

    // Header
    page.drawText('CERTIFICATE OF COMPLETION', { x: 50, y, size: 22, font: boldFont, color: purple });
    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 2, color: purple });
    y -= 30;

    page.drawText('BuyerForesight eSign', { x: 50, y, size: 12, font: boldFont, color: purple });
    y -= 30;

    // Envelope info
    page.drawText('Envelope ID:', { x: 50, y, size: 10, font: boldFont, color: gray });
    page.drawText(envelope.id, { x: 150, y, size: 10, font, color: black });
    y -= 18;
    page.drawText('Title:', { x: 50, y, size: 10, font: boldFont, color: gray });
    page.drawText(envelope.title, { x: 150, y, size: 10, font, color: black });
    y -= 18;
    page.drawText('Status:', { x: 50, y, size: 10, font: boldFont, color: gray });
    page.drawText('Completed', { x: 150, y, size: 10, font, color: rgb(0.086, 0.639, 0.29) });
    y -= 18;
    page.drawText('Sent:', { x: 50, y, size: 10, font: boldFont, color: gray });
    page.drawText(envelope.created_at, { x: 150, y, size: 10, font, color: black });
    y -= 18;
    page.drawText('Completed:', { x: 50, y, size: 10, font: boldFont, color: gray });
    page.drawText(envelope.completed_at || '', { x: 150, y, size: 10, font, color: black });
    y -= 18;
    page.drawText('Sender:', { x: 50, y, size: 10, font: boldFont, color: gray });
    page.drawText(`${owner.name} (${owner.email})`, { x: 150, y, size: 10, font, color: black });
    y -= 30;

    // Documents
    page.drawText('Documents:', { x: 50, y, size: 12, font: boldFont, color: black });
    y -= 18;
    documents.forEach((d, i) => {
      page.drawText(`${i + 1}. ${d.title} (${d.filename})`, { x: 70, y, size: 10, font, color: black });
      y -= 16;
    });
    y -= 15;

    // Signers
    page.drawText('Signing Events:', { x: 50, y, size: 12, font: boldFont, color: black });
    y -= 5;
    page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 18;

    recipients.forEach(r => {
      page.drawText(r.name, { x: 50, y, size: 11, font: boldFont, color: black });
      y -= 16;
      page.drawText(`Email: ${r.email}`, { x: 70, y, size: 9, font, color: gray });
      y -= 14;
      page.drawText(`Status: Signed`, { x: 70, y, size: 9, font, color: rgb(0.086, 0.639, 0.29) });
      y -= 14;
      page.drawText(`Signed at: ${r.signed_at || 'N/A'}`, { x: 70, y, size: 9, font, color: gray });
      y -= 14;
      page.drawText(`Signing order: ${r.order_num}`, { x: 70, y, size: 9, font, color: gray });
      y -= 20;
    });

    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 20;
    page.drawText('This certificate is auto-generated by BuyerForesight eSign and verifies the completion of the signing process.',
      { x: 50, y, size: 8, font, color: gray });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${envelope.id}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Certificate error:', err);
    res.status(500).json({ error: 'Failed to generate certificate' });
  }
});

// Download signed document (combines all docs with field values embedded)
router.get('/:id/download', requireAuth, async (req, res) => {
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.session.userId);
  if (!envelope) return res.status(404).json({ error: 'Envelope not found' });

  const docs = db.prepare('SELECT * FROM envelope_documents WHERE envelope_id = ? ORDER BY order_num')
    .all(envelope.id);
  if (docs.length === 0) return res.status(404).json({ error: 'No documents found' });

  // For single doc, embed signatures into it
  const doc = docs[0];
  const allFields = db.prepare(`
    SELECT f.*, s.signature_data, s.signature_type, s.signature_font
    FROM fields f
    LEFT JOIN signatures s ON s.field_id = f.id
    WHERE f.document_id = ?
  `).all(doc.id);

  try {
    const pdfBytes = fs.readFileSync(doc.file_path);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    for (const field of allFields) {
      if (!field.value && !field.signature_data) continue;
      const pageIdx = (field.page_number || 1) - 1;
      if (pageIdx >= pages.length) continue;
      const page = pages[pageIdx];
      const { width: pw, height: ph } = page.getSize();

      const fx = (field.x / 100) * pw;
      const fy = ph - (field.y / 100) * ph - (field.height / 100) * ph;

      if (field.type === 'signature' || field.type === 'initials') {
        if (field.signature_data && field.signature_data.startsWith('data:image')) {
          const imgData = field.signature_data.replace(/^data:image\/png;base64,/, '');
          const img = await pdfDoc.embedPng(Buffer.from(imgData, 'base64'));
          page.drawImage(img, {
            x: fx, y: fy,
            width: (field.width / 100) * pw,
            height: (field.height / 100) * ph
          });
        } else if (field.signature_data) {
          const sigFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
          page.drawText(field.signature_data, {
            x: fx, y: fy + 5,
            size: 16, font: sigFont, color: rgb(0.357, 0.129, 0.714)
          });
        }
      } else if (field.value) {
        const textFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        if (field.type === 'checkbox') {
          if (field.value === 'true') {
            page.drawText('✓', { x: fx + 2, y: fy + 2, size: 14, font: textFont, color: rgb(0, 0, 0) });
          }
        } else {
          page.drawText(field.value, {
            x: fx + 2, y: fy + 5,
            size: 10, font: textFont, color: rgb(0, 0, 0)
          });
        }
      }
    }

    const finalBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
    res.send(Buffer.from(finalBytes));
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to generate signed document' });
  }
});

module.exports = router;
