-- ============================================================
-- Migration 002: ClickPesa payment gateway
--
-- Replaces the AzamPay placeholder with a real integration:
--   - collections  (Travela tops up a business wallet)
--   - payouts      (agents are paid to mobile money)
--
-- Every gateway call and every inbound webhook is recorded so a
-- payment can always be reconciled against the provider.
-- ============================================================

SET NAMES utf8mb4;

-- ---------- withdrawals: carry ClickPesa state ----------
-- The old azampay_reference column is renamed rather than dropped so no
-- historical withdrawal loses its provider reference.
ALTER TABLE withdrawals
  CHANGE COLUMN azampay_reference provider_reference VARCHAR(255) NULL,
  ADD COLUMN provider           VARCHAR(40)  NOT NULL DEFAULT 'clickpesa' AFTER status,
  ADD COLUMN order_reference    VARCHAR(40)  NULL AFTER provider,
  ADD COLUMN provider_status    VARCHAR(40)  NULL AFTER provider_reference,
  ADD COLUMN fee_tzs            BIGINT       NOT NULL DEFAULT 0 AFTER amount_tzs,
  ADD COLUMN beneficiary_name   VARCHAR(200) NULL AFTER mobile_money_number,
  ADD COLUMN channel_provider   VARCHAR(60)  NULL AFTER beneficiary_name,
  ADD COLUMN attempts           INT          NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at    DATETIME     NULL,
  ADD COLUMN next_attempt_at    DATETIME     NULL,
  ADD UNIQUE KEY uq_wd_order_ref (order_reference),
  ADD KEY idx_wd_status_next (status, next_attempt_at);

-- 'queued' is the new initial state: the request is accepted and the balance
-- is debited, but the gateway has not been called yet. ClickPesa allows only
-- one payout creation per minute, so a worker drains the queue in order.
ALTER TABLE withdrawals
  MODIFY COLUMN status ENUM('queued','processing','completed','failed','reversed')
    NOT NULL DEFAULT 'queued';

-- ---------- wallet top-up intents (collections) ----------
-- One row per attempt by a business to fund its wallet. The wallet is only
-- credited when ClickPesa confirms, never when the request is made.
CREATE TABLE IF NOT EXISTS wallet_topups (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  business_id         CHAR(36)     NOT NULL,
  order_reference     VARCHAR(40)  NOT NULL,
  method              ENUM('mobile_money','bank_transfer') NOT NULL DEFAULT 'mobile_money',
  provider            VARCHAR(40)  NOT NULL DEFAULT 'clickpesa',
  amount_tzs          BIGINT       NOT NULL,
  phone_number        VARCHAR(20)  NULL,
  channel             VARCHAR(60)  NULL,
  provider_reference  VARCHAR(255) NULL,
  provider_status     VARCHAR(40)  NULL,
  status              ENUM('pending','processing','completed','failed','expired') NOT NULL DEFAULT 'pending',
  failure_reason      VARCHAR(255) NULL,
  credited            TINYINT(1)   NOT NULL DEFAULT 0,
  credited_at         DATETIME     NULL,
  requested_by        CHAR(36)     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_topup_order_ref (order_reference),
  KEY idx_topup_business (business_id, created_at),
  KEY idx_topup_status (status),
  CONSTRAINT fk_topup_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- gateway event log ----------
-- Every inbound webhook, stored raw. The unique key on the provider event
-- makes replayed webhooks idempotent at the database level.
CREATE TABLE IF NOT EXISTS gateway_events (
  id                 BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider           VARCHAR(40)  NOT NULL DEFAULT 'clickpesa',
  event_type         VARCHAR(60)  NOT NULL,
  order_reference    VARCHAR(40)  NULL,
  provider_reference VARCHAR(255) NULL,
  dedupe_key         VARCHAR(160) NOT NULL,
  payload            JSON         NULL,
  signature_valid    TINYINT(1)   NOT NULL DEFAULT 0,
  processed          TINYINT(1)   NOT NULL DEFAULT 0,
  process_result     VARCHAR(255) NULL,
  ip_address         VARCHAR(64)  NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gateway_dedupe (provider, dedupe_key),
  KEY idx_gateway_order (order_reference),
  KEY idx_gateway_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- outbound gateway call log ----------
-- Mirrors api_request_log, but for calls Pazo makes out to the provider.
CREATE TABLE IF NOT EXISTS gateway_requests (
  id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider      VARCHAR(40)  NOT NULL DEFAULT 'clickpesa',
  operation     VARCHAR(60)  NOT NULL,
  endpoint      VARCHAR(160) NOT NULL,
  method        VARCHAR(10)  NOT NULL,
  status_code   INT          NULL,
  order_reference VARCHAR(40) NULL,
  request_body  JSON         NULL,
  response_body JSON         NULL,
  error_message VARCHAR(500) NULL,
  duration_ms   INT          NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_gwreq_created (created_at),
  KEY idx_gwreq_order (order_reference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- institution payouts: same provider fields ----------
ALTER TABLE institution_payouts
  ADD COLUMN provider           VARCHAR(40)  NOT NULL DEFAULT 'manual' AFTER status,
  ADD COLUMN order_reference    VARCHAR(40)  NULL AFTER provider,
  ADD COLUMN provider_reference VARCHAR(255) NULL AFTER order_reference,
  ADD COLUMN provider_status    VARCHAR(40)  NULL AFTER provider_reference,
  ADD COLUMN fee_tzs            BIGINT       NOT NULL DEFAULT 0 AFTER amount_tzs,
  ADD COLUMN failure_reason     VARCHAR(255) NULL,
  ADD UNIQUE KEY uq_payout_order_ref (order_reference);

-- ---------- new platform settings ----------
INSERT INTO platform_settings
  (setting_key, setting_value, value_type, category, label, description)
VALUES
  ('payouts_enabled', 'true', 'bool', 'payouts', 'Automatic payouts enabled',
   'When off, withdrawals stay queued and are not sent to the payment gateway.'),
  ('payout_min_interval_seconds', '65', 'int', 'payouts', 'Seconds between gateway payouts',
   'ClickPesa allows one payout creation per minute. Keep a small margin above 60.'),
  ('payout_max_attempts', '4', 'int', 'payouts', 'Payout retry attempts',
   'How many times a failed payout is retried before it needs manual attention.'),
  ('payout_daily_cap_tzs', '20000000', 'int', 'payouts', 'Daily payout cap (TZS)',
   'Total that may be disbursed in a rolling 24 hours before payouts pause.'),
  ('topup_min_tzs', '10000', 'int', 'payouts', 'Minimum wallet top-up (TZS)',
   'Smallest amount a business may top up in one request.')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
