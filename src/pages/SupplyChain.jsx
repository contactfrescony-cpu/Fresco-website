import { Link } from 'react-router-dom';
import usePageMeta from '../hooks/usePageMeta.js';

// Content governance (brief §11): a capability is shown as established only once Fresco management confirms it.
// status: 'established' | 'developing'. 'developing' items carry an "In development" tag on the page.
// TODO(management): confirm each status before launch; these move to the CMS Content Manager later.
const CAPABILITIES = [
  {
    title: 'Production engineering',
    text: 'Construction, operation breakdowns and line planning prepared before bulk begins, so each style runs efficiently and consistently in the right factory.',
    status: 'established'
  },
  {
    title: '100% finished-garment re-inspection',
    text: 'Every finished garment is re-inspected before packing — our quality commitment, in addition to the factory’s own checks.',
    status: 'established'
  },
  {
    title: 'Garment dyeing, washing & finishing',
    text: 'Specialised dyeing, washing, printing and finishing partners, matched to the treatment each product needs.',
    status: 'established'
  },
  {
    title: 'Flexible inventory & print-on-demand',
    text: 'Programmes that let brands hold less stock — blanks ready for print or dye, produced closer to demand.',
    status: 'developing'
  },
  {
    title: 'Rapid replenishment',
    text: 'Repeat styles prepared for faster turnaround, so best-sellers can be reordered without starting from zero.',
    status: 'developing'
  },
  {
    title: 'ERP, AI & digital manufacturing',
    text: 'Order, material and production data in one system, with digital tools that improve visibility and planning.',
    status: 'developing'
  },
  {
    title: 'Global logistics',
    text: 'International shipping coordinated up to your designated warehouse under the agreed delivery terms.',
    status: 'established'
  }
];

const FLOW = [
  ['Develop', 'Design, sampling and technical sign-off.'],
  ['Source', 'Materials consolidated and approved centrally.'],
  ['Manufacture', 'The right factory for the right product.'],
  ['Finish', 'Dyeing, washing, printing and treatments.'],
  ['Inspect', '100% re-inspection before packing.'],
  ['Deliver', 'Coordinated to your warehouse.']
];

// Written as commitments, not certifications. Any certification or audit claim must be verified before it is added (brief §11).
const RESPONSIBLE = [
  ['01 / PEOPLE', 'Worker dignity & meaningful audits', 'Partner factories are assessed on how people are treated — fair conditions, safety and dignity — not only on paperwork.'],
  ['02 / ENERGY', 'Green energy', 'We favour manufacturing partners investing in renewable energy and lower-impact processes.'],
  ['03 / RESOURCES', 'Responsible chemicals & efficiency', 'Responsible chemical management and careful use of water and energy across dyeing, washing and finishing.']
];

export default function SupplyChain() {
  usePageMeta(
    'Supply Chain Excellence — Fresco NY',
    'Production engineering, 100% garment re-inspection, responsible manufacturing, replenishment and global logistics from Fresco NY.'
  );

  return (
    <main className="supply-page">
      <section className="page-hero">
        <div className="container">
          <div className="eyebrow">SUPPLY CHAIN EXCELLENCE</div>
          <h1>Engineered for consistency.<br />Delivered to your door.</h1>
          <p className="lead">From approved sample to your warehouse, one partner coordinates materials, manufacturing, finishing, quality and logistics.</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <div className="eyebrow">ONE CONNECTED CHAIN</div>
              <h2>Every step,<br />one point of contact.</h2>
            </div>
            <p>Instead of managing designers, mills, factories, finishers and forwarders separately, you work with Fresco.</p>
          </div>
          <div className="process process-6">
            {FLOW.map(([title, text], i) => (
              <div className="step" key={title}>
                <div className="num">{String(i + 1).padStart(2, '0')}</div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section cream">
        <div className="container">
          <div className="section-head">
            <div>
              <div className="eyebrow">CAPABILITIES</div>
              <h2>Built for quality,<br />speed and flexibility.</h2>
            </div>
            <p>What we deliver today, and the programmes we are building for tomorrow — clearly marked.</p>
          </div>
          {CAPABILITIES.map(({ title, text, status }, i) => (
            <div className="capability" key={title}>
              <div className="capability-row">
                <div className="capability-number">{String(i + 1).padStart(2, '0')}</div>
                <h3>
                  {title}
                  {status === 'developing' && <span className="status-tag">In development</span>}
                </h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section commitment">
        <div className="container">
          <div className="eyebrow">OUR QUALITY COMMITMENT</div>
          <p className="commitment-statement">Every finished garment is re-inspected before it is packed.</p>
          <p className="commitment-sub">100% re-inspection — not a sample, not a percentage.</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <div className="eyebrow">RESPONSIBLE MANUFACTURING</div>
              <h2>Made with care<br />for people and planet.</h2>
            </div>
            <p>Responsibility is part of how we choose partners and processes, not an afterthought.</p>
          </div>
          <div className="grid-3 feature-grid">
            {RESPONSIBLE.map(([label, title, text]) => (
              <div key={title}>
                <div className="eyebrow">{label}</div>
                <h3>{title}</h3>
                <p className="muted">{text}</p>
              </div>
            ))}
          </div>
          <p className="discover-link"><Link className="arrow-link" to="/contact">Discuss your supply chain ↗</Link></p>
        </div>
      </section>
    </main>
  );
}
