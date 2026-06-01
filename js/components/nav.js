import { el } from '../ui.js';

const TABS = [
  { href: '#/trips', label: 'Trips', icon: 'trips' },
  { href: '#/outfits', label: 'Outfits', icon: 'outfits' },
  { href: '#/items', label: 'Items', icon: 'items' },
  { href: '#/stylist', label: 'Stylist', icon: 'stylist' },
  { href: '#/settings', label: 'Settings', icon: 'settings' }
];

const ICONS = {
  trips: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7"/><path d="M8 20v-2M16 20v-2M5 12h14"/></svg>',
  outfits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 4l3 2 3-2 4 3-2 4-2-1v9H9v-9l-2 1-2-4 4-3z"/><path d="M9 4c.5 1.5 1.5 2.3 3 2.3S14.5 5.5 15 4"/></svg>',
  items: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 5v15M16 5v15M4 10h16M4 15h16"/></svg>',
  stylist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 16l-1.7-5L6 9.3l4.3-1.7L12 3z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/><path d="M5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6L5 15z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 3.1-.2-.1a1.7 1.7 0 0 0-2 .2 1.7 1.7 0 0 0-.8 1.7V22H9v-.1a1.7 1.7 0 0 0-.8-1.7 1.7 1.7 0 0 0-2-.2l-.2.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 13.9H3v-3.8h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1L6 3.9l.2.1a1.7 1.7 0 0 0 2-.2A1.7 1.7 0 0 0 9 2.1V2h6v.1a1.7 1.7 0 0 0 .8 1.7 1.7 1.7 0 0 0 2 .2l.2-.1L19.8 7l-.1.1A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 21 10.1h.1v3.8H21A1.7 1.7 0 0 0 19.4 15z"/></svg>'
};

function navIcon(name) {
  const wrap = el('span', { class: 'nav-icon', 'aria-hidden': 'true' });
  wrap.innerHTML = ICONS[name] || '';
  return wrap;
}

function isActive(tabHref, currentHash) {
  // Active if currentHash starts with the tab path or matches related routes.
  if (currentHash === tabHref) return true;
  const norm = (currentHash || '#/').replace(/^#/, '');
  const tab = tabHref.replace(/^#/, '');
  if (tab === '/trips' && (norm.startsWith('/trip/') || norm === '/' || norm === '/trips')) return true;
  if (tab === '/outfits' && norm.startsWith('/outfit')) return true;
  if (tab === '/items' && norm.startsWith('/item')) return true;
  if (tab === '/stylist' && norm.startsWith('/stylist')) return true;
  if (tab === '/settings' && norm.startsWith('/settings')) return true;
  return false;
}

export function renderNav(currentHash) {
  const tabbar = document.getElementById('tabbar');
  const sidebar = document.getElementById('sidebar-nav');
  if (tabbar) {
    tabbar.replaceChildren(...TABS.map(t => {
      const a = el('a', {
        href: t.href,
        'aria-current': isActive(t.href, currentHash) ? 'page' : null
      }, [
        navIcon(t.icon),
        el('span', { class: 'tab-label' }, t.label)
      ]);
      return a;
    }));
  }
  if (sidebar) {
    sidebar.replaceChildren(...TABS.map(t => el('a', {
      href: t.href,
      'aria-current': isActive(t.href, currentHash) ? 'page' : null
    }, [navIcon(t.icon), el('span', { class: 'tab-label' }, t.label)])));
  }
}
