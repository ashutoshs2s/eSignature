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

const RECIPIENT_COLORS = ['#5B21B6','#14967f','#059669','#D97706','#DC2626','#7C3AED','#0891B2','#10B981','#F59E0B','#EF4444'];
const FIELD_LABELS = { signature:'Signature', initials:'Initials', date_signed:'Date Signed', text:'Text', name:'Name', email:'Email', checkbox:'Checkbox' };
const FIELD_DEFAULTS = {
  signature: { w: 20, h: 5 }, initials: { w: 10, h: 5 }, date_signed: { w: 16, h: 3.5 },
  text: { w: 20, h: 3.5 }, name: { w: 20, h: 3.5 }, email: { w: 20, h: 3.5 }, checkbox: { w: 3, h: 3 }
};

// ==================== Helpers ====================
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }, 3000);
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDateShort(d) {
  if (!d) return '';
  return new Date(d + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}

function showModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id)?.classList.add('hidden'); }

function navigate(view) {
  // Update top nav active state
  document.querySelectorAll('.topnav-link').forEach(b => b.classList.remove('active'));
  document.querySelector(`.topnav-link[data-view="${view}"]`)?.classList.add('active');
  // Close avatar dropdown
  document.getElementById('topnav-dropdown')?.classList.add('hidden');

  if (view === 'dashboard') { showView('dashboard-view'); loadEnvelopes(); loadDashboardStats(); }
  else if (view === 'agreements') { showView('agreements-view'); loadAgreements(); }
  else if (view === 'inbox') { showView('agreements-view'); loadAgreements('action_required'); }
  else if (view === 'admin') { showView('admin-view'); loadAdminPanel(); }
}

// ==================== Auth ====================
async function checkAuth() {
  // Check for OAuth errors in URL
  const urlParams = new URLSearchParams(location.search);
  const authError = urlParams.get('auth_error');
  if (authError) {
    history.replaceState({}, '', '/');
    const errorMessages = {
      google_denied: 'Google sign-in was cancelled',
      google_token_failed: 'Google authentication failed',
      google_no_email: 'Could not get email from Google',
      google_failed: 'Google sign-in failed. Please try again.',
      apple_denied: 'Apple sign-in was cancelled',
      apple_invalid_token: 'Apple authentication failed',
      apple_no_email: 'Could not get email from Apple',
      apple_failed: 'Apple sign-in failed. Please try again.',
      account_deactivated: 'Your account has been deactivated. Contact your admin.',
    };
    setTimeout(() => toast(errorMessages[authError] || 'Authentication failed', 'error'), 100);
  }

  try {
    currentUser = await api('/api/auth/me');
    if (currentUser.must_change_password) {
      showView('auth-view');
      showModal('change-pw-modal');
      return;
    }
    showApp();
  } catch {
    await checkSetup();
    showView('auth-view');
  }
}

async function checkSetup() {
  try {
    const { needs_setup } = await api('/api/auth/setup-status');
    if (needs_setup) {
      document.querySelector('[data-tab="register"]').textContent = 'Setup';
      document.querySelector('#register-form button[type="submit"]').textContent = 'Create Admin Account';
    } else if (!inviteToken) {
      document.querySelector('[data-tab="register"]')?.classList.add('hidden');
      document.querySelector('.tab-bar')?.classList.add('hidden');
      document.getElementById('invite-notice')?.classList.remove('hidden');
    }
  } catch {}

  // Check which OAuth providers are available
  try {
    const oauth = await api('/api/auth/oauth-config');
    if (oauth.google || oauth.apple) {
      document.getElementById('social-login-section')?.classList.remove('hidden');
      if (!oauth.google) document.getElementById('google-login-btn')?.classList.add('hidden');
      if (!oauth.apple) document.getElementById('apple-login-btn')?.classList.add('hidden');
      else document.getElementById('apple-login-btn')?.classList.remove('hidden');
    }
  } catch {}
}

function showApp() {
  // Show top nav
  document.getElementById('topnav').classList.remove('hidden');
  document.getElementById('main-area').style.marginLeft = '0';

  // Set user info in top nav
  document.getElementById('topnav-initials').textContent = getInitials(currentUser.name);
  document.getElementById('topnav-user-name').textContent = currentUser.name;
  document.getElementById('dash-welcome').textContent = `Welcome back, ${currentUser.name}`;

  // Show admin nav if admin
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', currentUser.role !== 'admin'));

  navigate('dashboard');
}

// Auth tabs
document.querySelectorAll('.tab-bar .tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab-bar .tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('login-form').classList.toggle('hidden', t.dataset.tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', t.dataset.tab !== 'register');
}));

// Login
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  document.getElementById('login-error').textContent = '';
  try {
    currentUser = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: f.email.value.trim(), password: f.password.value })
    });
    if (currentUser.must_change_password) {
      showModal('change-pw-modal');
      return;
    }
    showApp();
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
  }
});

// Force password change
document.getElementById('change-pw-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const errEl = document.getElementById('change-pw-error');
  errEl.textContent = '';
  const newPw = f.new_password.value;
  const confirmPw = f.confirm_password.value;
  if (newPw !== confirmPw) { errEl.textContent = 'Passwords do not match'; return; }
  if (newPw.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; return; }
  try {
    await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ new_password: newPw }) });
    hideModal('change-pw-modal');
    currentUser.must_change_password = false;
    toast('Password changed successfully!', 'success');
    showApp();
  } catch (err) { errEl.textContent = err.message; }
});

// Register
document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  document.getElementById('register-error').textContent = '';
  try {
    const body = { name: f.name.value, email: f.email.value, password: f.password.value };
    if (inviteToken) body.invite_token = inviteToken;
    currentUser = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
    if (inviteToken) { history.replaceState({}, '', '/'); inviteToken = null; }
    showApp();
  } catch (err) {
    document.getElementById('register-error').textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  document.getElementById('sidebar').classList.add('hidden');
  document.getElementById('main-area').style.marginLeft = '0';
  showView('auth-view');
});

// New envelope button
document.getElementById('new-envelope-btn').addEventListener('click', startWizard);

// Agreements page: Start Now button
document.getElementById('agreements-new-btn')?.addEventListener('click', startWizard);

