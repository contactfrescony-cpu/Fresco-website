import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import logo from '../assets/fresco-ny-logo.webp';
import { useAuth } from './AuthContext.jsx';
import { ADMIN_SECTIONS, ROLE_LABELS, canAccess } from './sections.js';

/** Administrators: how many people signed up and are waiting for a role (shown on "Users & Roles"). */
function usePendingSignups(isAdmin) {
  const location = useLocation();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    fetch('/api/admin/users', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : { users: [] }))
      .then(({ users }) => { if (!cancelled) setCount(users.filter((u) => !u.role).length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAdmin, location.pathname]);
  return count;
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const sections = ADMIN_SECTIONS.filter((section) => canAccess(user.role, section));
  const pendingSignups = usePendingSignups(user.role === 'admin');

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="admin-shell">
      <aside className={menuOpen ? 'admin-sidebar open' : 'admin-sidebar'}>
        <div className="admin-sidebar-head">
          <Link to="/admin" onClick={() => setMenuOpen(false)}>
            <img src={logo} alt="Fresco NY" width="820" height="169" />
          </Link>
          <button
            type="button"
            className="admin-menu-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="admin-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? '×' : '☰'}
          </button>
        </div>
        <nav id="admin-nav" aria-label="Back office" onClick={(event) => { if (event.target.closest('a')) setMenuOpen(false); }}>
          {sections.map((section) => (
            <NavLink key={section.path} to={`/admin/${section.path}`}>
              {section.label}
              {section.path === 'users' && pendingSignups > 0 && (
                <span className="admin-nav-badge" title={`${pendingSignups} waiting for a role`}>{pendingSignups}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="admin-user">
          <div className="admin-user-name">{user.name}</div>
          <div className="admin-role-badge">{ROLE_LABELS[user.role] || user.role}</div>
          <div className="admin-user-actions">
            <a href="/" target="_blank" rel="noopener noreferrer">View website ↗</a>
            <button type="button" onClick={handleLogout}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
