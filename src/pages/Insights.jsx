import { useEffect, useMemo, useState } from 'react';
import usePageMeta from '../hooks/usePageMeta.js';
import { INSIGHT_TOPICS } from '../data/insights.js';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const STANDARDS = [
  ['01 / VERIFIED', 'Checked before publishing', 'Every update is reviewed and approved by our team before it appears here.'],
  ['02 / DATED', 'Always dated', 'Each insight shows when it was published, so you know how current it is.'],
  ['03 / ATTRIBUTED', 'Sources credited', 'Information from external publications is clearly attributed and linked.']
];

// "202611110930" (YYYYMMDDHHMM, from the blog id) -> a Date, or null when unknown.
function blogDate(sort) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(sort || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

function InsightCard({ insight }) {
  const date = blogDate(insight.sort);
  return (
    <article className="insight-card">
      <a className="insight-link" href={insight.link} target="_blank" rel="noopener noreferrer">
        {insight.image && (
          <div className="insight-image"><img src={insight.image} alt="" loading="lazy" referrerPolicy="no-referrer" /></div>
        )}
        <div className="insight-meta">
          <span className="eyebrow">{insight.tab}</span>
          {date && <time dateTime={date.toISOString().slice(0, 10)}>{dateFormat.format(date)}</time>}
        </div>
        <h3>{insight.title}</h3>
        {insight.description && <p className="muted">{insight.description}</p>}
        <span className="insight-read">Read the full blog ↗</span>
      </a>
    </article>
  );
}

export default function Insights() {
  usePageMeta(
    'Industry Insights — Fresco NY',
    'Fabric innovation, garment dyeing and washing, sustainable chemistry, automation and digital supply-chain developments, selected by Fresco NY.'
  );
  const [topic, setTopic] = useState('All');
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const load = (query = '') => fetch(`/api/insights${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { insights: [] }))
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data.insights)) setInsights(data.insights);
        return data;
      });
    // The server answers at once with its saved copy; if it is re-reading Drive, ask again and wait for the new list.
    load()
      .then((data) => (data.refreshing ? load('?wait=1') : null))
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  // The server sends every tab's latest blogs (max 20 each), newest first; "All" shows them together.
  const items = useMemo(
    () => insights.filter((item) => topic === 'All' || item.tab === topic),
    [insights, topic]
  );

  return (
    <main className="insights-page">
      <section className="page-hero">
        <div className="container">
          <div className="eyebrow">INDUSTRY INSIGHTS</div>
          <h1>Following the industry,<br />so you stay ahead.</h1>
          <p className="lead">Selected developments in fabrics, garment treatments, sustainability, manufacturing technology and the global apparel market.</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="topic-filter" role="group" aria-label="Filter insights by topic">
            {['All', ...INSIGHT_TOPICS].map((name) => (
              <button
                key={name}
                type="button"
                className={name === topic ? 'pill is-active' : 'pill'}
                aria-pressed={name === topic}
                onClick={() => setTopic(name)}
              >
                {name}
              </button>
            ))}
          </div>

          {items.length > 0 ? (
            <div className="insight-grid">
              {items.map((insight) => <InsightCard key={`${insight.tab}/${insight.id}`} insight={insight} />)}
            </div>
          ) : loading ? (
            <div className="insight-empty"><p className="muted">Loading insights…</p></div>
          ) : (
            <div className="insight-empty">
              <h2 className="heading-md">{topic === 'All' ? 'Our first insights are on their way.' : `No ${topic.toLowerCase()} insights yet.`}</h2>
              <p className="muted">We publish only verified, dated updates. Please check back soon.</p>
            </div>
          )}
        </div>
      </section>

      <section className="section cream">
        <div className="container">
          <div className="section-head">
            <div>
              <div className="eyebrow">EDITORIAL STANDARDS</div>
              <h2>Accurate before<br />it is interesting.</h2>
            </div>
            <p>Insights may be prepared with digital tools, but every update is checked by people before it is published.</p>
          </div>
          <div className="grid-3 feature-grid">
            {STANDARDS.map(([label, title, text]) => (
              <div key={title}>
                <div className="eyebrow">{label}</div>
                <h3>{title}</h3>
                <p className="muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
