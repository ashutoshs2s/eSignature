/* global pdfjsLib */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ==================== State ====================
let currentUser = null;
let inviteToken = null;
let currentEnvelopeId = null;
let signingToken = null;

// Wizard state
const wizard = {
  envelopeId: null,
  step: 1,
  documents: [],
  recipients: [],
  fields: [],
  selectedRecipient: null,
  selectedFieldType: null,
};

// Signing state
const signing = {
  token: null,
  data: null,
  filledFields: new Set(),
  currentFieldId: null,
  signatureMode: 'draw',
};

const RECIPIENT_COLORS = ['#5B21B6','#0891B2','#059669','#D97706','#DC2626','#7C3AED','#2563EB','#10B981','#F59E0B','#EF4444'];
const FIELD_LABELS = { signature:'Signature', initials:'Initials', date_signed:'Date', text:'Text', name:'Name', email:'Email', checkbox:'Check' };
const FIELD_DEFAULTS = {
  signature: { w: 20, h: 4 }, initials: { w: 8, h: 4 }, date_signed: { w: 14, h: 3 },
  text: { w: 18, h: 3 }, name: { w: 18, h: 3 }, email: { w: 18, h: 3 }, checkbox: { w: 2.5, h: 2.5 }
};

// ==================== Helpers ====================
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg, type = 'info') {
  const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 3500);
}
function fmtDate(d) {
  if (!d) return ''; return new Date(d + 'Z').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function showView(id) { document.querySelectorAll('.view').forEach(v => v.classList.add('hidden')); document.getElementById(id)?.classList.remove('hidden'); }
function showModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id)?.classList.add('hidden'); }
function navigate(view) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-view="${view}"]`)?.classList.add('active');
  if (view === 'dashboard') { showView('dashboard-view'); loadEnvelopes(); }
  else if (view === 'inbox') { showView('inbox-view'); loadInbox(); }
  else if (view === 'admin') { showView('admin-view'); loadAdminPanel(); }
}

// ==================== Auth ====================
async function checkAuth() {
  try { currentUser = await api('/api/auth/me'); showApp(); } catch { await checkSetup(); showView('auth-view'); }
}
async function checkSetup() {
  try {
    const { needs_setup } = await api('/api/auth/setup-status');
    if (needs_setup) {
      document.querySelector('[data-tab="register"]').textContent = 'Setup';
      document.querySelector('#register-form button[type="submit"]').textContent = 'Create Admin Account';
    } else if (!inviteToken) { document.getElementById('invite-notice')?.classList.remove('hidden'); }
  } catch {}
}
function showApp() {
  document.getElementById('header').classList.remove('hidden');
  document.getElementById('user-name').textContent = currentUser.name;
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', currentUser.role !== 'admin'));
  navigate('dashboard');
}

// Auth tabs
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active')); t.classList.add('active');
  document.getElementById('login-form').classList.toggle('hidden', t.dataset.tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', t.dataset.tab !== 'register');
}));

// Login
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; document.getElementById('login-error').textContent = '';
  try { currentUser = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ email:f.email.value, password:f.password.value }) }); showApp(); }
  catch (err) { document.getElementById('login-error').textContent = err.message; }
});

// Register
document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; document.getElementById('register-error').textContent = '';
  try {
    const body = { name:f.name.value, email:f.email.value, password:f.password.value };
    if (inviteToken) body.invite_token = inviteToken;
    currentUser = await api('/api/auth/register', { method:'POST', body: JSON.stringify(body) });
    if (inviteToken) { history.replaceState({}, '', '/'); inviteToken = null; }
    showApp();
  } catch (err) { document.getElementById('register-error').textContent = err.message; }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method:'POST' }); currentUser = null;
  document.getElementById('header').classList.add('hidden'); showView('auth-view');
});

// Nav
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
document.getElementById('new-envelope-btn').addEventListener('click', startWizard);

// ==================== Dashboard ====================
async function loadEnvelopes(filter = 'all') {
  try {
    const url = filter === 'all' ? '/api/envelopes' : `/api/envelopes?status=${filter}`;
    const envs = await api(url);
    const el = document.getElementById('envelopes-list');
    if (envs.length === 0) { el.innerHTML = '<div class="empty-state">No envelopes found.</div>'; return; }
    el.innerHTML = envs.map(e => `
      <div class="envelope-row" onclick="viewEnvelope('${e.id}')">
        <div class="env-title">${esc(e.title)}</div>
        <div class="env-meta">${e.document_count} doc${e.document_count !== 1 ? 's' : ''}</div>
        <div class="env-recipients">${e.signed_count}/${e.total_signers} signed</div>
        <div><span class="status-badge status-${e.status}">${e.status}</span></div>
        <div class="env-date">${fmtDate(e.updated_at)}</div>
      </div>
    `).join('');
  } catch (err) { toast(err.message, 'error'); }
}

document.querySelectorAll('.filter-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.filter-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
  loadEnvelopes(b.dataset.filter);
}));

// ==================== Inbox ====================
async function loadInbox() {
  try {
    const items = await api('/api/envelopes/inbox');
    const el = document.getElementById('inbox-list');
    if (items.length === 0) { el.innerHTML = '<div class="empty-state">No documents waiting for your action.</div>'; return; }
    el.innerHTML = items.map(i => `
      <div class="envelope-row ${i.my_status === 'sent' || i.my_status === 'delivered' ? 'clickable' : ''}"
           onclick="${i.my_status === 'sent' || i.my_status === 'delivered' ? `openSigning('${i.token}')` : ''}">
        <div class="env-title">${esc(i.title)}</div>
        <div class="env-meta">From: ${esc(i.sender_name)}</div>
        <div><span class="status-badge status-${i.my_status}">${i.my_status}</span></div>
        <div class="env-date">${fmtDate(i.created_at)}</div>
      </div>
    `).join('');
  } catch (err) { toast(err.message, 'error'); }
}

// ==================== Envelope Detail ====================
async function viewEnvelope(id) {
  currentEnvelopeId = id;
  try {
    const env = await api(`/api/envelopes/${id}`);
    showView('envelope-detail-view');
    const el = document.getElementById('envelope-detail');
    el.innerHTML = `
      <div class="detail-header">
        <div>
          <h2>${esc(env.title)}</h2>
          <span class="status-badge status-${env.status}">${env.status}</span>
          ${env.message ? `<p class="env-message">${esc(env.message)}</p>` : ''}
        </div>
        <div class="detail-actions">
          ${env.status === 'sent' ? `<button class="btn btn-danger btn-sm" onclick="openVoidModal('${env.id}')">Void</button>` : ''}
          ${env.status === 'completed' ? `
            <button class="btn btn-sm" onclick="downloadEnvelope('${env.id}')">Download Signed</button>
            <button class="btn btn-sm" onclick="downloadCertificate('${env.id}')">Certificate</button>
          ` : ''}
          ${env.status === 'draft' ? `<button class="btn btn-primary btn-sm" onclick="resumeWizard('${env.id}')">Edit & Send</button>` : ''}
          <button class="btn btn-sm btn-danger" onclick="deleteEnvelope('${env.id}')">Delete</button>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-section">
          <h3>Recipients</h3>
          ${env.recipients.map((r, i) => `
            <div class="recipient-row">
              <span class="color-dot" style="background:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]}"></span>
              <div class="recipient-info">
                <div>${esc(r.name)} <small>(${esc(r.email)})</small></div>
                <div class="recipient-meta">
                  <span class="status-badge status-${r.status}">${r.status}</span>
                  ${r.role === 'cc' ? '<span class="badge-cc">CC</span>' : ''}
                  ${r.signed_at ? `<span class="meta-sm">Signed ${fmtDate(r.signed_at)}</span>` : ''}
                  ${r.decline_reason ? `<span class="meta-sm text-danger">Reason: ${esc(r.decline_reason)}</span>` : ''}
                </div>
              </div>
              ${env.status === 'sent' && (r.status === 'sent' || r.status === 'delivered') ? `
                <div class="recipient-actions">
                  <button class="btn btn-sm" onclick="copyToClipboard('${location.origin}/sign/${r.token}')">Copy Link</button>
                  <button class="btn btn-sm" onclick="resendReminder('${env.id}','${r.id}')">Resend</button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
        <div class="detail-section">
          <h3>Documents</h3>
          ${env.documents.map(d => `
            <div class="doc-item">${esc(d.title)} <small>(${d.page_count} page${d.page_count !== 1 ? 's' : ''})</small></div>
          `).join('')}
        </div>
        <div class="detail-section detail-full">
          <h3>Activity</h3>
          ${env.auditLog.length === 0 ? '<p class="meta-sm">No activity yet.</p>' : env.auditLog.map(a => `
            <div class="audit-item">
              <span class="audit-action">${esc(a.action.replace(/_/g, ' '))}</span>
              <span class="audit-actor">${esc(a.actor)}</span>
              ${a.details ? `<span class="audit-details">${esc(a.details)}</span>` : ''}
              <span class="audit-time">${fmtDate(a.created_at)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('back-to-dashboard').addEventListener('click', () => navigate('dashboard'));

async function deleteEnvelope(id) {
  if (!confirm('Delete this envelope?')) return;
  try { await api(`/api/envelopes/${id}`, { method:'DELETE' }); toast('Deleted', 'success'); navigate('dashboard'); }
  catch (err) { toast(err.message, 'error'); }
}
function downloadEnvelope(id) { window.open(`/api/envelopes/${id}/download`, '_blank'); }
function downloadCertificate(id) { window.open(`/api/envelopes/${id}/certificate`, '_blank'); }
function copyToClipboard(text) { navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success')); }
async function resendReminder(envId, rid) {
  try { await api(`/api/envelopes/${envId}/resend/${rid}`, { method:'POST' }); toast('Reminder sent', 'success'); }
  catch (err) { toast(err.message, 'error'); }
}

// Void
function openVoidModal(id) { currentEnvelopeId = id; document.getElementById('void-reason').value = ''; showModal('void-modal'); }
document.getElementById('confirm-void-btn').addEventListener('click', async () => {
  try {
    await api(`/api/envelopes/${currentEnvelopeId}/void`, { method:'POST', body: JSON.stringify({ reason: document.getElementById('void-reason').value }) });
    hideModal('void-modal'); toast('Envelope voided', 'success'); viewEnvelope(currentEnvelopeId);
  } catch (err) { toast(err.message, 'error'); }
});

// ==================== Wizard ====================
async function startWizard() {
  try {
    const env = await api('/api/envelopes', { method:'POST', body: JSON.stringify({ title: 'Untitled Envelope' }) });
    wizard.envelopeId = env.id;
    wizard.step = 1; wizard.documents = []; wizard.recipients = []; wizard.fields = [];
    wizard.selectedRecipient = null; wizard.selectedFieldType = null;
    document.getElementById('envelope-title').value = '';
    document.getElementById('envelope-message').value = '';
    document.getElementById('wizard-doc-list').innerHTML = '';
    document.getElementById('wizard-next-1').disabled = true;
    setWizardStep(1);
    showView('wizard-view');
  } catch (err) { toast(err.message, 'error'); }
}

async function resumeWizard(id) {
  try {
    const env = await api(`/api/envelopes/${id}`);
    wizard.envelopeId = id;
    wizard.documents = env.documents;
    wizard.recipients = env.recipients;
    wizard.fields = env.fields;
    wizard.step = 1; wizard.selectedRecipient = null;
    document.getElementById('envelope-title').value = env.title;
    document.getElementById('envelope-message').value = env.message || '';
    renderWizardDocs();
    document.getElementById('wizard-next-1').disabled = wizard.documents.length === 0;
    setWizardStep(1);
    showView('wizard-view');
  } catch (err) { toast(err.message, 'error'); }
}

function setWizardStep(step) {
  wizard.step = step;
  document.querySelectorAll('.wizard-step').forEach(s => {
    const n = parseInt(s.dataset.step);
    s.classList.toggle('active', n === step);
    s.classList.toggle('completed', n < step);
  });
  document.querySelectorAll('.wizard-panel').forEach((p, i) => p.classList.toggle('hidden', i + 1 !== step));

  if (step === 2) renderRecipientsList();
  if (step === 3) renderFieldEditor();
  if (step === 4) renderReview();
}

// Step 1: Upload
document.getElementById('wizard-file-input').addEventListener('change', async (e) => {
  for (const file of e.target.files) {
    await uploadWizardDoc(file);
  }
  e.target.value = '';
});
document.getElementById('wizard-file-drop').addEventListener('dragover', e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); });
document.getElementById('wizard-file-drop').addEventListener('dragleave', e => { e.currentTarget.classList.remove('dragover'); });
document.getElementById('wizard-file-drop').addEventListener('drop', async e => {
  e.preventDefault(); e.currentTarget.classList.remove('dragover');
  for (const file of e.dataTransfer.files) { if (file.type === 'application/pdf') await uploadWizardDoc(file); }
});

async function uploadWizardDoc(file) {
  // Save title first
  await api(`/api/envelopes/${wizard.envelopeId}`, { method:'PUT', body: JSON.stringify({
    title: document.getElementById('envelope-title').value || 'Untitled Envelope',
    message: document.getElementById('envelope-message').value
  })});

  const fd = new FormData();
  fd.append('file', file); fd.append('title', file.name);
  try {
    const doc = await fetch(`/api/envelopes/${wizard.envelopeId}/documents`, { method:'POST', body:fd }).then(r => r.json());
    if (doc.error) throw new Error(doc.error);
    wizard.documents.push(doc);
    renderWizardDocs();
    document.getElementById('wizard-next-1').disabled = false;
  } catch (err) { toast(err.message, 'error'); }
}

function renderWizardDocs() {
  document.getElementById('wizard-doc-list').innerHTML = wizard.documents.map((d, i) => `
    <div class="doc-list-item">
      <span class="doc-list-name">${esc(d.title || d.filename)}</span>
      <span class="doc-list-pages">${d.page_count} page${d.page_count !== 1 ? 's' : ''}</span>
      <button class="btn btn-sm btn-danger" onclick="removeWizardDoc(${i})">&times;</button>
    </div>
  `).join('');
}

async function removeWizardDoc(idx) {
  const doc = wizard.documents[idx];
  try {
    await api(`/api/envelopes/${wizard.envelopeId}/documents/${doc.id}`, { method:'DELETE' });
    wizard.documents.splice(idx, 1);
    wizard.fields = wizard.fields.filter(f => f.document_id !== doc.id);
    renderWizardDocs();
    document.getElementById('wizard-next-1').disabled = wizard.documents.length === 0;
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('wizard-next-1').addEventListener('click', async () => {
  await api(`/api/envelopes/${wizard.envelopeId}`, { method:'PUT', body: JSON.stringify({
    title: document.getElementById('envelope-title').value || 'Untitled Envelope',
    message: document.getElementById('envelope-message').value
  })});
  setWizardStep(2);
});

// Step 2: Recipients
document.getElementById('add-recipient-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-recipient-name').value.trim();
  const email = document.getElementById('new-recipient-email').value.trim();
  const role = document.getElementById('new-recipient-role').value;
  if (!name || !email) { toast('Name and email required', 'error'); return; }
  try {
    const r = await api(`/api/envelopes/${wizard.envelopeId}/recipients`, { method:'POST', body: JSON.stringify({ name, email, role }) });
    wizard.recipients.push(r);
    document.getElementById('new-recipient-name').value = '';
    document.getElementById('new-recipient-email').value = '';
    renderRecipientsList();
    document.getElementById('wizard-next-2').disabled = wizard.recipients.filter(x => x.role === 'signer').length === 0;
  } catch (err) { toast(err.message, 'error'); }
});

function renderRecipientsList() {
  const el = document.getElementById('recipients-list');
  el.innerHTML = wizard.recipients.map((r, i) => `
    <div class="recipient-item">
      <span class="color-dot" style="background:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]}"></span>
      <div class="recipient-item-info">
        <strong>${esc(r.name)}</strong> &lt;${esc(r.email)}&gt;
        <span class="badge-${r.role}">${r.role === 'signer' ? 'Signs' : 'CC'}</span>
        <span class="meta-sm">Order: ${r.order_num}</span>
      </div>
      <button class="btn btn-sm btn-danger" onclick="removeRecipient(${i})">&times;</button>
    </div>
  `).join('');
  document.getElementById('wizard-next-2').disabled = wizard.recipients.filter(x => x.role === 'signer').length === 0;
}

async function removeRecipient(idx) {
  const r = wizard.recipients[idx];
  try {
    await api(`/api/envelopes/${wizard.envelopeId}/recipients/${r.id}`, { method:'DELETE' });
    wizard.recipients.splice(idx, 1);
    wizard.fields = wizard.fields.filter(f => f.recipient_id !== r.id);
    renderRecipientsList();
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('wizard-prev-2').addEventListener('click', () => setWizardStep(1));
document.getElementById('wizard-next-2').addEventListener('click', () => setWizardStep(3));

// Step 3: Field Editor
async function renderFieldEditor() {
  const container = document.getElementById('pdf-pages-container');
  container.innerHTML = '<div class="loading">Loading PDF pages...</div>';

  // Render recipient selector
  const signers = wizard.recipients.filter(r => r.role === 'signer');
  document.getElementById('field-recipient-selector').innerHTML = signers.map((r, i) => `
    <button class="recipient-select-btn ${i === 0 ? 'active' : ''}" data-rid="${r.id}"
            style="border-left-color:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]}"
            onclick="selectFieldRecipient('${r.id}', this)">
      ${esc(r.name)}
    </button>
  `).join('');
  if (signers.length > 0) wizard.selectedRecipient = signers[0].id;

  // Render PDF pages
  container.innerHTML = '';
  for (const doc of wizard.documents) {
    try {
      const pdf = await pdfjsLib.getDocument(`/api/envelopes/${wizard.envelopeId}/documents/${doc.id}/pdf`).promise;
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1.2 });
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.docId = doc.id;
        wrapper.dataset.page = p;
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        wrapper.appendChild(canvas);

        // Page label
        const label = document.createElement('div');
        label.className = 'page-label';
        label.textContent = `${doc.title || doc.filename} — Page ${p}`;
        wrapper.appendChild(label);

        // Drop zone for fields
        wrapper.addEventListener('dragover', e => e.preventDefault());
        wrapper.addEventListener('drop', e => handleFieldDrop(e, doc.id, p, wrapper));
        wrapper.addEventListener('click', e => handleFieldClick(e, doc.id, p, wrapper));

        container.appendChild(wrapper);

        // Render existing fields for this page
        wizard.fields.filter(f => f.document_id === doc.id && f.page_number === p).forEach(f => {
          renderPlacedField(wrapper, f);
        });
      }
    } catch (err) { container.innerHTML += `<div class="empty-state">Failed to load ${doc.filename}</div>`; }
  }
}

function selectFieldRecipient(rid, btn) {
  wizard.selectedRecipient = rid;
  document.querySelectorAll('.recipient-select-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// Draggable field types
document.querySelectorAll('.field-type-btn').forEach(btn => {
  btn.addEventListener('dragstart', e => {
    wizard.selectedFieldType = btn.dataset.type;
    e.dataTransfer.setData('text/plain', btn.dataset.type);
  });
  btn.addEventListener('click', () => {
    wizard.selectedFieldType = btn.dataset.type;
    document.querySelectorAll('.field-type-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

function handleFieldDrop(e, docId, page, wrapper) {
  e.preventDefault();
  if (!wizard.selectedRecipient || !wizard.selectedFieldType) return;
  const rect = wrapper.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  addField(docId, page, x, y, wizard.selectedFieldType, wrapper);
}

function handleFieldClick(e, docId, page, wrapper) {
  if (e.target.closest('.placed-field')) return;
  if (!wizard.selectedRecipient || !wizard.selectedFieldType) return;
  const rect = wrapper.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  addField(docId, page, x, y, wizard.selectedFieldType, wrapper);
}

function addField(docId, page, x, y, type, wrapper) {
  const defaults = FIELD_DEFAULTS[type] || { w:15, h:3 };
  const field = {
    id: crypto.randomUUID(), document_id: docId, recipient_id: wizard.selectedRecipient,
    type, page_number: page, x, y, width: defaults.w, height: defaults.h, required: 1, label: ''
  };
  wizard.fields.push(field);
  renderPlacedField(wrapper, field);
}

function renderPlacedField(wrapper, field) {
  const recipient = wizard.recipients.find(r => r.id === field.recipient_id);
  const color = recipient?.color || RECIPIENT_COLORS[0];
  const el = document.createElement('div');
  el.className = `placed-field field-${field.type}`;
  el.dataset.fieldId = field.id;
  el.style.left = field.x + '%'; el.style.top = field.y + '%';
  el.style.width = field.width + '%'; el.style.height = field.height + '%';
  el.style.borderColor = color;
  el.style.backgroundColor = color + '15';
  el.innerHTML = `
    <span class="field-label" style="color:${color}">${FIELD_LABELS[field.type] || field.type}</span>
    <button class="field-delete" onclick="removeField('${field.id}', this)">&times;</button>
  `;

  // Make draggable within page
  let isDragging = false, startX, startY, origX, origY;
  el.addEventListener('mousedown', e => {
    if (e.target.classList.contains('field-delete')) return;
    isDragging = true; startX = e.clientX; startY = e.clientY;
    origX = field.x; origY = field.y;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const rect = wrapper.getBoundingClientRect();
    const dx = ((e.clientX - startX) / rect.width) * 100;
    const dy = ((e.clientY - startY) / rect.height) * 100;
    field.x = Math.max(0, Math.min(100 - field.width, origX + dx));
    field.y = Math.max(0, Math.min(100 - field.height, origY + dy));
    el.style.left = field.x + '%'; el.style.top = field.y + '%';
  });
  document.addEventListener('mouseup', () => { isDragging = false; });

  wrapper.appendChild(el);
}

function removeField(fieldId, btn) {
  wizard.fields = wizard.fields.filter(f => f.id !== fieldId);
  btn.closest('.placed-field').remove();
}

document.getElementById('wizard-prev-3').addEventListener('click', () => setWizardStep(2));
document.getElementById('wizard-next-3').addEventListener('click', async () => {
  if (wizard.fields.length === 0) { toast('Place at least one field', 'error'); return; }
  try {
    await api(`/api/envelopes/${wizard.envelopeId}/fields`, { method:'POST', body: JSON.stringify({ fields: wizard.fields }) });
    setWizardStep(4);
  } catch (err) { toast(err.message, 'error'); }
});

// Step 4: Review
function renderReview() {
  const signers = wizard.recipients.filter(r => r.role === 'signer');
  const title = document.getElementById('envelope-title').value || 'Untitled Envelope';
  document.getElementById('review-summary').innerHTML = `
    <div class="review-card">
      <h4>${esc(title)}</h4>
      <div class="review-section">
        <strong>Documents (${wizard.documents.length})</strong>
        ${wizard.documents.map(d => `<div class="review-item">${esc(d.title || d.filename)} — ${d.page_count} pages</div>`).join('')}
      </div>
      <div class="review-section">
        <strong>Signing Order</strong>
        ${signers.map((r, i) => `
          <div class="review-item">
            <span class="color-dot" style="background:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]}"></span>
            ${i + 1}. ${esc(r.name)} &lt;${esc(r.email)}&gt;
            <span class="meta-sm">${wizard.fields.filter(f => f.recipient_id === r.id).length} fields</span>
          </div>
        `).join('')}
      </div>
      <div class="review-section">
        <strong>Total Fields: ${wizard.fields.length}</strong>
      </div>
    </div>
  `;
}

document.getElementById('wizard-prev-4').addEventListener('click', () => setWizardStep(3));
document.getElementById('wizard-send').addEventListener('click', async () => {
  try {
    const result = await api(`/api/envelopes/${wizard.envelopeId}/send`, { method:'POST' });
    toast('Envelope sent!', 'success');
    showView('envelope-detail-view');
    viewEnvelope(wizard.envelopeId);
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('wizard-cancel').addEventListener('click', () => {
  if (confirm('Discard this envelope?')) navigate('dashboard');
});

// ==================== Signing View ====================
async function openSigning(token) {
  signing.token = token;
  try {
    const data = await api(`/api/sign/${token}`);

    if (data.requires_access_code) {
      document.getElementById('access-code-label').textContent = `Hi ${data.recipient_name}, please enter the access code to continue.`;
      showView('access-code-view');
      return;
    }

    signing.data = data;
    signing.filledFields = new Set();

    document.getElementById('signing-info').innerHTML = `
      <span>${esc(data.envelope_title)}</span>
      <span class="meta-sm">from ${esc(data.sender_name)}</span>
    `;

    await renderSigningView();
    showView('signing-view');
  } catch (err) {
    showView('signing-done-view');
    document.getElementById('done-title').textContent = 'Cannot Sign';
    document.getElementById('done-message').textContent = err.message;
    document.querySelector('.done-icon').textContent = '!';
    document.querySelector('.done-icon').style.background = '#dc2626';
  }
}

// Access code
document.getElementById('access-code-form').addEventListener('submit', async e => {
  e.preventDefault(); document.getElementById('access-code-error').textContent = '';
  try {
    await api(`/api/sign/${signing.token}/verify-code`, { method:'POST', body: JSON.stringify({ code: e.target.code.value }) });
    signing.data = await api(`/api/sign/${signing.token}?access_code=${encodeURIComponent(e.target.code.value)}`);
    signing.filledFields = new Set();
    document.getElementById('signing-info').innerHTML = `<span>${esc(signing.data.envelope_title)}</span>`;
    await renderSigningView();
    showView('signing-view');
  } catch (err) { document.getElementById('access-code-error').textContent = err.message; }
});

async function renderSigningView() {
  const container = document.getElementById('signing-pdf-container');
  container.innerHTML = '';

  for (const doc of signing.data.documents) {
    try {
      const pdf = await pdfjsLib.getDocument(`/api/sign/${signing.token}/documents/${doc.id}/pdf`).promise;
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1.3 });
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper signing-page';
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        wrapper.appendChild(canvas);

        // Render completed fields from other signers
        signing.data.completed_fields?.filter(f => f.document_id === doc.id && f.page_number === p).forEach(f => {
          const fel = document.createElement('div');
          fel.className = 'signing-field completed';
          fel.style.left = f.x + '%'; fel.style.top = f.y + '%';
          fel.style.width = f.width + '%'; fel.style.height = f.height + '%';
          if (f.signature_data && f.signature_data.startsWith('data:image')) {
            fel.innerHTML = `<img src="${f.signature_data}" style="width:100%;height:100%;object-fit:contain;">`;
          } else if (f.value) {
            fel.innerHTML = `<span class="field-value">${esc(f.value)}</span>`;
          }
          wrapper.appendChild(fel);
        });

        // Render my fields
        signing.data.fields.filter(f => f.document_id === doc.id && f.page_number === p).forEach(f => {
          const fel = document.createElement('div');
          fel.className = `signing-field mine field-${f.type} ${f.value ? 'filled' : 'empty'}`;
          fel.dataset.fieldId = f.id;
          fel.style.left = f.x + '%'; fel.style.top = f.y + '%';
          fel.style.width = f.width + '%'; fel.style.height = f.height + '%';

          if (f.value) {
            signing.filledFields.add(f.id);
            fel.innerHTML = getFieldDisplay(f);
          } else {
            fel.innerHTML = `<span class="field-placeholder">${FIELD_LABELS[f.type]}</span>`;
          }

          fel.addEventListener('click', () => handleSigningFieldClick(f, fel));
          wrapper.appendChild(fel);
        });

        container.appendChild(wrapper);
      }
    } catch (err) { console.error('PDF render error:', err); }
  }

  updateSigningProgress();
}

function getFieldDisplay(f) {
  if (f.type === 'checkbox') return `<span class="checkbox-val">${f.value === 'true' ? '✓' : ''}</span>`;
  return `<span class="field-value">${esc(f.value)}</span>`;
}

function handleSigningFieldClick(field, el) {
  if (field.type === 'signature' || field.type === 'initials') {
    signing.currentFieldId = field.id;
    document.getElementById('sig-modal-title').textContent = field.type === 'signature' ? 'Add Signature' : 'Add Initials';
    initSignatureCanvas();
    showModal('signature-modal');
  } else if (field.type === 'date_signed') {
    fillSigningField(field.id, new Date().toLocaleDateString(), el);
  } else if (field.type === 'name') {
    fillSigningField(field.id, signing.data.recipient_name, el);
  } else if (field.type === 'email') {
    fillSigningField(field.id, signing.data.recipient_email, el);
  } else if (field.type === 'checkbox') {
    const newVal = field.value === 'true' ? 'false' : 'true';
    fillSigningField(field.id, newVal, el);
  } else if (field.type === 'text') {
    const val = prompt('Enter text:', field.value || '');
    if (val !== null) fillSigningField(field.id, val, el);
  }
}

async function fillSigningField(fieldId, value, el) {
  try {
    await api(`/api/sign/${signing.token}/fields/${fieldId}`, { method:'POST', body: JSON.stringify({ value }) });
    const field = signing.data.fields.find(f => f.id === fieldId);
    if (field) field.value = value;
    signing.filledFields.add(fieldId);
    el.classList.remove('empty'); el.classList.add('filled');
    el.innerHTML = getFieldDisplay(field || { type:'text', value });
    updateSigningProgress();
  } catch (err) { toast(err.message, 'error'); }
}

function updateSigningProgress() {
  const required = signing.data.fields.filter(f => f.required);
  const filled = required.filter(f => f.value);
  const pct = required.length > 0 ? (filled.length / required.length) * 100 : 0;
  document.getElementById('signing-progress-fill').style.width = pct + '%';
  document.getElementById('finish-signing-btn').disabled = filled.length < required.length;
}

// Signature canvas
let canvasCtx = null, isDrawing = false;
function initSignatureCanvas() {
  const canvas = document.getElementById('signature-canvas');
  canvasCtx = canvas.getContext('2d');
  canvas.width = 500; canvas.height = 160;
  canvasCtx.clearRect(0, 0, 500, 160);
  canvasCtx.strokeStyle = '#4C1D95'; canvasCtx.lineWidth = 2.5;
  canvasCtx.lineCap = 'round'; canvasCtx.lineJoin = 'round';
  document.getElementById('typed-signature').value = '';
  document.getElementById('typed-preview').textContent = '';
  signing.signatureMode = 'draw';
  document.querySelectorAll('.sig-tab').forEach(t => t.classList.toggle('active', t.dataset.sig === 'draw'));
  document.getElementById('sig-draw-panel').classList.remove('hidden');
  document.getElementById('sig-type-panel').classList.add('hidden');

  // Remove old listeners by cloning
  const newCanvas = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(newCanvas, canvas);
  canvasCtx = newCanvas.getContext('2d');
  canvasCtx.strokeStyle = '#4C1D95'; canvasCtx.lineWidth = 2.5;
  canvasCtx.lineCap = 'round'; canvasCtx.lineJoin = 'round';

  newCanvas.addEventListener('mousedown', e => { isDrawing = true; canvasCtx.beginPath(); canvasCtx.moveTo(e.offsetX, e.offsetY); });
  newCanvas.addEventListener('mousemove', e => { if (!isDrawing) return; canvasCtx.lineTo(e.offsetX, e.offsetY); canvasCtx.stroke(); });
  newCanvas.addEventListener('mouseup', () => isDrawing = false);
  newCanvas.addEventListener('mouseleave', () => isDrawing = false);
}

document.querySelectorAll('.sig-tab').forEach(t => t.addEventListener('click', () => {
  signing.signatureMode = t.dataset.sig;
  document.querySelectorAll('.sig-tab').forEach(x => x.classList.toggle('active', x.dataset.sig === t.dataset.sig));
  document.getElementById('sig-draw-panel').classList.toggle('hidden', t.dataset.sig !== 'draw');
  document.getElementById('sig-type-panel').classList.toggle('hidden', t.dataset.sig !== 'type');
}));
document.getElementById('clear-canvas').addEventListener('click', () => {
  const c = document.getElementById('signature-canvas');
  canvasCtx.clearRect(0, 0, c.width, c.height);
});
document.getElementById('typed-signature').addEventListener('input', e => {
  document.getElementById('typed-preview').textContent = e.target.value;
});

document.getElementById('apply-signature-btn').addEventListener('click', async () => {
  const fieldId = signing.currentFieldId;
  const field = signing.data.fields.find(f => f.id === fieldId);
  const el = document.querySelector(`.signing-field[data-field-id="${fieldId}"]`);

  let sigData, sigType;
  if (signing.signatureMode === 'draw') {
    const canvas = document.getElementById('signature-canvas');
    const pixels = canvasCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels.some((v, i) => i % 4 === 3 && v > 0)) { toast('Please draw your signature', 'error'); return; }
    sigData = canvas.toDataURL('image/png');
    sigType = 'draw';
  } else {
    sigData = document.getElementById('typed-signature').value.trim();
    if (!sigData) { toast('Please type your name', 'error'); return; }
    sigType = 'type';
  }

  try {
    await api(`/api/sign/${signing.token}/fields/${fieldId}`, {
      method:'POST', body: JSON.stringify({ signature_data: sigData, signature_type: sigType })
    });
    if (field) field.value = sigType === 'type' ? sigData : '[signed]';
    signing.filledFields.add(fieldId);
    el.classList.remove('empty'); el.classList.add('filled');
    if (sigType === 'draw') {
      el.innerHTML = `<img src="${sigData}" style="width:100%;height:100%;object-fit:contain;">`;
    } else {
      el.innerHTML = `<span class="field-value sig-typed">${esc(sigData)}</span>`;
    }
    hideModal('signature-modal');
    updateSigningProgress();
  } catch (err) { toast(err.message, 'error'); }
});

// Finish signing
document.getElementById('finish-signing-btn').addEventListener('click', async () => {
  try {
    await api(`/api/sign/${signing.token}/complete`, { method:'POST' });
    showView('signing-done-view');
    document.getElementById('done-title').textContent = 'Document Signed!';
    document.getElementById('done-message').textContent = 'Thank you. The document owner will be notified.';
    document.querySelector('.done-icon').textContent = '✓';
    document.querySelector('.done-icon').style.background = '#16a34a';
  } catch (err) { toast(err.message, 'error'); }
});

// Decline
document.getElementById('decline-btn').addEventListener('click', () => { document.getElementById('decline-reason').value = ''; showModal('decline-modal'); });
document.getElementById('confirm-decline-btn').addEventListener('click', async () => {
  try {
    await api(`/api/sign/${signing.token}/decline`, { method:'POST', body: JSON.stringify({ reason: document.getElementById('decline-reason').value }) });
    hideModal('decline-modal');
    showView('signing-done-view');
    document.getElementById('done-title').textContent = 'Signing Declined';
    document.getElementById('done-message').textContent = 'The document owner has been notified.';
    document.querySelector('.done-icon').textContent = '✗';
    document.querySelector('.done-icon').style.background = '#dc2626';
  } catch (err) { toast(err.message, 'error'); }
});

// ==================== Admin ====================
async function loadAdminPanel() { loadAdminStats(); loadAdminUsers(); loadAdminInvitations(); loadAdminEnvelopes(); }

async function loadAdminStats() {
  try {
    const s = await api('/api/admin/stats');
    document.getElementById('admin-stats').innerHTML = `
      <div class="stat-card"><div class="stat-value">${s.users}</div><div class="stat-label">Users</div></div>
      <div class="stat-card"><div class="stat-value">${s.activeUsers}</div><div class="stat-label">Active</div></div>
      <div class="stat-card"><div class="stat-value">${s.envelopes}</div><div class="stat-label">Envelopes</div></div>
      <div class="stat-card"><div class="stat-value">${s.sentEnvelopes}</div><div class="stat-label">In Progress</div></div>
      <div class="stat-card"><div class="stat-value">${s.completedEnvelopes}</div><div class="stat-label">Completed</div></div>
      <div class="stat-card"><div class="stat-value">${s.pendingInvitations}</div><div class="stat-label">Invites</div></div>
    `;
  } catch {}
}

async function loadAdminUsers() {
  try {
    const users = await api('/api/admin/users');
    document.getElementById('admin-users-list').innerHTML = `<table class="admin-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Envelopes</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td>${esc(u.name)}</td><td>${esc(u.email)}</td>
        <td><span class="role-badge role-${u.role}">${u.role}</span></td>
        <td><span class="${u.is_active ? 'status-active' : 'status-inactive'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
        <td>${u.envelope_count}</td>
        <td>${u.id !== currentUser.id ? `
          <button class="btn btn-sm" onclick="toggleUserRole(${u.id},'${u.role}')">${u.role==='admin'?'→ User':'→ Admin'}</button>
          <button class="btn btn-sm" onclick="toggleUserStatus(${u.id},${u.is_active})">${u.is_active?'Deactivate':'Activate'}</button>
        ` : '—'}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch {}
}

async function loadAdminInvitations() {
  try {
    const inv = await api('/api/admin/invitations');
    document.getElementById('admin-invitations-list').innerHTML = inv.length === 0 ? '<div class="empty-state">No invitations.</div>' :
    `<table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${inv.map(i => {
      const expired = new Date(i.expires_at) < new Date();
      const st = i.accepted ? 'Accepted' : (expired ? 'Expired' : 'Pending');
      return `<tr><td>${esc(i.name)}</td><td>${esc(i.email)}</td><td>${st}</td><td>
        ${!i.accepted && !expired ? `<button class="btn btn-sm" onclick="copyToClipboard('${location.origin}/invite/${i.token}')">Copy Link</button>` : ''}
      </td></tr>`;
    }).join('')}</tbody></table>`;
  } catch {}
}

async function loadAdminEnvelopes() {
  try {
    const envs = await api('/api/admin/envelopes');
    document.getElementById('admin-envelopes-list').innerHTML = envs.length === 0 ? '<div class="empty-state">No envelopes.</div>' :
    envs.map(e => `<div class="envelope-row">
      <div class="env-title">${esc(e.title)}</div>
      <div class="env-meta">${esc(e.owner_name)}</div>
      <div class="env-recipients">${e.signed_count}/${e.total_signers}</div>
      <div><span class="status-badge status-${e.status}">${e.status}</span></div>
      <div class="env-date">${fmtDate(e.updated_at)}</div>
    </div>`).join('');
  } catch {}
}

async function toggleUserRole(id, role) {
  if (!confirm('Change role?')) return;
  try { await api(`/api/admin/users/${id}/role`, { method:'PATCH', body: JSON.stringify({ role: role==='admin'?'user':'admin' }) }); loadAdminUsers(); } catch (e) { toast(e.message,'error'); }
}
async function toggleUserStatus(id, active) {
  if (!confirm(active ? 'Deactivate?' : 'Activate?')) return;
  try { await api(`/api/admin/users/${id}/status`, { method:'PATCH', body: JSON.stringify({ is_active: !active }) }); loadAdminUsers(); } catch (e) { toast(e.message,'error'); }
}

// Admin tabs
document.querySelectorAll('.admin-tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.admin-tab').forEach(x => x.classList.remove('active')); t.classList.add('active');
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById(`admin-${t.dataset.adminTab}-tab`)?.classList.remove('hidden');
}));

