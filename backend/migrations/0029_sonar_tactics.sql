-- Sonar Tactics vs Zero-Bot: ship powers, mines, crates and Overdrive.
-- A game replays from these columns plus its moves, so they never change
-- after the game starts.

ALTER TABLE sonar_games ADD COLUMN IF NOT EXISTS mode VARCHAR(8) NOT NULL DEFAULT 'classic';
ALTER TABLE sonar_games DROP CONSTRAINT IF EXISTS sonar_games_mode_check;
ALTER TABLE sonar_games ADD CONSTRAINT sonar_games_mode_check CHECK (mode IN ('classic', 'tactics'));
-- Tactics: hides the crates and picks which square a mine shows (a u32).
ALTER TABLE sonar_games ADD COLUMN IF NOT EXISTS seed BIGINT NOT NULL DEFAULT 0;
-- Tactics: power Mk levels, player then Zero-Bot ("1,1,1,1,1 1,1,1,1,1").
ALTER TABLE sonar_games ADD COLUMN IF NOT EXISTS levels TEXT;
-- Tactics: supply crates hidden in each sea.
ALTER TABLE sonar_games ADD COLUMN IF NOT EXISTS crates SMALLINT NOT NULL DEFAULT 0;
-- Tactics: ship powers used and crates opened by the player (for quests and stats).
ALTER TABLE sonar_games ADD COLUMN IF NOT EXISTS powers_used SMALLINT;
ALTER TABLE sonar_games ADD COLUMN IF NOT EXISTS crates_opened SMALLINT;
