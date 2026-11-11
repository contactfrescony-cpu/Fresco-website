import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header.jsx';
import Footer from './Footer.jsx';
import QuoteBand from './QuoteBand.jsx';
import CookieNotice from './CookieNotice.jsx';

export default function Layout() {
  return (
    <>
      <Header />
      <Suspense fallback={<main className="route-loading" aria-busy="true" />}>
        <Outlet />
      </Suspense>
      <QuoteBand />
      <Footer />
      <CookieNotice />
    </>
  );
}