// Agreements page: search
document.getElementById('agreements-search-input')?.addEventListener('input', () => {
  loadAgreements();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('topnav-dropdown');
  const avatar = document.getElementById('topnav-avatar');
  if (dropdown && !dropdown.contains(e.target) && !avatar?.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// ==================== Dashboard Stats ====================
async function loadDashboardStats() {
  try {
    const envs = await api('/api/envelopes');
    const sent = envs.filter(e => e.status === 'sent').length;
    const completed = envs.filter(e => e.status === 'completed').length;
    const draft = envs.filter(e => e.status === 'draft').length;
    const declined = envs.filter(e => e.status === 'declined').length;

    document.getElementById('dashboard-stats').innerHTML = `
      <div class="dash-stat-row"><span class="dash-stat-label">Waiting for others</span><span class="dash-stat-value">${sent}</span></div>
      <div class="dash-stat-row"><span class="dash-stat-label">Drafts</span><span class="dash-stat-value">${draft}</span></div>
      <div class="dash-stat-row"><span class="dash-stat-label">Completed</span><span class="dash-stat-value">${completed}</span></div>
      <div class="dash-stat-row"><span class="dash-stat-label">Declined</span><span class="dash-stat-value">${declined}</span></div>
    `;
  } catch {}
}

function fmtTimeAgo(d) {
  if (!d) return '';
  const now = new Date();
  const date = new Date(d + 'Z');
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)} hours ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)} days ago`;
  if (diff < 2592000) return `${Math.floor(diff/604800)} weeks ago`;
  return fmtDateShort(d);
}

function statusIcon(status) {
  const icons = {
    completed: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
    sent: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><circle cx="12" cy="12" r="1"/></svg>',
    draft: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M12 5v14"/></svg>',
    declined: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    voided: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  };
  return `<span class="dash-status-icon ${status}">${icons[status] || icons.draft}</span>`;
}

// ==================== Dashboard ====================
async function loadEnvelopes(filter = 'all') {
  try {
    const url = filter === 'all' ? '/api/envelopes' : `/api/envelopes?status=${filter}`;
    const envs = await api(url);
    const el = document.getElementById('envelopes-list');
    if (envs.length === 0) {
      el.innerHTML = `
        <div class="dash-tasks-empty">
          <h3>No agreements yet</h3>
          <p>Click "Get Signatures" to get started.</p>
        </div>`;
      return;
    }
    el.innerHTML = envs.map(e => {
      const statusLabel = e.status.charAt(0).toUpperCase() + e.status.slice(1);
      const timeAgo = fmtTimeAgo(e.updated_at);
      return `
      <div class="dash-activity-row" onclick="viewEnvelope('${e.id}')">
        <div class="dash-activity-info">
          <div class="dash-activity-title">${esc(e.title)}</div>
          <div class="dash-activity-sub">${timeAgo}</div>
        </div>
        <div class="dash-activity-status">
          ${statusIcon(e.status)}
          ${statusLabel}
        </div>
        <svg class="dash-activity-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      </div>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
}

// ==================== Agreements Page ====================
let currentAgreementFilter = 'inbox';

