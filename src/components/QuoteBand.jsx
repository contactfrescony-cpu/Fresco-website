import { CONTACT_EMAIL } from '../data/site.js';

export default function QuoteBand({ showContact = false }) {
  return (
    <section className="quote-band">
      <div className="container inner">
        <div>
          <div className="eyebrow">LET'S CREATE TOGETHER</div>
          <h2>From vision to garment.</h2>
          <p className="sub">Your ideas. Our expertise. Extraordinary execution.</p>
        </div>
        {showContact && <a className="button" href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Fresco NY enquiry')}`}>Contact ↗</a>}
      </div>
    </section>
  );
}
