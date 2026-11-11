import { Link } from 'react-router-dom';
import logo from '../assets/fresco-ny-logo.webp';
import { ADDRESS_LINES, ADDRESS_MAP_URL, CONTACT_EMAIL, PHONE_NUMBERS } from '../data/site.js';

// Simple line icons (24×24, drawn with the text colour).
const ICONS = {
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></>,
  phone: <path d="M5 4h3.2l1.6 4-2.1 1.3a11 11 0 0 0 5 5l1.3-2.1 4 1.6V17a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
  address: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>
};

function Icon({ name }) {
  return (
    <svg className="footer-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

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
            <ul className="footer-contact">
              <li>
                <Icon name="email" />
                <span><span className="sr-only">Email: </span><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></span>
              </li>
              {PHONE_NUMBERS.map((number) => (
                <li key={number}>
                  <Icon name="phone" />
                  <span><span className="sr-only">Phone: </span><a href={`tel:${number.replace(/[^+\d]/g, '')}`}>{number}</a></span>
                </li>
              ))}
              <li>
                <Icon name="address" />
                <address>
                  <span className="sr-only">Address: </span>
                  <a href={ADDRESS_MAP_URL} target="_blank" rel="noopener noreferrer">
                    {ADDRESS_LINES.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </a>
                </address>
              </li>
            </ul>
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
