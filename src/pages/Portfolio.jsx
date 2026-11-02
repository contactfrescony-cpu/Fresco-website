import usePageMeta from '../hooks/usePageMeta.js';
import GalleryImage from '../components/GalleryImage.jsx';
import { PRODUCT_IMAGES } from '../data/products.js';
import useProductCategories from '../hooks/useProductCategories.js';
import productInMind from '../assets/product-in-mind.webp';

const PILLS = ['Menswear', 'Womenswear', 'Kidswear', 'Knitwear', 'Wovens', 'Value-added styles'];

export default function Portfolio() {
  usePageMeta(
    'Our Products — Fresco NY',
    'Explore apparel categories developed by Fresco NY, from T-shirts, polos and sweatshirts to shirts, outerwear, denim, trousers and shorts.'
  );
  const categories = useProductCategories().filter((category) => category.showOnProducts);

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="eyebrow">OUR PRODUCTS</div>
          <h1>Designed around<br />your brand's direction.</h1>
          <p className="lead">A versatile apparel development capability, from core essentials to garments with more complex fabric, wash, print and construction details.</p>
          <div className="pill-row">
            {PILLS.map((pill) => <span className="pill" key={pill}>{pill}</span>)}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid-4 product-grid">
            {categories.map(({ slug, name, description }) => (
              <div className="card" id={slug} key={slug}>
                <div className="card-image">
                  <GalleryImage gallery={slug} fallback={PRODUCT_IMAGES[slug]} alt={`${name} product category`} width="800" height="1000" />
                </div>
                <h3>{name}</h3>
                <p>{description}</p>
              </div>
            ))}
          </div>
          <p className="form-note portfolio-note">These standalone product and fabric images are illustrative development visuals. Replace with approved Fresco NY portfolio photography before public launch.</p>
        </div>
      </section>

      <section className="section cream">
        <div className="container split">
          <div>
            <div className="eyebrow">SHOW US WHAT YOU HAVE IN MIND</div>
            <h2>Have a product<br />in mind?</h2>
            <p className="lead">Send a reference, specification or collection brief. We'll use it to start a focused product-development conversation.</p>
          </div>
          <img className="split-photo" src={productInMind} alt="Two models in casual apparel: a stone overshirt with olive cargo trousers, and a burgundy quilted vest with wide-leg jeans" width="1024" height="1536" loading="lazy" decoding="async" />
        </div>
      </section>
    </main>
  );
}
