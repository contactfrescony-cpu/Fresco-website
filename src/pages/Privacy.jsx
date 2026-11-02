import usePageMeta from '../hooks/usePageMeta.js';
import { CONTACT_EMAIL } from '../data/site.js';

export default function Privacy() {
  usePageMeta('Privacy & Analytics — Fresco NY', 'Fresco NY website privacy and analytics information.');

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="eyebrow">PRIVACY & ANALYTICS</div>
          <h1>Respect for your visit.</h1>
          <p className="lead">A simple explanation of how website enquiries and visitor analytics should be handled.</p>
        </div>
      </section>
      <section className="section">
        <div className="container legal">
          <h2>Enquiries</h2>
          <p>The enquiry form asks only for your company name, business email, phone number, the purpose of your enquiry and an optional message. These details are sent by email to {CONTACT_EMAIL} so our team can reply to you. The website passes your enquiry on to that inbox and does not keep a copy of it.</p>
          <h2>Website analytics</h2>
          <p>The production website should use an approved analytics service such as Google Analytics 4 to understand aggregate visits, referral sources, popular pages and approximate visitor countries. Analytics must be configured with Fresco NY's own account and measurement ID before launch. Where required by applicable law, consent should be collected before non-essential analytics are activated.</p>
          <h2>Daily visitor reporting</h2>
          <p>Once analytics is connected, configure a daily report for users, sessions, top pages, traffic sources and country/region. Country reporting is generally based on approximate network-derived location and may be affected by VPNs, privacy settings and consent choices. Do not treat it as a precise identity or address.</p>
          <h2>Contact</h2>
          <p>For website and business enquiries, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
          <p className="form-note">This page is a launch draft, not legal advice. Final privacy wording should be reviewed against the analytics tools and data practices actually enabled.</p>
        </div>
      </section>
    </main>
  );
}
