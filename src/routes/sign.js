const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../database');
const { sendSignedNotification, sendDeclinedNotification, sendCompletionNotification, sendNextSignerNotification } = require('../email');

const router = express.Router();

// Get signing session data
router.get('/:token', (req, res) => {
  const recipient = db.prepare(`
    SELECT r.*, e.title as envelope_title, e.message as envelope_message, e.status as envelope_status,
           u.name as sender_name, u.email as sender_email
    FROM recipients r
    JOIN envelopes e ON r.envelope_id = e.id
    JOIN users u ON e.owner_id = u.id
    WHERE r.token = ?
  `).get(req.params.token);

  if (!recipient) return res.status(404).json({ error: 'Invalid signing link' });

  if (recipient.envelope_status === 'voided') {
    return res.status(400).json({ error: 'This envelope has been voided by the sender' });
  }
  if (recipient.status === 'signed') {
    return res.status(400).json({ error: 'You have already signed this document', signed_at: recipient.signed_at });
  }
  if (recipient.status === 'declined') {
    return res.status(400).json({ error: 'You have declined this document' });
  }
  if (recipient.status === 'pending') {
    return res.status(400).json({ error: 'It is not your turn to sign yet. Please wait for previous signers.' });
  }

  // Check access code
  if (recipient.access_code) {
    const providedCode = req.query.access_code;
    if (!providedCode) {
      return res.json({ requires_access_code: true, recipient_name: recipient.name });
    }
    if (providedCode !== recipient.access_code) {
      return res.status(403).json({ error: 'Invalid access code' });
    }
  }

  // Mark as viewed
  if (!recipient.viewed_at) {
    db.prepare("UPDATE recipients SET status = 'delivered', viewed_at = datetime('now') WHERE id = ?")
      .run(recipient.id);
    db.prepare(`INSERT INTO audit_log (envelope_id, action, actor, details, ip_address) VALUES (?, 'viewed', ?, 'Document viewed', ?)`)
      .run(recipient.envelope_id, recipient.email, req.ip);
  }

  // Get documents
  const documents = db.prepare('SELECT id, title, filename, page_count, order_num FROM envelope_documents WHERE envelope_id = ? ORDER BY order_num')
    .all(recipient.envelope_id);

  // Get fields for this recipient
  const fields = db.prepare('SELECT * FROM fields WHERE envelope_id = ? AND recipient_id = ?')
    .all(recipient.envelope_id, recipient.id);

  // Get already-filled field values (from other signers) for display
  const otherFields = db.prepare(`
    SELECT f.id, f.type, f.page_number, f.x, f.y, f.width, f.height, f.value, f.document_id,
           s.signature_data, s.signature_type
    FROM fields f
    LEFT JOIN signatures s ON s.field_id = f.id
    JOIN recipients r ON f.recipient_id = r.id
    WHERE f.envelope_id = ? AND f.recipient_id != ? AND r.status = 'signed'
  `).all(recipient.envelope_id, recipient.id);

  res.json({
    recipient_id: recipient.id,
    recipient_name: recipient.name,
    recipient_email: recipient.email,
    envelope_title: recipient.envelope_title,
    envelope_message: recipient.envelope_message,
    sender_name: recipient.sender_name,
    sender_email: recipient.sender_email,
    documents,
    fields,
    completed_fields: otherFields
  });
});

// Verify access code
router.post('/:token/verify-code', (req, res) => {
  const recipient = db.prepare('SELECT * FROM recipients WHERE token = ?').get(req.params.token);
  if (!recipient) return res.status(404).json({ error: 'Invalid signing link' });
  if (!recipient.access_code) return res.json({ valid: true });
  if (req.body.code === recipient.access_code) return res.json({ valid: true });
  return res.status(403).json({ error: 'Invalid access code' });
});

// Serve PDF for signing
router.get('/:token/documents/:docId/pdf', (req, res) => {
  const recipient = db.prepare(`
    SELECT r.envelope_id FROM recipients r
    JOIN envelopes e ON r.envelope_id = e.id
    WHERE r.token = ? AND e.status IN ('sent', 'completed')
  `).get(req.params.token);

  if (!recipient) return res.status(404).json({ error: 'Invalid signing link' });

  const doc = db.prepare('SELECT * FROM envelope_documents WHERE id = ? AND envelope_id = ?')
    .get(req.params.docId, recipient.envelope_id);

  if (!doc || !fs.existsSync(doc.file_path)) return res.status(404).json({ error: 'Document not found' });

  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(path.resolve(doc.file_path));
});

// Fill a field value
router.post('/:token/fields/:fieldId', (req, res) => {
  const recipient = db.prepare(`
    SELECT r.* FROM recipients r
    JOIN envelopes e ON r.envelope_id = e.id
    WHERE r.token = ? AND e.status = 'sent' AND r.status IN ('sent', 'delivered')
  `).get(req.params.token);

  if (!recipient) return res.status(404).json({ error: 'Cannot sign at this time' });

  const field = db.prepare('SELECT * FROM fields WHERE id = ? AND recipient_id = ?')
    .get(req.params.fieldId, recipient.id);

  if (!field) return res.status(404).json({ error: 'Field not found' });

  const { value, signature_data, signature_type } = req.body;

  if (field.type === 'signature' || field.type === 'initials') {
    if (!signature_data) return res.status(400).json({ error: 'Signature data required' });

    db.prepare('DELETE FROM signatures WHERE field_id = ? AND recipient_id = ?').run(field.id, recipient.id);
    db.prepare('INSERT INTO signatures (recipient_id, field_id, signature_data, signature_type, ip_address) VALUES (?, ?, ?, ?, ?)')
      .run(recipient.id, field.id, signature_data, signature_type || 'draw', req.ip);

    db.prepare('UPDATE fields SET value = ? WHERE id = ?').run(signature_type === 'type' ? signature_data : '[signed]', field.id);
  } else {
    db.prepare('UPDATE fields SET value = ? WHERE id = ?').run(value || '', field.id);
  }

  res.json({ message: 'Field saved' });
});

