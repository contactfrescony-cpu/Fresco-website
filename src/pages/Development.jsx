import usePageMeta from '../hooks/usePageMeta.js';
import GalleryImage from '../components/GalleryImage.jsx';
import BriefFlow from '../components/BriefFlow.jsx';
// Self-hosted (Latin only) typefaces used by the software makers' own websites, for the software cards.
import '@fontsource/montserrat/latin-300.css';   // Optitex headings
import '@fontsource/montserrat/latin-700.css';   // Wilcom headings
import './software-fonts.css';                   // Optitex and DMIx body text (Inter, private name)
import '@fontsource/poppins/latin-400.css';      // Natific body text
import '@fontsource/poppins/latin-600.css';      // Natific headings
import '@fontsource/archivo/latin-600.css';      // DMIx headings
import '@fontsource/roboto/latin-400.css';       // Wilcom body text
// Software makers' logos, from their official websites (Optitex's recoloured white for the dark card).
import optitexLogo from '../assets/software/optitex-logo-white.svg';
import natificLogo from '../assets/software/natific-logo.webp';
import dmixLogo from '../assets/software/dmix-logo.svg';
import wilcomLogo from '../assets/software/wilcom-logo.png';

// Each section's photos (up to 3) come from Google Drive only; approvers manage them in the back office
// (Website Images → Development page photos).
const CRAFTS = [
  {
    key: 'measuring',
    alt: 'Large Indian garment factory quality-control team measuring finished garments',
    title: 'Every good fit begins with an accurate measure.',
    text: 'Measurements establish the foundation for proportion, balance and fit. Our development team translates size requirements and brand expectations into clear specifications that guide pattern construction and sampling.',
    points: ['Body and garment measurement standards', 'Size charts and points of measure', 'Fit review and tolerance alignment']
  },
  {
    key: 'thread',
    alt: 'Large Indian textile factory thread preparation department',
    title: 'The right thread supports every seam.',
    text: 'Thread choice influences strength, appearance and performance. We consider fibre content, ticket size, colour matching and stitch application so construction choices support both the design and its intended use.',
    points: ['Thread type and strength selection', 'Colour matching and stitch trials', 'Construction quality and seam performance']
  },
  {
    key: 'needles',
    alt: 'Large Indian garment production floor with rows of industrial sewing machines',
    title: 'Precision at the point of construction.',
    text: 'Needle selection is matched to fabric weight, structure and the required stitch. Careful trials help prevent damage, skipped stitches and puckering while supporting a clean, consistent finish.',
    points: ['Needle and fabric compatibility', 'Stitch-density and seam trials', 'Finish inspection and refinement']
  },
  {
    key: 'patterns',
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

// Each card shows its maker's logo and is styled in the maker's own colours and typefaces
// (see .software-card--* in styles.css) so visitors recognise the products at a glance.
const SOFTWARE = [
  {
    key: 'optitex', label: '01 / CAD & PATTERN', name: 'Optitex',
    text: '2D pattern creation, grading and marker planning, with 3D garment visualisation to review fit and design decisions before physical sampling.',
    href: 'https://optitex.com/products/2d-and-3d-cad-software/', logo: { src: optitexLogo, width: 1137, height: 190 }
  },
  {
    key: 'natific', label: '02 / DIGITAL COLOUR', name: 'Natific',
    text: 'Digital colour development and approval workflows that help teams set colour standards, collaborate with suppliers and monitor colour consistency.',
    href: 'https://www.natific.com/', logo: { src: natificLogo, width: 750, height: 234 }
  },
  {
    key: 'dmix', label: '03 / COLOUR & MATERIAL DATA', name: 'ColorDigital · DMIx',
    text: 'Digital exchange of measured colour, material and surface information to support consistent colour communication across design and supply partners.',
    href: 'https://www.dmix.info/', logo: { src: dmixLogo, width: 987, height: 207 }
  },
  {
    key: 'wilcom', label: '04 / EMBROIDERY DIGITISING', name: 'Wilcom EmbroideryStudio E3',
    text: 'Embroidery digitising and stitch programming: translating artwork into stitch paths, stitch types and machine-ready embroidery files.',
    href: 'https://wilcom.com/embroiderystudio', logo: { src: wilcomLogo, width: 258, height: 74 }
  }
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
                <GalleryImage gallery={`development-${craft.key}`} alt={craft.alt} width="1200" height="800" arrows />
              </figure>
              <div className="craft-copy">
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
          {/* Each whole card links to the maker's official website. */}
          <div className="software-grid">
            {SOFTWARE.map(({ key, label, name, text, href, logo }) => (
              <a className={`software-card software-card--${key}`} href={href} target="_blank" rel="noopener noreferrer" key={key}>
                <span className="software-card-arrow" aria-hidden="true">↗</span>
                <img className="software-logo" src={logo.src} alt={`${name} logo`} width={logo.width} height={logo.height} loading="lazy" decoding="async" />
                <span className="software-card-label">{label}</span>
                <h3>{name}</h3>
                <p>{text}</p>
                <span className="sr-only">(opens the official website in a new tab)</span>
              </a>
            ))}
          </div>
          <p className="form-note">Software descriptions are concise summaries of the manufacturers’ published capabilities. Fresco’s use of the named editions should be confirmed before launch.</p>
        </div>
      </section>
    </main>
  );
}
