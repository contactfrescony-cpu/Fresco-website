import { useState } from 'react';
import { Link } from 'react-router-dom';
import usePageMeta from '../hooks/usePageMeta.js';
import GalleryImage from '../components/GalleryImage.jsx';
import BriefFlow from '../components/BriefFlow.jsx';
import { BRANDS } from '../data/site.js';
import { PRODUCT_IMAGES } from '../data/products.js';
import useProductCategories from '../hooks/useProductCategories.js';
import heroImage from '../assets/hero-fashion.webp';


const CAPABILITIES = [
  ['In-house design & styling', "Translate a buyer's vision into a considered product direction, colours, details and specifications."],
  ['Patterns & sampling', 'Pattern making, sample construction, fit refinement and development iterations to bring the concept to life.'],
  ['Materials & specialist treatments', 'Fabric selection, washes, print and embroidery development, trims, accessories and finishing details.'],
  ['Ready for bulk execution', 'Refine the product and technical requirements so manufacturing partners can focus on efficient production at scale.']
];

const STEPS = [
  ['Concept & brief', 'Understanding your vision, customer and target price.'],
  ['Fabric & materials', 'Selection and development of the right materials.'],
  ['Design & sampling', 'Patterns, construction, fit and finishes.'],
  ['Production readiness', 'Specifications, sourcing and quality alignment.'],
  ['Bulk execution', 'Manufacturing coordination and delivery focus.']
];

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function Home() {
  usePageMeta(
    'Fresco NY — From Vision to Garment',
    'Fresco NY partners with fashion brands to develop distinctive apparel through in-house design, sampling, fabrics, treatments and production-ready sourcing.'
  );
  // Shuffle once per visit so the brand wall has no fixed positions.
  const [brands] = useState(() => shuffle(BRANDS));
  // Which categories appear here (up to 4) and in what order is chosen by approvers in the back office.
  const homeCategories = useProductCategories().filter((category) => category.showOnHome).slice(0, 4);

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">APPAREL PRODUCT DEVELOPMENT PARTNER</div>
          <h1>From Vision<br />to Garment.</h1>
          <p className="lead">Your ideas. Our expertise. Extraordinary execution.</p>
          <p className="muted hero-body">From first concept and fabric selection to product development, value-added treatments and finished apparel, we bring your vision to life.</p>
          <div className="hero-actions"><Link className="button light" to="/portfolio">Explore our products</Link></div>
          <div className="hero-note">DESIGNING · DEVELOPMENT · SOURCING</div>
        </div>
        <div className="hero-media">
          <img src={heroImage} alt="Editorial fashion models wearing textured casual garments" width="1024" height="1536" fetchPriority="high" decoding="async" />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <div className="eyebrow">OUR PRODUCTS</div>
              <h2>A range. A depth<br />of expertise.</h2>
            </div>
            <p>From everyday essentials to complex value-added styles, we develop garments that reflect your brand's direction and meet your market's expectations.</p>
            <Link className="arrow-link" to="/portfolio">View all products ↗</Link>
          </div>
          <div className="grid-4">
            {homeCategories.map(({ slug, name, homeTagline }) => (
              <Link className="card" to={`/portfolio#${slug}`} key={slug}>
                <div className="card-image">
                  <GalleryImage gallery={slug} fallback={PRODUCT_IMAGES[slug]} alt={`${name} collection`} width="800" height="1000" />
                </div>
                <h3>{name}</h3>
                <p>{homeTagline}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section compact">
        <div className="container">
          <div className="section-head">
            <div>
              <div className="eyebrow">BRAND EXPERIENCE</div>
              <h2 className="heading-md">Different brands.<br />Different points of view.</h2>
            </div>
            <p>Our existing website features a range of fashion and lifestyle brand names. The redesign keeps the presentation understated and lets the product work speak first.</p>
          </div>
          <div className="brand-wall" aria-label="Selected brand relationships">
            {brands.map(([name, href]) => (
              <a className="brand-wordmark" href={href} target="_blank" rel="noopener noreferrer" key={href}>{name}</a>
            ))}
          </div>
        </div>
      </section>

      <section className="section cream">
        <div className="container">
          <div className="section-head">
            <div>
              <div className="eyebrow">OUR DIFFERENCE</div>
              <h2>Development first.<br />Production ready.</h2>
            </div>
            <p>Factories are built to produce at scale. Fresco invests in the development work that helps get the product right before bulk production begins.</p>
          </div>
          {CAPABILITIES.map(([title, text], i) => (
            <div className="capability" key={title}>
              <div className="capability-row">
                <div className="capability-number">{String(i + 1).padStart(2, '0')}</div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
          <p className="discover-link"><Link className="arrow-link" to="/development">Discover our development process ↗</Link></p>
        </div>
      </section>

      <BriefFlow />

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <div className="eyebrow">HOW WE WORK</div>
              <h2>From first idea<br />to finished garment.</h2>
            </div>
            <p>A structured, collaborative process to turn your vision into production-ready apparel.</p>
          </div>
          <div className="process">
            {STEPS.map(([title, text], i) => (
              <div className="step" key={title}>
                <div className="num">{String(i + 1).padStart(2, '0')}</div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section cream designer-network">
        <div className="container">
          <div className="eyebrow">CREATIVE COLLABORATION</div>
          <h2>A creative network of<br />national and international designers.</h2>
          <p className="lead">Fresh perspectives, specialist skills and a shared focus on bringing distinctive apparel ideas to life.</p>
        </div>
      </section>
    </main>
  );
}
