const express = require('express');
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const db = require('../database');

const router = express.Router();

// Get signing page data via token
router.get('/:token', (req, res) => {
  const request = db.prepare(`
    SELECT sr.*, d.title, d.filename, d.id as document_id, u.name as sender_name, u.email as sender_email
    FROM signature_requests sr
    JOIN documents d ON sr.document_id = d.id
    JOIN users u ON d.owner_id = u.id
    WHERE sr.token = ?
  `).get(req.params.token);

  if (!request) {
    return res.status(404).json({ error: 'Invalid signing link' });
  }

  if (request.status === 'signed') {
    return res.status(400).json({ error: 'Document already signed', signed_at: request.signed_at });
  }

  res.json({
    request_id: request.id,
    document_title: request.title,
    document_filename: request.filename,
    signer_name: request.signer_name,
    signer_email: request.signer_email,
    sender_name: request.sender_name,
    sender_email: request.sender_email
  });
});

// Get the PDF for viewing (via token)
router.get('/:token/pdf', (req, res) => {
  const request = db.prepare(`
    SELECT sr.*, d.original_path, d.signed_path, d.filename
    FROM signature_requests sr
    JOIN documents d ON sr.document_id = d.id
    WHERE sr.token = ?
  `).get(req.params.token);

  if (!request) {
    return res.status(404).json({ error: 'Invalid signing link' });
  }

  const filePath = request.signed_path || request.original_path;
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'PDF file not found' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(path.resolve(filePath));
});

// Submit signature
router.post('/:token/submit', async (req, res) => {
  try {
    const { signature_data, signature_type } = req.body;

    if (!signature_data) {
      return res.status(400).json({ error: 'Signature data is required' });
    }

    const request = db.prepare(`
      SELECT sr.*, d.original_path, d.signed_path, d.id as document_id
      FROM signature_requests sr
      JOIN documents d ON sr.document_id = d.id
      WHERE sr.token = ?
    `).get(req.params.token);

    if (!request) {
      return res.status(404).json({ error: 'Invalid signing link' });
    }

    if (request.status === 'signed') {
      return res.status(400).json({ error: 'Already signed' });
    }

    // Load the current PDF (use signed_path if other signers already signed, otherwise original)
    const pdfPath = request.signed_path || request.original_path;
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { height } = lastPage.getSize();

    // Count existing signatures on this document to offset vertical position
    const existingSignatures = db.prepare(
      'SELECT COUNT(*) as count FROM signatures WHERE request_id IN (SELECT id FROM signature_requests WHERE document_id = ?)'
    ).get(request.document_id);
    const sigOffset = existingSignatures.count * 60;

    if (signature_type === 'type') {
      // Typed signature
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
      lastPage.drawText(signature_data, {
        x: 50,
        y: 80 + sigOffset,
        size: 24,
        font,
        color: rgb(0, 0, 0.6)
      });
      // Draw label
      const labelFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      lastPage.drawText(`Signed by: ${request.signer_name} (${request.signer_email}) - ${new Date().toISOString()}`, {
        x: 50,
        y: 60 + sigOffset,
        size: 8,
        font: labelFont,
        color: rgb(0.4, 0.4, 0.4)
      });
    } else {
      // Drawn signature — signature_data is a base64 PNG
      const sigImageData = signature_data.replace(/^data:image\/png;base64,/, '');
      const sigImage = await pdfDoc.embedPng(Buffer.from(sigImageData, 'base64'));
      const sigDims = sigImage.scale(0.5);
      lastPage.drawImage(sigImage, {
        x: 50,
        y: 50 + sigOffset,
        width: Math.min(sigDims.width, 200),
        height: Math.min(sigDims.height, 80)
      });
      // Draw label
      const labelFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      lastPage.drawText(`Signed by: ${request.signer_name} (${request.signer_email}) - ${new Date().toISOString()}`, {
        x: 50,
        y: 40 + sigOffset,
        size: 8,
        font: labelFont,
        color: rgb(0.4, 0.4, 0.4)
      });
    }

    // Save signed PDF
    const signedBytes = await pdfDoc.save();
    const signedFilename = `signed_${request.document_id}.pdf`;
    const signedPath = path.join(__dirname, '..', '..', 'uploads', signedFilename);
    fs.writeFileSync(signedPath, signedBytes);

    // Update database
    db.prepare('INSERT INTO signatures (request_id, signature_data, signature_type, ip_address) VALUES (?, ?, ?, ?)')
      .run(request.id, signature_type === 'type' ? signature_data : '[image data]', signature_type || 'draw', req.ip);

    db.prepare("UPDATE signature_requests SET status = 'signed', signed_at = datetime('now') WHERE id = ?")
      .run(request.id);

    db.prepare("UPDATE documents SET signed_path = ?, updated_at = datetime('now') WHERE id = ?")
      .run(signedPath, request.document_id);

    // Check if all signers have signed
    const pendingCount = db.prepare(
      "SELECT COUNT(*) as count FROM signature_requests WHERE document_id = ? AND status = 'pending'"
    ).get(request.document_id);

    if (pendingCount.count === 0) {
      db.prepare("UPDATE documents SET status = 'completed', updated_at = datetime('now') WHERE id = ?")
        .run(request.document_id);
    }

    db.prepare(`
      INSERT INTO audit_log (document_id, action, actor, details, ip_address)
      VALUES (?, 'signed', ?, 'Document signed', ?)
    `).run(request.document_id, request.signer_email, req.ip);

    res.json({ message: 'Document signed successfully' });
  } catch (err) {
    console.error('Signing error:', err);
    res.status(500).json({ error: 'Failed to apply signature' });
  }
});

module.exports = router;
