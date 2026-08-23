window.SkBarangay = (function() {
  let allBarangays = [];
  let selectedId = null;
  let currentUser = null;

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

  function getAdminCaption() {
    if (!currentUser) return 'Admin Portal';

    if (currentUser.role === 'admin') {
      const name = getSelectedBarangayName();
      if (!selectedId || selectedId === 'all' || !name || name === 'All Barangays') {
        return 'SK Federated Admin';
      }
      return 'Brgy. ' + name + ' Admin';
    }

    return 'Brgy. ' + (currentUser.barangay || getSelectedBarangayName() || 'Your Barangay') + ' Admin';
  }

  function updateSidebarCaption() {
    const logo = document.querySelector('.sidebar-logo, .sb-logo');
    if (!logo) return;

    let caption = logo.querySelector('p');
    if (!caption) {
      caption = document.createElement('p');
      logo.appendChild(caption);
    }

    caption.id = caption.id || 'sidebarBarangayText';
    caption.textContent = getAdminCaption();
  }

  return { init, getSelectedBarangayId, setSelectedBarangayId, populateDropdown, getBarangayName, getSelectedBarangayName, updateSidebarCaption };
})();
