import { el } from '../ui.js';

const TABS = [
  { href: '#/trips', label: 'Trips', icon: '🧳' },
  { href: '#/outfits', label: 'Outfits', icon: '👔' },
  { href: '#/items', label: 'Items', icon: '👕' },
  { href: '#/stylist', label: 'Stylist', icon: '✨' },
  { href: '#/settings', label: 'Settings', icon: '⚙️' }
];

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
        el('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon),
        el('span', null, t.label)
      ]);
      return a;
    }));
  }
  if (sidebar) {
    sidebar.replaceChildren(...TABS.map(t => el('a', {
      href: t.href,
      'aria-current': isActive(t.href, currentHash) ? 'page' : null
    }, [el('span', { 'aria-hidden': 'true' }, t.icon), el('span', null, t.label)])));
  }
}
