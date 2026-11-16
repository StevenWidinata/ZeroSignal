-- Checkers (English draughts): games vs Zero-Bot, owned boards / piece
-- sets, and the Daily puzzle.
CREATE TABLE IF NOT EXISTS checkers_games (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level       VARCHAR(8)  NOT NULL CHECK (level IN ('easy', 'medium', 'hard', 'master')),
    -- Your side: dark moves first.
    side        VARCHAR(5)  NOT NULL CHECK (side IN ('dark', 'light')),
    -- Moves in notation ("11-15 23-19 8x15 …"), space separated.
    moves       TEXT        NOT NULL DEFAULT '',
    status      VARCHAR(8)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'won', 'lost', 'drawn', 'resigned')),
    -- How it ended: no_moves, repetition, quiet, resign.
    ending      VARCHAR(16),
    undos_used  SMALLINT    NOT NULL DEFAULT 0,
    board_style VARCHAR(24) NOT NULL DEFAULT 'classic',
    piece_set   VARCHAR(24) NOT NULL DEFAULT 'classic',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_checkers_games_user ON checkers_games (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkers_one_active ON checkers_games (user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS checkers_items (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key   VARCHAR(40) NOT NULL,
    source     VARCHAR(8)  NOT NULL CHECK (source IN ('shop', 'drop')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_key)
);

-- The Daily puzzle: the same "win in N" position for everyone each WIB day.
CREATE TABLE IF NOT EXISTS checkers_puzzle_runs (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day         DATE        NOT NULL,
    puzzle_id   INTEGER     NOT NULL,
    moves       TEXT        NOT NULL DEFAULT '',
    status      VARCHAR(8)  NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'solved', 'failed')),
    mistakes    SMALLINT    NOT NULL DEFAULT 0,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, day)
);
