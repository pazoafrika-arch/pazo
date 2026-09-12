-- ============================================================
-- Migration 003: profile images
--
-- Images are stored in the database rather than on disk because the app
-- runs on an ephemeral filesystem: anything written to disk disappears on
-- the next deploy. Keeping them here also means a database backup is a
-- complete backup, with no second system to restore from.
--
-- Uploads are re-encoded and capped server-side, so rows stay small.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS user_avatars (
  user_id     CHAR(36)     NOT NULL PRIMARY KEY,
  mime_type   VARCHAR(40)  NOT NULL,
  byte_size   INT          NOT NULL,
  width       INT          NULL,
  height      INT          NULL,
  -- MEDIUMBLOB holds up to 16MB; uploads are capped far below that.
  image_data  MEDIUMBLOB   NOT NULL,
  -- Lets the browser cache aggressively and still see changes immediately.
  etag        VARCHAR(64)  NOT NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_avatar_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A flag on users avoids joining the blob table just to know whether an
-- avatar exists, which every partner list and table needs.
ALTER TABLE users
  ADD COLUMN has_avatar TINYINT(1) NOT NULL DEFAULT 0 AFTER avatar_color;

-- Businesses carry a logo too, shown on the business dashboard and in the
-- admin business list.
CREATE TABLE IF NOT EXISTS business_logos (
  business_id CHAR(36)     NOT NULL PRIMARY KEY,
  mime_type   VARCHAR(40)  NOT NULL,
  byte_size   INT          NOT NULL,
  width       INT          NULL,
  height      INT          NULL,
  image_data  MEDIUMBLOB   NOT NULL,
  etag        VARCHAR(64)  NOT NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_logo_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE businesses
  ADD COLUMN has_logo TINYINT(1) NOT NULL DEFAULT 0 AFTER status;