// Complete signing
router.post('/:token/complete', (req, res) => {
  const recipient = db.prepare(`
    SELECT r.* FROM recipients r
    JOIN envelopes e ON r.envelope_id = e.id
    WHERE r.token = ? AND e.status = 'sent' AND r.status IN ('sent', 'delivered')
  `).get(req.params.token);

  if (!recipient) return res.status(404).json({ error: 'Cannot complete signing' });

  const unfilledRequired = db.prepare(`
    SELECT COUNT(*) as count FROM fields
    WHERE recipient_id = ? AND required = 1 AND (value IS NULL OR value = '')
  `).get(recipient.id);

  if (unfilledRequired.count > 0) {
    return res.status(400).json({ error: `${unfilledRequired.count} required field(s) are not filled` });
  }

  db.prepare("UPDATE recipients SET status = 'signed', signed_at = datetime('now') WHERE id = ?")
    .run(recipient.id);

  db.prepare(`INSERT INTO audit_log (envelope_id, action, actor, details, ip_address) VALUES (?, 'signed', ?, 'Document signed', ?)`)
    .run(recipient.envelope_id, recipient.email, req.ip);

  // Check if all signers have completed
  const pendingSigners = db.prepare(
    "SELECT COUNT(*) as count FROM recipients WHERE envelope_id = ? AND role = 'signer' AND status != 'signed'"
  ).get(recipient.envelope_id);

  // Get envelope and sender info for emails
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ?').get(recipient.envelope_id);
  const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(envelope.owner_id);
  const totalSigners = db.prepare("SELECT COUNT(*) as count FROM recipients WHERE envelope_id = ? AND role = 'signer'").get(recipient.envelope_id).count;
  const signedCount = db.prepare("SELECT COUNT(*) as count FROM recipients WHERE envelope_id = ? AND role = 'signer' AND status = 'signed'").get(recipient.envelope_id).count;
  const APP_URL = process.env.APP_URL || 'https://sign.datastacksignal.com';
  const allSigned = pendingSigners.count === 0;

  if (allSigned) {
    db.prepare("UPDATE envelopes SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(recipient.envelope_id);
    db.prepare(`INSERT INTO audit_log (envelope_id, action, actor, details, ip_address) VALUES (?, 'completed', 'system', 'All signers have signed', ?)`)
      .run(recipient.envelope_id, req.ip);

    // Notify all signers that envelope is complete
    const allSigners = db.prepare("SELECT name, email FROM recipients WHERE envelope_id = ? AND role = 'signer'").all(recipient.envelope_id);
    for (const s of allSigners) {
      sendCompletionNotification({
        recipientName: s.name,
        recipientEmail: s.email,
        envelopeTitle: envelope.title,
        senderName: owner.name
      }).catch(err => console.error('Failed to send completion email:', err));
    }
  } else {
    // Advance to next signer
    const nextSigners = db.prepare(`
      SELECT * FROM recipients WHERE envelope_id = ? AND role = 'signer' AND status = 'pending'
      ORDER BY order_num LIMIT 1
    `).all(recipient.envelope_id);

    if (nextSigners.length > 0) {
      db.prepare("UPDATE recipients SET status = 'sent' WHERE envelope_id = ? AND order_num = ? AND status = 'pending'")
        .run(recipient.envelope_id, nextSigners[0].order_num);

      // Email next signer
      const next = nextSigners[0];
      sendNextSignerNotification({
        recipientName: next.name,
        recipientEmail: next.email,
        senderName: owner.name,
        senderEmail: owner.email,
        envelopeTitle: envelope.title,
        signingUrl: `${APP_URL}/sign/${next.token}`
      }).catch(err => console.error('Failed to send next signer email:', err));
    }
  }

  // Notify sender that this recipient signed
  sendSignedNotification({
    senderEmail: owner.email,
    senderName: owner.name,
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    envelopeTitle: envelope.title,
    allSigned,
    totalSigners,
    signedCount
  }).catch(err => console.error('Failed to send signed notification:', err));

  res.json({ message: 'Signing completed successfully' });
});

// Decline to sign
router.post('/:token/decline', (req, res) => {
  const recipient = db.prepare(`
    SELECT r.* FROM recipients r
    JOIN envelopes e ON r.envelope_id = e.id
    WHERE r.token = ? AND e.status = 'sent' AND r.status IN ('sent', 'delivered')
  `).get(req.params.token);

  if (!recipient) return res.status(404).json({ error: 'Cannot decline at this time' });

  const { reason } = req.body;

  db.prepare("UPDATE recipients SET status = 'declined', decline_reason = ? WHERE id = ?")
    .run(reason || 'No reason provided', recipient.id);

  db.prepare("UPDATE envelopes SET status = 'declined', updated_at = datetime('now') WHERE id = ?")
    .run(recipient.envelope_id);

  db.prepare(`INSERT INTO audit_log (envelope_id, action, actor, details, ip_address) VALUES (?, 'declined', ?, ?, ?)`)
    .run(recipient.envelope_id, recipient.email, reason || 'Declined without reason', req.ip);

  // Notify sender of decline
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ?').get(recipient.envelope_id);
  const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(envelope.owner_id);
  sendDeclinedNotification({
    senderEmail: owner.email,
    senderName: owner.name,
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    envelopeTitle: envelope.title,
    reason: reason || 'No reason provided'
  }).catch(err => console.error('Failed to send decline notification:', err));

  res.json({ message: 'Signing declined' });
});

module.exports = router;
