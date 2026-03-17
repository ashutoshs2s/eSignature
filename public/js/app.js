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

const RECIPIENT_COLORS = ['#2563a8','#14967f','#059669','#D97706','#DC2626','#3b8fd4','#0891B2','#10B981','#F59E0B','#EF4444'];
const FIELD_LABELS = { signature:'Signature', initials:'Initials', date_signed:'Date Signed', text:'Text', name:'Name', email:'Email', checkbox:'Checkbox', dropdown:'Dropdown' };
const FIELD_DEFAULTS = {
  signature: { w: 20, h: 5 }, initials: { w: 10, h: 5 }, date_signed: { w: 16, h: 3.5 },
  text: { w: 20, h: 3.5 }, name: { w: 20, h: 3.5 }, email: { w: 20, h: 3.5 }, checkbox: { w: 3, h: 3 }, dropdown: { w: 20, h: 3.5 }
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
  else if (view === 'templates') { showView('templates-view'); loadTemplatesView(); }
  else if (view === 'reports') { showView('reports-view'); loadReportsView(); }
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
  const welcome = document.getElementById('dash-welcome');
  if (welcome) welcome.textContent = `Welcome back, ${currentUser.name}`;

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
  document.getElementById('topnav')?.classList.add('hidden');
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
      const status = e.status || e.envelope_status || 'draft';
      const statusLabel = String(status).charAt(0).toUpperCase() + String(status).slice(1);
      const timeAgo = fmtTimeAgo(e.updated_at);
      return `
      <div class="dash-activity-row" onclick="viewEnvelope('${e.id}')">
        <div class="dash-activity-info">
          <div class="dash-activity-title">${esc(e.title)}</div>
          <div class="dash-activity-sub">${timeAgo}</div>
        </div>
        <div class="dash-activity-status">
          ${statusIcon(status)}
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
      const status = e.status || e.envelope_status || 'draft';
      const statusLabel = String(status).charAt(0).toUpperCase() + String(status).slice(1);
      const dateStr = fmtDateShort(e.updated_at || e.created_at);
      const from = e.sender_name ? `From: ${esc(e.sender_name)}` : (e.recipients_text ? `To: ${esc(e.recipients_text)}` : '');
      return `
      <div class="agreements-row" onclick="viewEnvelope('${e.id}')">
        <div>
          <div class="agreements-row-name">${esc(e.title)}</div>
          <div class="agreements-row-from">${from}</div>
        </div>
        <div class="agreements-row-status">
          ${statusIcon(status)}
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
function auditIcon(action) {
  const map = {
    envelope_created: 'created',
    envelope_sent: 'sent',
    document_viewed: 'viewed',
    field_completed: 'signed',
    signing_completed: 'complete',
    recipient_signed: 'complete',
    envelope_completed: 'complete',
    reminder_sent: 'notif',
    envelope_declined: 'declined',
    envelope_voided: 'voided',
    next_signer_notified: 'notif',
  };
  const cls = map[action] || 'sent';
  const icons = {
    created: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    sent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    viewed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    signed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
    complete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="20 6 9 17 4 12"/></svg>',
    notif: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>',
    declined: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    voided: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  };
  return `<div class="t-icon ${cls}">${icons[cls] || icons.sent}</div>`;
}

async function viewEnvelope(id) {
  currentEnvelopeId = id;
  try {
    const env = await api(`/api/envelopes/${id}`);
    showView('envelope-detail-view');
    document.getElementById('detail-topbar-title').innerHTML = `${esc(env.title)} <span class="status-badge status-${env.status}" style="margin-left:8px">${env.status}</span>`;
    const el = document.getElementById('envelope-detail');

    const totalFields = env.fields ? env.fields.length : 0;
    const signedFields = env.fields ? env.fields.filter(f => f.value).length : 0;
    const totalPages = env.documents.reduce((s, d) => s + (d.page_count || 0), 0);

    el.innerHTML = `
      <div class="detail-topbar">
        <button class="btn btn-ghost" style="font-size:12px;padding:5px 8px;color:var(--accent2)" onclick="navigate('agreements')">&#8592; Back</button>
        <span style="font-size:15px;font-weight:600;color:var(--ink)">${esc(env.title)}</span>
        <span class="status-badge status-${env.status}" style="margin-left:4px">${env.status}</span>
        <div style="margin-left:auto;display:flex;gap:8px">
          ${env.status === 'sent' ? `<button class="btn btn-ghost" style="font-size:12px" onclick="openVoidModal('${env.id}')">Void</button>` : ''}
          <button class="btn btn-ghost" style="font-size:12px" onclick="deleteEnvelope('${env.id}')">Delete</button>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;background:var(--surface);padding:22px">
        <div class="detail-layout">
          <div class="detail-main-col">
            <!-- Audit Timeline -->
            <div class="detail-card">
              <div class="detail-card-head"><h3>Audit Trail</h3><span style="font-size:11px;color:var(--ink3)">All times UTC</span></div>
              <div class="timeline">
                ${env.auditLog.length === 0 ? '<p style="color:var(--ink3);font-size:13px;padding:0 18px 18px">No activity yet.</p>' :
                  env.auditLog.map((a, i) => `
                    <div class="t-event">
                      <div class="t-icon-col">
                        ${auditIcon(a.action)}
                        ${i < env.auditLog.length - 1 ? '<div class="t-line"></div>' : ''}
                      </div>
                      <div class="t-body">
                        <div class="t-title">${esc(a.action.replace(/_/g, ' '))}</div>
                        <div class="t-meta">${esc(a.actor)}${a.details ? ' &middot; ' + esc(a.details) : ''}<br>${fmtDate(a.created_at)}${a.ip_address ? ' &middot; IP: ' + esc(a.ip_address) : ''}</div>
                      </div>
                    </div>
                  `).join('')}
              </div>
            </div>
            <!-- Document Details -->
            <div class="detail-card">
              <div class="detail-card-head"><h3>Document Details</h3></div>
              <div class="detail-card-body">
                <div class="detail-info-grid">
                  <div><div class="detail-info-label">File</div><div class="detail-info-value">${env.documents.map(d => esc(d.title || d.filename)).join(', ')}</div></div>
                  <div><div class="detail-info-label">Pages</div><div class="detail-info-value">${totalPages}</div></div>
                  <div><div class="detail-info-label">Sent</div><div class="detail-info-value">${fmtDateShort(env.created_at)}</div></div>
                  <div><div class="detail-info-label">Expires</div><div class="detail-info-value" ${env.expires_at ? 'style="color:var(--rose)"' : ''}>${env.expires_at ? fmtDateShort(env.expires_at) : 'No expiry'}</div></div>
                  <div><div class="detail-info-label">Signing Order</div><div class="detail-info-value">Sequential</div></div>
                  <div><div class="detail-info-label">Fields</div><div class="detail-info-value">${totalFields} total (${signedFields} signed)</div></div>
                </div>
              </div>
            </div>
          </div>
          <div class="detail-side-col">
            <!-- Signer Status -->
            <div class="detail-card">
              <div class="detail-card-head"><h3>Signer Status</h3></div>
              <div style="padding:14px 18px;display:flex;flex-direction:column;gap:0">
                ${env.recipients.map((r, i) => `
                  <div class="signer-status-row">
                    <div class="avatar" style="background:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]};width:34px;height:34px;font-size:12px">${getInitials(r.name)}</div>
                    <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;color:var(--ink)">${esc(r.name)}</div><div style="font-size:11px;color:var(--ink4)">${esc(r.email)}</div></div>
                    <span class="status-badge status-${r.status}">${r.status}</span>
                  </div>
                `).join('')}
              </div>
              ${env.status === 'sent' ? `<div style="padding:0 18px 16px">${env.recipients.filter(r => r.status === 'sent' || r.status === 'delivered').map(r => `
                <button class="btn btn-secondary" style="width:100%;justify-content:center;font-size:12px;margin-bottom:6px" onclick="resendReminder('${env.id}','${r.id}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>
                  Remind ${esc(r.name.split(' ')[0])}
                </button>
              `).join('')}</div>` : ''}
            </div>
            <!-- Actions -->
            <div class="detail-card">
              <div class="detail-card-head"><h3>Actions</h3></div>
              <div style="padding:10px 14px;display:flex;flex-direction:column;gap:6px">
                <button class="btn btn-secondary" style="justify-content:flex-start;font-size:12px" onclick="downloadEnvelope('${env.id}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download PDF
                </button>
                ${env.status === 'completed' ? `<button class="btn btn-secondary" style="justify-content:flex-start;font-size:12px" onclick="downloadCertificate('${env.id}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
                  Download Certificate
                </button>` : ''}
                ${env.status === 'sent' ? env.recipients.filter(r => r.status === 'sent' || r.status === 'delivered').map(r => `
                  <button class="btn btn-secondary" style="justify-content:flex-start;font-size:12px" onclick="copyToClipboard('${location.origin}/sign/${r.token}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>
                    Copy Link — ${esc(r.name.split(' ')[0])}
                  </button>
                `).join('') : ''}
                ${env.status === 'draft' ? `<button class="btn btn-primary" style="justify-content:flex-start;font-size:12px" onclick="resumeWizard('${env.id}')">Edit &amp; Send</button>` : ''}
                ${env.status === 'sent' ? `<button class="btn" style="justify-content:flex-start;font-size:12px;color:var(--rose);border:1px solid rgba(139,46,46,.2);border-radius:var(--r);padding:7px 15px" onclick="openVoidModal('${env.id}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                  Void Document
                </button>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (err) { toast(err.message, 'error'); }
}

// Back to dashboard handled inline in detail view

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

function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderWizardDocs() {
  document.getElementById('wizard-doc-list').innerHTML = wizard.documents.map((d, i) => `
    <div class="doc-chip">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
      <div class="doc-chip-info">
        <span class="doc-chip-name">${esc(d.title || d.filename)}</span>
        <span class="doc-chip-meta">${d.page_count} page${d.page_count !== 1 ? 's' : ''}${d.file_size ? ' \u00b7 ' + fmtFileSize(d.file_size) : ''}</span>
      </div>
      <button class="doc-chip-remove remove-doc-btn" data-doc-idx="${i}" title="Remove">&times;</button>
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
  el.innerHTML = wizard.recipients.map((r, i) => {
    const color = r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length];
    return `
    <div class="recipient-row-v2">
      <div class="recipient-num" style="background:${color}">${i + 1}</div>
      <select class="recipient-role-select" onchange="updateRecipientRole(${i}, this.value)">
        <option value="signer" ${r.role === 'signer' ? 'selected' : ''}>Needs to Sign</option>
        <option value="cc" ${r.role === 'cc' ? 'selected' : ''}>Receives a Copy</option>
      </select>
      <input type="text" class="recipient-input" value="${esc(r.name)}" placeholder="Full name" readonly>
      <input type="text" class="recipient-input" value="${esc(r.email)}" placeholder="Email" readonly>
      <button class="recipient-remove" onclick="removeRecipient(${i})" title="Remove">&times;</button>
    </div>`;
  }).join('');
  document.getElementById('wizard-next-2').disabled = wizard.recipients.filter(x => x.role === 'signer').length === 0;
}

async function updateRecipientRole(idx, newRole) {
  const r = wizard.recipients[idx];
  try {
    await api(`/api/envelopes/${wizard.envelopeId}/recipients/${r.id}`, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole })
    });
    r.role = newRole;
    renderRecipientsList();
  } catch (err) { toast(err.message, 'error'); }
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
  const summaryEl = document.getElementById('field-count-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `<strong>${wizard.fields.length}</strong> field${wizard.fields.length !== 1 ? 's' : ''} placed`;
  }
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
  const firstSigner = signers[0];
  const senderName = currentUser ? currentUser.name : 'You';

  document.getElementById('review-summary').innerHTML = `
    <div class="review-layout">
      <div>
        <!-- Recipients & Signing Order -->
        <div class="detail-card" style="margin-bottom:16px">
          <div class="detail-card-head"><div style="display:flex;align-items:center;gap:8px"><div class="step-badge">1</div><h3>Recipients &amp; Signing Order</h3></div></div>
          <div class="detail-card-body">
            <div style="display:flex;flex-direction:column;gap:9px;margin-bottom:14px">
              ${signers.map((r, i) => `
                <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface);border-radius:var(--r);border:1px solid var(--border)">
                  <div style="width:22px;height:22px;border-radius:50%;background:${r.color || RECIPIENT_COLORS[i % RECIPIENT_COLORS.length]};color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i + 1}</div>
                  <div style="flex:1"><div style="font-size:13px;font-weight:500;color:var(--ink)">${esc(r.name)}</div><div style="font-size:11px;color:var(--ink4)">${esc(r.email)} &middot; Signer ${i + 1}</div></div>
                </div>
              `).join('')}
            </div>
            ${ccs.length > 0 ? `<div style="font-size:11px;color:var(--ink4);margin-top:8px">CC: ${ccs.map(r => esc(r.name)).join(', ')}</div>` : ''}
          </div>
        </div>
        <!-- Message -->
        <div class="detail-card" style="margin-bottom:16px">
          <div class="detail-card-head"><div style="display:flex;align-items:center;gap:8px"><div class="step-badge">2</div><h3>Message to Signers</h3></div></div>
          <div class="detail-card-body">
            <div style="font-size:13px;font-weight:500;color:var(--ink);margin-bottom:4px">${esc(title)}</div>
            ${message ? `<div style="font-size:12px;color:var(--ink3);line-height:1.5">${esc(message)}</div>` : '<div style="font-size:12px;color:var(--ink4)">No message added</div>'}
          </div>
        </div>
        <!-- Deadline -->
        <div class="detail-card" style="margin-bottom:16px">
          <div class="detail-card-head"><div style="display:flex;align-items:center;gap:8px"><div class="step-badge">3</div><h3>Deadline</h3></div></div>
          <div class="detail-card-body">
            <div style="display:flex;align-items:center;gap:10px">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              <span style="font-size:13px;color:var(--ink3)">No expiration set &mdash; signers can complete at any time</span>
            </div>
          </div>
        </div>
      </div>
      <!-- Email Preview -->
      <div class="email-prev">
        <div class="ep-hdr"><h3>Email Preview</h3></div>
        <div class="ep-body">
          <div class="em-logo">
            <div class="em-logo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" style="width:10px;height:10px"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></div>
            <span class="em-logo-text">Sign</span>
          </div>
          <div class="em-subject">You have a document to sign</div>
          <div class="em-greeting">Hi ${firstSigner ? esc(firstSigner.name.split(' ')[0]) : 'there'},<br><br>${esc(senderName)} has sent you a document to review and sign.</div>
          <div class="em-doc-block">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
            <div>
              <div style="font-size:12px;font-weight:500;color:var(--ink)">${esc(title)}</div>
              <div style="font-size:10px;color:var(--ink4)">${wizard.documents.reduce((s,d) => s + (d.page_count||0), 0)} pages &middot; ${wizard.fields.length} fields to complete</div>
            </div>
          </div>
          <div class="em-cta">Review &amp; Sign Document &rarr;</div>
          <div class="em-footer">Sent securely via Sign</div>
        </div>
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
  // Hide topnav for signing view
  document.getElementById('topnav')?.classList.add('hidden');

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
  const sideBtn = document.getElementById('finish-signing-btn-side');
  if (sideBtn) sideBtn.disabled = filled.length < required.length;

  // Status pill
  const pill = document.getElementById('signing-status-pill');
  if (pill) pill.textContent = `${filled.length} of ${required.length} fields`;

  // Checklist
  const checklistEl = document.getElementById('signing-checklist-items');
  if (checklistEl) {
    checklistEl.innerHTML = signing.data.fields.map(f => {
      const done = f.value ? 'done' : '';
      return `<div class="checklist-item ${done}" data-field-id="${f.id}" onclick="scrollToSigningField('${f.id}')">
        <div class="checklist-check">${f.value ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' : ''}</div>
        <span>${FIELD_LABELS[f.type] || f.type}</span>
      </div>`;
    }).join('');
  }
}

function scrollToSigningField(fieldId) {
  const el = document.querySelector(\`.signing-field[data-field-id="\${fieldId}"]\`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Signature fonts
const SIG_FONTS = [
  { name: 'Dancing Script', family: "'Dancing Script', cursive" },
  { name: 'Great Vibes', family: "'Great Vibes', cursive" },
  { name: 'Alex Brush', family: "'Alex Brush', cursive" },
  { name: 'Sacramento', family: "'Sacramento', cursive" },
  { name: 'Pacifico', family: "'Pacifico', cursive" },
  { name: 'Caveat', family: "'Caveat', cursive" },
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
  canvasCtx.strokeStyle = '#1a4a72';
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
document.getElementById('finish-signing-btn-side')?.addEventListener('click', () => {
  document.getElementById('finish-signing-btn').click();
});
document.getElementById('finish-signing-btn').addEventListener('click', async () => {
  try {
    await api(`/api/sign/${signing.token}/complete`, { method: 'POST' });
    showView('signing-done-view');
    document.getElementById('done-title').textContent = 'Document Signed!';
    document.getElementById('done-message').textContent = 'Thank you. The document owner will be notified.';
    document.querySelector('.done-icon').textContent = '\u2713';
    document.querySelector('.done-icon').style.background = '#0a6b5c';
    document.querySelector('.done-icon').style.color = '#fff';
    // Summary
    const summary = document.getElementById('done-summary');
    if (summary && signing.data) {
      const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      summary.innerHTML = `Signed "${esc(signing.data.envelope_title)}" on ${now}`;
      summary.style.display = '';
    }
    // Download button
    const dlBtn = document.getElementById('done-download-btn');
    if (dlBtn && signing.data) {
      dlBtn.style.display = '';
      dlBtn.onclick = () => {
        const docId = signing.data.documents[0]?.id;
        if (docId) window.open(`/api/sign/${signing.token}/documents/${docId}/pdf`, '_blank');
      };
    }
    // Email note
    const emailNote = document.getElementById('done-email-note');
    if (emailNote) emailNote.style.display = '';
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
          <div><span class="status-badge status-${e.status || 'draft'}">${e.status || 'draft'}</span></div>
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

// ==================== Templates View ====================
async function loadTemplatesView() {
  try {
    const envs = await api('/api/envelopes?status=completed');
    const el = document.getElementById('templates-recent-list');
    if (envs.length === 0) {
      el.innerHTML = '<p style="color:var(--ink3);font-size:13px;">No completed envelopes to save as templates yet.</p>';
      return;
    }
    el.innerHTML = envs.slice(0, 3).map(e => `
      <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r-lg);padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px">
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--ink)">${esc(e.title)}</div>
          <div style="font-size:11px;color:var(--ink4);margin-top:2px">Completed ${fmtDateShort(e.completed_at || e.updated_at)}</div>
        </div>
        <button class="btn btn-secondary" style="font-size:12px;flex-shrink:0" onclick="toast('Template feature coming soon', 'info')">Save as Template</button>
      </div>
    `).join('');
  } catch (err) { console.error(err); }
}

// ==================== Reports View ====================
async function loadReportsView() {
  try {
    const stats = currentUser.role === 'admin' ? await api('/api/admin/stats') : null;
    const envs = await api('/api/envelopes');

    const total = envs.length;
    const completed = envs.filter(e => e.status === 'completed').length;
    const sent = envs.filter(e => e.status === 'sent').length;
    const declined = envs.filter(e => e.status === 'declined' || e.status === 'voided').length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const inProgress = total > 0 ? Math.round((sent / total) * 100) : 0;
    const declinedRate = total > 0 ? Math.round((declined / total) * 100) : 0;

    document.getElementById('reports-stats').innerHTML = `
      <div class="stat-card"><div class="stat-label">Total Envelopes</div><div class="stat-value">${total}</div></div>
      <div class="stat-card"><div class="stat-label">Completion Rate</div><div class="stat-value">${rate}%</div></div>
      <div class="stat-card"><div class="stat-label">In Progress</div><div class="stat-value">${sent}</div></div>
      <div class="stat-card"><div class="stat-label">Declined / Voided</div><div class="stat-value" style="color:var(--rose)">${declined}</div></div>
    `;

    document.getElementById('reports-charts').innerHTML = `
      <div class="detail-card" style="margin-bottom:16px">
        <div class="detail-card-head"><h3>Envelope Success Rate</h3></div>
        <div class="detail-card-body">
          <div class="rate-cards">
            <div class="rate-card" style="background:var(--teal-light)"><div class="rate-card-val" style="color:var(--teal)">${rate}%</div><div class="rate-card-lbl" style="color:var(--teal)">Success Rate</div></div>
            <div class="rate-card" style="background:var(--gold-light)"><div class="rate-card-val" style="color:var(--gold)">${inProgress}%</div><div class="rate-card-lbl" style="color:var(--gold)">In Progress</div></div>
            <div class="rate-card" style="background:var(--rose-light)"><div class="rate-card-val" style="color:var(--rose)">${declinedRate}%</div><div class="rate-card-lbl" style="color:var(--rose)">Declined / Void</div></div>
          </div>
        </div>
      </div>
    `;
  } catch (err) { console.error(err); }
}

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
