-- One ranked Whack-a-Mole Daily per player per WIB day (like 2048, Minefield
-- and Snake Signal). Older rows keep day = NULL, so they never clash.
ALTER TABLE wam_runs ADD COLUMN IF NOT EXISTS day DATE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wam_daily ON wam_runs (user_id, day) WHERE mode = 'daily' AND day IS NOT NULL;
