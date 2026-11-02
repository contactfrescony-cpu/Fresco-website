/**
 * Back-office sections (the sidebar) and which roles may open them. Administrators can open everything.
 * Sections without `ready` still show a placeholder until their screen is built.
 * There is no dashboard: signing in opens the first section the person may use.
 *
 *   contributor -> Upload Photos      approver -> Website Images      viewer -> Enquiries, Analytics
 */
export const ROLE_LABELS = {
  admin: 'Administrator',
  approver: 'Approver',
  contributor: 'Contributor',
  viewer: 'Viewer'
};

export const ADMIN_SECTIONS = [
  { path: 'upload', label: 'Upload Photos', roles: ['contributor'], description: 'Send raw garment photographs to the Google Drive image pipeline, one or many at a time.', ready: true },
  { path: 'review', label: 'Website Images', roles: ['approver'], description: 'Approve finished photos into the website’s product folders, and manage folders, order and homepage.', ready: true },
  { path: 'users', label: 'Users & Roles', roles: [], description: 'Assign roles to people who signed up, and enable or disable accounts.', ready: true },
  { path: 'enquiries', label: 'Enquiries', roles: ['viewer'], description: 'View, assign and follow up on customer enquiries.' },
  { path: 'analytics', label: 'Analytics', roles: ['viewer'], description: 'Visitors, countries, product interest and enquiry sources.' }
];

/** True when the role may open a section. An empty list means administrators only. */
export function canAccess(role, section) {
  return role === 'admin' || section.roles.includes(role);
}

/** The page someone lands on after signing in. */
export function homeSectionFor(role) {
  return ADMIN_SECTIONS.find((section) => canAccess(role, section));
}
