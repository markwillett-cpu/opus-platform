// ═══════════════════════════════════════════════════════════
// OPUS API CLIENT
// ═══════════════════════════════════════════════════════════

/**
 * Client for Opus Platform API
 * Centralized API client for all backend communication
 */

class OpusAPIClient {
  constructor(config) {
    this.baseURL = config.API_BASE_URL || 'https://opus-platform.onrender.com';
    this.apiKey = config.API_KEY || '';
  }

  /**
   * Make authenticated request to API
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      ...options.headers
    };

    const config = {
      ...options,
      headers
    };

    const response = await fetch(url, config);
    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error?.message || 'API request failed');
      error.status = data.error?.status || response.status;
      throw error;
    }

    return data;
  }

  // ─────────────────────────────────────────────────────────
  // STYLES
  // ─────────────────────────────────────────────────────────

  /**
   * Get all styles/playlists
   * @returns {Promise<Array>} List of styles
   */
  async getStyles() {
    const { data } = await this.request('/styles');
    return data;
  }

  // ─────────────────────────────────────────────────────────
  // TRACKS
  // ─────────────────────────────────────────────────────────

  /**
   * Get all tracks for a style
   * @param {string} styleId - Style UUID
   * @returns {Promise<Array>} List of tracks with metadata
   */
  async getStyleTracks(styleId) {
    const { data } = await this.request(`/styles/${styleId}/tracks`);
    return data;
  }

  // ─────────────────────────────────────────────────────────
  // ASSIGNMENTS
  // ─────────────────────────────────────────────────────────

  /**
   * Get class assignments for a style
   * @param {string} styleId - Style UUID
   * @returns {Promise<Array>} List of assignments
   */
  async getStyleAssignments(styleId) {
    const { data } = await this.request(`/styles/${styleId}/assignments`);
    return data;
  }

  /**
   * Update class assignments
   * @param {string} styleId - Style UUID
   * @param {Array} assignments - Array of { library_song_id, class_code }
   * @returns {Promise<Object>} Result with upserted count
   */
  async updateStyleAssignments(styleId, assignments) {
    return await this.request(`/styles/${styleId}/assignments`, {
      method: 'PUT',
      body: JSON.stringify({ assignments })
    });
  }

  // ─────────────────────────────────────────────────────────
  // WEIGHTS
  // ─────────────────────────────────────────────────────────

  /**
   * Get class weight distribution for a style
   * @param {string} styleId - Style UUID
   * @returns {Promise<Array>} Weight distribution
   */
  async getStyleWeights(styleId) {
    const { data } = await this.request(`/styles/${styleId}/weights`);
    return data;
  }

  /**
   * Update class weight distribution
   * @param {string} styleId - Style UUID
   * @param {Array} weights - Array of { class_code, weight_pct }
   * @returns {Promise<Object>} Result with upserted count
   */
  async updateStyleWeights(styleId, weights) {
    return await this.request(`/styles/${styleId}/weights`, {
      method: 'PUT',
      body: JSON.stringify({ weights })
    });
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════

// Make available globally
if (typeof window !== 'undefined') {
  window.OpusAPIClient = OpusAPIClient;
  
 // Create default instance if config exists
const cfg = window.OPUS_CONFIG || window.CONFIG;
if (cfg) {
  // Normalize config into what OpusAPIClient expects
  const normalized = {
    baseUrl: cfg.API_BASE_URL || cfg.baseUrl || cfg.OPUS_API_BASE_URL,
    apiKey: cfg.OPUS_INTERNAL_API_KEY || cfg.apiKey || cfg.OPUS_API_KEY
  };

  window.opusAPI = new OpusAPIClient(normalized);
  // Back-compat: most pages expect window.api
  window.api = window.opusAPI;
}
}

// Also export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OpusAPIClient;
}
