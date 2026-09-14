window.SkBarangay = (function() {
  let allBarangays = [];
  let selectedId = null;
  let currentUser = null;
  const LOGO_MIN_WIDTH = 256;
  const LOGO_MIN_HEIGHT = 256;
  const LOGO_MAX_BYTES = 5 * 1024 * 1024;

  async function init(user) {
    currentUser = user;
    if (user.role === 'admin') {
      try {
        const res = await fetch('/api/barangays');
        const data = await res.json();
        if (data.success) {
          allBarangays = data.data;
          // Restore last selected barangay from localStorage or default to all barangays
          const saved = localStorage.getItem('skfdms_selected_barangay');
          selectedId = saved && (saved === 'all' || allBarangays.find(b => b.id == saved)) ? saved : 'all';
        }
      } catch (e) {
        console.error('Failed to load barangays', e);
        selectedId = 'all';
      }
    } else {
      selectedId = user.barangay_id;
    }
  }

  function getSelectedBarangayId() {
    return selectedId;
  }

  function setSelectedBarangayId(id) {
    if (currentUser && currentUser.role === 'admin') {
      selectedId = id;
      localStorage.setItem('skfdms_selected_barangay', id);
      updateSidebarCaption();
    }
  }

  function getBarangayName(id) {
    if (id === 'all') return 'All Barangays';
    const found = allBarangays.find(b => b.id == id);
    return found ? found.name : '';
  }

  function populateDropdown(selectElement) {
    selectElement.innerHTML = '';
    selectElement.classList.toggle('barangay-select-locked', currentUser.role !== 'admin');
    if (currentUser.role === 'admin') {
      const allOpt = document.createElement('option');
      allOpt.value = 'all';
      allOpt.textContent = 'All Barangays';
      selectElement.appendChild(allOpt);

      allBarangays.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name;
        selectElement.appendChild(opt);
      });
      selectElement.value = selectedId || 'all';
      selectElement.disabled = false;
    } else {
      const opt = document.createElement('option');
      opt.value = selectedId;
      opt.textContent = currentUser?.barangay || 'Your Barangay';
      selectElement.appendChild(opt);
      selectElement.disabled = true;
    }
    updateSidebarCaption();
  }

  function getSelectedBarangayName() {
    return getBarangayName(selectedId) || currentUser?.barangay || '';
  }

  function updateSidebarCaption() {
    const logo = document.querySelector('.sidebar-logo, .sb-logo');
    if (!logo) return;
    const caption = logo.querySelector('#sidebarCaption, #sidebarBarangayText, p');
    if (caption) caption.remove();
  }

  function sidebarInitials(name) {
    return String(name || 'SK')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('') || 'SK';
  }

  function sidebarImageUrl(profileImage) {
    const value = String(profileImage || '').trim();
    if (!value) return '';
    if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) return value;
    return '/uploads/' + value.replace(/^\/+/, '');
  }

  function attrEscape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  }

  function renderSidebarUser(user, roleText) {
    const box = document.querySelector('.sidebar-user, .sb-user');
    if (!box || !user) return;
    currentUser = Object.assign({}, currentUser || {}, user);

    let avatar = box.querySelector('.sidebar-user-avatar');
    if (!avatar) {
      avatar = document.createElement('div');
      avatar.className = 'sidebar-user-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      box.insertBefore(avatar, box.firstChild);
    }

    const isAdmin = user.role === 'admin';
    const initials = isAdmin ? 'A' : sidebarInitials(user.barangay || user.name);
    const src = isAdmin ? '/images/cLogo.jpg' : sidebarImageUrl(user.profile_image);
    avatar.innerHTML = src
      ? '<img src="' + attrEscape(src) + '" alt="">'
      : '<span>' + initials + '</span>';

    const img = avatar.querySelector('img');
    if (img) {
      img.addEventListener('error', function() {
        avatar.innerHTML = '<span>' + initials + '</span>';
      }, { once: true });
    }

    const name = box.querySelector('#sName, #sidebarName, .uname, .sb-uname');
    const role = box.querySelector('#sRole, #sidebarRole, .urole, .sb-role');
    if (name) name.textContent = user.name || 'SK Official';
    if (role) role.textContent = roleText || user.role || '';
    ensureDocumentMenu(user);
    ensureAccomplishmentMenu(user);
    ensureAccountLink(user);
    updateEditableSidebarLogo(user);
  }

  function ensureAccountLink(user) {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    const existing = nav.querySelector('a[href="my-account.html"]');
    if (!user || user.role !== 'chairperson') {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const link = document.createElement('a');
    link.href = 'my-account.html';
    link.dataset.role = 'chairperson';
    link.innerHTML = '<span class="nav-icon" aria-hidden="true">&#9881;</span><span>My Account</span>';
    if (window.location.pathname.endsWith('/my-account.html')) link.classList.add('active');
    const logout = nav.querySelector('.sidebar-logout-link');
    nav.insertBefore(link, logout || null);
  }

  function ensureDocumentMenu(user) {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    const existing = nav.querySelector('.document-nav-submenu');
    const documentsLink = nav.querySelector('a[href="documents.html"]');
    if (!documentsLink || !user || user.role !== 'admin') {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    documentsLink.href = '#';
    documentsLink.classList.remove('active');
    documentsLink.classList.add('document-nav-toggle');
    const documentsLabel = documentsLink.querySelector('span:last-child');
    if (documentsLabel) {
      documentsLabel.classList.add('document-nav-label');
      documentsLabel.insertAdjacentHTML('afterend', '<span class="nav-dropdown-arrow" aria-hidden="true"></span>');
    }
    documentsLink.setAttribute('aria-expanded', 'false');
    documentsLink.setAttribute('aria-controls', 'documentNavSubmenu');
    documentsLink.addEventListener('click', function(event) {
      event.preventDefault();
      const expanded = documentsLink.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        documentsLink.setAttribute('aria-expanded', 'false');
        submenu.hidden = true;
        return;
      }
      nav.querySelectorAll('.document-nav-submenu').forEach(function(menu) {
        if (menu !== submenu) menu.hidden = true;
      });
      nav.querySelectorAll('.document-nav-toggle').forEach(function(toggle) {
        if (toggle !== documentsLink) toggle.setAttribute('aria-expanded', 'false');
      });
      documentsLink.setAttribute('aria-expanded', 'true');
      submenu.hidden = false;
    });

    const submenu = document.createElement('div');
    submenu.id = 'documentNavSubmenu';
    submenu.className = 'document-nav-submenu';
    submenu.hidden = !window.location.pathname.endsWith('/documents.html');
    submenu.innerHTML = '<a href="documents.html?view=published"><span class="document-submenu-icon document-submenu-icon-published" aria-hidden="true"></span><span>Published</span></a>'
      + '<a href="documents.html?view=requests"><span class="document-submenu-icon document-submenu-icon-request" aria-hidden="true"></span><span>Request</span></a>';
    const selectDocumentView = function(view) {
      submenu.querySelectorAll('a[href]').forEach(function(item) {
        item.classList.toggle('is-selected', new URL(item.href).searchParams.get('view') === view);
      });
    };
    selectDocumentView(new URLSearchParams(window.location.search).get('view') || 'published');
    if (!submenu.hidden) documentsLink.setAttribute('aria-expanded', 'true');
    submenu.addEventListener('click', function(event) {
      const link = event.target.closest('a[href]');
      if (!link) return;
      const view = new URL(link.href).searchParams.get('view');
      if (!view || typeof window.setDocumentView !== 'function') return;
      event.preventDefault();
      history.replaceState(null, '', link.href);
      selectDocumentView(view);
      window.setDocumentView(view);
      documentsLink.setAttribute('aria-expanded', 'false');
      submenu.hidden = true;
    });
    documentsLink.insertAdjacentElement('afterend', submenu);
  }

  function ensureAccomplishmentMenu(user) {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    const existing = nav.querySelector('.accomplishment-nav-submenu');
    const link = nav.querySelector('a[href="transparency.html"]');
    if (!link || !user || user.role !== 'admin') {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    link.href = '#';
    link.classList.remove('active');
    link.classList.add('document-nav-toggle', 'accomplishment-nav-toggle');
    const label = link.querySelector('span:last-child');
    if (label) {
      label.classList.add('document-nav-label');
      label.insertAdjacentHTML('afterend', '<span class="nav-dropdown-arrow" aria-hidden="true"></span>');
    }
    link.setAttribute('aria-expanded', 'false');
    link.setAttribute('aria-controls', 'accomplishmentNavSubmenu');
    link.addEventListener('click', function(event) {
      event.preventDefault();
      const expanded = link.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        link.setAttribute('aria-expanded', 'false');
        submenu.hidden = true;
        return;
      }
      nav.querySelectorAll('.document-nav-submenu').forEach(function(menu) {
        if (menu !== submenu) menu.hidden = true;
      });
      nav.querySelectorAll('.document-nav-toggle').forEach(function(toggle) {
        if (toggle !== link) toggle.setAttribute('aria-expanded', 'false');
      });
      link.setAttribute('aria-expanded', 'true');
      submenu.hidden = false;
    });

    const submenu = document.createElement('div');
    submenu.id = 'accomplishmentNavSubmenu';
    submenu.className = 'document-nav-submenu accomplishment-nav-submenu';
    submenu.hidden = !window.location.pathname.endsWith('/transparency.html');
    submenu.innerHTML = '<a href="transparency.html?view=published"><span class="document-submenu-icon document-submenu-icon-published" aria-hidden="true"></span><span>Published</span></a>'
      + '<a href="transparency.html?view=requested"><span class="document-submenu-icon document-submenu-icon-request" aria-hidden="true"></span><span>Requested</span></a>';
    const selectView = function(view) {
      submenu.querySelectorAll('a[href]').forEach(function(item) {
        item.classList.toggle('is-selected', new URL(item.href).searchParams.get('view') === view);
      });
    };
    selectView(new URLSearchParams(window.location.search).get('view') || 'published');
    if (!submenu.hidden) link.setAttribute('aria-expanded', 'true');
    submenu.addEventListener('click', function(event) {
      const item = event.target.closest('a[href]');
      if (!item) return;
      const view = new URL(item.href).searchParams.get('view');
      if (!view || typeof window.setProofView !== 'function') return;
      event.preventDefault();
      history.replaceState(null, '', item.href);
      selectView(view);
      window.setProofView(view, true);
      link.setAttribute('aria-expanded', 'false');
      submenu.hidden = true;
    });
    link.insertAdjacentElement('afterend', submenu);
  }

  function updateSidebarLogo(role) {
    const logosSpan = document.querySelector('.admin-brand-logos');
    if (!logosSpan) return;
    logosSpan.style.display = 'flex';
  }

  function notify(message, type) {
    if (typeof window.showAlert === 'function') {
      window.showAlert(message, type || 'info');
      return;
    }

    const alertBox = document.getElementById('alertBox');
    if (alertBox) {
      alertBox.innerHTML = '<div class="alert alert-' + attrEscape(type || 'info') + '">' + attrEscape(message) + '</div>';
      return;
    }

    alert(message);
  }

  function getImageSize(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function() {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        reject(new Error('Unable to read image dimensions.'));
      };
      img.src = url;
    });
  }

  async function validateLogoFile(file) {
    if (!file) return false;
    if (!file.type || !file.type.startsWith('image/')) {
      notify('Please select a valid image file.', 'danger');
      return false;
    }
    if (file.size > LOGO_MAX_BYTES) {
      notify('Image file is too large. Maximum size is 5MB.', 'danger');
      return false;
    }

    try {
      const size = await getImageSize(file);
      if (size.width < LOGO_MIN_WIDTH || size.height < LOGO_MIN_HEIGHT) {
        notify('Logo image must be at least ' + LOGO_MIN_WIDTH + ' x ' + LOGO_MIN_HEIGHT + ' pixels.', 'danger');
        return false;
      }
    } catch (err) {
      notify(err.message || 'Unable to read image dimensions.', 'danger');
      return false;
    }

    return true;
  }

  function openSidebarLogoPicker(user) {
    if (!user || user.role !== 'chairperson') return;
    let input = document.getElementById('sidebarLogoInput');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'sidebarLogoInput';
      input.accept = 'image/png,image/jpeg,image/jpg,image/gif,image/webp';
      input.style.display = 'none';
      document.body.appendChild(input);
    }

    input.onchange = function(event) {
      uploadSidebarLogo(user, event.target.files && event.target.files[0]);
    };
    input.value = '';
    input.click();
  }

  async function uploadSidebarLogo(user, file) {
    if (!await validateLogoFile(file)) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await fetch('/api/admin/users/' + encodeURIComponent(user.id) + '/profile-image', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        currentUser = Object.assign({}, currentUser || user, { profile_image: data.profile_image });
        renderSidebarUser(currentUser);
        notify(data.message || 'Logo updated successfully.', 'success');
      } else {
        notify(data.message || 'Failed to update logo.', 'danger');
      }
    } catch (err) {
      notify('Cannot connect to server.', 'danger');
    }
  }

  function updateEditableSidebarLogo(user) {
    const avatar = document.querySelector('.sidebar-user-avatar');
    if (!avatar) return;
    const box = avatar.closest('.sidebar-user, .sb-user');

    const existing = avatar.querySelector('.sidebar-edit-btn');
    if (existing) existing.remove();
    const existingBesideAvatar = box ? box.querySelector(':scope > .sidebar-edit-btn') : null;
    if (existingBesideAvatar) existingBesideAvatar.remove();

    // Profile photos are managed from My Account, keeping the sidebar uncluttered.
  }

  return { init, getSelectedBarangayId, setSelectedBarangayId, populateDropdown, getBarangayName, getSelectedBarangayName, updateSidebarCaption, renderSidebarUser, updateSidebarLogo, validateLogoFile };
})();
