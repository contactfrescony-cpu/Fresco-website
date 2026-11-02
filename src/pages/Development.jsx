import usePageMeta from '../hooks/usePageMeta.js';
import GalleryImage from '../components/GalleryImage.jsx';
import BriefFlow from '../components/BriefFlow.jsx';
import measuring from '../assets/development-measuring.webp';
import thread from '../assets/development-thread.webp';
import needles from '../assets/development-needles.webp';
import patterns from '../assets/development-patterns.webp';

// Each image rotates from its folder in /development-images/<key>/ (see HOW-TO-ADD-IMAGES.txt).
const CRAFTS = [
  {
    key: 'measuring', image: measuring, label: '01 / MEASURING TAPE',
    alt: 'Large Indian garment factory quality-control team measuring finished garments',
    title: 'Every good fit begins with an accurate measure.',
    text: 'Measurements establish the foundation for proportion, balance and fit. Our development team translates size requirements and brand expectations into clear specifications that guide pattern construction and sampling.',
    points: ['Body and garment measurement standards', 'Size charts and points of measure', 'Fit review and tolerance alignment']
  },
  {
    key: 'thread', image: thread, label: '02 / SEWING THREAD',
    alt: 'Large Indian textile factory thread preparation department',
    title: 'The right thread supports every seam.',
    text: 'Thread choice influences strength, appearance and performance. We consider fibre content, ticket size, colour matching and stitch application so construction choices support both the design and its intended use.',
    points: ['Thread type and strength selection', 'Colour matching and stitch trials', 'Construction quality and seam performance']
  },
  {
    key: 'needles', image: needles, label: '03 / NEEDLES',
    alt: 'Large Indian garment production floor with rows of industrial sewing machines',
    title: 'Precision at the point of construction.',
    text: 'Needle selection is matched to fabric weight, structure and the required stitch. Careful trials help prevent damage, skipped stitches and puckering while supporting a clean, consistent finish.',
    points: ['Needle and fabric compatibility', 'Stitch-density and seam trials', 'Finish inspection and refinement']
  },
  {
    key: 'patterns', image: patterns, label: '04 / PATTERN PIECES',
    alt: 'Large Indian apparel pattern and automated cutting department',
    title: 'Turning a silhouette into a repeatable product.',
    text: 'Patterns convert the design into precise components ready for sampling and production. Each piece is shaped, balanced and refined through fitting before grading and handover for bulk execution.',
    points: ['Pattern creation and correction', 'Fit-driven sample revisions', 'Grading and production preparation']
  }
];

const ADVANTAGES = [
  ['01 / CREATIVE', 'Design & styling', 'Concept interpretation, silhouettes, colour direction, garment detailing and styling decisions aligned to the brand brief.'],
  ['02 / TECHNICAL', 'Patterns & sampling', 'Pattern development, sample making, fit reviews, construction refinement and iteration toward an approved product.'],
  ['03 / MATERIAL', 'Fabric & treatment development', 'Material selection and coordination of wash, print, embroidery, trims and accessory development.']
];

const STEPS = [
  ['Brief', 'Agree on the design intent, market, target price and timing.'],
  ['Explore', 'Review fabric, colour, construction and treatment options.'],
  ['Develop', 'Make and refine samples, patterns and technical details.'],
  ['Approve', 'Align fit, finish, specifications and quality expectations.'],
  ['Prepare', 'Coordinate sourcing and handover for bulk execution.']
];

const SOFTWARE = [
  ['01 / CAD & PATTERN', 'Optitex', '2D pattern creation, grading and marker planning, with 3D garment visualisation to review fit and design decisions before physical sampling.', 'https://optitex.com/products/2d-and-3d-cad-software/', 'Official website ↗'],
  ['02 / DIGITAL COLOUR', 'Natific', 'Digital colour development and approval workflows that help teams set colour standards, collaborate with suppliers and monitor colour consistency.', 'https://www.natific.com/', 'Official website ↗'],
  ['03 / COLOUR & MATERIAL DATA', 'ColorDigital · DMIx', 'Digital exchange of measured colour, material and surface information to support consistent colour communication across design and supply partners.', 'https://www.colordigital.de/', 'Official website ↗'],
  ['04 / EMBROIDERY DIGITISING', 'Wilcom EmbroideryStudio E3', 'Embroidery digitising and stitch programming: translating artwork into stitch paths, stitch types and machine-ready embroidery files.', 'https://wilcom.com/embroiderystudio', 'Wilcom software ↗']
];

export default function Development() {
  usePageMeta(
    'Product Development — Fresco NY',
    'In-house apparel design, styling, pattern making, sample development and production readiness from Fresco NY.'
  );

  return (
    <main className="development-page">
      <section className="page-hero">
        <div className="container">
          <div className="development-tools" aria-hidden="true" />
          <div className="eyebrow">PRODUCT DEVELOPMENT</div>
          <h1>We develop the product.<br />Our network delivers at scale.</h1>
          <p className="lead">Our development capability is built around a simple belief: invest in getting the product right before bulk production begins.</p>
          <div className="hero-actions" />
        </div>
      </section>

      <section className="craft-sections" aria-label="Apparel development disciplines">
        <div className="container">
          {CRAFTS.map((craft) => (
            <article className="craft-section" key={craft.key}>
              <figure className="craft-image">
                <GalleryImage gallery={`development-${craft.key}`} fallback={craft.image} alt={craft.alt} width="1200" height="800" />
              </figure>
              <div className="craft-copy">
                <div className="eyebrow">{craft.label}</div>
                <h2>{craft.title}</h2>
                <p>{craft.text}</p>
                <ul>{craft.points.map((point) => <li key={point}>{point}</li>)}</ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <div className="eyebrow">THE DEVELOPMENT ADVANTAGE</div>
              <h2>More than a sample.<br />A product ready to scale.</h2>
            </div>
            <p>Fresco brings together design and technical specialists so product ideas can be explored, refined and prepared for production.</p>
          </div>
          <div className="grid-3 feature-grid">
            {ADVANTAGES.map(([label, title, text]) => (
              <div key={title}>
                <div className="eyebrow">{label}</div>
                <h3>{title}</h3>
                <p className="muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section cream">
        <div className="container">
          <div className="eyebrow">OUR PROCESS</div>
          <h2>A clear path from idea to approval.</h2>
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

      <BriefFlow />

      <section className="section software-section">
        <div className="container">
          <div className="eyebrow">DIGITAL TOOLS IN OUR DEVELOPMENT WORKFLOW</div>
          <h2>Technical precision,<br />supported by specialist software.</h2>
          <div className="software-grid">
            {SOFTWARE.map(([label, name, text, href, linkText]) => (
              <article key={name}>
                <span>{label}</span>
                <h3>{name}</h3>
                <p>{text}</p>
                <a href={href} target="_blank" rel="noopener noreferrer">{linkText}</a>
              </article>
            ))}
          </div>
          <p className="form-note">Software descriptions are concise summaries of the manufacturers’ published capabilities. Fresco’s use of the named editions should be confirmed before launch.</p>
        </div>
      </section>
    </main>
  );
}
