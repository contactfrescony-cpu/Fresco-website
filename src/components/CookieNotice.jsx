import { useState } from 'react';
import { Link } from 'react-router-dom';

// Keep false until a real analytics service and consent flow are configured.
const ANALYTICS_ENABLED = false;
const STORAGE_KEY = 'fresco-cookie-choice';

export default function CookieNotice() {
  const [visible, setVisible] = useState(() => {
    if (!ANALYTICS_ENABLED) return false;
    try { return !localStorage.getItem(STORAGE_KEY); } catch { return false; }
  });

  if (!visible) return null;

  const accept = () => {
    try { localStorage.setItem(STORAGE_KEY, 'continued'); } catch { /* storage unavailable */ }
    setVisible(false);
  };

  return (
    <div className="notice" role="region" aria-label="Analytics notice">
      <p>We use analytics to understand visits by country and improve the website. See our <Link to="/privacy">privacy note</Link>.</p>
      <button type="button" onClick={accept}>Continue</button>
    </div>
  );
}
