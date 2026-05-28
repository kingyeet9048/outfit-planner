// Small DOM helper and UI primitives: el(), modal/sheet, toast, confirm.

export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      // Always set `value` via the property — textareas ignore the value attribute,
      // and inputs need it for programmatic mutation to stick.
      else if (k === 'value' && 'value' in node) node.value = v;
      else if (k in node && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(parent, children) {
  if (children == null || children === false) return;
  if (Array.isArray(children)) {
    children.forEach(c => appendChildren(parent, c));
    return;
  }
  if (typeof children === 'string' || typeof children === 'number') {
    parent.appendChild(document.createTextNode(String(children)));
    return;
  }
  if (children instanceof Node) {
    parent.appendChild(children);
  }
}

// ---------- Toast ----------
export function toast(message, opts = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const t = el('div', { class: 'toast' + (opts.kind ? ` toast-${opts.kind}` : '') }, message);
  root.appendChild(t);
  const ttl = opts.ttl ?? 2500;
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity .2s';
    setTimeout(() => { if (t.parentNode) t.remove(); }, 250);
  }, ttl);
}

// ---------- Bottom Sheet ----------
// Returns a Promise that resolves with whatever close(value) is called with.
export function sheet({ title, body, actions, dismissible = true } = {}) {
  return new Promise(resolve => {
    const triggerEl = document.activeElement;
    let dialog;
    const supportsDialog = typeof HTMLDialogElement === 'function';

    const close = (value) => {
      try {
        if (supportsDialog && dialog && dialog.tagName === 'DIALOG' && dialog.open) dialog.close();
      } catch {}
      if (dialog && dialog.parentNode) dialog.remove();
      if (triggerEl && typeof triggerEl.focus === 'function') {
        try { triggerEl.focus(); } catch {}
      }
      resolve(value);
    };

    const handle = el('div', { class: 'sheet-handle', 'aria-hidden': 'true' });
    const header = el('div', { class: 'sheet-header' }, [
      el('h2', null, title || ''),
      dismissible ? el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onClick: () => close(undefined) }, '×') : null
    ]);
    const bodyWrap = el('div', { class: 'sheet-body' });
    if (typeof body === 'function') {
      const r = body(close);
      if (r instanceof Node) bodyWrap.appendChild(r);
    } else if (body instanceof Node) {
      bodyWrap.appendChild(body);
    } else if (body != null) {
      bodyWrap.textContent = String(body);
    }
    const inner = el('div', { class: 'sheet-inner', role: 'document' }, [handle, header, bodyWrap]);
    if (actions && actions.length) {
      const ac = el('div', { class: 'sheet-actions' }, actions.map(a => el('button', {
        type: 'button',
        class: 'btn ' + (a.variant === 'primary' ? 'btn-primary btn-block' : a.variant === 'danger' ? 'btn-danger btn-block' : 'btn-ghost btn-block'),
        onClick: () => { if (a.onClick) a.onClick(close); else close(a.value); }
      }, a.label)));
      inner.appendChild(ac);
    }

    if (supportsDialog) {
      dialog = el('dialog', { class: 'sheet' }, [inner]);
      document.getElementById('modal-root').appendChild(dialog);
      if (dismissible) {
        dialog.addEventListener('click', (e) => { if (e.target === dialog) close(undefined); });
        dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
      }
      dialog.showModal();
    } else {
      dialog = el('div', { class: 'sheet-fallback', style: { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.4)', zIndex: '200' } }, [inner]);
      document.getElementById('modal-root').appendChild(dialog);
      if (dismissible) {
        dialog.addEventListener('click', (e) => { if (e.target === dialog) close(undefined); });
      }
    }
    setTimeout(() => {
      const focusable = bodyWrap.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable) focusable.focus();
      else inner.focus?.();
    }, 50);
  });
}

// ---------- Confirm ----------
export async function confirm({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return sheet({
    title: '',
    body: el('div', { class: 'confirm-body' }, [
      el('h3', null, title || 'Are you sure?'),
      message ? el('p', null, message) : null
    ]),
    actions: [
      { label: cancelLabel, onClick: (close) => close(false) },
      { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: (close) => close(true) }
    ]
  });
}

// ---------- Top bar render ----------
export function renderTopbar({ title, left, right }) {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  bar.replaceChildren(
    el('div', { class: 'topbar-left' }, left || null),
    el('h1', null, title || ''),
    el('div', { class: 'topbar-right' }, right || null)
  );
}

export function backButton(href = '#/') {
  return el('a', { class: 'icon-btn', href, 'aria-label': 'Back' }, '◀');
}

export function iconLink(href, label, glyph) {
  return el('a', { class: 'icon-btn', href, 'aria-label': label, title: label }, glyph);
}

export function iconButton(label, glyph, onClick) {
  return el('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, onClick }, glyph);
}
