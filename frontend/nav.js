// ─────────────────────────────────────────────────────────
// Opus shared navigation — popover grid
// Include on every page:
//   <div id="nav-root"></div>
//   <script src="./nav.js"></script>
// ─────────────────────────────────────────────────────────

(function() {
  const NAV_SECTIONS = [
    {
      label: 'Library',
      items: [
        { href: 'http://opus.customchannels.net/', label: 'Tracks',          external: true, icon: '♫' },
        { href: 'index.html',                      label: 'Playback Classes',                icon: '⊞' },
        { href: 'library.html',                    label: 'Library',                         icon: '▤' },
        { href: 'style-builder.html',              label: 'Style Builder',                   icon: '✦' },
        { href: 'style-finder.html',               label: 'Style Finder',                    icon: '◎' },
      ]
    },
    {
      label: 'Tools',
      items: [
        { href: 'curator-dashboard.html', label: 'Curator Dashboard', icon: '◈' },
        { href: 'mood-tagging.html',      label: 'Mood Tagging',      icon: '◉' },
        { href: 'playlist-matcher.html',  label: 'Spotchecker',       icon: '✓' },
        { href: 'spotify-sync.html',      label: 'Spotify Sync',      icon: '⟳' },
      ]
    },
    {
      label: 'Explore',
      items: [
        { href: 'charts.html',      label: 'Charts',      icon: '↗' },
        { href: 'dna-compare.html', label: 'DNA Compare', icon: '⌬' },
        { href: 'api-docs.html',    label: 'API Docs',    icon: '{ }' },
      ]
    }
  ];

  const PLAYBACK_ALIASES = ['class-detail.html', 'uncategorized-detail.html'];
  const currentFile = window.location.pathname.split('/').pop() || 'index.html';
  const activeFile  = PLAYBACK_ALIASES.includes(currentFile) ? 'index.html' : currentFile;

  // Find the active item label for the trigger button
  let activeLabel = 'Navigate';
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (!item.external && item.href === activeFile) {
        activeLabel = item.label;
        break;
      }
    }
  }

  // Build section HTML
  const sectionsHtml = NAV_SECTIONS.map(section => {
    const itemsHtml = section.items.map(item => {
      const isActive = !item.external && item.href === activeFile;
      return `<a class="on-nav-item${isActive ? ' on-nav-active' : ''}" href="${item.href}"
        ${item.external ? 'target="_blank" rel="noopener"' : ''}>
        <span class="on-nav-icon">${item.icon}</span>
        <span class="on-nav-label">${item.label}</span>
      </a>`;
    }).join('');
    return `<div class="on-nav-section">
      <div class="on-nav-section-label">${section.label}</div>
      <div class="on-nav-grid">${itemsHtml}</div>
    </div>`;
  }).join('<div class="on-nav-divider"></div>');

  const css = `
    .on-trigger {
      display: flex; align-items: center; gap: 7px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 5px;
      padding: 7px 13px;
      cursor: pointer;
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .01em;
      transition: background .15s, border-color .15s;
      white-space: nowrap;
    }
    .on-trigger:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.25); }
    .on-trigger.on-open { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.3); }
    .on-trigger-icon { display: flex; flex-direction: column; gap: 4px; width: 16px; flex-shrink: 0; }
    .on-trigger-icon span { display: block; height: 1.5px; background: currentColor; border-radius: 2px; transition: all .2s; }
    .on-trigger.on-open .on-trigger-icon span:nth-child(1) { transform: translateY(5.5px) rotate(45deg); }
    .on-trigger.on-open .on-trigger-icon span:nth-child(2) { opacity: 0; width: 0; }
    .on-trigger.on-open .on-trigger-icon span:nth-child(3) { transform: translateY(-5.5px) rotate(-45deg); }
    .on-popover {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      z-index: 9998;
      display: none;
    }
    .on-popover.on-open { display: block; }
    .on-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.25); }
    .on-popover-inner {
      position: absolute;
      top: 58px; right: 18px;
      width: 310px;
      background: #2c3e50;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      padding: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      z-index: 1;
    }
    .on-nav-section { margin-bottom: 6px; }
    .on-nav-section:last-child { margin-bottom: 0; }
    .on-nav-section-label {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.35);
      padding: 2px 6px 6px;
    }
    .on-nav-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
    .on-nav-item {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 10px;
      border-radius: 5px;
      text-decoration: none;
      color: rgba(255,255,255,0.6);
      font-size: 13px;
      font-weight: 600;
      transition: background .12s, color .12s;
    }
    .on-nav-item:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .on-nav-active { background: rgba(52,152,219,0.25) !important; color: #7ec8f0 !important; }
    .on-nav-icon { font-size: 13px; width: 18px; text-align: center; opacity: 0.7; flex-shrink: 0; }
    .on-nav-label { line-height: 1.2; }
    .on-nav-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 8px 0; }
  `;

  const html = `
    <style>${css}</style>
    <button class="on-trigger" id="on-trigger" aria-haspopup="true" aria-expanded="false">
      <span class="on-trigger-icon"><span></span><span></span><span></span></span>
      <span id="on-active-label">${activeLabel}</span>
    </button>
    <div class="on-popover" id="on-popover" role="dialog" aria-label="Navigation">
      <div class="on-backdrop" id="on-backdrop"></div>
      <div class="on-popover-inner">${sectionsHtml}</div>
    </div>
  `;

  const root = document.getElementById('nav-root');
  if (!root) return;
  root.innerHTML = html;

  const trigger  = document.getElementById('on-trigger');
  const popover  = document.getElementById('on-popover');
  const backdrop = document.getElementById('on-backdrop');

  function open()   { popover.classList.add('on-open');    trigger.classList.add('on-open');    trigger.setAttribute('aria-expanded', 'true');  }
  function close()  { popover.classList.remove('on-open'); trigger.classList.remove('on-open'); trigger.setAttribute('aria-expanded', 'false'); }
  function toggle() { popover.classList.contains('on-open') ? close() : open(); }

  trigger.addEventListener('click', function(e) { e.stopPropagation(); toggle(); });
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') close(); });
})();
