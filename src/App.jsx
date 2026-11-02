import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import SmoothScroll from './components/SmoothScroll.jsx';
import ScrollManager from './components/ScrollManager.jsx';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import { LEGACY_REDIRECTS } from './data/site.js';

// The landing page ships in the main bundle; other pages load on demand.
const Development = lazy(() => import('./pages/Development.jsx'));
const Portfolio = lazy(() => import('./pages/Portfolio.jsx'));
const SupplyChain = lazy(() => import('./pages/SupplyChain.jsx'));
const Insights = lazy(() => import('./pages/Insights.jsx'));
const Contact = lazy(() => import('./pages/Contact.jsx'));
const Privacy = lazy(() => import('./pages/Privacy.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));
// Staff back office (login + role-protected sections), in its own bundle.
const AdminRoutes = lazy(() => import('./admin/AdminRoutes.jsx'));

/** Keeps old /page.html#anchor links working. */
function LegacyRedirect({ to }) {
  const { hash } = useLocation();
  return <Navigate to={`${to}${hash}`} replace />;
}

export default function App() {
  return (
    <SmoothScroll>
      <ScrollManager />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="development" element={<Development />} />
          <Route path="portfolio" element={<Portfolio />} />
          <Route path="supply-chain" element={<SupplyChain />} />
          <Route path="insights" element={<Insights />} />
          <Route path="contact" element={<Contact />} />
          <Route path="privacy" element={<Privacy />} />
        </Route>
        <Route path="admin/*" element={<Suspense fallback={null}><AdminRoutes /></Suspense>} />
        {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
          <Route key={from} path={from} element={<LegacyRedirect to={to} />} />
        ))}
        <Route path="*" element={<Suspense fallback={null}><NotFound /></Suspense>} />
      </Routes>
    </SmoothScroll>
  );
}
