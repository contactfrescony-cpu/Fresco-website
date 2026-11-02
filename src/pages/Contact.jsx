import { useState } from 'react';
import { Link } from 'react-router-dom';
import usePageMeta from '../hooks/usePageMeta.js';
import { CONTACT_EMAIL, PURPOSES } from '../data/site.js';

// Exactly the fields the brief allows: company, business email, phone with country code, purpose, message.
const FIELDS = ['company', 'email', 'phone', 'purpose', 'message', 'website'];

const FIELD_ERRORS = {
  company: 'Please enter your company name.',
  email: 'Please enter a valid business email address.',
  phone: 'Please enter your phone number with the country code, e.g. +44 20 7946 0000.',
  purpose: 'Please choose the purpose of your enquiry.',
  message: 'Your message is too long. Please shorten it, or email us directly.'
};

/** Email-app draft, used only when the website cannot send the enquiry itself. */
function buildMailto(payload) {
  const subject = `Fresco NY enquiry — ${payload.company} — ${payload.purpose}`;
  const body = [
    `Company: ${payload.company}`,
    `Business email: ${payload.email}`,
    `Phone: ${payload.phone}`,
    `Purpose: ${payload.purpose}`,
    '',
    'Message:',
    payload.message || '(none)'
  ].join('\n');
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function Contact() {
  usePageMeta(
    'Contact Fresco NY',
    'Contact Fresco NY about apparel development, sampling, manufacturing and supply-chain support.'
  );
  // idle | sending | sent | draft (email app opened) | error
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || status === 'sending') return;

    const data = new FormData(form);
    const payload = Object.fromEntries(FIELDS.map((field) => [field, String(data.get(field) ?? '').trim()]));

    setStatus('sending');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        setStatus('sent');
        setMessage(`Thank you — your enquiry has reached our team. We'll reply to ${payload.email}.`);
        form.reset();
        return;
      }
      if (response.status === 503) {
        // Email sending isn't configured on this server: hand over to the visitor's email app.
        window.location.href = buildMailto(payload);
        setStatus('draft');
        setMessage('Your email app has opened with your enquiry. Please review it and press send.');
        return;
      }
      const result = await response.json().catch(() => ({}));
      setStatus('error');
      if (response.status === 400 && FIELD_ERRORS[result.field]) {
        setMessage(FIELD_ERRORS[result.field]);
        form.elements[result.field]?.focus();
      } else if (response.status === 429) {
        setMessage('You have sent several enquiries in a short time. Please wait a few minutes, or email us directly.');
      } else {
        setMessage('Your enquiry could not be sent. Please try again, or email us directly.');
      }
    } catch {
      setStatus('error');
      setMessage('We could not reach the server. Please try again, or email us directly.');
    }
  };

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <div className="eyebrow">CONTACT FRESCO NY</div>
          <h1>Let’s start<br />a conversation.</h1>
          <p className="lead">Tell us who you are and what you need. Our team responds quickly to every business enquiry.</p>
        </div>
      </section>

      <section className="section">
        <div className="container form-layout">
          <div>
            <div className="eyebrow">BUSINESS ENQUIRIES</div>
            <h2 className="heading-md">Simple to start.<br />Quick to respond.</h2>
            <p className="muted">No registration and no lengthy quotation forms — just a few details so the right person can get back to you.</p>
            <p><strong>Email</strong><br /><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
          </div>

          <div className="form-panel">
            <form id="enquiry-form" onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="field full">
                  <label htmlFor="company">Company name *</label>
                  <input id="company" name="company" required maxLength={160} autoComplete="organization" />
                </div>
                <div className="field">
                  <label htmlFor="email">Business email *</label>
                  <input id="email" name="email" type="email" required maxLength={200} autoComplete="email" />
                </div>
                <div className="field">
                  <label htmlFor="phone">Phone (with country code) *</label>
                  <input
                    id="phone" name="phone" type="tel" required maxLength={32} autoComplete="tel"
                    placeholder="+44 20 7946 0000" pattern="\+[0-9][0-9 \(\)\.\-]{5,30}"
                    title="Start with + and your country code, e.g. +44 20 7946 0000"
                  />
                </div>
                <div className="field full">
                  <label htmlFor="purpose">Purpose of enquiry *</label>
                  <select id="purpose" name="purpose" required defaultValue="">
                    <option value="" disabled>Select a purpose</option>
                    {PURPOSES.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </div>
                <div className="field full">
                  <label htmlFor="message">Message <span className="optional">(optional)</span></label>
                  <textarea id="message" name="message" maxLength={5000} placeholder="Anything you'd like us to know" data-lenis-prevent />
                </div>
                <div className="hp-field" aria-hidden="true">
                  <label htmlFor="website">Website</label>
                  <input id="website" name="website" tabIndex={-1} autoComplete="off" />
                </div>
                <div className="field full">
                  <button className="button" type="submit" disabled={status === 'sending'}>
                    {status === 'sending' ? 'Sending…' : 'Send enquiry ↗'}
                  </button>
                  <p className="form-note privacy-note">
                    We use these details only to respond to your enquiry. See our <Link to="/privacy">privacy notice</Link>.
                  </p>
                  {(status === 'sent' || status === 'draft') && <div className="success is-visible" role="status">{message}</div>}
                  {status === 'error' && (
                    <div className="form-error" role="alert">
                      {message} <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
                    </div>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
