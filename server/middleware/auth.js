import jwt from 'jsonwebtoken';
import { config } from '../env.js';
import { query } from '../db.js';

export function signDoctorToken(doctor) {
  return jwt.sign(
    { id: doctor.id, email: doctor.email, name: doctor.name, role: doctor.role },
    config.jwtSecret,
    { expiresIn: `${config.tokenTtlHours}h` }
  );
}

export function requireDoctor(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'נדרשת התחברות' });
  try {
    req.doctor = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'ההתחברות פגה, יש להתחבר מחדש' });
  }
}

// The phonebook and the questionnaire assignments are management surfaces:
// they cover every doctor in the alphon, not just one clinic's. Only a manager
// gets there — and even a manager sees the alphon's public card plus coverage
// counts, never a patient's answers.
export function requireManager(req, res, next) {
  if (req.doctor?.role !== 'manager') {
    return res.status(403).json({ error: 'הפעולה מיועדת למנהל המערכת' });
  }
  next();
}

// Doctors this account *is responsible for* — himself plus the doctors under
// his organisation:
//   doctor        -> himself
//   clinic_owner  -> himself + 'clinic' links
//   trial_manager -> himself + 'trial' links
// Deliberately excludes data_shares: a GDPR share grants sight of research
// data, never the right to act or speak in the other doctor's name.
export async function ownDoctorIds(doctor) {
  const ids = new Set([doctor.id]);
  if (doctor.role === 'clinic_owner' || doctor.role === 'trial_manager') {
    const linkType = doctor.role === 'clinic_owner' ? 'clinic' : 'trial';
    const rows = await query(
      'SELECT doctor_id FROM doctor_links WHERE owner_id = ? AND link_type = ?',
      [doctor.id, linkType]
    );
    for (const r of rows) ids.add(r.doctor_id);
  }
  return [...ids];
}

// The set of doctor ids whose data this account may READ: everyone in
// ownDoctorIds plus any doctor who shared data with him under GDPR consent.
export async function scopedDoctorIds(doctor, scope = 'reports') {
  const ids = new Set(await ownDoctorIds(doctor));
  const shared = await query(
    `SELECT owner_doctor_id FROM data_shares
      WHERE target_doctor_id = ? AND gdpr_consent = 1 AND scope IN (?, 'all')`,
    [doctor.id, scope]
  );
  for (const r of shared) ids.add(r.owner_doctor_id);
  return [...ids];
}
