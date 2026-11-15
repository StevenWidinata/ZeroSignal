-- Chess vs Zero-Bot, owned board styles / piece sets, and the daily puzzle.
CREATE TABLE IF NOT EXISTS chess_games (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level       VARCHAR(8)  NOT NULL CHECK (level IN ('easy', 'medium', 'hard', 'master')),
    color       VARCHAR(5)  NOT NULL CHECK (color IN ('white', 'black')),
    -- UCI moves, space separated.
    moves       TEXT        NOT NULL DEFAULT '',
    status      VARCHAR(8)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'won', 'lost', 'drawn', 'resigned')),
    -- How it ended: checkmate, stalemate, repetition, fifty_moves, insufficient_material, resign.
    ending      VARCHAR(24),
    undos_used  SMALLINT    NOT NULL DEFAULT 0,
    board_style VARCHAR(24) NOT NULL DEFAULT 'classic',
    piece_set   VARCHAR(24) NOT NULL DEFAULT 'classic',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chess_games_user ON chess_games (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chess_one_active ON chess_games (user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS chess_items (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- "board:<id>" or "pieces:<id>" (catalog: shared/chess_items.json).
    item_key   VARCHAR(64) NOT NULL,
    source     VARCHAR(8)  NOT NULL CHECK (source IN ('shop', 'drop')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_key)
);

CREATE TABLE IF NOT EXISTS chess_puzzle_runs (
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

-- Online chess: a pending draw offer (seat 1 or 2).
ALTER TABLE online_rooms ADD COLUMN IF NOT EXISTS draw_offer SMALLINT;
ALTER TABLE online_rooms DROP CONSTRAINT IF EXISTS online_rooms_game_check;
ALTER TABLE online_rooms ADD CONSTRAINT online_rooms_game_check CHECK (game IN ('connect-four', 'tic-tac-toe', 'chess'));
