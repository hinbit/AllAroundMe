-- AllAroundMe schema. Idempotent (CREATE TABLE IF NOT EXISTS).
-- Charset utf8mb4 everywhere — Hebrew + emoji.

-- ---------------------------------------------------------------- user side

-- One row per anonymous app user, keyed by the aam_uid cookie.
-- A profile that is not seen for PROFILE_TTL_DAYS is considered expired:
-- the client cookie carries the same TTL, so the person "starts over".
CREATE TABLE IF NOT EXISTS profiles (
  uid CHAR(24) PRIMARY KEY,
  first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  visits INT UNSIGNED NOT NULL DEFAULT 0,
  searches INT UNSIGNED NOT NULL DEFAULT 0,
  points INT UNSIGNED NOT NULL DEFAULT 0,
  reviews_given INT UNSIGNED NOT NULL DEFAULT 0,
  skip_splash TINYINT(1) NOT NULL DEFAULT 0,
  allow_reviews TINYINT(1) NOT NULL DEFAULT 0,
  phone VARCHAR(32) NULL,                -- verified WhatsApp number (claimed profile)
  phone_verified_at DATETIME NULL,
  ui_lang VARCHAR(8) NULL,               -- he / en / ar / ru
  UNIQUE KEY uq_profile_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time codes for claiming a profile with a phone number (sent via WhatsApp).
CREATE TABLE IF NOT EXISTS otp_codes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(32) NOT NULL,
  uid CHAR(24) NULL,
  code CHAR(6) NOT NULL,
  purpose VARCHAR(30) NOT NULL DEFAULT 'claim',
  used TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_otp_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Excellence badges earned per profile.
CREATE TABLE IF NOT EXISTS badges (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uid CHAR(24) NOT NULL,
  code VARCHAR(60) NOT NULL,
  label VARCHAR(190) NOT NULL,
  icon VARCHAR(16) NULL,
  earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_badge (uid, code),
  KEY idx_badges_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every session start (page open) with everything the handshake can tell us.
CREATE TABLE IF NOT EXISTS app_sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uid CHAR(24) NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  browser VARCHAR(120) NULL,
  os VARCHAR(120) NULL,
  device VARCHAR(120) NULL,
  screen_w INT NULL, screen_h INT NULL,
  viewport_w INT NULL, viewport_h INT NULL,
  pixel_ratio DECIMAL(5,2) NULL,
  lang VARCHAR(20) NULL,
  timezone VARCHAR(64) NULL,
  display_mode VARCHAR(30) NULL,        -- 'standalone' = installed PWA, 'browser' = plain web
  referrer VARCHAR(512) NULL,
  splash_variant VARCHAR(20) NULL,      -- full / short / none
  KEY idx_sessions_uid (uid),
  KEY idx_sessions_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fine-grained UX events (clicks, searches, choices) for behavior learning.
CREATE TABLE IF NOT EXISTS app_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id INT UNSIGNED NULL,
  uid CHAR(24) NOT NULL,
  type VARCHAR(60) NOT NULL,
  page VARCHAR(190) NULL,
  element VARCHAR(190) NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_events_uid (uid),
  KEY idx_events_type (type),
  KEY idx_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Full voice/text triage trail: what was said, what the AI answered,
-- and what the person actually did afterwards.
CREATE TABLE IF NOT EXISTS transcripts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uid CHAR(24) NULL,
  session_id INT UNSIGNED NULL,
  source ENUM('voice','text') NOT NULL DEFAULT 'voice',
  transcript TEXT NULL,
  ai_recommendation TEXT NULL,
  ai_tags JSON NULL,
  urgent TINYINT(1) NOT NULL DEFAULT 0,
  ai_ok TINYINT(1) NOT NULL DEFAULT 0,
  error VARCHAR(300) NULL,
  action_taken VARCHAR(300) NULL,
  action_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tr_uid (uid),
  KEY idx_tr_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Doctors the user picked (contacted / navigated to) — feeds the rating prompt.
CREATE TABLE IF NOT EXISTS chosen_doctors (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uid CHAR(24) NOT NULL,
  entity_id INT UNSIGNED NULL,
  entity_name VARCHAR(190) NOT NULL,
  entity_spec VARCHAR(190) NULL,
  chosen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rated TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_chosen (uid, entity_name),
  KEY idx_chosen_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reviews attached to an alphon entity. Either a single overall star rating
-- or up to five user-defined domains, each 1-5 stars, plus free text /
-- a transcribed voice note.
CREATE TABLE IF NOT EXISTS reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uid CHAR(24) NOT NULL,
  entity_id INT UNSIGNED NULL,
  entity_name VARCHAR(190) NOT NULL,
  overall_stars TINYINT NULL,
  domains JSON NULL,
  text TEXT NULL,
  voice_transcript TEXT NULL,
  status ENUM('visible','hidden','flagged') NOT NULL DEFAULT 'visible',
  verified_visit TINYINT(1) NOT NULL DEFAULT 0,  -- reviewer actually contacted this doctor via the app
  reply_text TEXT NULL,                          -- the doctor's right-of-reply
  reply_doctor_name VARCHAR(190) NULL,
  reply_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_reviews_entity (entity_name),
  KEY idx_reviews_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Abuse flags on reviews; 3 distinct flags auto-hide the review pending moderation.
CREATE TABLE IF NOT EXISTS review_flags (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  review_id INT UNSIGNED NOT NULL,
  uid CHAR(24) NOT NULL,
  reason VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_flag (review_id, uid),
  CONSTRAINT fk_flag_review FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Review-on-review (ביקורת על ביקורת).
CREATE TABLE IF NOT EXISTS review_reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  review_id INT UNSIGNED NOT NULL,
  uid CHAR(24) NOT NULL,
  stars TINYINT NOT NULL,
  text TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rr (review_id, uid),
  CONSTRAINT fk_rr_review FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------- doctor side

-- Doctor accounts. Roles:
--   doctor        — sees only his own data
--   clinic_owner  — additionally sees data of doctors linked under him (link_type 'clinic')
--   trial_manager — additionally sees data of doctors registered to his trial (link_type 'trial')
--   manager       — platform manager: the phonebook (ספר טלפונים) and the
--                   questionnaire assignments across all alphon doctors. A
--                   manager administers *coverage*, not patients: the phonebook
--                   shows only the alphon's shareable public card, and patient
--                   answers are never in his scope (see questionnaire_runs).
CREATE TABLE IF NOT EXISTS doctors (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(190) NOT NULL,
  name VARCHAR(190) NOT NULL,
  role ENUM('doctor','clinic_owner','trial_manager','manager') NOT NULL DEFAULT 'doctor',
  specialty VARCHAR(190) NULL,
  alphon_entity_id INT UNSIGNED NULL,
  phone VARCHAR(32) NULL,               -- WhatsApp for the daily digest
  digest_enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_digest_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS doctor_links (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id INT UNSIGNED NOT NULL,
  doctor_id INT UNSIGNED NOT NULL,
  link_type ENUM('clinic','trial') NOT NULL DEFAULT 'clinic',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_link (owner_id, doctor_id, link_type),
  CONSTRAINT fk_dl_owner FOREIGN KEY (owner_id) REFERENCES doctors(id) ON DELETE CASCADE,
  CONSTRAINT fk_dl_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Questionnaires. kind 'regular' = per-patient questionnaire; kind 'super'
-- (שאלון-על) = a pool whose questions are blended into linked regular
-- questionnaires (each linked super contributes 20% of the issued questions,
-- at most two supers = 40%; the doctor's own questions fill the rest).
CREATE TABLE IF NOT EXISTS questionnaires (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT UNSIGNED NOT NULL,
  title VARCHAR(190) NOT NULL,
  kind ENUM('regular','super') NOT NULL DEFAULT 'regular',
  theme JSON NULL,
  target JSON NULL,
  schedule JSON NULL,
  questions JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_q_doctor (doctor_id),
  CONSTRAINT fk_q_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which super questionnaires are blended into which regular questionnaire.
CREATE TABLE IF NOT EXISTS questionnaire_links (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  questionnaire_id INT UNSIGNED NOT NULL,
  super_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ql (questionnaire_id, super_id),
  CONSTRAINT fk_ql_q FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id) ON DELETE CASCADE,
  CONSTRAINT fk_ql_super FOREIGN KEY (super_id) REFERENCES questionnaires(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Joint runs / joint publication of results between consenting doctors.
CREATE TABLE IF NOT EXISTS questionnaire_collaborators (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  questionnaire_id INT UNSIGNED NOT NULL,
  doctor_id INT UNSIGNED NOT NULL,
  role ENUM('co_runner','viewer','publisher') NOT NULL DEFAULT 'viewer',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_qc (questionnaire_id, doctor_id),
  CONSTRAINT fk_qc_q FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id) ON DELETE CASCADE,
  CONSTRAINT fk_qc_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A questionnaire template assigned to one doctor in the Eshkolot phonebook.
-- The doctor is an alphon *entity*, not an account here: assigning a
-- questionnaire must not require the doctor to register. `questionnaire_id`
-- is the category template (after-visit questionnaire for רפואת ילדים / אף אוזן
-- גרון / אונקולוגיה / כאב); one template serves many doctors.
--
-- deliver_phone / deliver_email are the doctor's OWN channel, copied from the
-- alphon's shareable card. Completed answers are delivered there and the
-- identifying copy is then dropped from this database — the regulatory line is
-- that personal patient content lives in the doctor's own WhatsApp/email with
-- the patient, and this platform is only the conduit.
--
-- desk_secret keys the rotating desk QR (see services/qr.js). It never leaves
-- the server: the QR carries only a short-lived signature derived from it, so
-- a leaked QR photo stops working once its window passes.
CREATE TABLE IF NOT EXISTS questionnaire_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  questionnaire_id INT UNSIGNED NOT NULL,
  alphon_entity_id INT UNSIGNED NOT NULL,
  entity_name VARCHAR(190) NOT NULL,
  entity_spec VARCHAR(190) NULL,
  entity_city VARCHAR(120) NULL,
  category VARCHAR(60) NOT NULL,
  deliver_phone VARCHAR(32) NULL,
  deliver_email VARCHAR(190) NULL,
  desk_secret CHAR(64) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assign (questionnaire_id, alphon_entity_id),
  KEY idx_assign_entity (alphon_entity_id),
  KEY idx_assign_category (category),
  CONSTRAINT fk_assign_q FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An issued questionnaire towards one patient: the blended question list is
-- frozen into `payload` as JSON instructions for the WhatsApp bot / email.
--
-- source records how the patient got here:
--   manual     — the doctor issued it from the console
--   qr         — the patient scanned the desk QR (assignment_id + visit_slot set)
--   identified — a phone-verified profile answering for a doctor it chose
--
-- visit_slot is the moment of the scan, which is what makes a QR run
-- self-identifying to the doctor without any patient details: "החולה מיום
-- שלישי בשעה 17:40".
CREATE TABLE IF NOT EXISTS questionnaire_runs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  questionnaire_id INT UNSIGNED NOT NULL,
  assignment_id INT UNSIGNED NULL,
  uid CHAR(24) NULL,                     -- app profile that answered (QR / identified)
  source ENUM('manual','qr','identified') NOT NULL DEFAULT 'manual',
  visit_slot DATETIME NULL,
  patient_name VARCHAR(190) NULL,
  patient_phone VARCHAR(60) NULL,
  patient_email VARCHAR(190) NULL,
  channel ENUM('whatsapp','email','web') NOT NULL DEFAULT 'whatsapp',
  payload JSON NOT NULL,
  status ENUM('issued','sent','answered','closed') NOT NULL DEFAULT 'issued',
  scheduled_for DATETIME NULL,
  sent_at DATETIME NULL,
  delivered_to_doctor_at DATETIME NULL,  -- answers handed to the doctor's own channel
  purged_at DATETIME NULL,               -- identifying fields dropped after delivery
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_runs_q (questionnaire_id),
  KEY idx_runs_assignment (assignment_id),
  KEY idx_runs_uid (uid),
  CONSTRAINT fk_run_q FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id) ON DELETE CASCADE,
  CONSTRAINT fk_run_assign FOREIGN KEY (assignment_id) REFERENCES questionnaire_assignments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questionnaire_answers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id INT UNSIGNED NOT NULL,
  question_idx INT NOT NULL,
  question VARCHAR(500) NULL,
  answer TEXT NULL,
  answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ans_run (run_id),
  CONSTRAINT fk_ans_run FOREIGN KEY (run_id) REFERENCES questionnaire_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------- delivery engine ----

-- Outgoing WhatsApp/email messages (questionnaire sends, OTP codes, digests).
-- The scheduler dispatches due 'pending' rows through the configured transport
-- (WHATSAPP_MODE: log / cloud / webhook — see server/services/whatsapp.js).
CREATE TABLE IF NOT EXISTS wa_outbox (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('questionnaire','otp','digest','system') NOT NULL DEFAULT 'system',
  channel ENUM('whatsapp','email') NOT NULL DEFAULT 'whatsapp',
  to_phone VARCHAR(32) NULL,
  to_email VARCHAR(190) NULL,
  body TEXT NULL,                       -- NULL for questionnaire rows: built from the run payload at send time
  run_id INT UNSIGNED NULL,
  due_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  mode VARCHAR(12) NULL,                -- transport that actually sent it
  last_error VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  KEY idx_outbox_due (status, due_at),
  KEY idx_outbox_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-question-at-a-time WhatsApp chat state per patient phone.
CREATE TABLE IF NOT EXISTS wa_conversations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(32) NOT NULL,
  run_id INT UNSIGNED NOT NULL,
  question_pos INT NOT NULL DEFAULT 0,  -- position of the NEXT question in payload.questions
  status ENUM('active','done','expired') NOT NULL DEFAULT 'active',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_conv_phone (phone, status),
  CONSTRAINT fk_conv_run FOREIGN KEY (run_id) REFERENCES questionnaire_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- GDPR-consented data sharing between doctors.
CREATE TABLE IF NOT EXISTS data_shares (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_doctor_id INT UNSIGNED NOT NULL,
  target_doctor_id INT UNSIGNED NOT NULL,
  scope ENUM('reports','questionnaires','all') NOT NULL DEFAULT 'reports',
  gdpr_consent TINYINT(1) NOT NULL DEFAULT 0,
  consent_text VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_share (owner_doctor_id, target_doctor_id, scope),
  CONSTRAINT fk_share_owner FOREIGN KEY (owner_doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  CONSTRAINT fk_share_target FOREIGN KEY (target_doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
