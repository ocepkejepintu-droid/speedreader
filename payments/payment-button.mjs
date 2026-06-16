// Lemon Squeezy payment button for RSVP Reader.
// Hidden by default — gated by localStorage flag `rsvp-payments-enabled=1`.
// See payments/README.md for the founder setup flow.

const FLAG_KEY = 'rsvp-payments-enabled';

// Default checkout URL used if payments/lemon-squeezy-config.json cannot be
// fetched at runtime. Founder replaces the placeholder product id with the
// real one from the Lemon Squeezy dashboard.
export const DEFAULT_CONFIG = Object.freeze({
  storeSlug: 'zipang',
  productSlug: 'rsvp-reader-tip',
  checkoutUrl: 'https://zipang.lemonsqueezy.com/checkout/buy/RSVP-PRODUCT-ID',
  minimumPriceUsd: 5,
  suggestedPricesUsd: [5, 20, 50],
  licenseMode: 'single-user-pwyw',
  envVarName: 'LEMON_SQUEEZY_CHECKOUT_URL',
});

/**
 * Returns true when the founder has flipped the payment flag on.
 * Reads `rsvp-payments-enabled` from localStorage. Truthy value = enabled.
 * Safe to call in non-browser contexts — returns false if no localStorage.
 */
export function isPaymentsEnabled() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    const v = localStorage.getItem(FLAG_KEY);
    if (v == null) return false;
    // Accept '1', 'true', 'yes', 'on' as truthy; anything else is off.
    return /^(1|true|yes|on)$/i.test(String(v).trim());
  } catch {
    return false;
  }
}

/**
 * Tries to load the JSON config from the same origin. Falls back to the
 * embedded DEFAULT_CONFIG. Never throws.
 */
export async function loadConfig() {
  try {
    if (typeof fetch === 'undefined') return { ...DEFAULT_CONFIG };
    const res = await fetch('/rsvp/payments/lemon-squeezy-config.json', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!res || !res.ok) return { ...DEFAULT_CONFIG };
    const data = await res.json();
    if (!data || typeof data !== 'object') return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...data };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function logClick(config) {
  // Prefix makes it easy to grep devtools for the founder.
  try {
    console.log('[rsvp-pay] click', {
      ts: new Date().toISOString(),
      storeSlug: config.storeSlug,
      productSlug: config.productSlug,
      url: config.checkoutUrl,
    });
  } catch { /* ignore */ }
}

function openHostedCheckout(url) {
  // The "no account" thesis: a new tab to Lemon Squeezy's hosted page.
  // No RSVP-side state changes, no return-token, no cookie sync.
  try {
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) {
      // Popup blocked — fall back to a same-tab navigation so the user is
      // never silently stranded on the reader with no payment affordance.
      window.location.href = url;
    }
  } catch {
    try { window.location.href = url; } catch { /* ignore */ }
  }
}

/**
 * Lazy-loads the Lemon Squeezy overlay script. Idempotent.
 * Falls back to a hosted new-tab checkout if the script cannot load.
 */
function loadOverlayScript() {
  return new Promise((resolve) => {
    try {
      if (typeof document === 'undefined') return resolve(false);
      if (window.LemonSqueezy) return resolve(true);
      const existing = document.querySelector('script[data-lemon-squeezy]');
      if (existing) {
        existing.addEventListener('load', () => resolve(true), { once: true });
        existing.addEventListener('error', () => resolve(false), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://assets.lemonsqueezy.com/lemon.js';
      s.defer = true;
      s.setAttribute('data-lemon-squeezy', '1');
      s.addEventListener('load', () => resolve(true), { once: true });
      s.addEventListener('error', () => resolve(false), { once: true });
      document.head.appendChild(s);
    } catch {
      resolve(false);
    }
  });
}

async function tryOverlayCheckout(config) {
  const ok = await loadOverlayScript();
  if (!ok || !window.LemonSqueezy) return false;
  try {
    // Lemon Squeezy's overlay API: build the URL, call .open() with the
    // checkout URL. They render the modal in-page.
    window.LemonSqueezy.Url.Open(config.checkoutUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mount a payment button into `target`.
 *
 * Signature:
 *   mountPaymentButton(target: HTMLElement | string, opts?: object) => Promise<boolean>
 *
 * `opts` may include:
 *   - config: a config object to use directly (skips fetch)
 *   - label: button text override
 *   - onClick: extra click handler (called before navigation)
 *
 * If `target` is a `<button>`, we bind a click handler to it in place
 * (preserving its text/classes). If it's a container, we append a new button.
 * Returns true if a button was wired, false otherwise (flag not set, target
 * not found, config invalid).
 */
export async function mountPaymentButton(target, opts = {}) {
  if (!isPaymentsEnabled()) return false;
  if (typeof document === 'undefined') return false;

  const el = typeof target === 'string'
    ? document.getElementById(target) || document.querySelector(target)
    : target;
  if (!el) return false;

  const config = opts.config || await loadConfig();
  if (!config || !config.checkoutUrl) return false;

  const min = Number.isFinite(config.minimumPriceUsd) ? config.minimumPriceUsd : 5;

  const onActivate = async (ev) => {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    logClick(config);
    if (typeof opts.onClick === 'function') {
      try { opts.onClick(ev, config); } catch { /* ignore */ }
    }
    const overlayOk = await tryOverlayCheckout(config);
    if (!overlayOk) openHostedCheckout(config.checkoutUrl);
  };

  // If the target is already a button, just bind the handler.
  if (el.tagName === 'BUTTON') {
    el.addEventListener('click', onActivate);
    if (opts.label) el.textContent = opts.label;
    return true;
  }

  // Container: append a fresh button.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lib-action-btn payment-btn';
  button.dataset.paymentBtn = 'lemon-squeezy';
  button.textContent = opts.label || `Pay what you want ($${min}+)`;
  button.addEventListener('click', onActivate);

  if (!el.children.length) {
    el.appendChild(button);
  } else {
    el.innerHTML = '';
    el.appendChild(button);
  }

  return true;
}

export const __FLAG_KEY = FLAG_KEY;
