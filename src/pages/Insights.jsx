import { useMemo, useState } from 'react';
import usePageMeta from '../hooks/usePageMeta.js';
import { INSIGHTS, INSIGHT_TOPICS } from '../data/insights.js';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const STANDARDS = [
  ['01 / VERIFIED', 'Checked before publishing', 'Every update is reviewed and approved by our team before it appears here.'],
  ['02 / DATED', 'Always dated', 'Each insight shows when it was published, so you know how current it is.'],
  ['03 / ATTRIBUTED', 'Sources credited', 'Information from external publications is clearly attributed and linked.']
];

function InsightCard({ insight }) {
  return (
    <article className="insight-card">
      {insight.image && (
        <div className="insight-image"><img src={insight.image} alt="" loading="lazy" /></div>
      )}
      <div className="insight-meta">
        <span className="eyebrow">{insight.topic}</span>
        <time dateTime={insight.date}>{dateFormat.format(new Date(insight.date))}</time>
      </div>
      <h3>{insight.title}</h3>
      <p className="muted">{insight.summary}</p>
      {insight.source && (
        <p className="insight-source">
          Source: <a href={insight.source.url} target="_blank" rel="noopener noreferrer">{insight.source.name} ↗</a>
        </p>
      )}
    </article>
  );
}

export default function Insights() {
  usePageMeta(
    'Industry Insights — Fresco NY',
    'Fabric innovation, garment dyeing and washing, sustainable chemistry, automation and digital supply-chain developments, selected by Fresco NY.'
  );
  const [topic, setTopic] = useState('All');

  const items = useMemo(
    () => INSIGHTS
      .filter((item) => topic === 'All' || item.topic === topic)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [topic]
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
              {items.map((insight) => <InsightCard key={insight.slug} insight={insight} />)}
            </div>
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
