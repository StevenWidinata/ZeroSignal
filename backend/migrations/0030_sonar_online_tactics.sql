-- Online Sonar Tactics: a room plays Classic or Tactics for its whole life;
-- each game of the series gets a fresh seed (it hides the supply crates).

ALTER TABLE online_rooms ADD COLUMN IF NOT EXISTS sonar_mode VARCHAR(8) NOT NULL DEFAULT 'classic';
ALTER TABLE online_rooms DROP CONSTRAINT IF EXISTS online_rooms_sonar_mode_check;
ALTER TABLE online_rooms ADD CONSTRAINT online_rooms_sonar_mode_check CHECK (sonar_mode IN ('classic', 'tactics'));
ALTER TABLE online_rooms ADD COLUMN IF NOT EXISTS sonar_seed BIGINT NOT NULL DEFAULT 0;