// Invite modal
['invite-user-btn','invite-user-btn-2'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => {
    document.getElementById('invite-result').classList.add('hidden');
    document.getElementById('invite-form').reset(); showModal('invite-modal');
  });
});
document.getElementById('invite-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  try {
    const r = await api('/api/admin/invite', { method:'POST', body: JSON.stringify({ name:f.name.value, email:f.email.value, role:f.role.value }) });
    const link = `${location.origin}/invite/${r.token}`;
    document.getElementById('invite-result').classList.remove('hidden');
    document.getElementById('invite-result').innerHTML = `<p style="color:var(--success)">Invitation created!</p><div class="invite-link-box"><a href="${link}">${link}</a><button class="btn btn-sm" onclick="copyToClipboard('${link}')" style="margin-top:8px;">Copy</button></div>`;
    loadAdminInvitations(); loadAdminStats();
  } catch (err) { toast(err.message, 'error'); }
});

// Reset password
document.getElementById('reset-pw-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api(`/api/admin/users/${document.getElementById('reset-pw-user-id').value}/reset-password`, { method:'POST', body: JSON.stringify({ password: e.target.password.value }) });
    toast('Password reset', 'success'); hideModal('reset-pw-modal'); e.target.reset();
  } catch (err) { toast(err.message, 'error'); }
});

// ==================== Modals ====================
document.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.add('hidden')));
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); }));

// ==================== URL Routing ====================
function checkUrl() {
  const p = location.pathname;
  const signMatch = p.match(/^\/sign\/(.+)$/);
  if (signMatch) { openSigning(signMatch[1]); return true; }
  const invMatch = p.match(/^\/invite\/(.+)$/);
  if (invMatch) { handleInvite(invMatch[1]); return true; }
  return false;
}

async function handleInvite(token) {
  try {
    const inv = await api(`/api/auth/invite/${token}`);
    inviteToken = token; showView('auth-view');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="register"]').classList.add('active');
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    const form = document.getElementById('register-form');
    form.name.value = inv.name; form.email.value = inv.email; form.email.readOnly = true;
    document.querySelector('#register-form button[type="submit"]').textContent = 'Accept Invitation';
  } catch { toast('Invalid or expired invitation', 'error'); showView('auth-view'); }
}

// ==================== Init ====================
if (!checkUrl()) checkAuth();
