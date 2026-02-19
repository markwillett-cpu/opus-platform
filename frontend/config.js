// ═══════════════════════════════════════════════════════════
// OPUS PLAYBACK MANAGER - CONFIGURATION
// ═══════════════════════════════════════════════════════════

/**
 * Central configuration file for Opus Playback Manager
 * 
 * Update these values with your Supabase project credentials
 * and customize application behavior as needed.
 */

const OPUS_CONFIG = {
  
  // ─────────────────────────────────────────────────────────
  // SUPABASE CONNECTION
  // ─────────────────────────────────────────────────────────
  
  /**
   * Supabase project URL
   * Find this in your Supabase project settings
   * Format: https://your-project-id.supabase.co
   */
  SUPABASE_URL: 'https://quuxtalnpdcommlylwlp.supabase.co',
  
  /**
   * Supabase anonymous (public) API key
   * Find this in: Project Settings → API → anon/public key
   * This key is safe to expose in client-side code
   */
  SUPABASE_ANON_KEY: 'sb_publishable_Lvv-SG7eonq1OO3T5Y7ofg__aF4eDRQ',
  
// Platform API Configuration
   API_BASE_URL: 'https://opus-platform.onrender.com/v1',
   API_KEY: 'opus_sandbox_6b3f9c2d0e7a4c1a9f8d2c7b1e0a4d3f',  // Match what you put in .env
  
  // ─────────────────────────────────────────────────────────
  // APPLICATION SETTINGS
  // ─────────────────────────────────────────────────────────
  
  /**
   * Maximum number of tracks to display per page
   * Limits UI rendering for performance with large datasets
   * Default: 3000
   */
  MAX_TRACKS_DISPLAY: 3000,
  
  /**
   * Duration (ms) to show success toast notifications
   * Default: 2500 (2.5 seconds)
   */
  TOAST_DURATION: 2500,
  
  /**
   * Debounce delay (ms) for auto-save operations
   * Prevents excessive database writes during rapid changes
   * Default: 400ms
   */
  AUTO_SAVE_DELAY: 400,
  
  /**
   * Debounce delay (ms) for search input
   * Prevents excessive re-renders while typing
   * Default: 300ms
   */
  SEARCH_DEBOUNCE: 300,
  
  /**
   * Styles (playlists) to exclude from UI lists
   * Use exact style names as they appear in the database
   * Example: ['AA Remix', 'Test Playlist', 'Deprecated']
   */
  STYLES_TO_EXCLUDE: ['AA Remix'],
  
  
  // ─────────────────────────────────────────────────────────
  // DEFAULT CLASS MIX
  // ─────────────────────────────────────────────────────────
  
  /**
   * Default class distribution percentages
   * Used when no custom mix is set for a style
   * Must total 100%
   */
  DEFAULT_CLASS_MIX: {
    A: 30,      // High-priority tracks
    B: 40,      // Core rotation
    C: 30,      // Library depth
    REST: 0     // Rested/on-hold tracks
  },
  
  
  // ─────────────────────────────────────────────────────────
  // UI CUSTOMIZATION
  // ─────────────────────────────────────────────────────────
  
  /**
   * Enable/disable features
   */
  FEATURES: {
    /**
     * Show keyboard shortcut hints in UI
     */
    showKeyboardHints: true,
    
    /**
     * Enable collapsible styles sidebar
     */
    collapsibleSidebar: true,
    
    /**
     * Show track count badges in style list
     */
    showStyleStats: true,
    
    /**
     * Enable drag-and-drop for class mix adjustments
     */
    enableMixDragging: true
  },
  
  
  // ─────────────────────────────────────────────────────────
  // ADVANCED SETTINGS
  // ─────────────────────────────────────────────────────────
  
  /**
   * Enable debug logging to browser console
   * Set to true for development, false for production
   */
  DEBUG_MODE: false,
  
  /**
   * Class code definitions and metadata
   * Do not modify unless you've changed the database schema
   */
  CLASS_CODES: {
    A: {
      color: '#e74c3c',      // --power red
      label: 'A',
      description: 'High-priority tracks',
      defaultLabel: ''
    },
    B: {
      color: '#3498db',      // --core blue
      label: 'B',
      description: 'Core rotation tracks',
      defaultLabel: ''
    },
    C: {
      color: '#27ae60',      // --library green
      label: 'C',
      description: 'Library tracks',
      defaultLabel: ''
    },
    REST: {
      color: '#95a5a6',      // --rest gray
      label: 'Rest',
      description: 'Rest period tracks',
      defaultLabel: ''
    }
  },
  
  /**
   * Pagination settings (if implementing pagination in future)
   */
  PAGINATION: {
    defaultPageSize: 50,
    pageSizeOptions: [25, 50, 100, 200]
  },
  
  /**
   * Cache settings for client-side data caching
   * (if implementing caching in future)
   */
  CACHE: {
    enabled: false,
    ttlSeconds: 300  // 5 minutes
  }
};

