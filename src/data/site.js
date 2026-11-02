export const CONTACT_EMAIL = 'info@frescony.uk';

export const NAV_LINKS = [
  ['/', 'Home'],
  ['/development', 'Development'],
  ['/portfolio', 'Our Products'],
  ['/supply-chain', 'Supply Chain'],
  ['/insights', 'Insights'],
  ['/contact', 'Contact']
];

/** Contact form "Purpose of enquiry" options. Keep in sync with PURPOSES in server/contact.js. */
export const PURPOSES = [
  'New product development',
  'Sampling',
  'Bulk manufacturing',
  'Fabric & material sourcing',
  'Dyeing, washing & finishing',
  'Supply chain & replenishment',
  'Partnership',
  'Other'
];

/** Old static-site URLs, redirected to their React routes (the server also sends 301s). */
export const LEGACY_REDIRECTS = {
  '/index.html': '/',
  '/development.html': '/development',
  '/portfolio.html': '/portfolio',
  '/contact.html': '/contact',
  '/privacy.html': '/privacy'
};

/** Brand wall, shuffled on every visit. Styling per brand is keyed on the href in styles.css. */
export const BRANDS = [
  ['Tommy Hilfiger', 'https://www.tommy.com'],
  ['R11 SPORT CLUB', 'https://www.r11sportclub.com'],
  ['DERBY', 'https://derbyjeanscommunity.com'],
  ['MCS', 'https://www.mcs.com'],
  ['RAGMAN', 'https://www.ragman.de'],
  ['REDSKINS', 'https://www.redskins.fr'],
  ['AMERICAN RAG CIE', 'https://www.americanrag.com'],
  ['DEVRED 1902', 'https://www.devred.com'],
  ['MPL SPORTS', 'https://www.mplsports.com'],
  ['Crocodile', 'https://crocodile.in'],
  ['Being Human', 'https://www.beinghumanclothing.com'],
  ['Cotton & Co.', 'https://www.cottonandco.com'],
  ['TAILOR VINTAGE', 'https://www.tailorvintage.com'],
  ['INDIAN TERRAIN', 'https://indianterrain.com'],
  ['VOI JEANS', 'https://www.voijeans.com'],
  ['ANGEL & ROCKET', 'https://www.angelandrocket.com'],
  ['Pepe Jeans London', 'https://www.pepejeans.com'],
  ['NAUTICA', 'https://www.nautica.com'],
  ['celio*', 'https://www.celio.com'],
  ['SLATE & STONE', 'https://www.slateandstone.com'],
  ['UrGear', 'https://www.urgear.in']
];
