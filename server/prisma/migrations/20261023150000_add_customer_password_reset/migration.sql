ALTER TABLE `users` ADD COLUMN `auth_version` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `password_reset_requests` (
    `id` VARCHAR(64) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `otp_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verified_at` DATETIME(3) NULL,
    `reset_token_hash` CHAR(64) NULL,
    `consumed_at` DATETIME(3) NULL,
    UNIQUE INDEX `password_reset_requests_user_id_key` (`user_id`),
    UNIQUE INDEX `password_reset_requests_reset_token_hash_key` (`reset_token_hash`),
    PRIMARY KEY (`id`),
    CONSTRAINT `password_reset_requests_user_id_fkey`
      FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