async function loadAgreements(filter) {
  if (filter) {
    currentAgreementFilter = filter;
    // Update sidebar active state
    document.querySelectorAll('.agreements-nav-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`.agreements-nav-item[data-agreement-filter="${filter}"]`)?.classList.add('active');
  }
  const titleMap = { inbox: 'Inbox', sent: 'Sent', completed: 'Completed', action_required: 'Action Required' };
  document.getElementById('agreements-page-title').textContent = titleMap[currentAgreementFilter] || 'Inbox';

  try {
    let envs;
    if (currentAgreementFilter === 'inbox' || currentAgreementFilter === 'action_required') {
      envs = await api('/api/envelopes/inbox');
    } else {
      envs = await api(`/api/envelopes?status=${currentAgreementFilter}`);
    }

    const searchVal = (document.getElementById('agreements-search-input')?.value || '').toLowerCase();
    if (searchVal) {
      envs = envs.filter(e => (e.title || '').toLowerCase().includes(searchVal));
    }

    const el = document.getElementById('agreements-list');
    if (envs.length === 0) {
      el.innerHTML = `<div class="empty-state" style="padding:48px 20px"><p>No documents found</p></div>`;
      return;
    }
    el.innerHTML = envs.map(e => {
      const statusLabel = e.status.charAt(0).toUpperCase() + e.status.slice(1);
      const dateStr = fmtDateShort(e.updated_at);
      const from = e.sender_name ? `From: ${esc(e.sender_name)}` : (e.recipients_text ? `To: ${esc(e.recipients_text)}` : '');
      return `
      <div class="agreements-row" onclick="viewEnvelope('${e.id}')">
        <div>
          <div class="agreements-row-name">${esc(e.title)}</div>
          <div class="agreements-row-from">${from}</div>
        </div>
        <div class="agreements-row-status">
          ${statusIcon(e.status)}
          ${statusLabel}
        </div>
        <div class="agreements-row-date">${dateStr}</div>
        <div class="agreements-row-actions">
          <button class="agreements-download-btn" onclick="event.stopPropagation(); downloadEnvelope('${e.id}')">Download</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
}

function filterAgreements(filter) {
  loadAgreements(filter);
}

function downloadEnvelope(id) {
  window.open(`/api/envelopes/${id}/download`, '_blank');
}

document.querySelectorAll('.filter-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.filter-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  loadEnvelopes(b.dataset.filter);
}));

// ==================== Inbox ====================
async function loadInbox() {
  try {
    const items = await api('/api/envelopes/inbox');
    const el = document.getElementById('inbox-list');
    if (items.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M22 12h-6l-2 3H10l-2-3H2"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
            </svg>
          </div>
          <p>No documents waiting for your action</p>
          <p class="text-small text-muted mt-1">You're all caught up!</p>
        </div>`;
      return;
    }
    el.innerHTML = items.map(i => `
      <div class="envelope-row ${i.my_status === 'sent' || i.my_status === 'delivered' ? 'clickable' : ''}"
           onclick="${i.my_status === 'sent' || i.my_status === 'delivered' ? `openSigning('${i.token}')` : ''}">
        <div class="envelope-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" style="flex-shrink:0;margin-right:8px">
            <path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/>
          </svg>
          ${esc(i.title)}
        </div>
        <div class="envelope-meta">From: ${esc(i.sender_name)}</div>
        <div><span class="status-badge status-${i.my_status}">${i.my_status === 'sent' || i.my_status === 'delivered' ? 'Needs signature' : i.my_status}</span></div>
        <div class="envelope-date">${fmtDateShort(i.created_at)}</div>
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
    document.getElementById('detail-topbar-title').innerHTML = `${esc(env.title)} <span class="status-badge status-${env.status}" style="margin-left:8px">${env.status}</span>`;
    const el = document.getElementById('envelope-detail');

    el.innerHTML = `
      <div class="detail-header">
        <div>
          <h2>${esc(env.title)}</h2>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <span class="status-badge status-${env.status}">${env.status}</span>
            <span style="font-size:13px;color:var(--ink3);">Created ${fmtDateShort(env.created_at)}</span>
          </div>
          ${env.message ? `<p class="detail-message">${esc(env.message)}</p>` : ''}
        </div>
        <div class="detail-actions">
          ${env.status === 'sent' ? `<button class="btn btn-outline-danger btn-sm" onclick="openVoidModal('${env.id}')">Void</button>` : ''}
          ${env.status === 'completed' ? `
            <button class="btn btn-secondary btn-sm" onclick="downloadEnvelope('${env.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Download
            </button>
            <button class="btn btn-secondary btn-sm" onclick="downloadCertificate('${env.id}')">Certificate</button>
          ` : ''}
          ${env.status === 'draft' ? `<button class="btn btn-primary btn-sm" onclick="resumeWizard('${env.id}')">Edit & Send</button>` : ''}
          <button class="btn btn-outline-danger btn-sm" onclick="deleteEnvelope('${env.id}')">Delete</button>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-section">
          <h3>Recipients</h3>
          ${env.recipients.map((r, i) => `
            <div class="signer-item">
              <div class="signer-info">
                <span class="signer-color-dot" style="background:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]}"></span>
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;font-size:14px;">${esc(r.name)}</div>
                  <div style="font-size:12px;color:var(--ink3);margin-top:1px;">${esc(r.email)}</div>
                  <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span class="status-badge status-${r.status}">${r.status}</span>
                    ${r.role === 'cc' ? '<span class="status-badge" style="background:var(--surface2);color:var(--ink3)">CC</span>' : ''}
                    ${r.signed_at ? `<span style="font-size:11px;color:var(--ink4);">Signed ${fmtDateShort(r.signed_at)}</span>` : ''}
                    ${r.decline_reason ? `<span style="font-size:11px;color:var(--rose);">Reason: ${esc(r.decline_reason)}</span>` : ''}
                  </div>
                </div>
              </div>
              ${env.status === 'sent' && (r.status === 'sent' || r.status === 'delivered') ? `
                <div style="display:flex;gap:6px;flex-shrink:0;">
                  <button class="btn btn-sm btn-secondary" onclick="copyToClipboard('${location.origin}/sign/${r.token}')">Copy Link</button>
                  <button class="btn btn-sm btn-secondary" onclick="resendReminder('${env.id}','${r.id}')">Resend</button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
        <div class="detail-section">
          <h3>Documents</h3>
          ${env.documents.map(d => `
            <div class="doc-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
              <span style="font-weight:500;">${esc(d.title)}</span>
              <span style="color:var(--ink4);font-size:12px;">${d.page_count} page${d.page_count !== 1 ? 's' : ''}</span>
            </div>
          `).join('')}
        </div>
        <div class="detail-section detail-full">
          <h3>Activity</h3>
          ${env.auditLog.length === 0 ? '<p style="color:var(--ink3);font-size:13px;">No activity yet.</p>' : env.auditLog.map(a => `
            <div class="audit-item">
              <span class="audit-action">${esc(a.action.replace(/_/g, ' '))}</span>
              <span class="audit-actor">${esc(a.actor)}</span>
              ${a.details ? ` <span class="audit-details">${esc(a.details)}</span>` : ''}
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
  try {
    await api(`/api/envelopes/${id}`, { method: 'DELETE' });
    toast('Deleted', 'success');
    navigate('dashboard');
  } catch (err) { toast(err.message, 'error'); }
}

function downloadEnvelope(id) { window.open(`/api/envelopes/${id}/download`, '_blank'); }
function downloadCertificate(id) { window.open(`/api/envelopes/${id}/certificate`, '_blank'); }

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard!', 'success'));
}

async function resendReminder(envId, rid) {
  try {
    await api(`/api/envelopes/${envId}/resend/${rid}`, { method: 'POST' });
    toast('Reminder sent', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// Void
function openVoidModal(id) {
  currentEnvelopeId = id;
  document.getElementById('void-reason').value = '';
  showModal('void-modal');
}

document.getElementById('confirm-void-btn').addEventListener('click', async () => {
  try {
    await api(`/api/envelopes/${currentEnvelopeId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: document.getElementById('void-reason').value })
    });
    hideModal('void-modal');
    toast('Envelope voided', 'success');
    viewEnvelope(currentEnvelopeId);
  } catch (err) { toast(err.message, 'error'); }
});

// ==================== Wizard ====================
async function startWizard() {
  try {
    const env = await api('/api/envelopes', { method: 'POST', body: JSON.stringify({ title: 'Untitled Envelope' }) });
    wizard.envelopeId = env.id;
    wizard.step = 1;
    wizard.documents = [];
    wizard.recipients = [];
    wizard.fields = [];
    wizard.selectedRecipient = null;
    wizard.selectedFieldType = null;
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
    wizard.step = 1;
    wizard.selectedRecipient = null;
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
    const circle = s.querySelector('.step-circle');
    if (n < step) {
      circle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';
    } else {
      circle.textContent = n;
    }
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

document.getElementById('wizard-file-drop').addEventListener('dragover', e => {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
});
document.getElementById('wizard-file-drop').addEventListener('dragleave', e => {
  e.currentTarget.classList.remove('drag-over');
});
const ALLOWED_EXTENSIONS = /\.(pdf|doc|docx|xls|xlsx|odt|ods)$/i;
document.getElementById('wizard-file-drop').addEventListener('drop', async e => {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  for (const file of e.dataTransfer.files) {
    if (ALLOWED_EXTENSIONS.test(file.name)) await uploadWizardDoc(file);
    else toast('Unsupported file type. Please upload PDF, Word, or Excel files.', 'error');
  }
});

async function uploadWizardDoc(file) {
  const titleInput = document.getElementById('envelope-title');
  if (!titleInput.value.trim()) {
    titleInput.value = file.name.replace(/\.(pdf|docx?|xlsx?|odt|ods)$/i, '');
  }
  await api(`/api/envelopes/${wizard.envelopeId}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: document.getElementById('envelope-title').value || 'Untitled Envelope',
      message: document.getElementById('envelope-message').value
    })
  });

  const fd = new FormData();
  fd.append('file', file);
  fd.append('title', file.name);
  try {
    const doc = await fetch(`/api/envelopes/${wizard.envelopeId}/documents`, { method: 'POST', body: fd }).then(r => r.json());
    if (doc.error) throw new Error(doc.error);
    wizard.documents.push(doc);
    renderWizardDocs();
    document.getElementById('wizard-next-1').disabled = false;
  } catch (err) { toast(err.message, 'error'); }
}

function renderWizardDocs() {
  document.getElementById('wizard-doc-list').innerHTML = wizard.documents.map((d, i) => `
    <div class="doc-list-item">
      <div class="doc-list-info">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
        <div>
          <div class="doc-list-name">${esc(d.title || d.filename)}</div>
          <div class="doc-list-pages">${d.page_count} page${d.page_count !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <button class="btn btn-sm btn-outline-danger remove-doc-btn" data-doc-idx="${i}">Remove</button>
    </div>
  `).join('');
  document.querySelectorAll('.remove-doc-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeWizardDoc(parseInt(btn.dataset.docIdx));
    });
  });
}

async function removeWizardDoc(idx) {
  const doc = wizard.documents[idx];
  try {
    await api(`/api/envelopes/${wizard.envelopeId}/documents/${doc.id}`, { method: 'DELETE' });
    wizard.documents.splice(idx, 1);
    wizard.fields = wizard.fields.filter(f => f.document_id !== doc.id);
    renderWizardDocs();
    document.getElementById('wizard-next-1').disabled = wizard.documents.length === 0;
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('wizard-next-1').addEventListener('click', async () => {
  await api(`/api/envelopes/${wizard.envelopeId}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: document.getElementById('envelope-title').value || 'Untitled Envelope',
      message: document.getElementById('envelope-message').value
    })
  });
  setWizardStep(2);
});

// Step 2: Recipients
document.getElementById('add-recipient-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-recipient-name').value.trim();
  const email = document.getElementById('new-recipient-email').value.trim();
  const role = document.getElementById('new-recipient-role').value;
  if (!name || !email) { toast('Name and email required', 'error'); return; }
  try {
    const r = await api(`/api/envelopes/${wizard.envelopeId}/recipients`, {
      method: 'POST',
      body: JSON.stringify({ name, email, role })
    });
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
    <div class="recipient-row">
      <span class="recipient-color" style="background:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]}"></span>
      <div class="recipient-info">
        <div class="recipient-name">${esc(r.name)}</div>
        <div class="recipient-email">${esc(r.email)}</div>
      </div>
      <span class="recipient-role-badge role-${r.role}">${r.role === 'signer' ? 'Signer' : 'CC'}</span>
      <span class="recipient-order">#${r.order_num || i + 1}</span>
      <button class="btn btn-sm btn-outline-danger" onclick="removeRecipient(${i})">Remove</button>
    </div>
  `).join('');
  document.getElementById('wizard-next-2').disabled = wizard.recipients.filter(x => x.role === 'signer').length === 0;
}

async function removeRecipient(idx) {
  const r = wizard.recipients[idx];
  try {
    await api(`/api/envelopes/${wizard.envelopeId}/recipients/${r.id}`, { method: 'DELETE' });
    wizard.recipients.splice(idx, 1);
    wizard.fields = wizard.fields.filter(f => f.recipient_id !== r.id);
    renderRecipientsList();
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('wizard-prev-2').addEventListener('click', () => setWizardStep(1));
document.getElementById('wizard-next-2').addEventListener('click', () => setWizardStep(3));

// ==================== Step 3: Field Editor ====================
let fieldEditorCleanup = null;

async function renderFieldEditor() {
  if (fieldEditorCleanup) {
    fieldEditorCleanup();
    fieldEditorCleanup = null;
  }

  const container = document.getElementById('pdf-pages-container');
  container.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><p>Loading PDF pages...</p></div>';

  const signers = wizard.recipients.filter(r => r.role === 'signer');
  document.getElementById('field-recipient-selector').innerHTML = signers.map((r, i) => `
    <button class="recipient-select-btn ${i === 0 ? 'active' : ''}" data-rid="${r.id}"
            style="border-left-color:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]}"
            onclick="selectFieldRecipient('${r.id}', this)">
      <span class="recipient-dot" style="background:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]}"></span>
      ${esc(r.name)}
      <span class="field-count">${wizard.fields.filter(f => f.recipient_id === r.id).length}</span>
    </button>
  `).join('');
  if (signers.length > 0) wizard.selectedRecipient = signers[0].id;

  const canvasArea = document.querySelector('.field-canvas-area');
  const availableWidth = Math.min(canvasArea.clientWidth - 48, 900) || 800;
  const dpr = window.devicePixelRatio || 1;

  container.innerHTML = '';
  const globalListeners = [];

  for (const doc of wizard.documents) {
    try {
      const pdf = await pdfjsLib.getDocument(`/api/envelopes/${wizard.envelopeId}/documents/${doc.id}/pdf`).promise;
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = availableWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });
        const hiResViewport = page.getViewport({ scale: scale * dpr });

        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.docId = doc.id;
        wrapper.dataset.page = p;
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = hiResViewport.width;
        canvas.height = hiResViewport.height;
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: hiResViewport }).promise;
        wrapper.appendChild(canvas);

        const label = document.createElement('div');
        label.className = 'page-label';
        label.textContent = `${doc.title || doc.filename} \u2014 Page ${p} of ${pdf.numPages}`;
        container.appendChild(label);

        wrapper.addEventListener('dragover', e => { e.preventDefault(); wrapper.classList.add('drop-target'); });
        wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drop-target'));
        wrapper.addEventListener('drop', e => {
          e.preventDefault();
          wrapper.classList.remove('drop-target');
          handleFieldDrop(e, doc.id, p, wrapper);
        });
        wrapper.addEventListener('click', e => handleFieldClick(e, doc.id, p, wrapper));

        container.appendChild(wrapper);

        wizard.fields
          .filter(f => f.document_id === doc.id && f.page_number === p)
          .forEach(f => renderPlacedField(wrapper, f, globalListeners));
      }
    } catch (err) {
      container.innerHTML += `<div class="empty-state">Failed to load ${esc(doc.filename)}: ${esc(err.message)}</div>`;
    }
  }

  fieldEditorCleanup = () => {
    globalListeners.forEach(({ type, fn }) => document.removeEventListener(type, fn));
  };
}

function selectFieldRecipient(rid, btn) {
  wizard.selectedRecipient = rid;
  document.querySelectorAll('.recipient-select-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function updateRecipientFieldCounts() {
  document.querySelectorAll('.recipient-select-btn').forEach(btn => {
    const rid = btn.dataset.rid;
    const count = wizard.fields.filter(f => f.recipient_id === rid).length;
    const countEl = btn.querySelector('.field-count');
    if (countEl) countEl.textContent = count;
  });
}

// Draggable field types
document.querySelectorAll('.field-type-btn').forEach(btn => {
  btn.addEventListener('dragstart', e => {
    wizard.selectedFieldType = btn.dataset.type;
    e.dataTransfer.setData('text/plain', btn.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
  });
  btn.addEventListener('click', () => {
    wizard.selectedFieldType = btn.dataset.type;
    document.querySelectorAll('.field-type-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

function handleFieldDrop(e, docId, page, wrapper) {
  if (!wizard.selectedRecipient) { toast('Select a recipient first', 'error'); return; }
  const type = e.dataTransfer.getData('text/plain') || wizard.selectedFieldType;
  if (!type) return;
  const rect = wrapper.getBoundingClientRect();
  const defaults = FIELD_DEFAULTS[type] || { w: 15, h: 3.5 };
  const x = Math.max(0, Math.min(100 - defaults.w, ((e.clientX - rect.left) / rect.width) * 100 - defaults.w / 2));
  const y = Math.max(0, Math.min(100 - defaults.h, ((e.clientY - rect.top) / rect.height) * 100 - defaults.h / 2));
  addField(docId, page, x, y, type, wrapper);
}

function handleFieldClick(e, docId, page, wrapper) {
  if (e.target.closest('.placed-field')) return;
  if (!wizard.selectedRecipient || !wizard.selectedFieldType) return;
  const rect = wrapper.getBoundingClientRect();
  const type = wizard.selectedFieldType;
  const defaults = FIELD_DEFAULTS[type] || { w: 15, h: 3.5 };
  const x = Math.max(0, Math.min(100 - defaults.w, ((e.clientX - rect.left) / rect.width) * 100 - defaults.w / 2));
  const y = Math.max(0, Math.min(100 - defaults.h, ((e.clientY - rect.top) / rect.height) * 100 - defaults.h / 2));
  addField(docId, page, x, y, type, wrapper);
}

function addField(docId, page, x, y, type, wrapper) {
  const defaults = FIELD_DEFAULTS[type] || { w: 15, h: 3.5 };
  const field = {
    id: crypto.randomUUID(),
    document_id: docId,
    recipient_id: wizard.selectedRecipient,
    type, page_number: page,
    x, y,
    width: defaults.w,
    height: defaults.h,
    required: 1,
    label: ''
  };
  wizard.fields.push(field);
  renderPlacedField(wrapper, field, null);
  updateRecipientFieldCounts();
}

function renderPlacedField(wrapper, field, globalListeners) {
  const recipientIdx = wizard.recipients.findIndex(r => r.id === field.recipient_id);
  const recipient = wizard.recipients[recipientIdx];
  const color = recipient?.color || RECIPIENT_COLORS[recipientIdx >= 0 ? recipientIdx % RECIPIENT_COLORS.length : 0];

  const el = document.createElement('div');
  el.className = `placed-field type-${field.type}`;
  el.dataset.fieldId = field.id;
  el.style.left = field.x + '%';
  el.style.top = field.y + '%';
  el.style.width = field.width + '%';
  el.style.height = field.height + '%';
  el.style.borderColor = color;
  el.style.backgroundColor = color + '18';

  el.innerHTML = `
    <span class="field-label" style="background:${color}">${FIELD_LABELS[field.type] || field.type}</span>
    <span class="field-inner-label">${FIELD_LABELS[field.type]}</span>
    <button class="field-delete" title="Remove field">&times;</button>
    <div class="resize-handle"></div>
  `;

  el.querySelector('.field-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    wizard.fields = wizard.fields.filter(f => f.id !== field.id);
    el.remove();
    updateRecipientFieldCounts();
  });

  let isDragging = false, isResizing = false;
  let startX, startY, origX, origY, origW, origH;

  const onMouseDown = (e) => {
    if (e.target.classList.contains('field-delete')) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.target.classList.contains('resize-handle')) {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      origW = field.width;
      origH = field.height;
    } else {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = field.x;
      origY = field.y;
    }

    el.classList.add('selected');
    wrapper.querySelectorAll('.placed-field.selected').forEach(f => {
      if (f !== el) f.classList.remove('selected');
    });
  };

  const onMouseMove = (e) => {
    if (!isDragging && !isResizing) return;
    const rect = wrapper.getBoundingClientRect();

    if (isDragging) {
      const dx = ((e.clientX - startX) / rect.width) * 100;
      const dy = ((e.clientY - startY) / rect.height) * 100;
      field.x = Math.max(0, Math.min(100 - field.width, origX + dx));
      field.y = Math.max(0, Math.min(100 - field.height, origY + dy));
      el.style.left = field.x + '%';
      el.style.top = field.y + '%';
    } else if (isResizing) {
      const dx = ((e.clientX - startX) / rect.width) * 100;
      const dy = ((e.clientY - startY) / rect.height) * 100;
      field.width = Math.max(3, Math.min(100 - field.x, origW + dx));
      field.height = Math.max(2, Math.min(100 - field.y, origH + dy));
      el.style.width = field.width + '%';
      el.style.height = field.height + '%';
    }
  };

  const onMouseUp = () => {
    isDragging = false;
    isResizing = false;
  };

  el.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  if (globalListeners) {
    globalListeners.push({ type: 'mousemove', fn: onMouseMove });
    globalListeners.push({ type: 'mouseup', fn: onMouseUp });
  }

  wrapper.appendChild(el);
}

document.getElementById('wizard-prev-3').addEventListener('click', () => setWizardStep(2));
document.getElementById('wizard-next-3').addEventListener('click', async () => {
  if (wizard.fields.length === 0) {
    toast('Place at least one field on the document', 'error');
    return;
  }
  try {
    await api(`/api/envelopes/${wizard.envelopeId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ fields: wizard.fields })
    });
    setWizardStep(4);
  } catch (err) { toast(err.message, 'error'); }
});

