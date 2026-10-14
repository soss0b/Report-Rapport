// Fonctions partagées autour des rapports.

const INTERVENTION_TYPES = [
  'Installation',
  'Maintenance préventive',
  'Dépannage / Réparation',
  'Contrôle / Inspection',
  'Mise en service',
  'Autre',
];

const FIELDS = [
  'intervention_date',
  'start_time',
  'end_time',
  'client',
  'site',
  'intervention_type',
  'description',
  'materials',
  'observations',
  'signer_name',
  'signature',
];

const MAX_LENGTH = {
  client: 200,
  site: 300,
  intervention_type: 100,
  signer_name: 200,
  description: 20000,
  materials: 10000,
  observations: 10000,
};

const MAX_SIGNATURE_LENGTH = 1_000_000;

function readReportForm(body) {
  const values = {};
  for (const field of FIELDS) values[field] = String(body[field] ?? '').trim();
  return values;
}

function validateReport(values, { forSubmission }) {
  const errors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.intervention_date) || Number.isNaN(Date.parse(values.intervention_date))) {
    errors.intervention_date = "Date d'intervention invalide.";
  }
  for (const field of ['start_time', 'end_time']) {
    if (values[field] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(values[field])) errors[field] = 'Heure invalide.';
  }
  if (!values.client) errors.client = 'Le client est obligatoire.';
  if (forSubmission && !values.description) {
    errors.description = 'La description des travaux est obligatoire pour soumettre.';
  }
  for (const [field, max] of Object.entries(MAX_LENGTH)) {
    if (values[field].length > max) errors[field] = `Maximum ${max} caractères.`;
  }
  if (values.signature) {
    if (!values.signature.startsWith('data:image/png;base64,') || values.signature.length > MAX_SIGNATURE_LENGTH) {
      errors.signature = 'Signature invalide.';
    }
  }
  if (forSubmission && values.signature && !values.signer_name) {
    errors.signer_name = 'Indiquez le nom du signataire.';
  }
  return errors;
}

function findReport(db, id) {
  return db
    .prepare(
      `SELECT r.*, u.name AS technician_name, u.email AS technician_email
       FROM reports r JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
    )
    .get(id);
}

function reportPhotos(db, reportId) {
  return db.prepare('SELECT * FROM photos WHERE report_id = ? ORDER BY id').all(reportId);
}

function canView(user, report) {
  return Boolean(report) && (user.role === 'admin' || report.user_id === user.id);
}

function canEdit(user, report) {
  return Boolean(report) && report.user_id === user.id && report.status === 'brouillon';
}

module.exports = {
  INTERVENTION_TYPES,
  readReportForm,
  validateReport,
  findReport,
  reportPhotos,
  canView,
  canEdit,
};
