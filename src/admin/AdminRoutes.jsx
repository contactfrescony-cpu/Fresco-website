import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import AdminLayout from './AdminLayout.jsx';
import Login from './pages/Login.jsx';
import SectionPage from './pages/SectionPage.jsx';
import Signup from './pages/Signup.jsx';
import UsersPage from './pages/UsersPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import ReviewPage from './pages/ReviewPage.jsx';
import { ADMIN_SECTIONS, canAccess, homeSectionFor } from './sections.js';
import './admin.css';

// Sections that have a real screen; every other section still shows the placeholder.
const SECTION_PAGES = { users: UsersPage, upload: UploadPage, review: ReviewPage };

function AdminLoading() {
  return <div className="admin-loading" aria-busy="true">Loading…</div>;
}

/** Signed-in staff only; everyone else is sent to the login page and brought back afterwards. */
function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <AdminLoading />;
  if (status !== 'signed-in') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/admin/login?next=${next}`} replace />;
  }
  return children;
}

/** Shows a "no access" message when the user's role may not open this section. */
function RequireRole({ section, children }) {
  const { user } = useAuth();
  if (canAccess(user.role, section)) return children;
  return (
    <div className="admin-panel admin-notice">
      <h1>No access</h1>
      <p>Your role does not include <strong>{section.label}</strong>. Ask an administrator if you need access.</p>
    </div>
  );
}

/** /admin itself: straight to the first page this person may use. */
function AdminHome() {
  const { user } = useAuth();
  const home = homeSectionFor(user.role);
  return home ? <Navigate to={`/admin/${home.path}`} replace /> : <AdminNotFound />;
}

function AdminNotFound() {
  return (
    <div className="admin-panel admin-notice">
      <h1>Page not found</h1>
      <p>This back-office page does not exist.</p>
    </div>
  );
}

function renderSection(section) {
  const Page = SECTION_PAGES[section.path];
  return Page ? <Page /> : <SectionPage section={section} />;
}

/** Everything under /admin. Loaded on demand, so public visitors never download the back office. */
export default function AdminRoutes() {
  useEffect(() => {
    // Keep the back office out of search results even if a link to it leaks.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    document.body.classList.add('is-admin');
    return () => { meta.remove(); document.body.classList.remove('is-admin'); };
  }, []);

  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route element={<RequireAuth><AdminLayout /></RequireAuth>}>
          <Route index element={<AdminHome />} />
          {ADMIN_SECTIONS.map((section) => (
            <Route
              key={section.path}
              path={section.path}
              element={<RequireRole section={section}>{renderSection(section)}</RequireRole>}
            />
          ))}
          <Route path="*" element={<AdminNotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
