// ═══════════════════════════════════════════════════════════
// SHARED CLASS LABELS MANAGEMENT
// ═══════════════════════════════════════════════════════════

const ClassLabels = {
  getStyleKey() {
    return window.selectedStyleId || 'default-style';
  },

  storageKey() {
    return 'opus.classLabels.' + this.getStyleKey();
  },

  load() {
    const empty = { A: '', B: '', C: '', REST: '' };
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (raw) return JSON.parse(raw);
      
      // Fallback: try legacy style-name key
      const legacyKey = 'opus.classLabels.' + (window.currentStyleName || 'default-style');
      const rawLegacy = localStorage.getItem(legacyKey);
      if (rawLegacy) {
        const parsed = JSON.parse(rawLegacy);
        // Migrate to new key
        localStorage.setItem(this.storageKey(), rawLegacy);
        return parsed;
      }
      
      return empty;
    } catch (e) {
      return empty;
    }
  },

  save(labels) {
    localStorage.setItem(this.storageKey(), JSON.stringify(labels));
  },

  apply(labels) {
    window.currentClassLabels = labels;
    
    // Update assign button labels
    document.querySelectorAll('.assign-btn .ab-label').forEach(el => {
      const btn = el.closest('.assign-btn');
      if (!btn) return;

      const cls = btn.dataset.class;
      if (!cls || cls === 'Uncategorized') return;

      const code = cls.toUpperCase();
      const displayCode = code === 'REST' ? 'Rest' : cls;
      const label = labels[code];

      el.textContent = label ? `${displayCode} — ${label}` : displayCode;
    });

    // Update mix widget labels
    document.querySelectorAll('.mix-lbl[data-code]').forEach(el => {
      const code = el.getAttribute('data-code');
      if (!code) return;
      
      const label = labels[code];
      if (code === 'REST') {
        el.textContent = label ? `Rest — ${label}` : 'Rest';
      } else {
        el.textContent = label ? `${code} — ${label}` : code;
      }
    });

    // Update alias spans in tables
    document.querySelectorAll('.class-alias[data-class-code]').forEach(el => {
      const code = el.getAttribute('data-class-code');
      const v = labels[code] || '';
      el.textContent = v ? ('— ' + v) : '';
      el.style.color = '#7f8c8d';
      el.style.fontWeight = '800';
      el.style.marginLeft = '6px';
      el.style.fontSize = '12px';
    });

    // Refresh mix UI if available
    if (typeof window.refreshMixUI === 'function') {
      window.refreshMixUI();
    }
  },

  // Modal management
  openModal() {
    const modal = document.getElementById('labelsModal');
    if (!modal) return;

    const labels = this.load();
    this.apply(labels);

    const inA = document.getElementById('labelA');
    const inB = document.getElementById('labelB');
    const inC = document.getElementById('labelC');
    const inR = document.getElementById('labelR');

    if (inA) inA.value = labels.A || '';
    if (inB) inB.value = labels.B || '';
    if (inC) inC.value = labels.C || '';
    if (inR) inR.value = labels.REST || '';

    modal.style.display = 'block';
  },

  closeModal() {
    const modal = document.getElementById('labelsModal');
    if (modal) modal.style.display = 'none';
  },

  saveFromModal() {
    const inA = document.getElementById('labelA');
    const inB = document.getElementById('labelB');
    const inC = document.getElementById('labelC');
    const inR = document.getElementById('labelR');

    const labels = {
      A: (inA?.value || '').trim(),
      B: (inB?.value || '').trim(),
      C: (inC?.value || '').trim(),
      REST: (inR?.value || '').trim()
    };

    this.save(labels);
    this.apply(labels);
    this.closeModal();
  },

  reset() {
    const labels = { A: '', B: '', C: '', REST: '' };
    this.save(labels);
    this.apply(labels);

    const inA = document.getElementById('labelA');
    const inB = document.getElementById('labelB');
    const inC = document.getElementById('labelC');
    const inR = document.getElementById('labelR');

    if (inA) inA.value = '';
    if (inB) inB.value = '';
    if (inC) inC.value = '';
    if (inR) inR.value = '';
  },

  // Initialize modal listeners
  init() {
    const btn = document.getElementById('editLabelsBtn');
    const closeBtn = document.getElementById('closeLabelsModal');
    const saveBtn = document.getElementById('saveLabels');
    const resetBtn = document.getElementById('resetLabels');
    const modal = document.getElementById('labelsModal');

    if (btn) btn.addEventListener('click', (e) => {
      e.preventDefault();
      this.openModal();
    });

    if (closeBtn) closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.closeModal();
    });

    if (saveBtn) saveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.saveFromModal();
    });

    if (resetBtn) resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.reset();
    });

    if (modal) modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeModal();
    });

    // Apply labels on load
    this.apply(this.load());

    // Listen for style changes
    window.addEventListener('styleChanged', () => {
      this.apply(this.load());
    });
  }
};
