'use strict';

// Fresco NY web server.
//   npm run dev    -> Vite dev server with hot reload, mounted inside Express (localhost only)
//   npm run build  -> production bundle in dist/
//   npm start      -> serves dist/ (run the build first)
// In every mode it also serves the runtime image folders, the gallery API and the contact API.

const path = require('path');

// Optional .env next to this file (SMTP settings etc.); real environment variables win.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env file */ }

const http = require('http');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const { createInsightsRouter } = require('./server/insights.js');
const { createContactRouter } = require('./server/contact.js');
const { createAuthRouter } = require('./server/auth.js');
const { createUsersRouter } = require('./server/users.js');
const { createUploadsRouter } = require('./server/uploads.js');
const { createReviewRouter, createCatalogRouter, publishedImagesFor } = require('./server/catalog.js');
const { createDevelopmentImagesRouter } = require('./server/development-images.js');
const { createPublicAnalyticsRouter, createAdminAnalyticsRouter } = require('./server/analytics.js');
const { createAnalyticsEmailRouter, startAnalyticsEmailScheduler, stopAnalyticsEmailScheduler } = require('./server/analytics-email.js');
const { createEnquiriesRouter, startEnquirySheetSync, stopEnquirySheetSync } = require('./server/enquiries.js');
const { serveMedia } = require('./server/media.js');
const { closePool } = require('./server/db.js');

const root = __dirname;
const distDir = path.join(root, 'dist');
const isDev = process.argv.includes('--dev');
const isProduction = process.env.NODE_ENV === 'production';
const port = Number.parseInt(process.env.PORT || '8000', 10);
const host = process.env.HOST || (isDev ? '127.0.0.1' : '0.0.0.0');

// Gallery key (used by <GalleryImage gallery="...">) -> fallback folder relative to the project root,
// used for product categories only when the database is unreachable:
//   "denim" -> gallery/denim
// Development page sections ("development-measuring" ...) come from Google Drive only (managed in the
// back office), so they have no folder.
// Keys are restricted to lowercase letters, digits and hyphens (no path traversal).
const galleryKeyPattern = /^[a-z0-9][a-z0-9-]{0,40}$/;
const isDevelopmentGallery = (key) => key.startsWith('development-');
function galleryFolderFor(key) {
  if (!galleryKeyPattern.test(key)) return null;
  return isDevelopmentGallery(key) ? null : `gallery/${key}`;
}
const imageFolders = ['gallery'];
const imagePattern = /\.(?:jpe?g|png|webp|avif)$/i;

// Client-side routes (rendered by React) and the old static-site URLs that now redirect to them.
const appRoutes = new Set(['/', '/development', '/portfolio', '/supply-chain', '/insights', '/contact', '/privacy']);
// Back-office screens (/admin, /admin/login, /admin/...) are all rendered by the React admin app.
const isAdminRoute = (route) => route === '/admin' || route.startsWith('/admin/');
const legacyRedirects = new Map([
  ['/index.html', '/'], ['/development.html', '/development'], ['/portfolio.html', '/portfolio'],
  ['/contact.html', '/contact'], ['/privacy.html', '/privacy']
]);

// Endpoints Google Analytics 4 sends hits to (per Google's CSP guidance for gtag.js).
const GA_HOSTS = [
  'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'
];