// Step 4: Review
function renderReview() {
  const signers = wizard.recipients.filter(r => r.role === 'signer');
  const ccs = wizard.recipients.filter(r => r.role === 'cc');
  const title = document.getElementById('envelope-title').value || 'Untitled Envelope';
  const message = document.getElementById('envelope-message').value;

  document.getElementById('review-summary').innerHTML = `
    <div class="review-card">
      <div class="review-header">
        <h4>${esc(title)}</h4>
        ${message ? `<p class="review-message">${esc(message)}</p>` : ''}
      </div>
      <div class="review-section">
        <div class="review-section-title">Documents (${wizard.documents.length})</div>
        ${wizard.documents.map(d => `
          <div class="review-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
            <span style="font-weight:500;">${esc(d.title || d.filename)}</span>
            <span style="color:var(--ink4);font-size:12px;">${d.page_count} page${d.page_count !== 1 ? 's' : ''}</span>
          </div>
        `).join('')}
      </div>
      <div class="review-section">
        <div class="review-section-title">Signing Order</div>
        ${signers.map((r, i) => `
          <div class="review-signer">
            <span class="review-order">${i + 1}</span>
            <span class="signer-color-dot" style="background:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]}"></span>
            <div class="review-signer-info">
              <strong>${esc(r.name)}</strong> &lt;${esc(r.email)}&gt;
              <span class="review-field-count">${wizard.fields.filter(f => f.recipient_id === r.id).length} fields</span>
            </div>
          </div>
        `).join('')}
        ${ccs.length > 0 ? `
          <div class="review-section-title" style="margin-top:16px;">CC Recipients</div>
          ${ccs.map(r => `<div class="review-item" style="padding:6px 0;">${esc(r.name)} &lt;${esc(r.email)}&gt;</div>`).join('')}
        ` : ''}
      </div>
      <div class="review-summary-stats">
        <div class="review-stat"><strong>${wizard.documents.length}</strong>document${wizard.documents.length !== 1 ? 's' : ''}</div>
        <div class="review-stat"><strong>${signers.length}</strong>signer${signers.length !== 1 ? 's' : ''}</div>
        <div class="review-stat"><strong>${wizard.fields.length}</strong>field${wizard.fields.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
  `;
}

