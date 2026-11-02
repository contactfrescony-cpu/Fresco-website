import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import logo from '../assets/fresco-ny-logo.webp';
import { NAV_LINKS } from '../data/site.js';

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <div className="topbar">
      <div className="container nav">
        <Link className="brand-wrap" to="/" aria-label="Fresco NY home" onClick={() => setOpen(false)}>
          <img className="brand-logo" src={logo} alt="Fresco NY — Designing, Development, Sourcing" width="820" height="169" />
        </Link>
        <button
          className="menu-toggle"
          type="button"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '×' : '☰'}
        </button>
        <nav
          id="main-nav"
          className={open ? 'navlinks open' : 'navlinks'}
          aria-label="Main navigation"
          onClick={(event) => { if (event.target.closest('a')) setOpen(false); }}
        >
          {NAV_LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
