const STAGES = [
  ['✎', '01 · Interpret', 'Your idea, reference and product direction'],
  ['◈', '02 · Design', 'Silhouette, fabric, colour and details'],
  ['✂', '03 · Develop', 'Patterns, samples, fit and refinement'],
  ['✓', '04 · Prepare', 'Technical readiness for bulk execution']
];

/** "Built around your brief" section, shared by the Home and Development pages. */
export default function BriefFlow() {
  return (
    <section className="section brief-visual">
      <div className="container">
        <div className="eyebrow">BUILT AROUND YOUR BRIEF</div>
        <h2>Development is not<br />an afterthought.</h2>
        <p className="lead brief-intro">Many manufacturing facilities are optimised for bulk production. Fresco puts focused attention into the work that happens before production: product choices, samples, details and technical readiness.</p>
        <div className="brief-flow">
          {STAGES.map(([icon, title, text]) => (
            <div className="brief-stage" key={title}>
              <span className="brief-icon" aria-hidden="true">{icon}</span>
              <b>{title}</b>
              <span>{text}</span>
            </div>
          ))}
        </div>
        <p className="muted brief-outro">A dedicated development partner works through the details while manufacturing partners focus on consistent execution at scale.</p>
      </div>
    </section>
  );
}
