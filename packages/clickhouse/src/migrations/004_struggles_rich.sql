-- Rich struggle detection (implementation): the element each struggle happened on and
-- a 0–100 friction score for ranking. Idempotent ADDs so re-running is safe.
ALTER TABLE struggles ADD COLUMN IF NOT EXISTS element String DEFAULT '';
ALTER TABLE struggles ADD COLUMN IF NOT EXISTS score UInt16 DEFAULT 0;
