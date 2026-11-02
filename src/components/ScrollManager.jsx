import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { scrollToTarget, useLenis } from './SmoothScroll.jsx';

/**
 * Resets the scroll position on page changes and scrolls to #hash targets
 * (e.g. /portfolio#tshirts), waiting for lazily loaded pages to render first.
 */
export default function ScrollManager() {
  const { pathname, hash } = useLocation();
  const lenis = useLenis();
  const lenisRef = useRef(lenis);
  const lastPath = useRef(null);
  lenisRef.current = lenis;

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  }, []);

  useEffect(() => {
    const samePage = lastPath.current === pathname;
    lastPath.current = pathname;

    if (!hash) {
      scrollToTarget(lenisRef.current, 0, { immediate: true });
      return undefined;
    }

    const id = decodeURIComponent(hash.slice(1));
    let frame = 0;
    let tries = 0;
    const find = () => {
      const el = document.getElementById(id);
      if (el) scrollToTarget(lenisRef.current, el, { immediate: !samePage });
      else if (tries++ < 120) frame = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);

  return null;
}
