import React, { useEffect, useRef, useState, useCallback } from "react";
import { BRAND, GARMENTS, ART, Garment } from "../../lib/spatial-rail-data";
import { useLenis } from "../SmoothScroll.jsx";
import "./spatial-rail.css";

function Image({ priority: _priority, unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; unoptimized?: boolean }) {
  return <img {...props} />;
}

function Link({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href} {...props} />;
}

const TOTAL = GARMENTS.length;
const CANVAS_W = ART.canvas.w;
const CANVAS_H = ART.canvas.h;
const HOOK_Y = ART.canvas.hookY;
const FT = CANVAS_W / CANVAS_H;
const BT = (HOOK_Y + 0.0115 * CANVAS_H) / CANVAS_H;

// Smoothstep helper
function smoothstep(min: number, max: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Convert hex to rgb tuple
function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const GARMENT_COLORS = GARMENTS.map((g) => hexToRgb(ART.garments[g.id]?.color || "#8a8780"));

function getTintRgb(pos: number): string {
  const clamped = clamp(pos, 0, TOTAL - 1);
  const idx = Math.floor(clamped);
  const next = Math.min(TOTAL - 1, idx + 1);
  const frac = clamped - idx;
  const c1 = GARMENT_COLORS[idx];
  const c2 = GARMENT_COLORS[next];
  const r = Math.round(lerp(c1[0], c2[0], frac));
  const g = Math.round(lerp(c1[1], c2[1], frac));
  const b = Math.round(lerp(c1[2], c2[2], frac));
  return `rgb(${r}, ${g}, ${b})`;
}

interface BagItem {
  garment: Garment;
  size: string;
  qty: number;
}

export default function CurvedRail() {
  const lenis = useLenis();
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hangersRef = useRef<HTMLDivElement>(null);

  // State
  const [activeIdx, setActiveIdx] = useState(0);
  const activeIdxRef = useRef(0);
  const [isHoveredGarment, setIsHoveredGarment] = useState<number | null>(null);
  const isHoveredGarmentRef = useRef<number | null>(null);
  const [hoverTag, setHoverTag] = useState<{ text: string; x: number; y: number } | null>(null);
  const [isLookCloserOpen, setIsLookCloserOpen] = useState(false);
  const [selectedView, setSelectedView] = useState("front");
  const [selectedSize, setSelectedSize] = useState("M");
  const [bag, setBag] = useState<BagItem[]>([]);
  const [isBagOpen, setIsBagOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Animation Refs
  const targetPos = useRef(0);
  const currentPos = useRef(0);
  const velocity = useRef(0);
  const pulls = useRef<number[]>(new Array(TOTAL).fill(0));
  const pullVelocities = useRef<number[]>(new Array(TOTAL).fill(0));
  const reducedMotion = useRef(false);
  const isDragging = useRef(false);
  const dragMoved = useRef(false);
  const dragPointerId = useRef<number | null>(null);
  const dragStartX = useRef(0);
  const dragStartPos = useRef(0);
  const rafId = useRef<number | null>(null);
  const snapTimer = useRef<number | null>(null);

  // Responsive / Layout parameters
  const layout = useRef({
    F: { x: 0, y: 0 },
    V: { x: 0, y: 0 },
    C: { x: 0, y: 0 },
    Hf: 0,
    W: 0,
    H: 0,
    isMobile: false,
  });

  // Calculate curve point
  const getCurvePoint = useCallback((t: number) => {
    const { F: e, V: n, C: s } = layout.current;
    if (t < 0) {
      return {
        x: e.x + 2 * t * (s.x - e.x),
        y: e.y + 2 * t * (s.y - e.y),
      };
    }
    const a = 1 - t;
    return {
      x: a * a * e.x + 2 * t * a * s.x + t * t * n.x,
      y: a * a * e.y + 2 * t * a * s.y + t * t * n.y,
    };
  }, []);

  // Update layout and draw chrome rod canvas
  const updateLayoutAndCanvas = useCallback(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const isMobile = window.innerWidth < 760 || (window.innerWidth < 1100 && window.innerHeight > window.innerWidth);
    const barHeight = isMobile ? 58 : 68;

    let e = { x: W * 0.29, y: barHeight + H * 0.03 };
    let n = { x: W * 0.7, y: H * 0.3 };
    let s = Math.min((H * 0.97 - e.y) / 0.84, (W * 0.44) / FT);
    let c = { x: e.x + (n.x - e.x) * 0.56, y: H * 0.6 };

    if (isMobile) {
      e = { x: W * 0.4, y: barHeight + H * 0.035 };
      n = { x: W * 0.99, y: H * 0.27 };
      s = Math.min((H * 0.86 - 18 - e.y) / 0.86, (W * 1.05) / FT);
      c = { x: e.x + (n.x - e.x) * 0.5, y: H * 0.54 };
    }

    layout.current = { F: e, V: n, C: c, Hf: s, W, H, isMobile };

    // Setup canvas
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const rodBaseWidth = isMobile ? 4.6 : 6.4;
    const steps = 140;
    const uMin = -2.4;
    const uMax = 0.995;

    const getParamWidth = (u: number) => {
      if (u >= 0) {
        const depth = (1 / Math.max(0.005, 1 - u) - 1) / 0.85;
        return 1 / (1 + 0.62 * depth);
      }
      return 1 - 0.45 * u;
    };

    const points = Array.from({ length: steps + 1 }, (_, i) => {
      const u = lerp(uMin, uMax, i / steps);
      const pt = getCurvePoint(u);
      const ptNext = getCurvePoint(u + 0.003);
      const dist = Math.hypot(ptNext.x - pt.x, ptNext.y - pt.y) || 1;
      return {
        u,
        x: pt.x,
        y: pt.y,
        nx: -(ptNext.y - pt.y) / dist,
        ny: (ptNext.x - pt.x) / dist,
        hw: rodBaseWidth * getParamWidth(u),
      };
    });

    const fadeFactor = (u: number, y: number) =>
      (1 - smoothstep(0.72, 0.995, u)) * smoothstep(barHeight - 6, barHeight + 34, y);

    // Offscreen shadow
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = canvas.width;
    shadowCanvas.height = canvas.height;
    const sCtx = shadowCanvas.getContext("2d");
    if (sCtx) {
      sCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sCtx.filter = `blur(${isMobile ? 4 : 6}px)`;
      sCtx.fillStyle = "rgba(60, 44, 30, 0.22)";
      sCtx.beginPath();
      points.forEach((p, idx) => {
        const sy = p.y + p.hw * 2.6 + 3;
        if (idx === 0) sCtx.moveTo(p.x, sy);
        else sCtx.lineTo(p.x, sy);
      });
      for (let i = steps; i >= 0; i--) {
        const p = points[i];
        sCtx.lineTo(p.x, p.y + p.hw * 0.6 + 3);
      }
      sCtx.fill();
      sCtx.filter = "none";
      sCtx.globalCompositeOperation = "destination-in";
      const grad = sCtx.createLinearGradient(0, barHeight, 0, barHeight + 50);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "#000");
      sCtx.fillStyle = grad;
      sCtx.fillRect(0, 0, W, H);
      ctx.drawImage(shadowCanvas, 0, 0, W, H);
    }

    // Chrome rod segments with reflections
    for (let i = 0; i < steps; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const extX = p2.x + (p2.x - p1.x) * 0.35;
      const extY = p2.y + (p2.y - p1.y) * 0.35;
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const midHw = (p1.hw + p2.hw) / 2;
      const sign = p1.ny < 0 ? 1 : -1;
      const normX = p1.nx * sign;
      const normY = p1.ny * sign;

      const grad = ctx.createLinearGradient(
        midX - normX * midHw,
        midY - normY * midHw,
        midX + normX * midHw,
        midY + normY * midHw
      );
      grad.addColorStop(0, "#2d2c2a");
      grad.addColorStop(0.3, "#8d8a85");
      grad.addColorStop(0.58, "#e4e2dd");
      grad.addColorStop(0.72, "#ffffff");
      grad.addColorStop(0.86, "#b9b6b0");
      grad.addColorStop(1, "#4a4844");

      ctx.globalAlpha = fadeFactor(p1.u, p1.y);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(p1.x + p1.nx * p1.hw, p1.y + p1.ny * p1.hw);
      ctx.lineTo(extX + p2.nx * p2.hw, extY + p2.ny * p2.hw);
      ctx.lineTo(extX - p2.nx * p2.hw, extY - p2.ny * p2.hw);
      ctx.lineTo(p1.x - p1.nx * p1.hw, p1.y - p1.ny * p1.hw);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [getCurvePoint]);

  // Position hangers and update styles
  const updateHangers = useCallback(() => {
    const hangersEl = hangersRef.current;
    if (!hangersEl) return;
    const { Hf } = layout.current;
    const cur = currentPos.current;

    const children = hangersEl.children;
    let pullOffset = 0;
    const diffs = Array.from({ length: TOTAL }, (_, idx) => {
      const baseDiff = idx - cur;
      const offsetBefore = pullOffset;
      if (pulls.current[idx] > 0.001 && baseDiff > 0.4) pullOffset += 0.55 * pulls.current[idx];
      return baseDiff + offsetBefore;
    });
    for (let idx = 0; idx < TOTAL; idx++) {
      const el = children[idx] as HTMLElement;
      if (!el) continue;

      const diff = diffs[idx];
      if (diff < -1.2 || diff > TOTAL + 1) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "";

      let scale: number;
      let pos: { x: number; y: number };
      let opacity = 1;

      if (diff >= 0) {
        scale = 1 / (1 + 0.62 * diff);
        const curveParam = 1 - 1 / (1 + 0.85 * diff);
        pos = getCurvePoint(curveParam);
        opacity = 1 - smoothstep(5, 9.5, diff) * 0.55;
      } else {
        const absDiff = -diff;
        scale = 1 + 0.32 * absDiff;
        pos = getCurvePoint(-0.55 * absDiff);
        opacity = 1 - smoothstep(0.05, 0.85, absDiff);
      }

      scale *= 1 + 0.06 * pulls.current[idx];

      const hgt = Hf * scale;
      const wid = hgt * FT;

      el.style.width = `${wid}px`;
      el.style.height = `${hgt}px`;

      el.style.transform = `translate(${(pos.x - wid / 2).toFixed(1)}px, ${(
        pos.y -
        hgt * BT
      ).toFixed(1)}px)`;
      el.style.opacity = opacity.toFixed(3);
      el.style.zIndex = String(100 - Math.round(diff * 4));

      // Keep the baked garment-and-hanger image permanently front-facing.
      const frontImg = el.querySelector(".front") as HTMLElement;
      if (frontImg) {
        frontImg.style.opacity = "1";
        frontImg.style.transform = "none";
      }
    }
  }, [getCurvePoint]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      reducedMotion.current = query.matches;
    };
    syncPreference();
    query.addEventListener("change", syncPreference);
    return () => query.removeEventListener("change", syncPreference);
  }, []);

  // Main animation frame loop. Pause it entirely when the rail is off screen.
  useEffect(() => {
    let lastTime = performance.now();
    let railIsVisible = true;

    const loop = (time: number) => {
      rafId.current = null;
      const dt = Math.min(0.05, (time - lastTime) / 1000);
      lastTime = time;

      if (reducedMotion.current) {
        velocity.current = 0;
        currentPos.current = targetPos.current;
      } else {
        const stiffness = 70;
        const damping = 2 * Math.sqrt(stiffness) * 1.02;
        velocity.current += (stiffness * (targetPos.current - currentPos.current) - damping * velocity.current) * dt;
        currentPos.current += velocity.current * dt;
      }

      const roundIdx = Math.round(currentPos.current);

      for (let i = 0; i < TOTAL; i++) {
        const targetPull = isHoveredGarmentRef.current === i && i !== roundIdx ? 1 : 0;
        if (reducedMotion.current) {
          pulls.current[i] = targetPull;
          pullVelocities.current[i] = 0;
        } else {
          const pullStiffness = 120;
          const pullDamping = 2 * Math.sqrt(pullStiffness) * 0.9;
          pullVelocities.current[i] +=
            (pullStiffness * (targetPull - pulls.current[i]) - pullDamping * pullVelocities.current[i]) * dt;
          pulls.current[i] = clamp(pulls.current[i] + pullVelocities.current[i] * dt, -0.1, 1.2);
        }
      }

      updateHangers();

      // Check current item change
      const nearest = clamp(Math.round(currentPos.current), 0, TOTAL - 1);
      if (nearest !== activeIdxRef.current) {
        activeIdxRef.current = nearest;
        setActiveIdx(nearest);
      }

      // Dynamic wall tint
      const stage = stageRef.current;
      if (stage) {
        stage.style.setProperty("--tint", getTintRgb(currentPos.current));
      }

      if (railIsVisible && !document.hidden) rafId.current = requestAnimationFrame(loop);
    };

    const start = () => {
      if (rafId.current !== null || !railIsVisible || document.hidden) return;
      lastTime = performance.now();
      rafId.current = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
    };
    const observer = new IntersectionObserver(([entry]) => {
      railIsVisible = entry.isIntersecting;
      if (railIsVisible) start();
      else stop();
    }, { rootMargin: "160px 0px" });
    if (containerRef.current) observer.observe(containerRef.current);
    const handleVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", handleVisibility);
    start();

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [updateHangers]);

  // Redraw at most once per frame during viewport/address-bar resizes.
  useEffect(() => {
    let resizeFrame: number | null = null;
    const scheduleResize = () => {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        updateLayoutAndCanvas();
        updateHangers();
        const container = containerRef.current;
        if (container && !isDragging.current) {
          const maxScroll = container.offsetHeight - window.innerHeight;
          if (maxScroll > 0) {
            targetPos.current = clamp(-container.getBoundingClientRect().top / maxScroll, 0, 1) * (TOTAL - 1);
          }
        }
      });
    };
    updateLayoutAndCanvas();
    const observer = new ResizeObserver(scheduleResize);
    if (stageRef.current) observer.observe(stageRef.current);
    window.addEventListener("resize", scheduleResize, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleResize);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    };
  }, [updateLayoutAndCanvas, updateHangers]);

  const scrollRailTo = useCallback((top: number) => {
    if (lenis) {
      lenis.resize();
      lenis.scrollTo(top, { immediate: reducedMotion.current, force: true });
      return;
    }
    window.scrollTo({ top, behavior: reducedMotion.current ? "auto" : "smooth" });
  }, [lenis]);

  // Handle scroll along the rail container
  useEffect(() => {
    const handleScroll = () => {
      const container = containerRef.current;
      if (!container || isDragging.current) return;
      const rect = container.getBoundingClientRect();
      const maxScroll = container.offsetHeight - window.innerHeight;
      if (maxScroll <= 0) return;
      const scrollFrac = clamp(-rect.top / maxScroll, 0, 1);
      targetPos.current = scrollFrac * (TOTAL - 1);

      if (snapTimer.current) window.clearTimeout(snapTimer.current);
      snapTimer.current = window.setTimeout(() => {
        const activeContainer = containerRef.current;
        if (!activeContainer || isDragging.current) return;
        const activeRect = activeContainer.getBoundingClientRect();
        if (activeRect.top > 2 || activeRect.bottom < window.innerHeight - 2) return;
        const nearest = Math.round(targetPos.current);
        if (Math.abs(targetPos.current - nearest) <= 0.015) return;
        const activeMaxScroll = activeContainer.offsetHeight - window.innerHeight;
        const targetScroll = activeContainer.offsetTop + (nearest / (TOTAL - 1)) * activeMaxScroll;
        scrollRailTo(targetScroll);
      }, 180);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (snapTimer.current) window.clearTimeout(snapTimer.current);
    };
  }, [scrollRailTo]);

  // Go to specific garment index
  const goToIndex = useCallback((index: number) => {
    const clamped = clamp(index, 0, TOTAL - 1);
    targetPos.current = clamped;
    const container = containerRef.current;
    if (container) {
      const maxScroll = container.offsetHeight - window.innerHeight;
      const targetScroll = container.offsetTop + (clamped / (TOTAL - 1)) * maxScroll;
      scrollRailTo(targetScroll);
    }
  }, [scrollRailTo]);

  // Keyboard navigation (ArrowLeft / ArrowRight)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLookCloserOpen || isBagOpen) {
        if (e.key === "Escape") {
          setIsLookCloserOpen(false);
          setIsBagOpen(false);
        }
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.top > 1 || rect.bottom < window.innerHeight - 1) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goToIndex(Math.round(targetPos.current) + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToIndex(Math.round(targetPos.current) - 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLookCloserOpen, isBagOpen, goToIndex]);

  // Pointer move & Drag / Swipe handling
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".info, button, a")) return;
    isDragging.current = true;
    dragMoved.current = false;
    dragPointerId.current = e.pointerId;
    dragStartX.current = e.clientX;
    dragStartPos.current = targetPos.current;
    if (e.pointerType === "mouse") lenis?.stop();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isDragging.current) {
      if (Math.abs(e.clientX - dragStartX.current) > 5) dragMoved.current = true;
      const delta = (dragStartX.current - e.clientX) / 220;
      targetPos.current = clamp(dragStartPos.current + delta, 0, TOTAL - 1);
      return;
    }

    // Check hit test against garments
    const cur = currentPos.current;
    let hovered: number | null = null;
    let hoveredDepth = Infinity;
    const { Hf } = layout.current;

    for (let i = 0; i < TOTAL; i++) {
      const diff = i - cur;
      if (diff < -0.4 || diff > TOTAL + 1) continue;
      const scale = diff >= 0 ? 1 / (1 + 0.62 * diff) : 1 + 0.32 * -diff;
      const curveParam = diff >= 0 ? 1 - 1 / (1 + 0.85 * diff) : -0.55 * -diff;
      const pt = getCurvePoint(curveParam);
      const hgt = Hf * scale;
      const wid = hgt * FT;
      const halfW = (ART.garments[GARMENTS[i].id]?.half || CANVAS_W * 0.46) / CANVAS_W * wid;
      const bottom = (ART.garments[GARMENTS[i].id]?.bottom || CANVAS_H * 0.83) / CANVAS_H * hgt;
      const topY = pt.y - hgt * BT;

      if (x >= pt.x - halfW && x <= pt.x + halfW && y >= topY && y <= topY + bottom && diff < hoveredDepth) {
        hovered = i;
        hoveredDepth = diff;
      }
    }

    setIsHoveredGarment(hovered);
    isHoveredGarmentRef.current = hovered;
    if (hovered !== null && hovered !== Math.round(cur)) {
      setHoverTag({
        text: `${String(hovered + 1).padStart(2, "0")}  ${GARMENTS[hovered].name}`,
        x: x + 16,
        y: y + 18,
      });
    } else {
      setHoverTag(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragPointerId.current !== null && e.currentTarget.hasPointerCapture(dragPointerId.current)) {
      e.currentTarget.releasePointerCapture(dragPointerId.current);
    }
    const shouldSnap = isDragging.current && dragMoved.current;
    isDragging.current = false;
    dragPointerId.current = null;
    lenis?.start();
    if (shouldSnap) goToIndex(Math.round(targetPos.current));
  };

  const handlePointerLeave = () => {
    if (isDragging.current) return;
    setIsHoveredGarment(null);
    isHoveredGarmentRef.current = null;
    setHoverTag(null);
  };

  const handleStageClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".info, button, a")) return;
    if (dragMoved.current) {
      dragMoved.current = false;
      return;
    }
    if (isHoveredGarment !== null) goToIndex(isHoveredGarment);
  };

  // Add to Bag handler
  const handleAddToBag = (garment: Garment, size: string) => {
    setBag((prev) => {
      const existing = prev.find((item) => item.garment.id === garment.id && item.size === size);
      if (existing) {
        return prev.map((item) =>
          item.garment.id === garment.id && item.size === size ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { garment, size, qty: 1 }];
    });
    setToastMessage(`Added ${garment.name} (${size}) to bag`);
    setTimeout(() => setToastMessage(null), 3000);
    setIsLookCloserOpen(false);
  };

  const activeGarment = GARMENTS[activeIdx] || GARMENTS[0];
  const bagTotal = bag.reduce((sum, item) => sum + item.garment.price * item.qty, 0);
  const bagCount = bag.reduce((sum, item) => sum + item.qty, 0);

  useEffect(() => {
    if (!['#clothing', '#spatial-rail'].includes(window.location.hash)) return undefined;
    const frame = window.requestAnimationFrame(() => {
      containerRef.current?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="spatial-rail-root" id="spatial-rail">
      {/* Top Header Bar */}
      <header className="bar">
        <Link href="/portfolio" className="demo-badge">
          <span className="demo-badge-dot"></span>
          <span>LIVE DEMO</span>
        </Link>
        <Link href="/portfolio" className="mark">
          <svg className="mark-sym" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="12" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <rect
              x="9"
              y="3"
              width="12"
              height="14"
              fill="currentColor"
              fillOpacity="0.16"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
          <span className="mark-name">{BRAND.name}</span>
        </Link>
        <nav className="nav">
          <a className="link" href="#clothing">
            Clothing
          </a>
          <a className="link" href="#clothing">
            Jewellery
          </a>
          <a className="link" href="#clothing">
            Journal
          </a>
          <a className="link" href="#clothing">
            Visit
          </a>
        </nav>
        <button className="bag-btn" type="button" onClick={() => setIsBagOpen(true)}>
          <span>Bag</span>
          <span className="bag-count">{bagCount}</span>
        </button>
      </header>

      {/* Main Interactive Curved Rail Section */}
      <div
        ref={containerRef}
        className="rail"
        id="clothing"
        style={{ ["--steps" as string]: TOTAL - 1 }}
      >
        <div
          ref={stageRef}
          className={`stage ${isHoveredGarment !== null ? "is-pointing" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onClick={handleStageClick}
        >
          {/* Wall textured background */}
          <div className="wall has-photo" aria-hidden="true" />

          {/* Chrome Curved Rail Canvas */}
          <canvas ref={canvasRef} className="rod" aria-hidden="true" />

          {/* Hangers and Garments Container */}
          <div ref={hangersRef} className="hangers">
            {GARMENTS.map((g, i) => (
              <div key={g.id} className="hanger" data-index={i}>
                {/* The uniform hanger is baked directly into this generated front image. */}
                <Image
                  src={`/sites/spatial-rail/img/fresco-rail/fresco-${g.id}-hanger.webp`}
                  srcSet={`/sites/spatial-rail/img/fresco-rail/fresco-${g.id}-hanger-sm.webp 512w, /sites/spatial-rail/img/fresco-rail/fresco-${g.id}-hanger.webp 1024w`}
                  sizes={Math.abs(i - activeIdx) <= 1 ? "(max-width: 759px) 88vw, 44vw" : "16vw"}
                  alt={g.name}
                  width={1024}
                  height={1536}
                  className="front"
                  priority={i <= 2}
                  loading={i <= 2 ? "eager" : "lazy"}
                  decoding="async"
                  fetchPriority={i === activeIdx ? "high" : "auto"}
                  unoptimized
                />
              </div>
            ))}
          </div>

          {/* Hover tooltip tag */}
          {hoverTag && (
            <p
              className="tag is-on"
              style={{
                transform: `translate(${hoverTag.x.toFixed(0)}px, ${hoverTag.y.toFixed(0)}px)`,
              }}
            >
              {hoverTag.text}
            </p>
          )}

          {/* Left Vertical Counter */}
          <div className="count" aria-hidden="true">
            <span>{String(activeIdx + 1).padStart(2, "0")}</span>
            <i style={{ ["--prog" as string]: `${((activeIdx + 1) / TOTAL) * 100}%` }}></i>
            <span>{String(TOTAL).padStart(2, "0")}</span>
          </div>

          {/* Right Product Information Card */}
          <div className="info" aria-live="polite">
            <p className="info-kicker mono">
              <span>
                {String(activeIdx + 1).padStart(2, "0")} / {String(TOTAL).padStart(2, "0")}
              </span>
              <span>{activeGarment.colour.toUpperCase()}</span>
            </p>
            <h1 className="info-name">{activeGarment.name}</h1>
            <i className="info-rule" aria-hidden="true"></i>
            <p className="info-line">{activeGarment.line}</p>
            <dl className="info-specs">
              <dt>Material</dt>
              <dd>{activeGarment.material}</dd>
              <dt>Colour</dt>
              <dd>{activeGarment.colour}</dd>
              <dt>Sizes</dt>
              <dd>{activeGarment.sizes.join(" / ")}</dd>
            </dl>
            <p className="info-price">
              £{activeGarment.price} <small>EXAMPLE PRICE</small>
            </p>
            <div className="info-actions">
              <button className="btn" type="button" onClick={() => setIsLookCloserOpen(true)}>
                Look closer
              </button>
              <button
                className="btn btn-solid"
                type="button"
                onClick={() => handleAddToBag(activeGarment, selectedSize)}
              >
                Add to bag
              </button>
            </div>
            <div className="info-nav">
              <button
                type="button"
                onClick={() => goToIndex(activeIdx - 1)}
                disabled={activeIdx <= 0}
                aria-label="Previous piece"
              >
                &larr;
              </button>
              <span className="mono">
                {String(activeIdx + 1).padStart(2, "0")} / {String(TOTAL).padStart(2, "0")}
              </span>
              <button
                type="button"
                onClick={() => goToIndex(activeIdx + 1)}
                disabled={activeIdx >= TOTAL - 1}
                aria-label="Next piece"
              >
                &rarr;
              </button>
            </div>
          </div>

          {/* Bottom Hint */}
          <p className="hint mono">Scroll or drag to move along the rail</p>
        </div>
      </div>

      {/* Look Closer Modal Sheet */}
      {isLookCloserOpen && (
        <div className="sheet" onClick={() => setIsLookCloserOpen(false)}>
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <button
              className="sheet-close"
              type="button"
              onClick={() => setIsLookCloserOpen(false)}
              aria-label="Close"
            >
              &times;
            </button>
            <p className="mono sheet-kicker">
              {String(activeIdx + 1).padStart(2, "0")} / {String(TOTAL).padStart(2, "0")} · {activeGarment.colour}
            </p>
            <h2 className="sheet-title">{activeGarment.name}</h2>
            <p className="sheet-line">{activeGarment.line}</p>

            {/* View Selector Tabs */}
            <div className="views" role="tablist">
              {["front"].map((view) => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={selectedView === view}
                  onClick={() => setSelectedView(view)}
                >
                  {view === "worn"
                    ? "Worn"
                    : view === "fabric"
                    ? "Cloth"
                    : view.charAt(0).toUpperCase() + view.slice(1)}
                </button>
              ))}
            </div>

            {/* View Image Display */}
            <figure className="sheet-pic">
              <Image
                src={`/sites/spatial-rail/img/fresco-rail/fresco-${activeGarment.id}-hanger.webp`}
                alt={`${activeGarment.name} - ${selectedView}`}
                width={1000}
                height={1667}
                className={selectedView === "front" || selectedView === "side" ? "is-cut" : ""}
                unoptimized
              />
            </figure>

            {/* Size Selector and Add to Bag */}
            <div className="sheet-buy">
              <div className="sizes" role="radiogroup">
                {activeGarment.sizes.map((size) => (
                  <button
                    key={size}
                    type="button"
                    role="radio"
                    aria-checked={selectedSize === size}
                    onClick={() => setSelectedSize(size)}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <p className="info-price">
                £{activeGarment.price} <small>EXAMPLE PRICE</small>
              </p>
              <button
                className="btn btn-solid btn-wide"
                type="button"
                onClick={() => handleAddToBag(activeGarment, selectedSize)}
              >
                Add to bag
              </button>
            </div>

            <dl className="info-specs sheet-specs" style={{ marginTop: "24px" }}>
              <dt>Material</dt>
              <dd>{activeGarment.material}</dd>
              <dt>Colour</dt>
              <dd>{activeGarment.colour}</dd>
              <dt>Sizes</dt>
              <dd>{activeGarment.sizes.join(" / ")}</dd>
            </dl>
          </div>
        </div>
      )}

      {/* Bag Drawer */}
      {isBagOpen && (
        <div className="bag">
          <div className="bag-shade" onClick={() => setIsBagOpen(false)}></div>
          <aside className="bag-panel">
            <div className="bag-head">
              <h2>Your bag</h2>
              <button
                type="button"
                className="sheet-close"
                onClick={() => setIsBagOpen(false)}
                aria-label="Close bag"
              >
                &times;
              </button>
            </div>
            {bag.length === 0 ? (
              <p style={{ color: "var(--muted)", margin: "auto 0" }}>Your bag is empty.</p>
            ) : (
              <ul className="bag-list">
                {bag.map((item, idx) => (
                  <li key={`${item.garment.id}-${item.size}-${idx}`} className="bag-item">
                    <Image
                      src={`/sites/spatial-rail/img/fresco-rail/fresco-${item.garment.id}-hanger-sm.webp`}
                      alt={item.garment.name}
                      width={60}
                      height={80}
                      className="bag-item-pic"
                      unoptimized
                    />
                    <div className="bag-item-info">
                      <h3 className="bag-item-title">{item.garment.name}</h3>
                      <p className="bag-item-sub">
                        {item.garment.colour} · Size {item.size} · Qty {item.qty}
                      </p>
                      <div className="bag-item-foot">
                        <span>£{item.garment.price * item.qty}</span>
                        <button
                          type="button"
                          className="bag-item-remove"
                          onClick={() => setBag((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="bag-foot">
              <div className="bag-total">
                <span>Total</span>
                <span>£{bagTotal}</span>
              </div>
              <button
                className="btn btn-solid btn-wide"
                type="button"
                disabled={bag.length === 0}
                onClick={() => {
                  alert("Checkout demo complete!");
                }}
              >
                Checkout
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && <p className="toast">{toastMessage}</p>}
    </div>
  );
}
