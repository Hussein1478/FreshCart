-- FreshCart product photography support. Safe to run on an existing database.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);
