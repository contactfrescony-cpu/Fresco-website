import tshirts from '../assets/products/tshirts.webp';
import polos from '../assets/products/polos.webp';
import hoodies from '../assets/products/hoodies.webp';
import shirts from '../assets/products/shirts.webp';
import outerwear from '../assets/products/outerwear.webp';
import denim from '../assets/products/denim.webp';
import trousers from '../assets/products/trousers.webp';
import shorts from '../assets/products/shorts.webp';

/**
 * Bundled fallback image per gallery folder. It is only shown if the folder is empty
 * or the gallery API is unavailable; normally images come from gallery/<key>/.
 */
export const PRODUCT_IMAGES = { tshirts, polos, hoodies, shirts, outerwear, denim, trousers, shorts };

/**
 * Built-in copy of the product categories. The live list (names, order, what shows on the homepage and
 * Products page) is managed by approvers in the back office and loaded from /api/products/categories;
 * this copy is used only while that loads or if the database is unavailable.
 */
export const DEFAULT_CATEGORIES = [
  { slug: 'tshirts', name: 'T-shirts', description: 'Core essentials, long sleeves, graphics, jacquards and surface treatments.', homeTagline: 'Everyday, elevated.', showOnHome: true, showOnProducts: true },
  { slug: 'polos', name: 'Polo shirts', description: 'Piqué, knitted and printed polos with tipped collars and refined branding.', homeTagline: 'Classic, refined.', showOnHome: false, showOnProducts: true },
  { slug: 'hoodies', name: 'Sweatshirts & hoodies', description: 'Fleece, brushed and textured surfaces with considered finishing.', homeTagline: 'Comfort with character.', showOnHome: true, showOnProducts: true },
  { slug: 'shirts', name: 'Shirts & overshirts', description: 'Woven structures, prints, checks, trims and distinctive construction.', homeTagline: 'Structure and style.', showOnHome: true, showOnProducts: true },
  { slug: 'outerwear', name: 'Outerwear', description: 'Denim jackets and fleece layers with considered materials and functional detailing.', homeTagline: 'Built for every season.', showOnHome: true, showOnProducts: true },
  { slug: 'denim', name: 'Denim', description: 'Five-pocket jeans across washes, fits and finishes.', homeTagline: 'Washes with depth.', showOnHome: false, showOnProducts: true },
  { slug: 'trousers', name: 'Trousers', description: 'Chinos, joggers and utility trousers with clean, considered construction.', homeTagline: 'Clean, considered fits.', showOnHome: false, showOnProducts: true },
  { slug: 'shorts', name: 'Shorts', description: 'Terry, printed and woven shorts for warm-season and leisure ranges.', homeTagline: 'Made for warm seasons.', showOnHome: false, showOnProducts: true }
];
