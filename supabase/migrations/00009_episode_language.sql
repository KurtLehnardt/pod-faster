-- Add language column to episodes table
ALTER TABLE episodes ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
