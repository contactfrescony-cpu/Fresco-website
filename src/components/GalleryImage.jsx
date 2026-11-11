import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchGallery } from '../lib/gallery.js';

const FALLBACK_AFTER_MS = 1200;
const AXIS_LOCK_PX = 8;          // movement needed before deciding swipe vs. page scroll
const SWIPE_MIN_PX = 50;         // shortest swipe that changes the image…
const SWIPE_MIN_SHARE = 0.18;    // …or this share of the carousel width, whichever is smaller
const WHEEL_MIN_PX = 40;         // horizontal trackpad scroll needed to change the image
const WHEEL_PAUSE_MS = 450;      // one trackpad gesture changes the image only once

const nextFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

/**
 * Sliding image carousel fed from /api/gallery/<key>: the photos managed in the back office (stored in
 * Google Drive), or for product categories the gallery/ folder when the database is unreachable.
 * - Slides to the next image every `interval` ms (default 5 s), looping seamlessly.
 * - Swipe left / right with a finger, by dragging with the mouse, or with a two-finger trackpad swipe;
 *   vertical swipes still scroll the page.
 * - `arrows`: previous / next buttons, shown on large screens with a mouse or trackpad (see styles.css).
 *   Leave it off inside links (buttons cannot sit inside a link).
 * - Pauses while hovered with a mouse, while touched, off screen, or when the browser tab is hidden.
 * - Each image is downloaded only just before it slides in (or when it might be swiped to).
 * - Uses the bundled `fallback` image, if given, when there are no photos or the API is unavailable;
 *   without one, an empty frame is shown (the Development page sections use Drive photos only).
 */
