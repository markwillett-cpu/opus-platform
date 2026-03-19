// ─────────────────────────────────────────────────────────
// Opus shared navigation
// Include on every page:
//   <div id="nav-root"></div>
//   <script src="./nav.js"></script>
// ─────────────────────────────────────────────────────────

(function() {
  const NAV_ITEMS = [
    { href: 'http://opus.customchannels.net/', label: 'Tracks', external: true },
    { href: 'api-docs.html',          label: 'API Docs' },
    { href: 'index.html',             label: 'Playback Classes' },
    { href: 'curator-dashboard.html', label: 'Curator Dashboard' },
    { href: 'mood-tagging.html',      label: 'Mood Tagging' },
    { href: 'playlist-matcher.html',  label: 'Spotchecker' },
    { href: 'style-finder.html',      label: 'Style Finder' },
    { href: 'spotify-sync.html',      label: 'Spotify Sync' },
    { href: 'style-builder.html',     label: 'Style Builder' },
    { href: 'charts.html',            label: 'Charts' },
    { href: 'dna-compare.html',       label: 'DNA Compare' },
  ];

  // Determine active page from current filename
  const currentFile = window.location.pathname.split('/').pop() || 'index.html';

  // Pages that highlight "Playback Classes" as active
  const PLAYBACK_ALIASES = ['class-detail.html', 'uncategorized-detail.html'];
  const activeFile = PLAYBACK_ALIASES.includes(currentFile) ? 'index.html' : currentFile;

  const navHtml = NAV_ITEMS.map(item => {
    const isActive = !item.external && item.href === activeFile;
    const cls = 'nav-item' + (isActive ? ' active' : '');
    return `<a class="${cls}" href="${item.href}">${item.label}</a>`;
  }).join('');

  const root = document.getElementById('nav-root');
  if (root) {
    root.innerHTML = `<nav class="opus-nav">${navHtml}</nav>`;
  }
})();
