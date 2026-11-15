-- Sonar (Battleship-style): games vs Zero-Bot, the Daily Hunt, fleets and
-- seas, and secret fleets for online rooms.

CREATE TABLE IF NOT EXISTS sonar_games (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level        VARCHAR(8)  NOT NULL CHECK (level IN ('easy', 'medium', 'hard', 'master')),
    -- Fleet codes ("a1h a3h …"). Zero-Bot's fleet is never sent before the game ends.
    player_fleet TEXT        NOT NULL,
    ai_fleet     TEXT        NOT NULL,
    -- Both sides' moves in order, player first ("f37 p44 …").
    moves        TEXT        NOT NULL DEFAULT '',
    status       VARCHAR(8)  NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'won', 'lost', 'resigned')),
    -- Filled in when the game ends.
    ships_lost   SMALLINT,
    shots        SMALLINT,
    fleet_skin   VARCHAR(24) NOT NULL DEFAULT 'navy',
    sea          VARCHAR(24) NOT NULL DEFAULT 'ocean',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sonar_games_user ON sonar_games (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sonar_games_one_active ON sonar_games (user_id) WHERE status = 'active';

-- The Daily Hunt: the same hidden fleet for everyone each WIB day.
CREATE TABLE IF NOT EXISTS sonar_daily_runs (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day         DATE        NOT NULL,
    moves       TEXT        NOT NULL DEFAULT '',
    status      VARCHAR(8)  NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'done')),
    shots       SMALLINT,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS sonar_items (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key   VARCHAR(40) NOT NULL,
    source     VARCHAR(8)  NOT NULL CHECK (source IN ('shop', 'drop')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_key)
);

-- Online Sonar: each seat's secret fleet for the current game.
ALTER TABLE online_rooms ADD COLUMN IF NOT EXISTS host_fleet TEXT;
ALTER TABLE online_rooms ADD COLUMN IF NOT EXISTS guest_fleet TEXT;
ALTER TABLE online_rooms DROP CONSTRAINT IF EXISTS online_rooms_game_check;
ALTER TABLE online_rooms ADD CONSTRAINT online_rooms_game_check
    CHECK (game IN ('connect-four', 'tic-tac-toe', 'chess', 'sonar'));
