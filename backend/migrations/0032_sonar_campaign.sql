-- Sonar Campaign: Tactics missions vs Zero-Bot (shared/sonar_campaign.json).
-- A campaign game is a sonar_games row with mode 'campaign' and its mission.

ALTER TABLE sonar_games DROP CONSTRAINT IF EXISTS sonar_games_mode_check;
ALTER TABLE sonar_games ADD CONSTRAINT sonar_games_mode_check CHECK (mode IN ('classic', 'tactics', 'campaign'));
ALTER TABLE sonar_games ADD COLUMN IF NOT EXISTS op SMALLINT;

-- Best stars per mission (they pay coins once each) and the fewest moves.
CREATE TABLE IF NOT EXISTS sonar_campaign (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    op         SMALLINT    NOT NULL,
    stars      SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 3),
    best_moves SMALLINT    NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, op)
);
