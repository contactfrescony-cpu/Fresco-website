FRESCO NY WEBSITE — FIRST MULTI-PAGE BUILD
==========================================

Included pages
--------------
- index.html              Homepage
- development.html        In-house product development
- fabrics.html            Fabrics, washes, prints, embroidery, trims
- portfolio.html          Product categories
- about.html              Fresco NY positioning and operating model
- start-project.html      Project enquiry form (mailto draft)
- privacy.html            Draft privacy and analytics note
- styles.css              Responsive visual system
- site.js                 Mobile navigation, email form, notice
- assets/                 Approved logo concept and illustrative visual crops

Brand direction
---------------
Main line: From Vision to Garment.
Support line: Your ideas. Our expertise. Extraordinary execution.
Logo palette: emerald green, solid bright metallic-inspired gold, red dots.
Descriptor: DESIGNING · DEVELOPMENT · SOURCING
Visual direction: Apple-inspired simplicity and usability with an editorial fashion identity.
No telephone number is included. Contact email: info@frescony.uk.

IMPORTANT BEFORE PUBLIC LAUNCH
------------------------------
1. The current website lists this address, and this draft retains it as requested:
   No: 520, Pudur pirivu, Dharapuram road, Tirupur - 641608. The current site also exposes a phone number and
   generic email details; those have intentionally NOT been copied. Only info@frescony.uk is used.
2. Images are illustrative crops from the approved visual concept, not original portfolio photographs.
   Replace these with the user's approved garment/fabric photos before launch.
3. The existing site shows logo images without readable customer names in its public text. This draft
   does not invent customer names or reproduce third-party logos. Add only approved, confirmed customer
   names/logos after review. For inspiration, use broad UX principles from customer sites rather than
   copying their exact branding, fonts, or page designs.
4. The homepage includes brand names displayed in the current site's logo strip, rendered as restrained text rather than copying each brand's proprietary logo treatment. Confirm current usage/permissions before launch.
5. No analytics account or GA4 measurement ID was provided. No visitor data is being collected by this
   static draft. To enable daily country reports:
   - Create/choose a Google Analytics 4 property owned by Fresco NY.
   - Add the official Google tag / Measurement ID to every page or via a tag manager.
   - Configure privacy/consent controls appropriate to the site's audiences and applicable laws.
   - In GA4, review Reports > User attributes > Demographic details / Country, and traffic acquisition.
   - Configure a daily report email or use a reporting workflow (e.g. Looker Studio) with a daily schedule.
   - Test with real visits and verify country data before relying on it.
6. The Start a Project form uses mailto and opens the visitor's email client. For reliable lead capture,
   connect a secure form backend/CRM before production. Do not claim the form is storing submissions.
7. The existing listed address is retained exactly as requested.
8. Verify all copy, legal/privacy language, customer references, claims and actual capabilities before launch.

How to preview
--------------
Open index.html in a browser. For best local testing, run a static server from this folder:
  python -m http.server 8000
Then open http://localhost:8000

How to deploy
-------------
Upload the complete folder to the existing hosting provider or deploy to a static hosting service.
Keep frescony.uk pointed at the existing production environment until the new build is tested and approved.
This ZIP is a deployable front-end starter; it has not been published to frescony.uk and does not include
server credentials, analytics credentials, CMS, or a form-processing backend.


LOGO CONSISTENCY UPDATE
-----------------------
The same approved logo image (emerald FRESCO, red three dots, solid gold NY, and the DESIGNING · DEVELOPMENT · SOURCING descriptor) is now used in the header and footer across all seven pages. Keep assets/fresco-ny-logo.png in the assets folder when deploying.


IMAGE PLACEMENT CORRECTION
--------------------------
The previous build mistakenly used crops taken from a full-page website mockup as if they were individual photos. Those have been replaced with separate, standalone fashion-model, garment-product, and fabric-texture images. No webpage text or layout is embedded inside the new image assets.


IMAGE PLACEMENT CORRECTION
--------------------------
The previous build mistakenly used crops from a full-page website mockup as individual photos. This build replaces them with separate, standalone model, garment-product and fabric-texture images. No webpage text or layout is embedded inside these new image assets.


VISUAL DIRECTION UPDATE
-----------------------
Refined around Fresco NY's approved marketing direction: emerald green, rich solid gold and warm ivory; large fashion/product photography; restrained editorial typography; generous white space; and no factory photography. The approved logo and standalone garment/fabric images are retained.


OCTOBER 2026 WEBSITE UPDATE
---------------------------
Navigation: Home, Development, Our Products, Contact, Privacy & Analytics. The old Fabrics & Treatments, About Fresco and Start a Project pages are removed.
Brand wall: Maje, SCALPERS, Banana Moon and Week-end à la mer removed; Tommy Hilfiger added. Brand tiles are hyperlinks and their order shuffles on each page load.
Image folders: Add JPG/JPEG/PNG/WEBP/AVIF images to gallery/<category> (tshirts, polos, hoodies, shirts, outerwear, denim, trousers, shorts) or development-images/<step> (measuring, thread, needles, patterns). The site reads each folder through the Node server API and rotates images every 5 seconds while they are on screen. No rebuild is needed after adding images.
Preview: Install Node.js LTS, then double-click START_PREVIEW_WINDOWS.bat (installs, builds and serves http://localhost:8000). For live-reload editing run "npm run dev".
Deployment: Run "npm ci && npm run build", then "npm start" on a Node-capable host (see DEPLOYMENT.md). Static-only hosting cannot enumerate the image folders.
React version (October 2026): The site is a React + Vite single-page app with Lenis smooth scrolling. Page URLs are now /development, /portfolio, /contact and /privacy; the old .html URLs redirect permanently. The previous static HTML site is kept in legacy-static/ for reference and is not served.
Brand logos: At present the brand wall uses typographic wordmarks as clickable hyperlinks, not official trademark logo artwork. Replace with approved logo files only after obtaining/confirming usage rights. Review every official brand URL before launch.
Contact address: No: 520, Pudur pirivu, Dharapuram road, Tirupur - 641608.

BRAND PRESENTATION NOTE
-----------------------
Brand names are currently rendered as typographic wordmarks, each linking to the brand website. They are not copied trademark logo files. Replace with approved brand artwork if Fresco has permission to display it. Verify each destination URL before publishing.
