// ==================== State ====================
let currentUser = null;
let currentDocId = null;
let signingToken = null;
let signatureMode = 'draw';
let isDrawing = false;
let canvasCtx = null;

// ==================== API Helpers ====================
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// ==================== Routing ====================
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(viewId).classList.remove('hidden');
}

function showModal(modalId) {
  document.getElementById(modalId).classList.remove('hidden');
}

function hideModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

// ==================== Auth ====================
async function checkAuth() {
  try {
    currentUser = await api('/api/auth/me');
    showApp();
  } catch {
    showView('auth-view');
  }
}

function showApp() {
  document.getElementById('header').classList.remove('hidden');
  document.getElementById('user-name').textContent = currentUser.name;
  showView('dashboard-view');
  loadDocuments();
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('login-form').classList.toggle('hidden', target !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', target !== 'register');
  });
});

// Login
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    currentUser = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: form.email.value,
        password: form.password.value
      })
    });
    showApp();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// Register
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';
  try {
    currentUser = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.value,
        email: form.email.value,
        password: form.password.value
      })
    });
    showApp();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  document.getElementById('header').classList.add('hidden');
  showView('auth-view');
});

// Nav
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    if (view === 'dashboard') {
      showView('dashboard-view');
      loadDocuments();
    } else if (view === 'to-sign') {
      showView('to-sign-view');
      loadToSign();
    }
  });
});