async function createApp(httpServer) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

  app.use(helmet({
    // Vite's dev client relies on inline scripts, so the CSP is applied to built output only.
    contentSecurityPolicy: isDev ? false : { directives: {
      // blob: = previews of photos chosen for upload. https: = blog images on the Insights page (hosted anywhere). Google hosts below = Google Analytics 4 (gtag.js).
      defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:', 'https:', ...GA_HOSTS],
      styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'", 'https://*.googletagmanager.com'],
      connectSrc: ["'self'", ...GA_HOSTS], baseUri: ["'self'"],
      formAction: ["'self'", 'mailto:'], frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }},
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false
  }));
  app.use(compression());

  app.get('/healthz', (req, res) => res.set('Cache-Control', 'no-store').json({ status: 'ok' }));

  // Keep the back office out of search engines.
  app.use(['/admin', '/api/auth', '/api/admin'], (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

  app.use('/api/contact', createContactRouter());
  app.use('/api/auth', createAuthRouter());
  app.use('/api/admin/users', createUsersRouter());
  app.use('/api/admin/enquiries', createEnquiriesRouter());
  app.use('/api/admin/uploads', createUploadsRouter());
  app.use('/api/admin/review', createReviewRouter());
  app.use('/api/admin/development-images', createDevelopmentImagesRouter());
  app.use('/api/admin/analytics/email', createAnalyticsEmailRouter());
  app.use('/api/admin/analytics', createAdminAnalyticsRouter());
  app.use('/api/analytics', createPublicAnalyticsRouter());
  app.use('/api/products', createCatalogRouter());
  app.use('/api/insights', createInsightsRouter());

  app.get('/api/gallery/:category', async (req, res, next) => {
    const key = req.params.category;
    if (!galleryKeyPattern.test(key)) return res.status(404).json({ error: 'Unknown gallery category' });
    // Photos come from the database (managed by approvers, files in Google Drive).
    const managed = await publishedImagesFor(key);
    if (managed) return res.set('Cache-Control', 'no-store').json({ category: key, images: managed });
    // Development page sections have no local fallback: Drive is their only source.
    if (isDevelopmentGallery(key)) return res.status(503).set('Cache-Control', 'no-store').json({ error: 'gallery_unavailable', images: [] });
    // Product categories fall back to their gallery/ folder when the database is unreachable.
    const folder = galleryFolderFor(key);
    try {
      const entries = await fs.readdir(path.join(root, folder), { withFileTypes: true });
      const images = entries.filter((entry) => entry.isFile() && imagePattern.test(entry.name))
        .map((entry) => `/${folder}/${encodeURIComponent(entry.name)}`).sort();
      return res.set('Cache-Control', 'no-store').json({ category: req.params.category, images });
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).json({ error: 'Gallery folder not found' });
      return next(error);
    }
  });

  app.get([...legacyRedirects.keys()], (req, res) => res.redirect(301, legacyRedirects.get(req.path)));

  // Published product photos. They are stored in Google Drive and served from a local cache
  // (filled from Drive on first request; see server/media.js).
  app.get('/media/:name', serveMedia);

  // Runtime image folders: only image files are served (instructions/.gitkeep stay private).
  for (const folder of imageFolders) {
    app.use(`/${folder}`,
      (req, res, next) => (imagePattern.test(req.path) ? next() : res.status(404).type('text').send('Not found')),
      express.static(path.join(root, folder), {
        dotfiles: 'deny', index: false, fallthrough: false,
        setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
      }));
  }

  if (isDev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root,
      appType: 'spa',
      server: { middlewareMode: true, hmr: { server: httpServer } }
    });
    app.use(vite.middlewares);
  } else {
    const indexHtml = path.join(distDir, 'index.html');
    if (!existsSync(indexHtml)) {
      console.error('No production build found. Run "npm run build" first, or "npm run dev" while developing.');
      process.exit(1);
    }

    // Hashed bundles never change, so they can be cached for a year.
    app.use('/assets', express.static(path.join(distDir, 'assets'), {
      immutable: true, maxAge: '1y', index: false, fallthrough: false
    }));
    app.use(express.static(distDir, {
      index: false, dotfiles: 'deny',
      setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=3600')
    }));

    // Every other page request gets the React app; unknown paths keep a real 404 status.
    app.use((req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api/') || !req.accepts('html')) return next();
      const route = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
      res.set('Cache-Control', 'no-cache');
      return res.status(appRoutes.has(route) || isAdminRoute(route) ? 200 : 404).sendFile(indexHtml);
    });
  }

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    return res.status(404).type('text').send('Not found');
  });

  app.use((error, req, res, next) => {
    // Client errors (404 from static files, 413 oversized or 400 malformed JSON bodies) are not crashes.
    const status = error.status || error.statusCode;
    if (status >= 400 && status < 500 && !res.headersSent) {
      return req.path.startsWith('/api/')
        ? res.status(status).json({ error: status === 413 ? 'too_large' : 'bad_request' })
        : res.status(status).type('text').send(status === 404 ? 'Not found' : 'Bad request');
    }
    console.error(`[${new Date().toISOString()}]`, error);
    if (res.headersSent) return next(error);
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Internal server error' });
    return res.status(500).type('text').send('Internal server error');
  });

  return app;
}

async function main() {
  const server = http.createServer();
  const app = await createApp(server);
  server.on('request', app);
  server.listen(port, host, () => {
    const mode = isDev ? 'development (Vite)' : (process.env.NODE_ENV || 'preview');
    console.log(`Fresco NY listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} [${mode}]`);
    startAnalyticsEmailScheduler();   // daily analytics email (settings on the back-office Analytics page)
    startEnquirySheetSync();          // copies enquiries to the Google Sheet, retrying any that failed
  });

  function shutdown(signal) {
    console.log(`${signal} received; closing HTTP server`);
    stopAnalyticsEmailScheduler();
    stopEnquirySheetSync();
    server.close((error) => closePool().finally(() => process.exit(error ? 1 : 0)));
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
