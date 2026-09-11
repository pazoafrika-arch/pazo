-- ============================================================
-- PAZO PARTNER PLATFORM - MySQL 8 schema
-- Migration 001: initial schema
-- All money columns are integer TZS (no decimals), per spec 6.1.
-- ============================================================

SET NAMES utf8mb4;

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  email              VARCHAR(255) NULL,
  phone              VARCHAR(20)  NULL,
  password_hash      VARCHAR(255) NOT NULL,
  role               ENUM('individual','institution','business_owner','admin','super_admin') NOT NULL,
  status             ENUM('active','suspended','deactivated','pending_approval') NOT NULL DEFAULT 'active',
  name               VARCHAR(200) NOT NULL,
  avatar_color       VARCHAR(12)  NOT NULL DEFAULT '#007b84',
  email_verified     TINYINT(1)   NOT NULL DEFAULT 0,
  phone_verified     TINYINT(1)   NOT NULL DEFAULT 0,
  last_login_at      DATETIME     NULL,
  failed_login_count INT          NOT NULL DEFAULT 0,
  locked_until       DATETIME     NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone),
  KEY idx_users_role_status (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- businesses ----------
CREATE TABLE IF NOT EXISTS businesses (
  id                         CHAR(36)     NOT NULL PRIMARY KEY,
  name                       VARCHAR(255) NOT NULL,
  website                    VARCHAR(255) NULL,
  slug                       VARCHAR(120) NOT NULL,
  category                   VARCHAR(100) NULL,
  signup_url_template        VARCHAR(500) NOT NULL DEFAULT 'https://thetravela.com/signup?ref={CODE}',
  api_key_hash               VARCHAR(64)  NULL,
  api_key_prefix             VARCHAR(16)  NULL,
  api_key_last_four          VARCHAR(8)   NULL,
  api_key_rotated_at         DATETIME     NULL,
  commission_rate            DECIMAL(6,4) NOT NULL DEFAULT 0.0800,
  platform_fee_rate          DECIMAL(6,4) NOT NULL DEFAULT 0.0100,
  wallet_balance_tzs         BIGINT       NOT NULL DEFAULT 0,
  wallet_alert_threshold_tzs BIGINT       NOT NULL DEFAULT 500000,
  notification_email         VARCHAR(255) NULL,
  status                     ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_businesses_slug (slug),
  KEY idx_businesses_apikey (api_key_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- business_members ----------
CREATE TABLE IF NOT EXISTS business_members (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  user_id     CHAR(36) NOT NULL,
  access      ENUM('full','read_only') NOT NULL DEFAULT 'full',
  is_owner    TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bm (business_id, user_id),
  CONSTRAINT fk_bm_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_bm_user     FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- individual_profiles ----------
CREATE TABLE IF NOT EXISTS individual_profiles (
  id                     CHAR(36)     NOT NULL PRIMARY KEY,
  user_id                CHAR(36)     NOT NULL,
  first_name             VARCHAR(100) NOT NULL,
  last_name              VARCHAR(100) NOT NULL,
  whatsapp_number        VARCHAR(20)  NULL,
  mobile_money_number    VARCHAR(20)  NULL,
  mobile_money_provider  VARCHAR(40)  NULL,
  mobile_money_verified  TINYINT(1)   NOT NULL DEFAULT 0,
  wallet_balance_tzs     BIGINT       NOT NULL DEFAULT 0,
  lifetime_earned_tzs    BIGINT       NOT NULL DEFAULT 0,
  lifetime_withdrawn_tzs BIGINT       NOT NULL DEFAULT 0,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ip_user (user_id),
  CONSTRAINT fk_ip_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- institution_profiles ----------
CREATE TABLE IF NOT EXISTS institution_profiles (
  id                      CHAR(36)     NOT NULL PRIMARY KEY,
  user_id                 CHAR(36)     NOT NULL,
  organisation_name       VARCHAR(255) NOT NULL,
  industry_type           VARCHAR(100) NULL,
  contact_person_name     VARCHAR(200) NULL,
  contact_phone           VARCHAR(20)  NULL,
  payout_method           ENUM('bank','mobile_money') NOT NULL DEFAULT 'bank',
  payout_account          VARCHAR(255) NULL,
  payout_bank_name        VARCHAR(150) NULL,
  payout_account_verified TINYINT(1)   NOT NULL DEFAULT 0,
  accumulated_balance_tzs BIGINT       NOT NULL DEFAULT 0,
  lifetime_earned_tzs     BIGINT       NOT NULL DEFAULT 0,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inst_user (user_id),
  CONSTRAINT fk_inst_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- partners ----------
CREATE TABLE IF NOT EXISTS partners (
  id                       CHAR(36)     NOT NULL PRIMARY KEY,
  user_id                  CHAR(36)     NOT NULL,
  business_id              CHAR(36)     NOT NULL,
  partner_type             ENUM('individual','institution') NOT NULL,
  referral_code            VARCHAR(20)  NOT NULL,
  commission_rate_override DECIMAL(6,4) NULL,
  total_referrals          INT          NOT NULL DEFAULT 0,
  total_clicks             INT          NOT NULL DEFAULT 0,
  total_earnings_tzs       BIGINT       NOT NULL DEFAULT 0,
  status                   ENUM('active','suspended','inactive') NOT NULL DEFAULT 'active',
  last_active_at           DATETIME     NULL,
  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_partner_code (referral_code),
  UNIQUE KEY uq_partner_user_business (user_id, business_id),
  KEY idx_partner_business (business_id, status),
  CONSTRAINT fk_partner_user     FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
  CONSTRAINT fk_partner_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- referral_clicks ----------
CREATE TABLE IF NOT EXISTS referral_clicks (
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  partner_id CHAR(36)     NOT NULL,
  source     VARCHAR(50)  NULL,
  user_agent VARCHAR(255) NULL,
  ip_hash    VARCHAR(64)  NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_clicks_partner (partner_id, created_at),
  CONSTRAINT fk_clicks_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- referrals ----------
CREATE TABLE IF NOT EXISTS referrals (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  partner_id          CHAR(36)     NOT NULL,
  business_id         CHAR(36)     NOT NULL,
  tourist_external_id VARCHAR(255) NOT NULL,
  signup_date         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_purchase_date DATETIME     NULL,
  total_purchases     INT          NOT NULL DEFAULT 0,
  total_value_tzs     BIGINT       NOT NULL DEFAULT 0,
  status              ENUM('referred','active','inactive') NOT NULL DEFAULT 'referred',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_referral_tourist_business (business_id, tourist_external_id),
  KEY idx_referral_partner (partner_id, created_at),
  CONSTRAINT fk_ref_partner  FOREIGN KEY (partner_id)  REFERENCES partners(id)   ON DELETE CASCADE,
  CONSTRAINT fk_ref_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- transactions ----------
CREATE TABLE IF NOT EXISTS transactions (
  id                      CHAR(36)     NOT NULL PRIMARY KEY,
  referral_id             CHAR(36)     NULL,
  partner_id              CHAR(36)     NULL,
  business_id             CHAR(36)     NOT NULL,
  external_tx_ref         VARCHAR(255) NOT NULL,
  bundle_type             VARCHAR(120) NULL,
  transaction_type        ENUM('first_purchase','topup') NOT NULL DEFAULT 'first_purchase',
  amount_tzs              BIGINT       NOT NULL,
  commission_tzs          BIGINT       NOT NULL DEFAULT 0,
  platform_fee_tzs        BIGINT       NOT NULL DEFAULT 0,
  commission_rate_applied DECIMAL(6,4) NOT NULL DEFAULT 0,
  commission_status       ENUM('paid','pending','failed','resolved') NOT NULL DEFAULT 'pending',
  failure_reason          VARCHAR(255) NULL,
  paid_at                 DATETIME     NULL,
  webhook_received_at     DATETIME     NULL,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tx_business_ref (business_id, external_tx_ref),
  KEY idx_tx_partner (partner_id, created_at),
  KEY idx_tx_business_created (business_id, created_at),
  KEY idx_tx_status (commission_status),
  CONSTRAINT fk_tx_referral FOREIGN KEY (referral_id) REFERENCES referrals(id)  ON DELETE SET NULL,
  CONSTRAINT fk_tx_partner  FOREIGN KEY (partner_id)  REFERENCES partners(id)   ON DELETE SET NULL,
  CONSTRAINT fk_tx_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- withdrawals ----------
CREATE TABLE IF NOT EXISTS withdrawals (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  partner_id          CHAR(36)     NOT NULL,
  amount_tzs          BIGINT       NOT NULL,
  mobile_money_number VARCHAR(20)  NOT NULL,
  status              ENUM('processing','completed','failed') NOT NULL DEFAULT 'processing',
  azampay_reference   VARCHAR(255) NULL,
  failure_reason      VARCHAR(255) NULL,
  requested_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at        DATETIME     NULL,
  KEY idx_wd_partner (partner_id, requested_at),
  CONSTRAINT fk_wd_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- institution_payouts ----------
CREATE TABLE IF NOT EXISTS institution_payouts (
  id                      CHAR(36)     NOT NULL PRIMARY KEY,
  partner_id              CHAR(36)     NOT NULL,
  payout_month            DATE         NOT NULL,
  amount_tzs              BIGINT       NOT NULL,
  transaction_count       INT          NOT NULL DEFAULT 0,
  referral_count          INT          NOT NULL DEFAULT 0,
  sales_total_tzs         BIGINT       NOT NULL DEFAULT 0,
  payout_account_snapshot VARCHAR(255) NULL,
  status                  ENUM('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
  reference               VARCHAR(120) NULL,
  processed_by            CHAR(36)     NULL,
  processed_at            DATETIME     NULL,
  completed_at            DATETIME     NULL,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payout_partner_month (partner_id, payout_month),
  CONSTRAINT fk_payout_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- wallet_ledger ----------
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  business_id       CHAR(36)     NOT NULL,
  entry_type        ENUM('topup','commission','platform_fee','adjustment','reversal') NOT NULL,
  amount_tzs        BIGINT       NOT NULL,
  balance_after_tzs BIGINT       NOT NULL,
  description       VARCHAR(255) NULL,
  transaction_id    CHAR(36)     NULL,
  created_by        CHAR(36)     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ledger_business (business_id, created_at),
  CONSTRAINT fk_ledger_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  type       VARCHAR(50)  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT         NOT NULL,
  data       JSON         NULL,
  is_read    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notif_user (user_id, is_read, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- institution_applications ----------
CREATE TABLE IF NOT EXISTS institution_applications (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  business_id         CHAR(36)     NOT NULL,
  organisation_name   VARCHAR(255) NOT NULL,
  industry_type       VARCHAR(100) NULL,
  contact_person_name VARCHAR(200) NOT NULL,
  contact_email       VARCHAR(255) NOT NULL,
  contact_phone       VARCHAR(20)  NULL,
  payout_method       ENUM('bank','mobile_money') NOT NULL DEFAULT 'bank',
  payout_account      VARCHAR(255) NULL,
  payout_bank_name    VARCHAR(150) NULL,
  notes               TEXT         NULL,
  status              ENUM('pending','approved','declined') NOT NULL DEFAULT 'pending',
  decline_reason      VARCHAR(500) NULL,
  reviewed_by         CHAR(36)     NULL,
  reviewed_at         DATETIME     NULL,
  created_partner_id  CHAR(36)     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_app_status (status, created_at),
  CONSTRAINT fk_app_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- otp_codes ----------
CREATE TABLE IF NOT EXISTS otp_codes (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  identifier VARCHAR(255) NOT NULL,
  channel    ENUM('sms','email') NOT NULL,
  purpose    ENUM('signup','login','reset','change_phone','change_payout') NOT NULL,
  code_hash  VARCHAR(64)  NOT NULL,
  attempts   INT          NOT NULL DEFAULT 0,
  consumed   TINYINT(1)   NOT NULL DEFAULT 0,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_otp_identifier (identifier, purpose, consumed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- refresh_tokens ----------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  token_hash VARCHAR(64)  NOT NULL,
  user_agent VARCHAR(255) NULL,
  ip_address VARCHAR(64)  NULL,
  revoked    TINYINT(1)   NOT NULL DEFAULT 0,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rt_hash (token_hash),
  KEY idx_rt_user (user_id, revoked),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- audit_log ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id CHAR(36)     NULL,
  actor_name    VARCHAR(200) NULL,
  actor_role    VARCHAR(40)  NULL,
  action        VARCHAR(100) NOT NULL,
  resource_type VARCHAR(60)  NULL,
  resource_id   VARCHAR(64)  NULL,
  detail        JSON         NULL,
  ip_address    VARCHAR(64)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_created (created_at),
  KEY idx_audit_actor (actor_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- api_request_log ----------
CREATE TABLE IF NOT EXISTS api_request_log (
  id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_id   CHAR(36)     NULL,
  endpoint      VARCHAR(120) NOT NULL,
  method        VARCHAR(10)  NOT NULL,
  status_code   INT          NOT NULL,
  request_body  JSON         NULL,
  response_body JSON         NULL,
  duration_ms   INT          NULL,
  ip_address    VARCHAR(64)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_apilog_business (business_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- platform_settings ----------
CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key   VARCHAR(80)  NOT NULL PRIMARY KEY,
  setting_value VARCHAR(500) NOT NULL,
  value_type    ENUM('string','int','decimal','bool','json') NOT NULL DEFAULT 'string',
  category      VARCHAR(60)  NOT NULL DEFAULT 'general',
  label         VARCHAR(160) NOT NULL,
  description   VARCHAR(400) NULL,
  updated_by    CHAR(36)     NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- announcements ----------
CREATE TABLE IF NOT EXISTS announcements (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  title      VARCHAR(200) NOT NULL,
  body       TEXT         NOT NULL,
  audience   ENUM('all','individuals','institutions','business','admins') NOT NULL DEFAULT 'all',
  variant    ENUM('info','success','warning') NOT NULL DEFAULT 'info',
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  starts_at  DATETIME     NULL,
  ends_at    DATETIME     NULL,
  created_by CHAR(36)     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- message_templates ----------
CREATE TABLE IF NOT EXISTS message_templates (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  channel    ENUM('sms','email','in_app') NOT NULL,
  subject    VARCHAR(200) NULL,
  body       TEXT         NOT NULL,
  created_by CHAR(36)     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- communications ----------
CREATE TABLE IF NOT EXISTS communications (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  channel         ENUM('sms','email','in_app') NOT NULL,
  audience        VARCHAR(60)  NOT NULL,
  audience_ref    VARCHAR(255) NULL,
  subject         VARCHAR(200) NULL,
  body            TEXT         NOT NULL,
  recipient_count INT          NOT NULL DEFAULT 0,
  delivered_count INT          NOT NULL DEFAULT 0,
  failed_count    INT          NOT NULL DEFAULT 0,
  sent_by         CHAR(36)     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comms_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- cms_content ----------
CREATE TABLE IF NOT EXISTS cms_content (
  content_key   VARCHAR(80)  NOT NULL PRIMARY KEY,
  content_value TEXT         NOT NULL,
  value_type    ENUM('text','html','json') NOT NULL DEFAULT 'text',
  group_name    VARCHAR(60)  NOT NULL DEFAULT 'landing',
  label         VARCHAR(160) NOT NULL,
  sort_order    INT          NOT NULL DEFAULT 0,
  updated_by    CHAR(36)     NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