// ═══════════════════════════════════════════════════════════
// EXPORT CONFIGURATION
// ═══════════════════════════════════════════════════════════

// Make configuration available globally
if (typeof window !== 'undefined') {
  window.OPUS_CONFIG = OPUS_CONFIG;
}

// Also export for module systems (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OPUS_CONFIG;
}

// ═══════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════

/**
 * Validates configuration on load
 * Logs warnings for common issues
 */
(function validateConfig() {
  // Check if Supabase URL is set
  if (OPUS_CONFIG.SUPABASE_URL.includes('your-project') || 
      OPUS_CONFIG.SUPABASE_URL === 'https://quuxtalnpdcommlylwlp.supabase.co') {
    console.warn('⚠️ OPUS CONFIG: Please update SUPABASE_URL with your project URL');
  }
  
  // Check if Supabase key is set
  if (OPUS_CONFIG.SUPABASE_ANON_KEY.includes('your-key') ||
      OPUS_CONFIG.SUPABASE_ANON_KEY.startsWith('sb_publishable_Lvv')) {
    console.warn('⚠️ OPUS CONFIG: Please update SUPABASE_ANON_KEY with your project key');
  }
  
  // Validate default mix totals 100%
  const mixTotal = Object.values(OPUS_CONFIG.DEFAULT_CLASS_MIX)
    .reduce((sum, val) => sum + val, 0);
  
  if (mixTotal !== 100) {
    console.error('❌ OPUS CONFIG: DEFAULT_CLASS_MIX must total 100%, currently totals ' + mixTotal + '%');
  }
  
  // Check for negative values
  const hasNegative = Object.values(OPUS_CONFIG.DEFAULT_CLASS_MIX)
    .some(val => val < 0);
  
  if (hasNegative) {
    console.error('❌ OPUS CONFIG: DEFAULT_CLASS_MIX cannot contain negative values');
  }
  
  if (OPUS_CONFIG.DEBUG_MODE) {
    console.log('✓ Opus Config loaded:', OPUS_CONFIG);
  }
})();

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Get configuration value with optional fallback
 * @param {string} path - Dot-notation path (e.g., 'FEATURES.showKeyboardHints')
 * @param {*} fallback - Fallback value if path not found
 * @returns {*} Configuration value or fallback
 */
OPUS_CONFIG.get = function(path, fallback = null) {
  const parts = path.split('.');
  let value = OPUS_CONFIG;
  
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return fallback;
    }
  }
  
  return value;
};

/**
 * Check if a feature is enabled
 * @param {string} featureName - Feature key from FEATURES object
 * @returns {boolean} True if feature is enabled
 */
OPUS_CONFIG.isFeatureEnabled = function(featureName) {
  return this.get(`FEATURES.${featureName}`, false);
};

/**
 * Get class configuration by code
 * @param {string} classCode - Class code (A, B, C, REST)
 * @returns {object|null} Class configuration object or null
 */
OPUS_CONFIG.getClassConfig = function(classCode) {
  const normalized = classCode === 'Rest' ? 'REST' : String(classCode).toUpperCase();
  return this.CLASS_CODES[normalized] || null;
};
