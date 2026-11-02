import { Link } from 'react-router-dom';
import logo from '../assets/fresco-ny-logo.webp';
import { CONTACT_EMAIL } from '../data/site.js';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Link className="footer-logo-box" to="/" aria-label="Fresco NY home">
              <img className="footer-logo" src={logo} alt="Fresco NY — Designing, Development, Sourcing" width="820" height="169" loading="lazy" />
            </Link>
            <p className="footer-blurb">A product-development partner for fashion brands — from first concept and fabric selection to production-ready apparel.</p>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </div>
          <div>
            <h4>Explore</h4>
            <div className="footer-links">
              <Link to="/development">Development</Link>
              <Link to="/portfolio">Our Products</Link>
              <Link to="/supply-chain">Supply Chain</Link>
              <Link to="/insights">Industry Insights</Link>
            </div>
          </div>
          <div>
            <h4>Contact</h4>
            <p>For new product briefs and business enquiries:</p>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            <p className="footer-address">No: 520, Pudur pirivu,<br />Dharapuram road, Tirupur - 641608.</p>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Fresco NY. All rights reserved.</span>
          <span><Link to="/privacy">Privacy & analytics</Link> · <Link to="/admin/login">Login</Link> · From Vision to Garment.</span>
        </div>
      </div>
    </footer>
  );
}