export default function GalleryImage({ gallery, fallback, interval = 5000, alt = '', className, arrows = false, ...imgProps }) {
  const rootRef = useRef(null);
  const [images, setImages] = useState(null);
  const [index, setIndex] = useState(0);           // equals images.length while showing the loop clone
  const [animate, setAnimate] = useState(true);
  const [dragOffset, setDragOffset] = useState(null); // px while dragging, else null
  const [restart, setRestart] = useState(0);       // bumped after a manual change so auto-advance waits a full interval
  const [loaded, setLoaded] = useState(() => new Set([0]));
  const live = useRef({ index: 0, inView: false, hovered: false, dragging: false });
  const drag = useRef(null);
  const swipedAt = useRef(0);
  const wheel = useRef({ sum: 0, lockedUntil: 0 });
  const count = images?.length ?? 0;

  const markLoaded = useCallback((...slides) => setLoaded((prev) => {
    if (slides.every((slide) => prev.has(slide))) return prev;
    const next = new Set(prev);
    slides.forEach((slide) => next.add(slide));
    return next;
  }), []);

  const loadNeighbours = useCallback(() => {
    if (count < 2) return;
    const real = live.current.index % count;
    markLoaded((real + 1) % count, (real - 1 + count) % count);
  }, [count, markLoaded]);

  // Folder listing (falls back to the bundled image if slow, empty or unavailable).
  useEffect(() => {
    let cancelled = false;
    const backup = fallback ? [fallback] : [];
    const timer = setTimeout(() => setImages((current) => current ?? backup), FALLBACK_AFTER_MS);
    fetchGallery(gallery).then((list) => {
      if (cancelled) return;
      clearTimeout(timer);
      live.current.index = 0;
      setIndex(0);
      setLoaded(new Set([0]));
      setImages(list.length ? list : backup);
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
    const paused = () => live.current.hovered || live.current.dragging;
    const timer = setInterval(() => {
      const state = live.current;
      if (paused()) return;
      if (state.index >= count) {           // missed transitionend (e.g. hidden tab): reset quietly
        state.index = 0;
        setAnimate(false);
        setIndex(0);
        return;
      }
      if (!state.inView || document.hidden) return;
      const next = state.index + 1;
      const real = next % count;
      const preload = new Image();
      preload.onload = () => {
        if (cancelled || paused() || state.index !== next - 1) return;
        state.index = next;
        markLoaded(real);
        setAnimate(true);
        setIndex(next);
      };
      preload.src = images[real];
    }, interval);
    return () => { cancelled = true; clearInterval(timer); };
  }, [images, count, interval, restart, markLoaded]);

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

  /** Slides one image back (-1) or forward (+1), looping at both ends. */
  const step = useCallback((direction) => {
    if (count < 2) return;
    const state = live.current;
    const at = state.index;
    const slideTo = (to) => {
      state.index = to;
      markLoaded(to % count);
      setAnimate(true);
      setIndex(to);
    };
    // The first image and its loop clone (after the last image) look identical: jump between them
    // without animation, then slide, so looping in either direction is seamless.
    if (direction < 0 && at % count === 0) {
      state.index = count;
      setAnimate(false);
      setIndex(count);
      nextFrame(() => slideTo(count - 1));
    } else if (direction > 0 && at >= count) {
      state.index = 0;
      setAnimate(false);
      setIndex(0);
      nextFrame(() => slideTo(1));
    } else {
      slideTo(at + direction);
    }
    setRestart((n) => n + 1);
  }, [count, markLoaded]);

  // ----- Dragging: finger, pen or mouse -----
  const handlePointerDown = (event) => {
    if (count < 2 || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target.closest('button')) return;        // arrow buttons handle their own clicks
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, axis: null, width: rootRef.current.offsetWidth || 1 };
    live.current.dragging = true;
    loadNeighbours();
    if (event.pointerType === 'mouse') {
      event.preventDefault();                          // no text selection while dragging
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.id) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      state.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (state.axis === 'y') {             // vertical: let the page scroll as normal
        drag.current = null;
        live.current.dragging = false;
        return;
      }
    }
    // Swap between the first image and its identical loop clone, so a drag to the right from the
    // first image reveals the last one, and vice versa.
    const at = live.current.index;
    const wanted = dx > 0 && at % count === 0 ? count : dx <= 0 && at >= count ? 0 : at;
    if (wanted !== at) {
      live.current.index = wanted;
      setIndex(wanted);
    }
    state.dx = Math.max(-state.width, Math.min(state.width, dx));
    setDragOffset(state.dx);
  };

  const handlePointerEnd = (event) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.id) return;
    drag.current = null;
    live.current.dragging = false;
    if (state.axis !== 'x') return;
    swipedAt.current = Date.now();
    // A cancelled pointer (the browser took over) snaps back instead of changing the image.
    const threshold = event.type === 'pointercancel' ? Infinity : Math.min(SWIPE_MIN_PX, state.width * SWIPE_MIN_SHARE);
    let next = live.current.index;
    if (state.dx <= -threshold) next += 1;
    else if (state.dx >= threshold) next -= 1;
    live.current.index = next;
    setAnimate(true);
    setDragOffset(null);
    setIndex(next);
    setRestart((n) => n + 1);
  };

  // A swipe or drag over a card link should not also open the link.
  const handleClickCapture = (event) => {
    if (Date.now() - swipedAt.current < 400) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  // Two-finger horizontal trackpad swipe. Registered natively (not passive) so the browser's own
  // "swipe to go back" gesture does not fire while swiping through the photos.
  useEffect(() => {
    const element = rootRef.current;
    if (!element || count < 2) return undefined;
    const onWheel = (event) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const state = wheel.current;
      const now = Date.now();
      if (now < state.lockedUntil) { state.lockedUntil = now + WHEEL_PAUSE_MS; return; }
      state.sum += event.deltaX;
      if (Math.abs(state.sum) < WHEEL_MIN_PX) return;
      step(state.sum > 0 ? 1 : -1);
      state.sum = 0;
      state.lockedUntil = now + WHEEL_PAUSE_MS;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [count, step]);

  const slides = count > 1 ? [...images, images[0]] : (images ?? []);
  const active = count ? index % count : 0;
  const dragging = dragOffset !== null;
  const transform = dragging
    ? `translate3d(calc(${-index * 100}% + ${dragOffset}px),0,0)`
    : `translate3d(${-index * 100}%,0,0)`;
  const classes = ['gallery-carousel', count > 1 && 'is-multi', dragging && 'is-dragging', className].filter(Boolean).join(' ');

  return (
    <div
      ref={rootRef}
      className={classes}
      data-gallery={gallery}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        live.current.hovered = true;
        loadNeighbours();                    // so the arrows and drags show the next photo at once
      }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') live.current.hovered = false; }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClickCapture={handleClickCapture}
    >
      <div
        className={animate && !dragging ? 'gallery-track' : 'gallery-track no-anim'}
        style={{ transform }}
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
      {arrows && count > 1 && (
        <>
          <button type="button" className="gallery-arrow is-prev" onClick={() => step(-1)} aria-label="Previous photo">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14.5 5.5-6.5 6.5 6.5 6.5" /></svg>
          </button>
          <button type="button" className="gallery-arrow is-next" onClick={() => step(1)} aria-label="Next photo">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></svg>
          </button>
        </>
      )}
      {count > 1 && (
        <div className="gallery-dots" aria-hidden="true">
          {images.map((src, i) => <span key={src} className={i === active ? 'is-active' : undefined} />)}
        </div>
      )}
    </div>
  );
}