document.getElementById('wizard-prev-4').addEventListener('click', () => setWizardStep(3));
document.getElementById('wizard-send').addEventListener('click', async () => {
  try {
    await api(`/api/envelopes/${wizard.envelopeId}/send`, { method: 'POST' });
    toast('Envelope sent successfully!', 'success');
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
  // Hide sidebar for signing view
  document.getElementById('sidebar').classList.add('hidden');
  document.getElementById('main-area').style.marginLeft = '0';

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
      <div class="signing-title">${esc(data.envelope_title)}</div>
      <div class="signing-sender">from ${esc(data.sender_name)}</div>
    `;

    showView('signing-view');
    await renderSigningView();
  } catch (err) {
    showView('signing-done-view');
    document.getElementById('done-title').textContent = 'Cannot Sign';
    document.getElementById('done-message').textContent = err.message;
    document.querySelector('.done-icon').textContent = '!';
    document.querySelector('.done-icon').style.background = '#8b2e2e';
    document.querySelector('.done-icon').style.color = '#fff';
  }
}

// Access code
document.getElementById('access-code-form').addEventListener('submit', async e => {
  e.preventDefault();
  document.getElementById('access-code-error').textContent = '';
  try {
    await api(`/api/sign/${signing.token}/verify-code`, {
      method: 'POST',
      body: JSON.stringify({ code: e.target.code.value })
    });
    signing.data = await api(`/api/sign/${signing.token}?access_code=${encodeURIComponent(e.target.code.value)}`);
    signing.filledFields = new Set();
    document.getElementById('signing-info').innerHTML = `<div class="signing-title">${esc(signing.data.envelope_title)}</div>`;
    showView('signing-view');
    await renderSigningView();
  } catch (err) { document.getElementById('access-code-error').textContent = err.message; }
});

async function renderSigningView() {
  const container = document.getElementById('signing-pdf-container');
  container.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><p>Loading document...</p></div>';

  const wrapperEl = document.querySelector('.signing-body-wrapper');
  const availableWidth = Math.min(wrapperEl.clientWidth - 48, 900) || 800;
  const dpr = window.devicePixelRatio || 1;

  container.innerHTML = '';

  for (const doc of signing.data.documents) {
    try {
      const pdf = await pdfjsLib.getDocument(`/api/sign/${signing.token}/documents/${doc.id}/pdf`).promise;
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = availableWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });
        const hiResViewport = page.getViewport({ scale: scale * dpr });

        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper signing-page';
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = hiResViewport.width;
        canvas.height = hiResViewport.height;
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: hiResViewport }).promise;
        wrapper.appendChild(canvas);

        // Completed fields from other signers
        signing.data.completed_fields?.filter(f => f.document_id === doc.id && f.page_number === p).forEach(f => {
          const fel = document.createElement('div');
          fel.className = 'signing-field completed';
          fel.style.left = f.x + '%';
          fel.style.top = f.y + '%';
          fel.style.width = f.width + '%';
          fel.style.height = f.height + '%';
          if (f.signature_data && f.signature_data.startsWith('data:image')) {
            fel.innerHTML = `<img src="${f.signature_data}" alt="Signature">`;
          } else if (f.value) {
            fel.innerHTML = `<span class="field-value">${esc(f.value)}</span>`;
          }
          wrapper.appendChild(fel);
        });

        // My fields
        signing.data.fields.filter(f => f.document_id === doc.id && f.page_number === p).forEach(f => {
          const fel = document.createElement('div');
          fel.className = `signing-field ${f.value ? 'filled' : 'unfilled'}`;
          fel.dataset.fieldId = f.id;
          fel.style.left = f.x + '%';
          fel.style.top = f.y + '%';
          fel.style.width = f.width + '%';
          fel.style.height = f.height + '%';

          if (f.value) {
            signing.filledFields.add(f.id);
            fel.innerHTML = getFieldDisplay(f);
          } else {
            fel.innerHTML = `<span class="placeholder-text">${FIELD_LABELS[f.type]}</span>`;
          }

          fel.addEventListener('click', () => handleSigningFieldClick(f, fel));
          wrapper.appendChild(fel);
        });

        container.appendChild(wrapper);
      }
    } catch (err) { console.error('PDF render error:', err); }
  }

  updateSigningProgress();

  setTimeout(() => {
    const firstUnfilled = container.querySelector('.signing-field.unfilled');
    if (firstUnfilled) {
      firstUnfilled.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 500);
}

function getFieldDisplay(f) {
  if (f.type === 'checkbox') {
    return `<span class="checkbox-display">${f.value === 'true' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' : ''}</span>`;
  }
  return `<span class="field-value">${esc(f.value)}</span>`;
}

function handleSigningFieldClick(field, el) {
  if (field.type === 'signature' || field.type === 'initials') {
    signing.currentFieldId = field.id;
    document.getElementById('sig-modal-title').textContent = field.type === 'signature' ? 'Create your signature' : 'Add Initials';
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
    await api(`/api/sign/${signing.token}/fields/${fieldId}`, {
      method: 'POST',
      body: JSON.stringify({ value })
    });
    const field = signing.data.fields.find(f => f.id === fieldId);
    if (field) field.value = value;
    signing.filledFields.add(fieldId);
    el.classList.remove('unfilled');
    el.classList.add('filled');
    el.innerHTML = getFieldDisplay(field || { type: 'text', value });
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

// Signature fonts
const SIG_FONTS = [
  { name: 'Dancing Script', family: "'Dancing Script', cursive" },
  { name: 'Great Vibes', family: "'Great Vibes', cursive" },
  { name: 'Alex Brush', family: "'Alex Brush', cursive" },
  { name: 'Sacramento', family: "'Sacramento', cursive" },
  { name: 'Pacifico', family: "'Pacifico', cursive" },
  { name: 'Caveat', family: "'Caveat', cursive" },
  { name: 'Satisfy', family: "'Satisfy', cursive" },
];
let selectedSigFont = SIG_FONTS[0];

// Signature canvas
let canvasCtx = null, isDrawing = false;

function initSignatureCanvas() {
  const canvas = document.getElementById('signature-canvas');
  const newCanvas = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(newCanvas, canvas);

  canvasCtx = newCanvas.getContext('2d');
  newCanvas.width = newCanvas.offsetWidth || 500;
  newCanvas.height = 160;
  canvasCtx.clearRect(0, 0, newCanvas.width, newCanvas.height);
  canvasCtx.strokeStyle = '#4A1D96';
  canvasCtx.lineWidth = 2.5;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  document.getElementById('typed-signature').value = '';
  document.getElementById('typed-preview').textContent = '';
  document.getElementById('typed-preview').style.fontFamily = selectedSigFont.family;
  renderFontPicker();
  signing.signatureMode = 'draw';
  document.querySelectorAll('.sig-tab').forEach(t => t.classList.toggle('active', t.dataset.sig === 'draw'));
  document.getElementById('sig-draw-panel').classList.remove('hidden');
  document.getElementById('sig-type-panel').classList.add('hidden');

  newCanvas.addEventListener('mousedown', e => {
    isDrawing = true;
    canvasCtx.beginPath();
    const rect = newCanvas.getBoundingClientRect();
    canvasCtx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  });
  newCanvas.addEventListener('mousemove', e => {
    if (!isDrawing) return;
    const rect = newCanvas.getBoundingClientRect();
    canvasCtx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    canvasCtx.stroke();
  });
  newCanvas.addEventListener('mouseup', () => isDrawing = false);
  newCanvas.addEventListener('mouseleave', () => isDrawing = false);

  // Touch support
  newCanvas.addEventListener('touchstart', e => {
    e.preventDefault();
    isDrawing = true;
    canvasCtx.beginPath();
    const rect = newCanvas.getBoundingClientRect();
    const touch = e.touches[0];
    canvasCtx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
  });
  newCanvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!isDrawing) return;
    const rect = newCanvas.getBoundingClientRect();
    const touch = e.touches[0];
    canvasCtx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
    canvasCtx.stroke();
  });
  newCanvas.addEventListener('touchend', () => isDrawing = false);
}

function renderFontPicker() {
  const picker = document.getElementById('sig-font-picker');
  const name = document.getElementById('typed-signature').value || 'Your Name';
  picker.innerHTML = SIG_FONTS.map((f, i) =>
    `<div class="sig-font-option${f.name === selectedSigFont.name ? ' active' : ''}" data-font-idx="${i}" style="font-family:${f.family}">${esc(name)}</div>`
  ).join('');
  picker.querySelectorAll('.sig-font-option').forEach(el => {
    el.addEventListener('click', () => {
      selectedSigFont = SIG_FONTS[parseInt(el.dataset.fontIdx)];
      document.getElementById('typed-preview').style.fontFamily = selectedSigFont.family;
      picker.querySelectorAll('.sig-font-option').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
    });
  });
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
  renderFontPicker();
});

