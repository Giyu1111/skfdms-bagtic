(function () {
  var storageKey = 'sk-dark';
  var darkIcon = '☀️';
  var lightIcon = '🌙';

  var isAjaxNavigating = false;

  function cleanPagePath(pathname) {
    if (!pathname) return '/';

    var cleanPath = pathname.replace(/\/+$/, '') || '/';
    if (cleanPath === '/index.html' || cleanPath === '/index') return '/';
    if (/\/index\.html$/i.test(cleanPath)) return cleanPath.replace(/\/index\.html$/i, '') || '/';
    if (/\.html$/i.test(cleanPath)) return cleanPath.replace(/\.html$/i, '') || '/';
    return cleanPath;
  }

  function pageHtmlPath(pathname) {
    var cleanPath = (pathname || '/').replace(/\/+$/, '') || '/';

    if (cleanPath === '/') return '/index.html';
    if (/\.html$/i.test(cleanPath)) return cleanPath;

    var lastSegment = cleanPath.substring(cleanPath.lastIndexOf('/') + 1);
    if (lastSegment.indexOf('.') !== -1) return '';
    if (cleanPath.indexOf('/api') === 0 || cleanPath.indexOf('/uploads') === 0) return '';

    return cleanPath + '.html';
  }

  function cleanUrl(url) {
    var cleanPath = cleanPagePath(url.pathname);
    return cleanPath + url.search + url.hash;
  }

  function sameOriginPageUrl(href) {
    if (!href || href.charAt(0) === '#') return null;

    var url;
    try {
      url = new URL(href, window.location.href);
    } catch (error) {
      return null;
    }

    if (url.origin !== window.location.origin) return null;
    if (!pageHtmlPath(url.pathname)) return null;
    return url;
  }

  function fetchUrlForPage(url) {
    return pageHtmlPath(url.pathname) + url.search + url.hash;
  }

  function isAdminPageUrl(url) {
    return cleanPagePath(url.pathname).indexOf('/pages/admin/') === 0;
  }

  function normalizeVisibleUrl() {
    if (!window.history || !window.history.replaceState || window.location.protocol === 'file:') return;

    var url = sameOriginPageUrl(window.location.href);
    if (!url) return;

    var current = window.location.pathname + window.location.search + window.location.hash;
    var clean = cleanUrl(url);
    if (current !== clean) {
      window.history.replaceState({ skfdmsPage: fetchUrlForPage(url) }, '', clean);
    }
  }

  function writeFetchedDocument(html) {
    document.open();
    document.write(html);
    document.close();
  }

  function loadPage(url, shouldPush) {
    if (isAjaxNavigating || window.location.protocol === 'file:' || isAdminPageUrl(url)) {
      window.location.href = cleanUrl(url);
      return;
    }

    isAjaxNavigating = true;

    fetch(fetchUrlForPage(url), {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
      .then(function (response) {
        if (!response.ok) throw new Error('Page not found');
        return response.text();
      })
      .then(function (html) {
        if (shouldPush && window.history && window.history.pushState) {
          window.history.pushState({ skfdmsPage: fetchUrlForPage(url) }, '', cleanUrl(url));
        }
        writeFetchedDocument(html);
      })
      .catch(function () {
        window.location.href = cleanUrl(url);
      })
      .finally(function () {
        isAjaxNavigating = false;
      });
  }

  function shouldHandleAjaxClick(event, link) {
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.target && link.target !== '_self') return false;
    if (link.hasAttribute('download')) return false;
    return true;
  }

  function bindAjaxNavigation() {
    normalizeVisibleUrl();

    document.addEventListener('click', function (event) {
      var link = event.target.closest ? event.target.closest('a[href]') : null;
      if (!link || !shouldHandleAjaxClick(event, link)) return;

      var url = sameOriginPageUrl(link.getAttribute('href'));
      if (!url) return;

      var currentClean = cleanPagePath(window.location.pathname) + window.location.search + window.location.hash;
      var nextClean = cleanUrl(url);
      if (currentClean === nextClean) return;

      event.preventDefault();
      loadPage(url, true);
    });

    window.addEventListener('popstate', function () {
      var url = sameOriginPageUrl(window.location.href);
      if (url) loadPage(url, false);
    });
  }

  function getSavedMode() {
    var saved = localStorage.getItem(storageKey);
    if (saved === '1') return true;
    if (saved === '0') return false;
    return document.body && document.body.dataset.defaultTheme === 'dark';
  }

  function updateToggleButtons(isDark) {
    document.querySelectorAll('.dark-toggle').forEach(function (button) {
      button.innerHTML = isDark ? darkIcon : lightIcon;
      button.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      button.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
      button.setAttribute('aria-label', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    });
  }

  function applyMode(isDark, shouldSave) {
    document.body.classList.toggle('dark', isDark);
    updateToggleButtons(isDark);

    if (shouldSave) {
      localStorage.setItem(storageKey, isDark ? '1' : '0');
    }
  }

  window.toggleDark = function () {
    applyMode(!document.body.classList.contains('dark'), true);
  };

  function createToggleButton() {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'dark-toggle admin-theme-toggle';
    button.addEventListener('click', window.toggleDark);
    return button;
  }

  function createNotificationButton() {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-message-button';
    button.setAttribute('aria-label', 'Open contact messages');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('title', 'Contact messages');
    button.innerHTML = '<span class="admin-message-icon">&#9993;</span><span class="admin-message-dot" aria-hidden="true"></span><span class="admin-message-count" aria-hidden="true"></span>';
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleAdminMessagePopup();
    });
    return button;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function messageSender(message) {
    return [message.first_name, message.last_name].filter(Boolean).join(' ') || 'Unknown sender';
  }

  function formatMessageDate(value) {
    if (!value) return '';
    var date = new Date(value);
    var today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  }

  function ensureAdminMessagePopup() {
    var popup = document.getElementById('adminMessagePopup');
    if (popup) return popup;

    popup = document.createElement('div');
    popup.id = 'adminMessagePopup';
    popup.className = 'admin-message-popup';
    popup.innerHTML =
      '<div class="admin-message-popup-head">' +
        '<div><strong>Contact Messages</strong><span id="adminMessageSummary">Loading...</span></div>' +
        '<button type="button" class="admin-message-close" aria-label="Close messages">&times;</button>' +
      '</div>' +
      '<div class="admin-message-popup-list" id="adminMessageList">' +
        '<div class="admin-message-empty">Loading messages...</div>' +
      '</div>';
    document.body.appendChild(popup);

    popup.querySelector('.admin-message-close').addEventListener('click', closeAdminMessagePopup);
    popup.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    return popup;
  }

  function closeAdminMessagePopup() {
    var popup = document.getElementById('adminMessagePopup');
    if (popup) popup.classList.remove('is-open');
    document.querySelectorAll('.admin-message-button').forEach(function (button) {
      button.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleAdminMessagePopup() {
    var popup = ensureAdminMessagePopup();
    var willOpen = !popup.classList.contains('is-open');
    popup.classList.toggle('is-open', willOpen);
    document.querySelectorAll('.admin-message-button').forEach(function (button) {
      button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    if (willOpen) loadAdminMessages();
  }

  function updateNotificationButton(count) {
    document.querySelectorAll('.admin-message-button').forEach(function (button) {
      var dot = button.querySelector('.admin-message-dot');
      var badge = button.querySelector('.admin-message-count');
      var hasUnread = Number(count) > 0;
      button.classList.toggle('has-unread', hasUnread);
      if (dot) dot.style.display = hasUnread ? '' : 'none';
      if (badge) {
        badge.textContent = hasUnread ? String(Math.min(Number(count), 99)) : '';
        badge.style.display = hasUnread ? '' : 'none';
      }
    });
  }

  function renderAdminMessages(messages) {
    var list = document.getElementById('adminMessageList');
    var summary = document.getElementById('adminMessageSummary');
    if (!list || !summary) return;

    var unreadCount = messages.filter(function (message) { return !message.is_read; }).length;
    summary.textContent = messages.length + ' total, ' + unreadCount + ' unread';
    updateNotificationButton(unreadCount);

    if (!messages.length) {
      list.innerHTML = '<div class="admin-message-empty">No contact messages yet.</div>';
      return;
    }

    list.innerHTML = messages.map(function (message) {
      var sender = messageSender(message);
      var replySubject = encodeURIComponent('Re: ' + (message.subject || 'Contact message'));
      return '<article class="admin-message-card ' + (message.is_read ? '' : 'is-unread') + '" data-id="' + escapeHtml(message.id) + '">' +
        '<div class="admin-message-card-top">' +
          '<div><strong>' + escapeHtml(sender) + '</strong><span>' + escapeHtml(message.email) + '</span></div>' +
          '<time>' + escapeHtml(formatMessageDate(message.created_at)) + '</time>' +
        '</div>' +
        '<div class="admin-message-subject">' + escapeHtml(message.subject) + '</div>' +
        '<p>' + escapeHtml(message.message) + '</p>' +
        '<div class="admin-message-card-foot">' +
          '<span>' + escapeHtml(message.barangay_name || 'Barangay') + '</span>' +
          '<div>' +
            (message.is_read ? '' : '<button type="button" class="admin-message-read-btn" data-id="' + escapeHtml(message.id) + '">Mark read</button>') +
            '<a href="mailto:' + encodeURIComponent(message.email) + '?subject=' + replySubject + '">Reply</a>' +
            '<button type="button" class="admin-message-delete-btn" data-id="' + escapeHtml(message.id) + '" aria-label="Delete message" title="Delete message"><span class="ui-icon ui-icon-trash" aria-hidden="true"></span></button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    list.querySelectorAll('.admin-message-read-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        markAdminMessageRead(button.getAttribute('data-id'));
      });
    });

    list.querySelectorAll('.admin-message-delete-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        deleteAdminMessage(button.getAttribute('data-id'));
      });
    });
  }

  function loadAdminMessages() {
    var list = document.getElementById('adminMessageList');
    if (list) list.innerHTML = '<div class="admin-message-empty">Loading messages...</div>';
    if (window.location.protocol === 'file:') {
      renderAdminMessages([]);
      return;
    }

    fetch(window.location.origin + '/api/admin/contact-messages', { credentials: 'include' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (result) {
        renderAdminMessages(result && result.success && Array.isArray(result.data) ? result.data : []);
      })
      .catch(function () {
        if (list) list.innerHTML = '<div class="admin-message-empty">Unable to load messages.</div>';
      });
  }

  function markAdminMessageRead(id) {
    fetch(window.location.origin + '/api/admin/contact-messages/' + encodeURIComponent(id) + '/read', {
      method: 'PATCH',
      credentials: 'include'
    })
      .then(function () {
        loadAdminMessages();
        refreshAdminNotifications();
      })
      .catch(function () {
        loadAdminMessages();
      });
  }

  function deleteAdminMessage(id) {
    if (!id || !confirm('Delete this message?')) return;

    fetch(window.location.origin + '/api/admin/contact-messages/' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'include'
    })
      .then(function () {
        loadAdminMessages();
        refreshAdminNotifications();
      })
      .catch(function () {
        loadAdminMessages();
      });
  }

  function refreshAdminNotifications() {
    if (!document.querySelector('.admin-message-button') || window.location.protocol === 'file:') return;

    fetch(window.location.origin + '/api/admin/contact-messages/unread-count', { credentials: 'include' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (result) {
        if (result && result.success) updateNotificationButton(result.count || 0);
      })
      .catch(function () {
        updateNotificationButton(0);
      });
  }

  function ensureAdminToggle() {
    document.querySelectorAll('.admin-topbar, .topbar').forEach(function (topbar) {
      if (topbar.querySelector('.dark-toggle') && topbar.querySelector('.admin-message-button')) return;

      var button = createToggleButton();
      var notification = createNotificationButton();
      var actions = topbar.querySelector('.topbar-actions');

      if (actions) {
        if (!actions.querySelector('.admin-message-button')) actions.insertBefore(notification, actions.firstChild);
        if (!actions.querySelector('.dark-toggle')) {
          var existingNotification = actions.querySelector('.admin-message-button');
          actions.insertBefore(button, existingNotification ? existingNotification.nextSibling : actions.firstChild);
        }
        return;
      }

      var topbarChildren = Array.prototype.slice.call(topbar.children);
      var actionChildren = topbarChildren.filter(function (child) {
        return !child.classList.contains('topbar-left');
      });

      if (actionChildren.length === 1 && actionChildren[0].tagName === 'DIV') {
        actionChildren[0].classList.add('topbar-actions');
        actionChildren[0].insertBefore(notification, actionChildren[0].firstChild);
        actionChildren[0].insertBefore(button, notification.nextSibling);
        return;
      }

      actions = document.createElement('div');
      actions.className = 'topbar-actions';
      topbar.appendChild(actions);
      actions.appendChild(notification);
      actions.appendChild(button);
      actionChildren.forEach(function (child) {
        actions.appendChild(child);
      });
    });
  }

  function getCachedAdminUser() {
    try {
      var cached = JSON.parse(sessionStorage.getItem('skfdms_current_user') || 'null');
      if (!cached) return null;
      if (cached.user && cached.cached_at) return cached.user;
      return null;
    } catch (error) {
      return null;
    }
  }

  function normalizeAdminHref(href) {
    if (!href) return '';
    var cleanHref = href.split('#')[0].split('?')[0];
    var pageName = cleanHref.substring(cleanHref.lastIndexOf('/') + 1);
    return pageName.replace(/\.html$/i, '');
  }

  function applyAdminSidebarState(user) {
    var nav = document.getElementById('sidebarNav');
    if (!nav) return;

    var role = user && user.role;
    var currentPage = normalizeAdminHref(window.location.pathname);
    var pendingPage = normalizeAdminHref(sessionStorage.getItem('skfdms_pending_admin_page') || '');
    var links = nav.querySelectorAll('a');

    links.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      var linkPage = normalizeAdminHref(href);
      var roleAttr = link.getAttribute('data-role');
      var span = link.querySelector('span:last-child');

      if (linkPage && (linkPage === pendingPage || linkPage === currentPage)) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }

      if (role && roleAttr) {
        var allowed = roleAttr.split(',');
        link.style.display = allowed.indexOf(role) === -1 ? 'none' : '';
      }

      if (!span || !role) return;

      if (role === 'chairperson') {
        if (linkPage === 'documents') span.textContent = 'My Documents';
        if (linkPage === 'transparency') span.textContent = 'My Accomplishments';
        if (linkPage === 'announcements') span.textContent = 'Post Announcements';
      } else if (role === 'admin') {
        if (linkPage === 'documents') span.textContent = 'Manage Documents';
        if (linkPage === 'transparency') span.textContent = 'Manage Accomplishments';
        if (linkPage === 'upload') link.style.display = 'none';
      }
    });

    if (pendingPage && pendingPage === currentPage) {
      sessionStorage.removeItem('skfdms_pending_admin_page');
    }
  }

  function bindAdminSidebarClicks() {
    var nav = document.getElementById('sidebarNav');
    if (!nav) return;

    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        var linkPage = normalizeAdminHref(link.getAttribute('href') || '');
        if (linkPage) sessionStorage.setItem('skfdms_pending_admin_page', linkPage);

        nav.querySelectorAll('a').forEach(function (item) {
          item.classList.remove('active');
        });
        link.classList.add('active');
      });
    });
  }

  function initTheme() {
    bindAjaxNavigation();
    applyAdminSidebarState(getCachedAdminUser());
    bindAdminSidebarClicks();
    ensureAdminToggle();
    applyMode(getSavedMode(), false);
    refreshAdminNotifications();
    if (document.querySelector('.admin-message-button')) {
      window.setInterval(refreshAdminNotifications, 30000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  document.addEventListener('click', closeAdminMessagePopup);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeAdminMessagePopup();
  });

  window.addEventListener('skfdms:user', function (event) {
    applyAdminSidebarState(event.detail);
  });

  window.addEventListener('storage', function (event) {
    if (event.key === storageKey) {
      applyMode(event.newValue === '1', false);
    }
  });
})();
