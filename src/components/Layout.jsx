import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header.jsx';
import Footer from './Footer.jsx';
import QuoteBand from './QuoteBand.jsx';
import CookieNotice from './CookieNotice.jsx';

export default function Layout() {
  const { pathname } = useLocation();
  return (
    <>
      <Header />
      <Suspense fallback={<main className="route-loading" aria-busy="true" />}>
        <Outlet />
      </Suspense>
      <QuoteBand showContact={pathname === '/contact'} />
      <Footer />
      <CookieNotice />
    </>
  );
}
