/** Industry Insights topics (brief §8). Used for the filter on /insights. */
export const INSIGHT_TOPICS = [
  'Fabric innovation',
  'Dyeing & washing',
  'Sustainable chemistry',
  'Green energy',
  'Automation',
  'Print-on-demand',
  'AI & digital supply chain',
  'Market developments'
];

/**
 * Published insights. Empty until the Insights Manager (CMS) is built; it will then come from the API.
 * Every item must be verified and approved before publication, carry a date, and credit external sources.
 *
 * Shape:
 * {
 *   slug: 'unique-id',
 *   title: 'Headline',
 *   topic: 'Fabric innovation',          // one of INSIGHT_TOPICS
 *   date: '2026-11-02',                  // ISO date, shown on the card
 *   summary: 'Two or three sentences.',
 *   image: '/insights/photo.webp',       // optional
 *   source: { name: 'Publisher', url: 'https://…' } // optional, required for external information
 * }
 */
export const INSIGHTS = [];