document.getElementById('apply-signature-btn').addEventListener('click', async () => {
  const fieldId = signing.currentFieldId;
  const field = signing.data.fields.find(f => f.id === fieldId);
  const el = document.querySelector(`.signing-field[data-field-id="${fieldId}"]`);

  let sigData, sigType;
  if (signing.signatureMode === 'draw') {
    const canvas = document.getElementById('signature-canvas');
    const pixels = canvasCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels.some((v, i) => i % 4 === 3 && v > 0)) {
      toast('Please draw your signature', 'error');
      return;
    }
    sigData = canvas.toDataURL('image/png');
    sigType = 'draw';
  } else {
    sigData = document.getElementById('typed-signature').value.trim();
    if (!sigData) { toast('Please type your name', 'error'); return; }
    sigType = 'type';
    signing.currentSigFont = selectedSigFont.family;
  }

  try {
    await api(`/api/sign/${signing.token}/fields/${fieldId}`, {
      method: 'POST',
      body: JSON.stringify({ signature_data: sigData, signature_type: sigType, signature_font: sigType === 'type' ? selectedSigFont.name : undefined })
    });
    if (field) field.value = sigType === 'type' ? sigData : '[signed]';
    signing.filledFields.add(fieldId);
    el.classList.remove('unfilled');
    el.classList.add('filled');
    if (sigType === 'draw') {
      el.innerHTML = `<img src="${sigData}" alt="Signature">`;
    } else {
      el.innerHTML = `<span class="field-value typed-sig" style="font-family:${signing.currentSigFont}">${esc(sigData)}</span>`;
    }
    hideModal('signature-modal');
    updateSigningProgress();
  } catch (err) { toast(err.message, 'error'); }
});

