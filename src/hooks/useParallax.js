import { useEffect } from 'react';
import { useLenis } from '../components/SmoothScroll.jsx';

const MOBILE_QUERY = '(max-width: 720px)';
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Distance from the top of the document to the top of `el`, ignoring CSS transforms. */
function documentTop(el) {
  let top = 0;
  for (let node = el; node; node = node.offsetParent) top += node.offsetTop;
  return top;
}

function readTargets(root) {
  return Array.from(root.querySelectorAll('[data-parallax]')).map((el) => ({
    el,
    speed: Number.parseFloat(el.dataset.parallax) || 0,
    mode: el.dataset.parallaxMode === 'top' ? 'top' : 'center',
    clampOverflow: el.dataset.parallaxClamp === 'overflow',
    max: el.dataset.parallaxMax ? Number.parseFloat(el.dataset.parallaxMax) : Infinity,
    top: 0,
    height: 0,
    overflow: 0,
    last: null
  }));
}

/**
 * Scroll parallax for every `[data-parallax]` element inside `rootRef`.
 * Writes a pixel offset to the CSS custom property `--py`; styles.css turns it into a transform.
 *   data-parallax="0.25"           speed as a fraction of the scroll distance
 *   data-parallax-mode="top"       offset = scrollY * speed (for the hero at the top of the page)
 *   data-parallax-mode="center"    offset = (viewport centre - element centre) * speed (default)
 *   data-parallax-clamp="overflow" keep the offset within the element's overflow beyond its parent
 *   data-parallax-max="28"         keep the offset within +/- 28 px
 * Does nothing (and clears --py) when the visitor prefers reduced motion. Speeds are halved on phones.
 */
export default function useParallax(rootRef) {
  const lenis = useLenis();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const reducedMotion = window.matchMedia(MOTION_QUERY);
    const mobile = window.matchMedia(MOBILE_QUERY);
    let targets = readTargets(root);
    let frame = 0;

    const clear = () => targets.forEach((t) => {
      t.el.style.removeProperty('--py');
      if (t.mode === 'top') {
        t.el.style.removeProperty('--hero-scale');
        t.el.style.removeProperty('--hero-dim');
        t.el.style.removeProperty('--hero-copy-opacity');
      }
      t.last = null;
    });

    const measure = () => {
      targets.forEach((t) => {
        t.top = documentTop(t.el);
        t.height = t.el.offsetHeight;
        const parent = t.el.parentElement;
        t.overflow = parent ? Math.max(0, (t.height - parent.clientHeight) / 2) : 0;
      });
    };

    const update = () => {
      frame = 0;
      if (reducedMotion.matches) return;
      const scrollY = window.scrollY;
      const viewportCentre = scrollY + window.innerHeight / 2;
      const factor = mobile.matches ? 0.5 : 1;
      targets.forEach((t) => {
        let py = t.mode === 'top'
          ? scrollY * t.speed
          : (viewportCentre - (t.top + t.height / 2)) * t.speed;
        py *= factor;
        if (t.clampOverflow) py = Math.max(-t.overflow, Math.min(t.overflow, py));
        if (Number.isFinite(t.max)) py = Math.max(-t.max, Math.min(t.max, py));
        if (t.last !== null && Math.abs(py - t.last) < 0.1) return;
        t.last = py;
        t.el.style.setProperty('--py', py.toFixed(2));
        if (t.mode === 'top') {
          const progress = Math.max(0, Math.min(1, py / 600));
          t.el.style.setProperty('--hero-scale', (1 - Math.min(py, 240) / 6000).toFixed(4));
          t.el.style.setProperty('--hero-dim', (progress * 0.3).toFixed(3));
          t.el.style.setProperty('--hero-copy-opacity', (1 - progress).toFixed(3));
        }
      });
    };

    // Coalesce bursts of scroll events into one write per frame.
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const remeasure = () => { measure(); schedule(); };
    // The product cards render again once the category list arrives, so pick up new elements.
    const refresh = () => { clear(); targets = readTargets(root); remeasure(); };
    const onMotionChange = () => { if (reducedMotion.matches) clear(); else remeasure(); };

    measure();
    update();

    // Lenis fires per animation frame while scrolling; the window event covers native scrolling.
    if (lenis) lenis.on('scroll', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', remeasure);
    reducedMotion.addEventListener('change', onMotionChange);
    const observer = new ResizeObserver(remeasure);
    observer.observe(document.body);
    const mutations = new MutationObserver(refresh);
    mutations.observe(root, { childList: true, subtree: true });

    return () => {
      if (lenis) lenis.off('scroll', schedule);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', remeasure);
      reducedMotion.removeEventListener('change', onMotionChange);
      observer.disconnect();
      mutations.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clear();
    };
  }, [rootRef, lenis]);
}