// ==================== Documents ====================
async function loadDocuments() {
  try {
    const docs = await api('/api/documents');
    const container = document.getElementById('documents-list');

    if (docs.length === 0) {
      container.innerHTML = '<div class="empty-state">No documents yet. Upload a PDF to get started.</div>';
      return;
    }

    container.innerHTML = docs.map(doc => `
      <div class="doc-card" onclick="viewDocument('${doc.id}')">
        <div class="doc-card-header">
          <h3>${escapeHtml(doc.title)}</h3>
          <span class="status-badge status-${doc.status}">${doc.status}</span>
        </div>
        <div class="meta">${escapeHtml(doc.filename)}</div>
        <div class="meta">Uploaded ${formatDate(doc.created_at)}</div>
        ${doc.total_signers > 0 ? `
          <div class="progress-bar">
            <div class="fill" style="width: ${(doc.signed_count / doc.total_signers) * 100}%"></div>
          </div>
          <div class="meta">${doc.signed_count} of ${doc.total_signers} signed</div>
        ` : ''}
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadToSign() {
  try {
    const docs = await api('/api/documents/to-sign');
    const container = document.getElementById('to-sign-list');

    if (docs.length === 0) {
      container.innerHTML = '<div class="empty-state">No documents waiting for your signature.</div>';
      return;
    }

    container.innerHTML = docs.map(doc => `
      <div class="doc-card" onclick="${doc.status === 'pending' ? `openSigning('${doc.token}')` : ''}">
        <div class="doc-card-header">
          <h3>${escapeHtml(doc.title)}</h3>
          <span class="status-badge status-${doc.status}">${doc.status}</span>
        </div>
        <div class="meta">From: ${escapeHtml(doc.from_name)} (${escapeHtml(doc.from_email)})</div>
        <div class="meta">${formatDate(doc.created_at)}</div>
        ${doc.status === 'pending' ? '<div class="meta" style="color: var(--primary); font-weight: 500;">Click to sign</div>' : ''}
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ==================== Document Detail ====================
async function viewDocument(docId) {
  currentDocId = docId;
  try {
    const doc = await api(`/api/documents/${docId}`);
    showView('document-detail-view');

    const container = document.getElementById('document-detail');
    container.innerHTML = `
      <div class="detail-header">
        <div>
          <h2>${escapeHtml(doc.title)}</h2>
          <span class="status-badge status-${doc.status}" style="margin-top:8px;">${doc.status}</span>
        </div>
        <div class="detail-actions">
          ${doc.status === 'draft' ? `<button class="btn btn-primary" onclick="openSendModal('${doc.id}')">Send for Signature</button>` : ''}
          <button class="btn" onclick="downloadDocument('${doc.id}')">Download</button>
          <button class="btn btn-danger" onclick="deleteDocument('${doc.id}')">Delete</button>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-section">
          <h3>Signers</h3>
          ${doc.signers.length === 0 ? '<p style="color: var(--gray-500); font-size:14px;">No signers yet. Send the document for signature.</p>' :
            doc.signers.map(s => `
              <div class="signer-item">
                <div class="signer-info">
                  <div>${escapeHtml(s.signer_name)}</div>
                  <small>${escapeHtml(s.signer_email)}</small>
                </div>
                <span class="status-badge status-${s.status}">${s.status}${s.signed_at ? ' - ' + formatDate(s.signed_at) : ''}</span>
              </div>
            `).join('')}
        </div>
        <div class="detail-section">
          <h3>Activity Log</h3>
          ${doc.auditLog.length === 0 ? '<p style="color: var(--gray-500); font-size:14px;">No activity yet.</p>' :
            doc.auditLog.map(a => `
              <div class="audit-item">
                <div class="action">${escapeHtml(a.action.replace(/_/g, ' '))}</div>
                <div>${escapeHtml(a.actor)} ${a.details ? '- ' + escapeHtml(a.details) : ''}</div>
                <div class="time">${formatDate(a.created_at)}</div>
              </div>
            `).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('back-to-dashboard').addEventListener('click', () => {
  showView('dashboard-view');
  loadDocuments();
});

// ==================== Upload ====================
document.getElementById('upload-btn').addEventListener('click', () => {
  showModal('upload-modal');
});

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('upload-submit').disabled = false;
  }
});

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fileInput = document.getElementById('file-input');
  if (!fileInput.files[0]) return;

  const formData = new FormData();
  formData.append('title', form.title.value);
  formData.append('document', fileInput.files[0]);

  try {
    await fetch('/api/documents/upload', {
      method: 'POST',
      body: formData
    }).then(r => r.json());

    hideModal('upload-modal');
    form.reset();
    document.getElementById('file-name').textContent = '';
    document.getElementById('upload-submit').disabled = true;
    toast('Document uploaded!', 'success');
    loadDocuments();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ==================== Send for Signature ====================
function openSendModal(docId) {
  currentDocId = docId;
  document.getElementById('signers-list').innerHTML = `
    <div class="signer-row">
      <input type="text" placeholder="Name" class="signer-name" required>
      <input type="email" placeholder="Email" class="signer-email" required>
      <button type="button" class="btn btn-sm remove-signer" title="Remove">&times;</button>
    </div>
  `;
  showModal('send-modal');
}

document.getElementById('add-signer').addEventListener('click', () => {
  const row = document.createElement('div');
  row.className = 'signer-row';
  row.innerHTML = `
    <input type="text" placeholder="Name" class="signer-name" required>
    <input type="email" placeholder="Email" class="signer-email" required>
    <button type="button" class="btn btn-sm remove-signer" title="Remove">&times;</button>
  `;
  document.getElementById('signers-list').appendChild(row);
});

document.getElementById('signers-list').addEventListener('click', (e) => {
  if (e.target.classList.contains('remove-signer')) {
    const rows = document.querySelectorAll('.signer-row');
    if (rows.length > 1) e.target.closest('.signer-row').remove();
  }
});

document.getElementById('send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rows = document.querySelectorAll('.signer-row');
  const signers = [];
  for (const row of rows) {
    const name = row.querySelector('.signer-name').value.trim();
    const email = row.querySelector('.signer-email').value.trim();
    if (name && email) signers.push({ name, email });
  }

  if (signers.length === 0) {
    toast('Add at least one signer', 'error');
    return;
  }

  try {
    const result = await api(`/api/documents/${currentDocId}/send`, {
      method: 'POST',
      body: JSON.stringify({ signers })
    });

    hideModal('send-modal');
    toast('Document sent for signature!', 'success');

    // Show signing links
    const linksHtml = result.requests.map(r => {
      const link = `${window.location.origin}/sign/${r.token}`;
      return `
        <div class="signing-link-item">
          <span>${escapeHtml(r.name)} (${escapeHtml(r.email)})</span>
          <a href="${link}" target="_blank">${link}</a>
          <button class="copy-btn" onclick="copyToClipboard('${link}')">Copy</button>
        </div>
      `;
    }).join('');

    // Refresh the detail view and show links
    await viewDocument(currentDocId);

    const detail = document.getElementById('document-detail');
    const linksSection = document.createElement('div');
    linksSection.className = 'detail-section';
    linksSection.style.gridColumn = '1 / -1';
    linksSection.style.marginTop = '16px';
    linksSection.innerHTML = `
      <h3>Signing Links</h3>
      <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">Share these links with the signers:</p>
      <div class="signing-links">${linksHtml}</div>
    `;
    detail.appendChild(linksSection);
  } catch (err) {
    toast(err.message, 'error');
  }
});

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => toast('Link copied!', 'success'));
}

// ==================== Download / Delete ====================
function downloadDocument(docId) {
  window.open(`/api/documents/${docId}/download`, '_blank');
}

async function deleteDocument(docId) {
  if (!confirm('Are you sure you want to delete this document?')) return;
  try {
    await api(`/api/documents/${docId}`, { method: 'DELETE' });
    toast('Document deleted', 'success');
    showView('dashboard-view');
    loadDocuments();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ==================== Signing ====================
async function openSigning(token) {
  signingToken = token;
  try {
    const data = await api(`/api/sign/${token}`);

    document.getElementById('signing-header').innerHTML = `
      <h2>Sign: ${escapeHtml(data.document_title)}</h2>
      <p>Requested by ${escapeHtml(data.sender_name)} (${escapeHtml(data.sender_email)})</p>
      <p>Signing as: <strong>${escapeHtml(data.signer_name)}</strong> (${escapeHtml(data.signer_email)})</p>
    `;

    document.getElementById('pdf-frame').src = `/api/sign/${token}/pdf`;

    showView('signing-view');
    initCanvas();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Check for signing URL on page load
function checkSigningUrl() {
  const path = window.location.pathname;
  const match = path.match(/^\/sign\/(.+)$/);
  if (match) {
    openSigning(match[1]);
    return true;
  }
  return false;
}

// Signature tabs
document.querySelectorAll('.sig-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sig-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    signatureMode = tab.dataset.sig;
    document.getElementById('sig-draw-panel').classList.toggle('hidden', signatureMode !== 'draw');
    document.getElementById('sig-type-panel').classList.toggle('hidden', signatureMode !== 'type');
  });
});

// Canvas signature
function initCanvas() {
  const canvas = document.getElementById('signature-canvas');
  canvasCtx = canvas.getContext('2d');

  // Set actual canvas size to match CSS size
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  canvasCtx.strokeStyle = '#00008b';
  canvasCtx.lineWidth = 2.5;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDraw);
  canvas.addEventListener('mouseleave', stopDraw);

  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDraw(getTouchPos(e)); });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); draw(getTouchPos(e)); });
  canvas.addEventListener('touchend', stopDraw);
}

function getTouchPos(e) {
  const rect = e.target.getBoundingClientRect();
  const touch = e.touches[0];
  return { offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top };
}

function startDraw(e) {
  isDrawing = true;
  canvasCtx.beginPath();
  canvasCtx.moveTo(e.offsetX, e.offsetY);
}

function draw(e) {
  if (!isDrawing) return;
  canvasCtx.lineTo(e.offsetX, e.offsetY);
  canvasCtx.stroke();
}

function stopDraw() {
  isDrawing = false;
}

document.getElementById('clear-canvas').addEventListener('click', () => {
  const canvas = document.getElementById('signature-canvas');
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
});

// Typed signature preview
document.getElementById('typed-signature').addEventListener('input', (e) => {
  document.getElementById('typed-preview').textContent = e.target.value;
});

// Submit signature
document.getElementById('submit-signature').addEventListener('click', async () => {
  let signatureData;

  if (signatureMode === 'draw') {
    const canvas = document.getElementById('signature-canvas');
    // Check if canvas has been drawn on
    const pixelData = canvasCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    const hasDrawing = pixelData.some((val, i) => i % 4 === 3 && val > 0);
    if (!hasDrawing) {
      toast('Please draw your signature', 'error');
      return;
    }
    signatureData = canvas.toDataURL('image/png');
  } else {
    signatureData = document.getElementById('typed-signature').value.trim();
    if (!signatureData) {
      toast('Please type your name', 'error');
      return;
    }
  }

  try {
    await api(`/api/sign/${signingToken}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        signature_data: signatureData,
        signature_type: signatureMode
      })
    });

    toast('Document signed successfully!', 'success');

    // If logged in, go back to dashboard; otherwise show a success message
    if (currentUser) {
      showView('to-sign-view');
      loadToSign();
    } else {
      document.getElementById('signing-view').innerHTML = `
        <div style="text-align:center;padding:80px 20px;">
          <h2 style="color:var(--success);">Document Signed!</h2>
          <p style="color:var(--gray-500);margin-top:12px;">Thank you. The document owner will be notified.</p>
        </div>
      `;
    }
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ==================== Modals ====================
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.modal').classList.add('hidden');
  });
});

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
});

// ==================== Utils ====================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================== Init ====================
if (!checkSigningUrl()) {
  checkAuth();
}