// Finish signing
document.getElementById('finish-signing-btn').addEventListener('click', async () => {
  try {
    await api(`/api/sign/${signing.token}/complete`, { method: 'POST' });
    showView('signing-done-view');
    document.getElementById('done-title').textContent = 'Document Signed!';
    document.getElementById('done-message').textContent = 'Thank you. The document owner will be notified.';
    document.querySelector('.done-icon').textContent = '\u2713';
    document.querySelector('.done-icon').style.background = '#0a6b5c';
    document.querySelector('.done-icon').style.color = '#fff';
  } catch (err) { toast(err.message, 'error'); }
});

// Decline
document.getElementById('decline-btn').addEventListener('click', () => {
  document.getElementById('decline-reason').value = '';
  showModal('decline-modal');
});
document.getElementById('confirm-decline-btn').addEventListener('click', async () => {
  try {
    await api(`/api/sign/${signing.token}/decline`, {
      method: 'POST',
      body: JSON.stringify({ reason: document.getElementById('decline-reason').value })
    });
    hideModal('decline-modal');
    showView('signing-done-view');
    document.getElementById('done-title').textContent = 'Signing Declined';
    document.getElementById('done-message').textContent = 'The document owner has been notified.';
    document.querySelector('.done-icon').textContent = '\u2717';
    document.querySelector('.done-icon').style.background = '#8b2e2e';
    document.querySelector('.done-icon').style.color = '#fff';
  } catch (err) { toast(err.message, 'error'); }
});

// ==================== Admin ====================
async function loadAdminPanel() {
  loadAdminStats();
  loadAdminUsers();
  loadAdminInvitations();
  loadAdminEnvelopes();
}

async function loadAdminStats() {
  try {
    const s = await api('/api/admin/stats');
    document.getElementById('admin-stats').innerHTML = `
      <div class="stat-card"><div class="stat-label">Total Users</div><div class="stat-value">${s.users}</div></div>
      <div class="stat-card"><div class="stat-label">Active Users</div><div class="stat-value">${s.activeUsers}</div></div>
      <div class="stat-card"><div class="stat-label">Envelopes</div><div class="stat-value">${s.envelopes}</div></div>
      <div class="stat-card"><div class="stat-label">In Progress</div><div class="stat-value">${s.sentEnvelopes}</div></div>
      <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value">${s.completedEnvelopes}</div></div>
      <div class="stat-card"><div class="stat-label">Pending Invites</div><div class="stat-value">${s.pendingInvitations}</div></div>
    `;
  } catch {}
}

