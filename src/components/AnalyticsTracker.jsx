import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Google Analytics 4 web stream for frescony.uk. Measurement IDs are public by design.
const GA_MEASUREMENT_ID = 'G-1VZ2VV7005';
const SESSION_KEY = '_fs_sid';

/**
 * Only real visitors on the public site are tracked: no staff back office,
 * no local development, no private-network previews. This keeps the
 * Google Analytics property free of test traffic.
 */
function isTrackableHost(hostname) {
  return !(
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === '[::1]'
  );
}

let gaLoaded = false;

function loadGoogleAnalytics() {
  if (gaLoaded) return;
  gaLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  // Page views are sent manually on every route change (this is a single-page app).
  window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `sid_${Math.random().toString(36).slice(2, 12)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Server-side visit log (IP / location / device), stored in our own database. */
function logVisit(pageUrl, referrer) {
  try {
    const payload = JSON.stringify({ pageUrl, referrer, sessionId: sessionId() });
    const endpoint = '/api/analytics/collect';
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
    }
  } catch {
    // Tracking must never break the site.
  }
}

export default function AnalyticsTracker() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (pathname.startsWith('/admin')) return;
    if (!isTrackableHost(window.location.hostname)) return;

    loadGoogleAnalytics();
    // Wait a tick so the new page has rendered and set its document title.
    const timer = setTimeout(() => {
      window.gtag('event', 'page_view', {
        page_location: window.location.href,
        page_path: pathname + search,
        page_title: document.title
      });
      logVisit(pathname + search, document.referrer || null);
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname, search]);

  return null;
}
