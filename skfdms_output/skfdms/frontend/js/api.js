// ============================================================
// frontend/js/api.js
// Centralized API client — uses same host/port as the page
// ============================================================

// Automatically uses whatever port the page is served from
const API_BASE = window.location.origin + '/api';

async function apiFetch(endpoint, options = {}) {
  const defaultOpts = {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  };

  if (options.body instanceof FormData) {
    delete defaultOpts.headers['Content-Type'];
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, { ...defaultOpts, ...options });
    const data = await response.json().catch(() => ({ success: false, message: 'Invalid response' }));
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    console.error('API fetch error:', err);
    return {
      ok: false,
      status: 0,
      data: { success: false, message: 'Cannot connect to server. Make sure backend is running.' }
    };
  }
}

const Auth = {
  login:  (email, password) => apiFetch('/auth/login',  { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: ()                 => apiFetch('/auth/logout', { method: 'POST' }),
  me:     ()                 => apiFetch('/auth/me'),
};

const Documents = {
  listPublic: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/documents${qs ? '?' + qs : ''}`);
  },
  listAdmin: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/admin/documents${qs ? '?' + qs : ''}`);
  },
  upload:        (formData) => apiFetch('/admin/documents',              { method: 'POST',   body: formData }),
  togglePublish: (id)       => apiFetch(`/admin/documents/${id}/publish`,{ method: 'PATCH' }),
  delete:        (id)       => apiFetch(`/admin/documents/${id}`,        { method: 'DELETE' }),
  downloadUrl:   (id)       => `${API_BASE}/documents/${id}/download`,
  stats:         ()         => apiFetch('/admin/stats'),
};

const Categories = {
  list: () => apiFetch('/categories'),
};

const Users = {
  list:         ()     => apiFetch('/admin/users'),
  create:       (data) => apiFetch('/admin/users',              { method: 'POST',  body: JSON.stringify(data) }),
  toggleActive: (id)   => apiFetch(`/admin/users/${id}/toggle`, { method: 'PATCH' }),
};

const Announcements = {
  listPublic: ()     => apiFetch('/announcements'),
  listAdmin:  ()     => apiFetch('/admin/announcements'),
  create:     (data) => apiFetch('/admin/announcements',    { method: 'POST',   body: JSON.stringify(data) }),
  delete:     (id)   => apiFetch(`/admin/announcements/${id}`, { method: 'DELETE' }),
};

const ActivityLogs = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/admin/activity-logs${qs ? '?' + qs : ''}`);
  },
};

function showAlert(containerId, message, type = 'info') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const icons = { success: '✅', danger: '❌', info: 'ℹ️' };
  el.innerHTML = `<div class="alert alert-${type}">${icons[type] || ''} ${message}</div>`;
  setTimeout(() => { if (el) el.innerHTML = ''; }, 5000);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatFileSize(kb) {
  if (!kb) return '—';
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

async function requireLogin() {
  const { ok, data } = await Auth.me();
  if (!ok || !data.success) {
    window.location.href = '/pages/login.html';
    return null;
  }
  return data.user;
}

window.SkFDMS = { Auth, Documents, Categories, Users, Announcements, ActivityLogs, showAlert, formatDate, formatFileSize, requireLogin };
