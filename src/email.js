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

// Inline SVG logo mark for email (base64-encoded for max compatibility)
const LOGO_SVG_B64 = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 212" width="48" height="35"><path d="M0 0H220Q290 0 290 70V142Q290 212 220 212H0Z" fill="#5B21B6"/><polygon points="0,0 100,0 185,90 80,90" fill="white"/><polygon points="80,90 185,90 185,122 80,122" fill="white"/><polygon points="80,122 185,122 290,212 185,212" fill="white"/></svg>`).toString('base64');

function baseTemplate(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f5f5;">
    <tr><td style="padding:0;">

      <!-- Top brand bar -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr><td style="height:4px;background:#5B21B6;font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>

      <!-- Logo -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr><td align="center" style="padding:28px 0 20px;">
          <img src="${LOGO_SVG_B64}" alt="BuyerForesight" width="40" height="29" style="display:block;" />
          <span style="display:block;margin-top:6px;font-size:15px;font-weight:600;color:#1a1a2e;letter-spacing:0.3px;">BuyerForesight eSign</span>
        </td></tr>
      </table>

      <!-- Main content -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width:600px;width:100%;margin:0 auto;">
        <tr><td style="padding:0 24px 32px;">
          ${content}
        </td></tr>
      </table>

      <!-- Security notice -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width:600px;width:100%;margin:0 auto;">
        <tr><td style="padding:0 24px 8px;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#333;">Do Not Share This Email</p>
          <p style="margin:0 0 16px;font-size:12px;color:#666;line-height:1.5;">This email contains a secure link to BuyerForesight eSign. Please do not share this email, link, or access code with others.</p>
        </td></tr>
      </table>

      <!-- Footer -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width:600px;width:100%;margin:0 auto;">
        <tr><td style="padding:16px 24px 40px;border-top:1px solid #e5e5e5;">
          <p style="margin:0 0 6px;font-size:11px;color:#999;line-height:1.5;">This message was sent to you by someone using the BuyerForesight Electronic Signature Service.</p>
          <p style="margin:0;font-size:11px;color:#bbb;">Copyright &copy; ${new Date().getFullYear()} BuyerForesight. All rights reserved.</p>
        </td></tr>
      </table>

    </td></tr>
  </table>
</body></html>`;
}

function heroSection({ iconSvgB64, heading, buttonText, buttonUrl }) {
  return `
  <!-- Hero card -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#1a1a3e;border-radius:12px;overflow:hidden;">
    <tr><td align="center" style="padding:40px 32px 44px;">
      ${iconSvgB64 ? `<div style="width:52px;height:52px;background:#fff;border-radius:12px;display:inline-block;text-align:center;line-height:52px;margin-bottom:20px;">
        <img src="${iconSvgB64}" alt="" width="24" height="24" style="display:inline-block;vertical-align:middle;" />
      </div>` : ''}
      <p style="margin:0 0 24px;font-size:16px;color:#e0dff0;line-height:1.5;">${heading}</p>
      ${buttonText && buttonUrl ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
        <tr><td style="background:#5B21B6;border-radius:6px;">
          <a href="${buttonUrl}" target="_blank" style="display:inline-block;padding:13px 32px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.3px;">${buttonText}</a>
        </td></tr>
      </table>` : ''}
    </td></tr>
  </table>`;
}

function senderCard({ senderName, senderEmail, message }) {
  return `
  <!-- Sender info card -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;background:#ffffff;border:1px solid #e8e8e8;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:24px 28px;">
      <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1a1a1a;">${senderName}</p>
      <a href="mailto:${senderEmail}" style="font-size:13px;color:#5B21B6;text-decoration:none;">${senderEmail}</a>
      ${message ? `<p style="margin:16px 0 0;font-size:14px;color:#444;line-height:1.6;">${message}</p>` : ''}
    </td></tr>
  </table>`;
}

function documentInfoCard({ envelopeTitle }) {
  return `
  <!-- Document info -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:12px;background:#ffffff;border:1px solid #e8e8e8;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:18px 28px;">
      <p style="margin:0;font-size:13px;color:#888;">Document</p>
      <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1a1a1a;">${envelopeTitle}</p>
    </td></tr>
  </table>`;
}

function fallbackLink(url) {
  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;">
    <tr><td>
      <p style="margin:0;font-size:11px;color:#999;line-height:1.5;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="margin:4px 0 0;font-size:11px;"><a href="${url}" style="color:#5B21B6;word-break:break-all;text-decoration:none;">${url}</a></p>
    </td></tr>
  </table>`;
}

// Pen icon for signing emails
const PEN_ICON_B64 = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#5B21B6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`).toString('base64');

// Check icon for completion emails
const CHECK_ICON_B64 = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`).toString('base64');

// Alert icon for declined emails
const ALERT_ICON_B64 = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`).toString('base64');

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
  const html = baseTemplate(`
    ${heroSection({
      iconSvgB64: PEN_ICON_B64,
      heading: `${senderName} sent you a document to review and sign.`,
      buttonText: 'Review Document',
      buttonUrl: signingUrl
    })}
    ${senderCard({ senderName, senderEmail, message })}
    ${documentInfoCard({ envelopeTitle })}
    ${fallbackLink(signingUrl)}
  `);

  return sendMail(recipientEmail, `${senderName} sent you "${envelopeTitle}" to sign`, html);
}