async function loadAdminUsers() {
  try {
    const users = await api('/api/admin/users');
    document.getElementById('admin-users-list').innerHTML = `<table class="admin-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Envelopes</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td><strong>${esc(u.name)}</strong></td>
        <td>${esc(u.email)}</td>
        <td><span class="role-badge role-${u.role}">${u.role}</span></td>
        <td><span class="status-dot ${u.is_active ? 'active' : 'inactive'}"></span>${u.is_active ? 'Active' : 'Inactive'}</td>
        <td>${u.envelope_count}</td>
        <td>${u.id !== currentUser.id ? `
          <div class="action-btns">
            <button class="btn btn-sm btn-secondary" onclick="toggleUserRole(${u.id},'${u.role}')">Make ${u.role === 'admin' ? 'User' : 'Admin'}</button>
            <button class="btn btn-sm btn-secondary" onclick="toggleUserStatus(${u.id},${u.is_active})">${u.is_active ? 'Deactivate' : 'Activate'}</button>
            <button class="btn btn-sm btn-secondary" onclick="openResetPw(${u.id},'${esc(u.name)}')">Reset PW</button>
          </div>
        ` : '<span style="color:var(--ink4);font-size:12px;">You</span>'}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch {}
}

function openResetPw(userId, name) {
  document.getElementById('reset-pw-user-id').value = userId;
  document.getElementById('reset-pw-user-label').textContent = `Reset password for ${name}`;
  showModal('reset-pw-modal');
}

async function loadAdminInvitations() {
  try {
    const inv = await api('/api/admin/invitations');
    document.getElementById('admin-invitations-list').innerHTML = inv.length === 0
      ? '<div class="empty-state"><p>No invitations yet.</p></div>'
      : `<table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${inv.map(i => {
          const expired = new Date(i.expires_at) < new Date();
          const st = i.accepted ? 'Accepted' : (expired ? 'Expired' : 'Pending');
          const stClass = i.accepted ? 'status-completed' : (expired ? 'status-voided' : 'status-sent');
          return `<tr>
            <td>${esc(i.name)}</td>
            <td>${esc(i.email)}</td>
            <td><span class="role-badge role-${i.role || 'user'}">${i.role || 'user'}</span></td>
            <td><span class="status-badge ${stClass}">${st}</span></td>
            <td>${!i.accepted && !expired ? `
              <button class="btn btn-sm btn-secondary" onclick="copyToClipboard('${location.origin}/invite/${i.token}')">Copy Link</button>
              <button class="btn btn-sm btn-outline-danger" onclick="revokeInvite('${i.id}')">Revoke</button>
            ` : ''}</td>
          </tr>`;
        }).join('')}</tbody></table>`;
  } catch {}
}

async function revokeInvite(id) {
  if (!confirm('Revoke this invitation?')) return;
  try {
    await api(`/api/admin/invitations/${id}`, { method: 'DELETE' });
    toast('Invitation revoked', 'success');
    loadAdminInvitations();
    loadAdminStats();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadAdminEnvelopes() {
  try {
    const envs = await api('/api/admin/envelopes');
    document.getElementById('admin-envelopes-list').innerHTML = envs.length === 0
      ? '<div class="empty-state"><p>No envelopes.</p></div>'
      : envs.map(e => `<div class="envelope-row" onclick="viewEnvelope('${e.id}')">
          <div class="envelope-title">${esc(e.title)}</div>
          <div class="envelope-meta">${esc(e.owner_name)}</div>
          <div class="envelope-recipients">${e.signed_count || 0} of ${e.total_signers || 0} signed</div>
          <div><span class="status-badge status-${e.status}">${e.status}</span></div>
          <div class="envelope-date">${fmtDateShort(e.updated_at)}</div>
        </div>`).join('');
  } catch {}
}

async function toggleUserRole(id, role) {
  if (!confirm(`Change this user's role?`)) return;
  try {
    await api(`/api/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role: role === 'admin' ? 'user' : 'admin' }) });
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleUserStatus(id, active) {
  if (!confirm(active ? 'Deactivate this user?' : 'Activate this user?')) return;
  try {
    await api(`/api/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active: !active }) });
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

// Admin tabs
document.querySelectorAll('.admin-tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.admin-tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById(`admin-${t.dataset.adminTab}-tab`)?.classList.remove('hidden');
}));

// Invite modal
document.getElementById('invite-user-btn')?.addEventListener('click', () => {
  document.getElementById('invite-result').classList.add('hidden');
  document.getElementById('invite-form').reset();
  showModal('invite-modal');
});

document.getElementById('invite-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('/api/admin/invite', {
      method: 'POST',
      body: JSON.stringify({ name: f.name.value, email: f.email.value, role: f.role.value })
    });
    const link = `${location.origin}/invite/${r.token}`;
    document.getElementById('invite-result').classList.remove('hidden');
    document.getElementById('invite-result').innerHTML = `
      <div class="invite-success">
        <p>Invitation created!</p>
        <div class="invite-link-box">
          <input type="text" value="${link}" readonly onclick="this.select()">
          <button class="btn btn-sm btn-primary" onclick="copyToClipboard('${link}')">Copy</button>
        </div>
      </div>
    `;
    loadAdminInvitations();
    loadAdminStats();
  } catch (err) { toast(err.message, 'error'); }
});

// Reset password
document.getElementById('reset-pw-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api(`/api/admin/users/${document.getElementById('reset-pw-user-id').value}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password: e.target.password.value })
    });
    toast('Password reset successfully', 'success');
    hideModal('reset-pw-modal');
    e.target.reset();
  } catch (err) { toast(err.message, 'error'); }
});

// ==================== Modals ====================
document.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.add('hidden')));
document.querySelectorAll('.modal-backdrop').forEach(m => m.addEventListener('click', () => m.closest('.modal').classList.add('hidden')));

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
    inviteToken = token;
    showView('auth-view');
    document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="register"]').classList.add('active');
    document.querySelector('[data-tab="register"]').classList.remove('hidden');
    document.querySelector('.tab-bar').classList.remove('hidden');
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('invite-notice')?.classList.add('hidden');
    const form = document.getElementById('register-form');
    form.name.value = inv.name;
    form.email.value = inv.email;
    form.email.readOnly = true;
    document.querySelector('#register-form button[type="submit"]').textContent = 'Accept Invitation';
  } catch {
    toast('Invalid or expired invitation', 'error');
    showView('auth-view');
  }
}

// ==================== Init ====================
if (!checkUrl()) checkAuth();
