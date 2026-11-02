import { useEffect, useRef, useState } from 'react';
import { fetchGallery } from '../lib/gallery.js';

const FALLBACK_AFTER_MS = 1200;

/**
 * Sliding image carousel fed from a server folder (gallery/* or development-images/*).
 * - Slides to the next image every `interval` ms (default 5 s), looping seamlessly.
 * - Pauses while hovered, off screen, or when the browser tab is hidden.
 * - Each image is downloaded only just before it slides in.
 * - Uses the bundled `fallback` image if the folder is empty or the API is unavailable.
 */
export default function GalleryImage({ gallery, fallback, interval = 5000, alt = '', className, ...imgProps }) {
  const rootRef = useRef(null);
  const [images, setImages] = useState(null);
  const [index, setIndex] = useState(0);           // equals images.length while showing the loop clone
  const [animate, setAnimate] = useState(true);
  const [loaded, setLoaded] = useState(() => new Set([0]));
  const live = useRef({ index: 0, inView: false, paused: false });
  const count = images?.length ?? 0;

  // Folder listing (falls back to the bundled image if slow, empty or unavailable).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => setImages((current) => current ?? [fallback]), FALLBACK_AFTER_MS);
    fetchGallery(gallery).then((list) => {
      if (cancelled) return;
      clearTimeout(timer);
      live.current.index = 0;
      setIndex(0);
      setLoaded(new Set([0]));
      setImages(list.length ? list : [fallback]);
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [gallery, fallback]);

  // Only rotate while the carousel is on (or near) the screen.
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { live.current.inView = entry.isIntersecting; }, { rootMargin: '120px' });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  // Auto-advance: preload the next image, then slide to it.
  useEffect(() => {
    if (count < 2) return undefined;
    let cancelled = false;
    const timer = setInterval(() => {
      const state = live.current;
      if (state.index >= count) {           // missed transitionend (e.g. hidden tab): reset quietly
        state.index = 0;
        setAnimate(false);
        setIndex(0);
        return;
      }
      if (!state.inView || state.paused || document.hidden) return;
      const next = state.index + 1;
      const real = next % count;
      const preload = new Image();
      preload.onload = () => {
        if (cancelled || state.index !== next - 1) return;
        state.index = next;
        setLoaded((prev) => (prev.has(real) ? prev : new Set(prev).add(real)));
        setAnimate(true);
        setIndex(next);
      };
      preload.src = images[real];
    }, interval);
    return () => { cancelled = true; clearInterval(timer); };
  }, [images, count, interval]);

  // Re-enable the slide transition one frame after an instant jump.
  useEffect(() => {
    if (animate) return undefined;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setAnimate(true)); });
    return () => cancelAnimationFrame(frame);
  }, [animate]);

  // After sliding onto the clone of the first image, jump back to the real first image.
  const handleTransitionEnd = (event) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
    if (live.current.index >= count) {
      live.current.index = 0;
      setAnimate(false);
      setIndex(0);
    }
  };

  const slides = count > 1 ? [...images, images[0]] : (images ?? []);
  const active = count ? index % count : 0;

  return (
    <div
      ref={rootRef}
      className={className ? `gallery-carousel ${className}` : 'gallery-carousel'}
      data-gallery={gallery}
      onMouseEnter={() => { live.current.paused = true; }}
      onMouseLeave={() => { live.current.paused = false; }}
    >
      <div
        className={animate ? 'gallery-track' : 'gallery-track no-anim'}
        style={{ transform: `translate3d(${-index * 100}%,0,0)` }}
        onTransitionEnd={handleTransitionEnd}
      >
        {slides.map((src, i) => {
          const isCurrent = i === index;
          return (
            <img
              key={i}
              src={loaded.has(count ? i % count : 0) ? src : undefined}
              alt={isCurrent ? alt : ''}
              aria-hidden={isCurrent ? undefined : true}
              loading="lazy"
              decoding="async"
              draggable="false"
              {...imgProps}
            />
          );
        })}
      </div>
      {count > 1 && (
        <div className="gallery-dots" aria-hidden="true">
          {images.map((src, i) => <span key={src} className={i === active ? 'is-active' : undefined} />)}
        </div>
      )}
    </div>
  );
}
