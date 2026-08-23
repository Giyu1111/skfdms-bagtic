// ============================================================
// frontend/js/api.js
// Centralized API client — uses same host/port as the page
// ============================================================

// Automatically uses whatever port the page is served from
const API_BASE = window.location.origin + '/api';
const AUTH_CACHE_KEY = 'skfdms_current_user';
const AUTH_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readAuthCache() {
  try {
    return JSON.parse(sessionStorage.getItem(AUTH_CACHE_KEY) || localStorage.getItem(AUTH_CACHE_KEY) || 'null');
  } catch (err) {
    return null;
  }
}

function writeAuthCache(value) {
  const serialized = JSON.stringify(value);
  sessionStorage.setItem(AUTH_CACHE_KEY, serialized);
  localStorage.setItem(AUTH_CACHE_KEY, serialized);
}

function clearAuthCache() {
  sessionStorage.removeItem(AUTH_CACHE_KEY);
  localStorage.removeItem(AUTH_CACHE_KEY);
}

function isFreshAuthCache(cached) {
  return cached && cached.user && cached.cached_at && Date.now() - cached.cached_at < AUTH_CACHE_MAX_AGE_MS;
}

function getStoredAuthToken() {
  const cached = readAuthCache();
  return cached && cached.token ? cached.token : '';
}

function withAuthHeader(headers = {}) {
  const nextHeaders = headers instanceof Headers ? Object.fromEntries(headers.entries()) : { ...headers };
  const token = getStoredAuthToken();
  if (token) nextHeaders['X-SKFDMS-Auth'] = token;
  return nextHeaders;
}

const nativeFetch = window.fetch.bind(window);
window.fetch = function(input, options = {}) {
  const url = typeof input === 'string' ? new URL(input, window.location.href) : new URL(input.url, window.location.href);
  if (url.origin === window.location.origin && url.pathname.indexOf('/api/') === 0) {
    options = { ...options, headers: withAuthHeader(options.headers) };
  }
  return nativeFetch(input, options);
};

async function apiFetch(endpoint, options = {}) {
  const defaultOpts = {
    credentials: 'include',
    headers: withAuthHeader({ 'Content-Type': 'application/json', ...options.headers }),
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
  update:        (id, data)  => apiFetch(`/admin/documents/${id}`,        { method: 'PATCH',  body: JSON.stringify(data) }),
  togglePublish: (id)       => apiFetch(`/admin/documents/${id}/publish`,{ method: 'PATCH' }),
  delete:        (id)       => apiFetch(`/admin/documents/${id}`,        { method: 'DELETE' }),
  downloadUrl:   (id)       => `${API_BASE}/documents/${id}/download`,
  stats:         ()         => apiFetch('/admin/stats'),
};

const FundProofs = {
  listPublic: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/fund-proofs${qs ? '?' + qs : ''}`);
  },
  listAdmin: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/admin/fund-proofs${qs ? '?' + qs : ''}`);
  },
  upload: (formData, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/admin/fund-proofs${qs ? '?' + qs : ''}`, { method: 'POST', body: formData });
  },
  togglePublish: (id, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/admin/fund-proofs/${id}/publish${qs ? '?' + qs : ''}`, { method: 'PATCH' });
  },
  delete: (id, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/admin/fund-proofs/${id}${qs ? '?' + qs : ''}`, { method: 'DELETE' });
  },
  downloadUrl: (id) => `${API_BASE}/fund-proofs/${id}/download`,
};

const Categories = {
  list: () => apiFetch('/categories'),
};

const Users = {
  list:         ()     => apiFetch('/admin/users'),
  create:       (data) => apiFetch('/admin/users',              { method: 'POST',  body: JSON.stringify(data) }),
  toggleActive: (id)   => apiFetch(`/admin/users/${id}/toggle`, { method: 'PATCH' }),
  review:       (id, decision) => apiFetch(`/admin/users/${id}/approval`, { method: 'PATCH', body: JSON.stringify({ decision }) }),
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

const ContactMessages = {
  create: (data) => apiFetch('/contact-messages', { method: 'POST', body: JSON.stringify(data) }),
  listAdmin: () => apiFetch('/admin/contact-messages'),
  unreadCount: () => apiFetch('/admin/contact-messages/unread-count'),
  markRead: (id) => apiFetch(`/admin/contact-messages/${id}/read`, { method: 'PATCH' }),
};

function showAlert(containerId, message, type = 'info') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const icons = { success: 'check', danger: 'x', info: 'info' };
  const iconName = icons[type];
  const iconHtml = iconName ? '<span class="ui-icon ui-icon-' + iconName + '" aria-hidden="true"></span>' : '';
  el.innerHTML = '<div class="alert alert-' + type + '">' + iconHtml + ' ' + message + '</div>';
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
  const cachedBeforeCheck = readAuthCache();
  const { ok, data } = await Auth.me();
  if (!ok || !data.success) {
    if (isFreshAuthCache(cachedBeforeCheck)) return cachedBeforeCheck.user;
    clearAuthCache();
    window.location.href = '/pages/login';
    return null;
  }
  const cachedToken = getStoredAuthToken();
  writeAuthCache({
    user: data.user,
    token: cachedToken,
    cached_at: Date.now()
  });
  window.dispatchEvent(new CustomEvent('skfdms:user', { detail: data.user }));
  return data.user;
}

async function logoutAndRedirect(target = '/') {
  await Auth.logout();
  clearAuthCache();
  window.location.href = target;
}

window.SkFDMS = {
  Auth,
  Documents,
  FundProofs,
  Categories,
  Users,
  Announcements,
  ActivityLogs,
  ContactMessages,
  showAlert,
  formatDate,
  formatFileSize,
  requireLogin,
  logoutAndRedirect,
};
