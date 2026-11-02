import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import usePageMeta from '../hooks/usePageMeta.js';

export default function NotFound() {
  usePageMeta('Page not found — Fresco NY');

  // Keep unknown URLs out of search indexes.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="eyebrow">404 · PAGE NOT FOUND</div>
          <h1>This page is<br />not in our collection.</h1>
          <p className="lead">The address may be incorrect or the page may have moved.</p>
          <Link className="button" to="/">Return home</Link>
        </div>
      </section>
    </main>
  );
}
