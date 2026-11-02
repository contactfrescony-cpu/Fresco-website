import { createContext, useContext, useEffect, useState } from 'react';
import Lenis from 'lenis';

const LenisContext = createContext(null);

/** The active Lenis instance, or null when smooth scrolling is off (reduced motion). */
export const useLenis = () => useContext(LenisContext);

/**
 * Scroll to a pixel position or element through Lenis, falling back to native scrolling.
 * The gap for the sticky header comes from `scroll-margin-top` in styles.css, which Lenis,
 * scrollIntoView and the browser's own #anchor jump all respect.
 */
export function scrollToTarget(lenis, target, { immediate = false } = {}) {
  if (lenis) {
    // Lenis re-measures the page on a 250 ms debounce; a page that just rendered would
    // otherwise be clamped to the previous page's height.
    lenis.resize();
    lenis.scrollTo(target, { immediate, force: true });
    return;
  }
  const behavior = immediate ? 'instant' : 'smooth';
  if (typeof target === 'number') window.scrollTo({ top: target, behavior });
  else target.scrollIntoView({ behavior, block: 'start' });
}

export default function SmoothScroll({ children }) {
  const [lenis, setLenis] = useState(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let instance = null;

    const setup = () => {
      instance?.destroy();
      instance = reducedMotion.matches
        ? null
        : new Lenis({
            autoRaf: true,
            lerp: 0.1,
            smoothWheel: true,
            // Touch devices keep their native momentum scrolling.
            syncTouch: false
          });
      setLenis(instance);
    };

    setup();
    reducedMotion.addEventListener('change', setup);
    return () => {
      reducedMotion.removeEventListener('change', setup);
      instance?.destroy();
    };
  }, []);

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>;
}