// Notify sender that a recipient has signed
async function sendSignedNotification({ senderEmail, senderName, recipientName, recipientEmail, envelopeTitle, allSigned, totalSigners, signedCount }) {
  const statusLine = allSigned
    ? 'All signers have completed signing. Your envelope is now complete!'
    : `${signedCount} of ${totalSigners} signers have completed signing.`;

  const html = baseTemplate(`
    ${heroSection({
      iconSvgB64: allSigned ? CHECK_ICON_B64 : PEN_ICON_B64,
      heading: `${recipientName} has signed "${envelopeTitle}".`,
      buttonText: allSigned ? 'View Completed Envelope' : 'View Envelope Status',
      buttonUrl: APP_URL
    })}
    <!-- Status card -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;background:#ffffff;border:1px solid #e8e8e8;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px 28px;">
        <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1a1a1a;">Signing Progress</p>
        <p style="margin:8px 0 0;font-size:14px;color:${allSigned ? '#059669' : '#444'};line-height:1.5;">${statusLine}</p>
      </td></tr>
    </table>
  `);

  const subject = allSigned
    ? `Completed: "${envelopeTitle}" - All signers have signed`
    : `Signed: ${recipientName} has signed "${envelopeTitle}"`;

  return sendMail(senderEmail, subject, html);
}

// Notify sender that a recipient declined
async function sendDeclinedNotification({ senderEmail, senderName, recipientName, recipientEmail, envelopeTitle, reason }) {
  const html = baseTemplate(`
    ${heroSection({
      iconSvgB64: ALERT_ICON_B64,
      heading: `${recipientName} has declined to sign "${envelopeTitle}".`,
      buttonText: 'View Envelope',
      buttonUrl: APP_URL
    })}
    <!-- Reason card -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;background:#ffffff;border:1px solid #e8e8e8;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px 28px;">
        <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#1a1a1a;">Reason for Declining</p>
        <p style="margin:8px 0 0;font-size:14px;color:#444;line-height:1.6;">${reason || 'No reason provided'}</p>
      </td></tr>
    </table>
    ${senderCard({ senderName: recipientName, senderEmail: recipientEmail })}
  `);

  return sendMail(senderEmail, `Declined: ${recipientName} declined to sign "${envelopeTitle}"`, html);
}

// Notify all recipients that envelope is completed
async function sendCompletionNotification({ recipientName, recipientEmail, envelopeTitle, senderName }) {
  const html = baseTemplate(`
    ${heroSection({
      iconSvgB64: CHECK_ICON_B64,
      heading: `All parties have signed "${envelopeTitle}". The document is now complete.`,
      buttonText: null,
      buttonUrl: null
    })}
    <!-- Info card -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;background:#ffffff;border:1px solid #e8e8e8;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px 28px;">
        <p style="margin:0;font-size:14px;color:#444;line-height:1.6;">Sent by <strong>${senderName}</strong>. A copy of the signed document is available from the sender.</p>
      </td></tr>
    </table>
  `);

  return sendMail(recipientEmail, `Completed: "${envelopeTitle}" - All signatures collected`, html);
}

// Send reminder email
async function sendReminderEmail({ recipientName, recipientEmail, senderName, senderEmail, envelopeTitle, signingUrl }) {
  const html = baseTemplate(`
    ${heroSection({
      iconSvgB64: PEN_ICON_B64,
      heading: `Reminder: ${senderName} is waiting for you to sign "${envelopeTitle}".`,
      buttonText: 'Review Document',
      buttonUrl: signingUrl
    })}
    ${senderCard({ senderName, senderEmail })}
    ${documentInfoCard({ envelopeTitle })}
    ${fallbackLink(signingUrl)}
  `);

  return sendMail(recipientEmail, `Reminder: ${senderName} is waiting for you to sign "${envelopeTitle}"`, html);
}

// Notify next signer that it's their turn
async function sendNextSignerNotification({ recipientName, recipientEmail, senderName, senderEmail, envelopeTitle, signingUrl }) {
  const html = baseTemplate(`
    ${heroSection({
      iconSvgB64: PEN_ICON_B64,
      heading: `It's your turn to sign "${envelopeTitle}". Previous signers have completed their signatures.`,
      buttonText: 'Review Document',
      buttonUrl: signingUrl
    })}
    ${senderCard({ senderName, senderEmail })}
    ${documentInfoCard({ envelopeTitle })}
    ${fallbackLink(signingUrl)}
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
