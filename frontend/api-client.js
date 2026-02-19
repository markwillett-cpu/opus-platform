// ═══════════════════════════════════════════════════════════
// OPUS API CLIENT
// ═══════════════════════════════════════════════════════════

/**
 * Client for Opus Platform API
 * Replace direct Supabase calls with this API client
 */

class OpusAPIClient {
  constructor(config) {
    this.baseURL = config.API_BASE_URL || 'http://localhost:8787/v1';
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
  if (window.OPUS_CONFIG) {
    window.opusAPI = new OpusAPIClient(window.OPUS_CONFIG);
  }
}

// Also export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OpusAPIClient;
}
