import { useEffect, useRef, useState } from 'react';

const ASSET_ROOT = '/interactive-rail';
const ASSET_VERSION = '20261117-2';
const SIDE_HOOK_CENTRES = {
  'tommy-tee': 48.4, 'desigual-tee': 55.2, 'crocodile-text-tee': 49.4,
  'indian-terrain-tee': 52.8, 'pepe-tee': 53.2, 'american-eagle-tee': 50.2,
  'white-badge-tee': 51.8, 'navy-tee': 48.6, 'burgundy-tee': 48.8,
  'grey-tee': 51.6, 'jacquard-tee': 51.4, 'utility-shirt': 52.8,
  'ribbed-hoodie': 56.7, 'fleece-jacket': 48.9
};

function HangerHook({ centre = 50 }) {
  return (
    <svg className="rail-uniform-hook" style={{ left: `${centre}%` }} viewBox="-40 0 80 105" aria-hidden="true">
      <path d="M 27 28 C 27 -8 -27 -8 -27 28 C -27 51 0 53 0 76 L 0 138" fill="none" stroke="#797a76" strokeWidth="4" strokeLinecap="round" />
      <path d="M 27 28 C 27 -8 -27 -8 -27 28 C -27 51 0 53 0 76 L 0 138" fill="none" stroke="#e0e0db" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

const GARMENTS = [
  ['tommy-tee', 'Tommy Hilfiger', 'FLAG EMBROIDERY · COTTON CREW-NECK T-SHIRT · WHITE'],
  ['desigual-tee', 'Desigual', 'COLOURFUL GRAPHIC · COTTON T-SHIRT · BLACK'],
  ['crocodile-text-tee', 'Crocodile', 'TEXT WORDMARK · COTTON T-SHIRT · FOREST GREEN'],
  ['indian-terrain-tee', 'Indian Terrain', 'TYPOGRAPHIC PRINT · COTTON T-SHIRT · SAND'],
  ['pepe-tee', 'Pepe Jeans London', 'SIGNATURE CHEST PRINT · COTTON T-SHIRT · NAVY'],
  ['american-eagle-tee', 'American Eagle', 'EAGLE GRAPHIC · COTTON T-SHIRT · BURGUNDY'],
  ['utility-shirt', 'Utility Shirt', 'FRESCO NY · TWIN-POCKET UTILITY SHIRT · OLIVE'],
  ['ribbed-hoodie', 'Ribbed Hoodie', 'FRESCO NY · TEXTURED PULLOVER HOODIE · SOFT GREY'],
  ['fleece-jacket', 'Fleece Zip Jacket', 'FRESCO NY · STAND-COLLAR FLEECE JACKET · SAGE']
].map(([slug, name, specs], index, garments) => ({
  id: slug,
  name,
  specs,
  reverseSide: ['utility-shirt', 'fleece-jacket'].includes(slug),
  number: `${String(index + 1).padStart(2, '0')} / ${String(garments.length).padStart(2, '0')}`,
  side: `${ASSET_ROOT}/fresco-${slug}-side.webp?v=${ASSET_VERSION}`,
  front: `${ASSET_ROOT}/fresco-${slug}-front.webp?v=${ASSET_VERSION}`,
  back: `${ASSET_ROOT}/fresco-${slug}-back.webp?v=${ASSET_VERSION}`
}));

export default function InteractiveRail() {
  const [activeIndex, setActiveIndex] = useState(null);
  const [showBack, setShowBack] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const stageRef = useRef(null);
  const pointerType = useRef(null);
  const activeGarment = GARMENTS[activeIndex];

  useEffect(() => {
    if (window.location.hash !== '#interactive-rail') return undefined;
    const frame = window.requestAnimationFrame(() => {
      stageRef.current?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const handleMouseMove = (event) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    setTilt({
      x: ((event.clientX - rect.left) / rect.width - 0.5) * 10,
      y: -((event.clientY - rect.top) / rect.height - 0.5) * 8
    });
  };

  const selectGarment = (index) => {
    setActiveIndex(index);
    setShowBack(false);
  };

  const activateOrFlip = (index) => {
    if (activeIndex === index) setShowBack((current) => !current);
    else selectGarment(index);
  };

  return (
    <section
      id="interactive-rail"
      className="interactive-rail"
      aria-label="Interactive garment collection"
      ref={stageRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
      onPointerDown={(event) => { pointerType.current = event.pointerType; }}
      onClick={(event) => {
        if (!event.target.closest('button')) { setActiveIndex(null); setShowBack(false); }
      }}
    >
      <div className="interactive-rail-tabs" aria-hidden="true">
        <span>On the rail</span><i /><span>The range</span>
      </div>

      <div className="interactive-rail-suspension" aria-hidden="true">
        <span /><span />
      </div>
      <img className="interactive-rail-tube" src={`${ASSET_ROOT}/rail-tube.webp`} alt="" />

      <div className="interactive-rail-garments" style={{ '--side-count': GARMENTS.length - 1 }}>
        {GARMENTS.map((garment, index) => {
          const isActive = activeIndex === index;
          return (
            <button
              type="button"
              className={`interactive-garment${isActive ? ' is-active' : ''}`}
              key={garment.id}
              onPointerEnter={(event) => { if (event.pointerType === 'mouse') selectGarment(index); }}
              onPointerLeave={(event) => { if (event.pointerType === 'mouse') { setActiveIndex(null); setShowBack(false); } }}
              onFocus={() => { if (!pointerType.current) selectGarment(index); }}
              onKeyDown={() => { pointerType.current = null; }}
              onBlur={() => { setActiveIndex(null); setShowBack(false); }}
              onClick={() => activateOrFlip(index)}
              aria-label={`${garment.name}. ${isActive ? `Showing ${showBack ? 'back' : 'front'}; activate to show ${showBack ? 'front' : 'back'}.` : 'Activate to show front.'}`}
              style={{ '--tilt-x': `${isActive ? tilt.x : 0}deg`, '--tilt-y': `${isActive ? tilt.y : 0}deg` }}
            >
              <span className="interactive-garment-side">
                <img src={garment.side} alt="" draggable="false" style={garment.reverseSide ? { transform: 'scaleX(-1)' } : undefined} />
                <HangerHook centre={SIDE_HOOK_CENTRES[garment.id]} />
              </span>
              <span className="interactive-garment-face">
                <img
                  src={showBack && isActive ? garment.back : garment.front}
                  alt={`${garment.name} ${showBack && isActive ? 'back' : 'front'} view`}
                  draggable="false"
                />
                <HangerHook />
                <span className="interactive-garment-flip-hint">{showBack ? 'Front view ↺' : 'Back view ↻'}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="interactive-rail-meta" aria-live="polite">
        <div className="interactive-rail-count">{activeGarment?.number ?? 'THE RANGE'}</div>
        <h2>{activeGarment?.name ?? 'Explore the collection'}</h2>
        <p>{activeGarment?.specs ?? 'Hover or tap a garment to see the front view'}</p>
        <div className="interactive-rail-dots" aria-label="Choose a garment">
          {GARMENTS.map((garment, index) => (
            <button
              type="button"
              className={activeIndex === index ? 'is-active' : ''}
              aria-label={`Select ${garment.name}`}
              aria-pressed={activeIndex === index}
              onClick={() => selectGarment(index)}
              key={garment.id}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
