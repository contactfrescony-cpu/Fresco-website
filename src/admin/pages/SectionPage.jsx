import { ROLE_LABELS } from '../sections.js';

/** Placeholder for a back-office section; replaced by the real screen when that section is built. */
export default function SectionPage({ section }) {
  const roles = ['admin', ...section.roles].map((role) => ROLE_LABELS[role]).join(', ');
  return (
    <>
      <header className="admin-page-head">
        <div className="eyebrow">{section.label.toUpperCase()}</div>
        <h1>{section.label}</h1>
        <p className="muted">{section.description}</p>
      </header>
      <div className="admin-panel admin-placeholder">
        <p>This section is not built yet.</p>
        <p className="muted">Access: {roles}</p>
      </div>
    </>
  );
}
