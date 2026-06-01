// Data-at-risk warning bar: once the user has data, tells them it can be
// evicted until the app is installed to the Home Screen.
//
// HCI notes:
//  • Visibility of system status — the bar is shown on every page with data,
//    so the risk is never hidden behind a settings screen.
//  • Strong affordance — it's a full-width red button with a warning icon, clear
//    label, and a chevron, so it obviously looks tappable.
//  • Match between system & real world — copy is plain language ("Your data
//    could be lost"), not jargon, and the guide matches the user's device.
//  • The bar disappears the instant the data is protected, giving clear feedback
//    that the action worked.

import { el, sheet } from '../ui.js';
import { isStorageProtected, isIOS } from '../storage.js';
import { getCounts, isEmptyCounts } from '../backup.js';

// Captured Chromium install prompt, if the browser offers one.
let deferredInstallPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    refreshStorageBanner();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    refreshStorageBanner();
  });
}

export async function refreshStorageBanner() {
  const banner = document.getElementById('storage-banner');
  if (!banner) return;
  let prot = false;
  try { prot = await isStorageProtected(); } catch {}
  let counts = null;
  try { counts = await getCounts(); } catch {}
  const mode = storageBannerMode({ protected: prot, counts });
  if (mode === 'hidden') hideBanner(banner);
  else showBanner(banner);
}

export function storageBannerMode({ protected: isProtected = false, counts = null } = {}) {
  if (isProtected) return 'hidden';
  if (counts && isEmptyCounts(counts)) return 'hidden';
  return 'strong';
}

function hideBanner(banner) {
  banner.hidden = true;
  banner.replaceChildren();
  document.documentElement.style.setProperty('--storage-banner-h', '0px');
  document.querySelector('.app-main')?.classList.remove('has-storage-banner');
}

function showBanner(banner) {
  banner.hidden = false;
  banner.className = 'storage-banner';
  banner.replaceChildren(
    el('button', {
      type: 'button',
      class: 'storage-banner-btn',
      'aria-label': 'Your data could be lost. Tap to protect it by adding the app to your Home Screen.',
      onClick: openInstallGuide
    }, [
      el('span', { class: 'storage-banner-icon', 'aria-hidden': 'true' }, '⚠️'),
      el('span', { class: 'storage-banner-text' }, [
        el('strong', null, 'Your data could be lost'),
        el('span', { class: 'storage-banner-sub' }, 'Tap to protect it — add this app to your Home Screen')
      ]),
      el('span', { class: 'storage-banner-chevron', 'aria-hidden': 'true' }, '›')
    ])
  );
  document.querySelector('.app-main')?.classList.add('has-storage-banner');
  // Measure so the sticky topbar can sit directly below the bar.
  requestAnimationFrame(() => {
    if (!banner.hidden) {
      document.documentElement.style.setProperty('--storage-banner-h', banner.offsetHeight + 'px');
    }
  });
}

function iosSteps() {
  return el('ol', { class: 'guide-steps' }, [
    el('li', null, ['Tap the ', el('strong', null, 'Share'), ' button ', el('span', { class: 'guide-glyph', 'aria-hidden': 'true' }, '􀈂'), ' — the square with an up arrow, in the browser toolbar.']),
    el('li', null, ['Scroll down and choose ', el('strong', null, 'Add to Home Screen'), '.']),
    el('li', null, ['Tap ', el('strong', null, 'Add'), ' in the top corner.']),
    el('li', null, ['From now on, open Outfit Planner from the ', el('strong', null, 'Home Screen icon'), ' — not the browser.'])
  ]);
}

function genericSteps() {
  return el('ol', { class: 'guide-steps' }, [
    el('li', null, ['Open your browser menu (', el('strong', null, '⋮'), ' or the address-bar install icon).']),
    el('li', null, ['Choose ', el('strong', null, 'Install app'), ' or ', el('strong', null, 'Add to Home Screen'), '.']),
    el('li', null, ['Confirm, then launch Outfit Planner from the installed icon.'])
  ]);
}

export function openInstallGuide() {
  const ios = isIOS();
  return sheet({
    title: 'Protect your data',
    body: (close) => el('div', { class: 'install-guide' }, [
      el('p', { class: 'guide-intro' },
        'On this device, a browser can automatically clear an app’s data after about a week. Installing Outfit Planner to your Home Screen keeps your items, outfits and trips safe.'),
      ios ? iosSteps() : genericSteps(),
      // Real one-tap install when the browser supports it (Chromium).
      deferredInstallPrompt
        ? el('button', {
            type: 'button',
            class: 'btn btn-primary btn-block',
            style: { marginTop: '8px' },
            onClick: async () => {
              const p = deferredInstallPrompt;
              deferredInstallPrompt = null;
              try { await p.prompt(); await p.userChoice; } catch {}
              close();
              refreshStorageBanner();
            }
          }, 'Install now')
        : null,
      el('p', { class: 'guide-foot meta' },
        'Already installed? Open the app from your Home Screen icon and this warning will disappear. As a second safety net, set up automatic Backups in Settings.')
    ])
  });
}
