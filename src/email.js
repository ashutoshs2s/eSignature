const nodemailer = require('nodemailer');

// SMTP configuration from environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const FROM_NAME = process.env.EMAIL_FROM_NAME || 'BuyerForesight eSign';
const FROM_EMAIL = process.env.SMTP_USER || 'noreply@datastacksignal.com';
const APP_URL = process.env.APP_URL || 'https://sign.datastacksignal.com';

function baseTemplate(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; padding:0; background:#f4f4f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .wrapper { width:100%; background:#f4f4f7; padding:40px 0; }
  .container { max-width:580px; margin:0 auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
  .header { background:#5B21B6; padding:24px 32px; text-align:center; }
  .header h1 { color:#fff; margin:0; font-size:20px; font-weight:600; letter-spacing:0.5px; }
  .body { padding:32px; color:#333; line-height:1.6; }
  .body h2 { color:#1a1a1a; font-size:18px; margin:0 0 16px; }
  .body p { margin:0 0 14px; font-size:14px; }
  .btn { display:inline-block; padding:12px 28px; background:#5B21B6; color:#fff!important; text-decoration:none; border-radius:6px; font-weight:600; font-size:14px; margin:16px 0; }
  .btn:hover { background:#4C1D95; }
  .info-box { background:#f8f5ff; border:1px solid #e9e0f7; border-radius:6px; padding:16px; margin:16px 0; }
  .info-box p { margin:4px 0; font-size:13px; color:#555; }
  .info-box strong { color:#333; }
  .footer { padding:20px 32px; text-align:center; border-top:1px solid #eee; }
  .footer p { margin:0; font-size:12px; color:#999; }
</style></head>
<body><div class="wrapper"><div class="container">
  <div class="header"><h1>BuyerForesight eSign</h1></div>
  <div class="body">${content}</div>
  <div class="footer"><p>&copy; ${new Date().getFullYear()} BuyerForesight. All rights reserved.</p></div>
</div></div></body></html>`;
}

async function sendMail(to, subject, html) {
  if (!process.env.SMTP_USER) {
    console.log(`[Email skipped - no SMTP config] To: ${to}, Subject: ${subject}`);
    return false;
  }
  try {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html
    });
    console.log(`[Email sent] To: ${to}, Subject: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[Email error] To: ${to}, Subject: ${subject}`, err.message);
    return false;
  }
}

// Send signing invitation to a recipient
async function sendSigningInvitation({ recipientName, recipientEmail, senderName, senderEmail, envelopeTitle, message, signingUrl }) {
  const messageBlock = message
    ? `<div class="info-box"><p><strong>Message from ${senderName}:</strong></p><p>${message}</p></div>`
    : '';

  const html = baseTemplate(`
    <h2>You have a document to sign</h2>
    <p>Hi ${recipientName},</p>
    <p><strong>${senderName}</strong> (${senderEmail}) has sent you a document to review and sign.</p>
    <div class="info-box">
      <p><strong>Document:</strong> ${envelopeTitle}</p>
    </div>
    ${messageBlock}
    <p style="text-align:center">
      <a href="${signingUrl}" class="btn">Review & Sign Document</a>
    </p>
    <p style="font-size:12px;color:#888;">If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${signingUrl}" style="color:#5B21B6;word-break:break-all;">${signingUrl}</a></p>
  `);

  return sendMail(recipientEmail, `${senderName} sent you "${envelopeTitle}" to sign`, html);
}

// Notify sender that a recipient has signed
async function sendSignedNotification({ senderEmail, senderName, recipientName, recipientEmail, envelopeTitle, allSigned, totalSigners, signedCount }) {
  const statusText = allSigned
    ? '<p style="color:#059669;font-weight:600;">All signers have completed signing. Your envelope is now complete!</p>'
    : `<p>${signedCount} of ${totalSigners} signers have completed signing.</p>`;

  const html = baseTemplate(`
    <h2>${recipientName} has signed</h2>
    <p>Hi ${senderName},</p>
    <p><strong>${recipientName}</strong> (${recipientEmail}) has signed <strong>"${envelopeTitle}"</strong>.</p>
    ${statusText}
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">${allSigned ? 'View Completed Envelope' : 'View Envelope Status'}</a>
    </p>
  `);

  const subject = allSigned
    ? `Completed: "${envelopeTitle}" - All signers have signed`
    : `Signed: ${recipientName} has signed "${envelopeTitle}"`;

  return sendMail(senderEmail, subject, html);
}

// Notify sender that a recipient declined
async function sendDeclinedNotification({ senderEmail, senderName, recipientName, recipientEmail, envelopeTitle, reason }) {
  const html = baseTemplate(`
    <h2>Signing Declined</h2>
    <p>Hi ${senderName},</p>
    <p><strong>${recipientName}</strong> (${recipientEmail}) has declined to sign <strong>"${envelopeTitle}"</strong>.</p>
    <div class="info-box">
      <p><strong>Reason:</strong> ${reason || 'No reason provided'}</p>
    </div>
    <p style="text-align:center">
      <a href="${APP_URL}" class="btn">View Envelope</a>
    </p>
  `);

  return sendMail(senderEmail, `Declined: ${recipientName} declined to sign "${envelopeTitle}"`, html);
}

// Notify all recipients that envelope is completed
async function sendCompletionNotification({ recipientName, recipientEmail, envelopeTitle, senderName }) {
  const html = baseTemplate(`
    <h2>Document Signing Complete</h2>
    <p>Hi ${recipientName},</p>
    <p>All parties have signed <strong>"${envelopeTitle}"</strong>. The document is now complete.</p>
    <p>Sent by: ${senderName}</p>
    <p style="font-size:13px;color:#666;">A copy of the signed document is available from the sender.</p>
  `);

  return sendMail(recipientEmail, `Completed: "${envelopeTitle}" - All signatures collected`, html);
}

// Send reminder email
async function sendReminderEmail({ recipientName, recipientEmail, senderName, senderEmail, envelopeTitle, signingUrl }) {
  const html = baseTemplate(`
    <h2>Reminder: Document awaiting your signature</h2>
    <p>Hi ${recipientName},</p>
    <p>This is a reminder that <strong>${senderName}</strong> (${senderEmail}) is waiting for you to sign <strong>"${envelopeTitle}"</strong>.</p>
    <p style="text-align:center">
      <a href="${signingUrl}" class="btn">Review & Sign Document</a>
    </p>
    <p style="font-size:12px;color:#888;">If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${signingUrl}" style="color:#5B21B6;word-break:break-all;">${signingUrl}</a></p>
  `);

  return sendMail(recipientEmail, `Reminder: ${senderName} is waiting for you to sign "${envelopeTitle}"`, html);
}

// Notify next signer that it's their turn
async function sendNextSignerNotification({ recipientName, recipientEmail, senderName, senderEmail, envelopeTitle, signingUrl }) {
  const html = baseTemplate(`
    <h2>It's your turn to sign</h2>
    <p>Hi ${recipientName},</p>
    <p><strong>${senderName}</strong> (${senderEmail}) has sent you <strong>"${envelopeTitle}"</strong> for your signature. Previous signers have completed their signatures and it's now your turn.</p>
    <p style="text-align:center">
      <a href="${signingUrl}" class="btn">Review & Sign Document</a>
    </p>
    <p style="font-size:12px;color:#888;">If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${signingUrl}" style="color:#5B21B6;word-break:break-all;">${signingUrl}</a></p>
  `);

  return sendMail(recipientEmail, `Action Required: Sign "${envelopeTitle}"`, html);
}

module.exports = {
  sendSigningInvitation,
  sendSignedNotification,
  sendDeclinedNotification,
  sendCompletionNotification,
  sendReminderEmail,
  sendNextSignerNotification
};
