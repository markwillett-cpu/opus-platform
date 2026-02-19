// ═══════════════════════════════════════════════════════════
// SHARED DATABASE HELPERS (API VERSION)
// ═══════════════════════════════════════════════════════════

// Use config from config.js if available, otherwise use defaults
const CONFIG = window.OPUS_CONFIG || {
  MAX_TRACKS_DISPLAY: 3000,
  TOAST_DURATION: 2500,
  AUTO_SAVE_DELAY: 400,
  SEARCH_DEBOUNCE: 300,
  STYLES_TO_EXCLUDE: ['AA Remix']
};

const DB_HELPERS = {
  /**
   * Fetch all songs for a style with joined metadata
   * @param {string} styleId - Style UUID
   * @returns {Promise<Array>} Song rows with metadata
   */
  async fetchStyleSongRows(styleId) {
    if (!window.opusAPI) {
      throw new Error('OpusAPIClient not initialized');
    }
    
    const data = await window.opusAPI.getStyleTracks(styleId);
    
    // Transform API response to match expected format
    return (data || [])
      .filter(r => r && r.library_song_id)
      .map(r => ({
        song_id: r.library_song_id,
        sim_duration_seconds: r.sim_duration_seconds ?? null,
        song: r.song ? {
          id: r.song.id ?? null,
          artist: r.song.artist ?? '',
          title: r.song.title ?? '',
          album: r.song.album ?? '',
          year: r.song.peak_year ?? '',
          run_time_seconds: r.song.run_time_seconds ?? 0,
          styles: r.song.styles ?? ''
        } : null
      }));
  },

  /**
   * Fetch class assignments for a style
   * @param {string} styleId - Style UUID
   * @returns {Promise<Object>} Assignment map { song_id: { class_code, moved_at } }
   */
  async fetchAssignments(styleId) {
    if (!window.opusAPI) {
      throw new Error('OpusAPIClient not initialized');
    }
    
    const data = await window.opusAPI.getStyleAssignments(styleId);
    
    // Transform to map format
    const m = {};
    (data || []).forEach(r => {
      if (!r.library_song_id) return;
      m[r.library_song_id] = {
        class_code: r.class_code,
        moved_at: r.moved_at
      };
    });
    return m;
  },

  /**
   * Bulk assign tracks to classes
   * @param {Array} rows - Array of { song_id, style_id, class_code }
   * @returns {Promise<Object>} API response
   */
  async upsertAssignments(rows) {
    if (!window.opusAPI) {
      throw new Error('OpusAPIClient not initialized');
    }
    
    const payload = (rows || [])
      .filter(r => r && r.song_id && r.style_id)
      .map(r => ({
        library_song_id: r.song_id,
        class_code: r.class_code
      }));

    if (payload.length === 0) {
      return { ok: true, upserted: 0 };
    }

    // All rows should have same style_id
    const styleId = rows[0].style_id;
    
    return await window.opusAPI.updateStyleAssignments(styleId, payload);
  },

  /**
   * Remove class assignments for specific songs
   * @param {string} styleId - Style UUID
   * @param {Array<string>} songIds - Song UUIDs to unassign
   * @returns {Promise<Object>} API response
   */
  async deleteAssignments(styleId, songIds) {
    // API doesn't have delete endpoint yet, so we could:
    // 1. Add DELETE endpoint to API
    // 2. Or implement as update with null class_code
    // For now, throw not implemented
    throw new Error('Delete assignments not yet implemented in API. Add DELETE endpoint or use PUT with null class_code.');
  },

  /**
   * Normalize class code to consistent format
   * @param {string} rawClass - Raw class code input
   * @returns {string|null} Normalized class code or null
   */
  normalizeClassCode(rawClass) {
    if (!rawClass) return null;
    return String(rawClass).toLowerCase() === 'rest' 
      ? 'REST' 
      : String(rawClass).toUpperCase();
  }
};

const ClassCodes = {
  ALL: ['A', 'B', 'C', 'REST'],
  
  normalize(code) {
    if (!code) return null;
    return String(code).toLowerCase() === 'rest' ? 'REST' : String(code).toUpperCase();
  },
  
  isValid(code) {
    return this.ALL.includes(this.normalize(code));
  },
  
  getDisplayName(code, labels = {}) {
    const normalized = this.normalize(code);
    if (!normalized) return 'Uncategorized';
    const label = labels[normalized];
    const baseName = normalized === 'REST' ? 'Rest' : normalized;
    return label ? `${baseName} — ${label}` : baseName;
  }
};

// Utility functions
function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

async function safeExecute(fn, errorMessage) {
  try {
    return await fn();
  } catch (err) {
    console.error(errorMessage, err);
    if (typeof showToast === 'function') {
      showToast(`❌ ${errorMessage}: ${err.message}`);
    }
    return null;
  }
}
