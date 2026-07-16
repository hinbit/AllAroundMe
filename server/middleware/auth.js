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

// The set of doctor ids whose data this account may read:
//   doctor        -> himself
//   clinic_owner  -> himself + 'clinic' links
//   trial_manager -> himself + 'trial' links
// plus any doctor who shared data with him via data_shares (GDPR consent).
export async function scopedDoctorIds(doctor, scope = 'reports') {
  const ids = new Set([doctor.id]);
  if (doctor.role === 'clinic_owner' || doctor.role === 'trial_manager') {
    const linkType = doctor.role === 'clinic_owner' ? 'clinic' : 'trial';
    const rows = await query(
      'SELECT doctor_id FROM doctor_links WHERE owner_id = ? AND link_type = ?',
      [doctor.id, linkType]
    );
    for (const r of rows) ids.add(r.doctor_id);
  }
  const shared = await query(
    `SELECT owner_doctor_id FROM data_shares
      WHERE target_doctor_id = ? AND gdpr_consent = 1 AND scope IN (?, 'all')`,
    [doctor.id, scope]
  );
  for (const r of shared) ids.add(r.owner_doctor_id);
  return [...ids];
}
