-- Sudoku: games (Easy … Expert from the puzzle bank, plus the Daily) and
-- owned board themes. The solution never leaves the server; it is worked
-- out from the bank puzzle when needed.
CREATE TABLE IF NOT EXISTS sudoku_games (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level       VARCHAR(8)  NOT NULL CHECK (level IN ('easy', 'medium', 'hard', 'expert', 'daily')),
    -- WIB day of a Daily game (one per player per day).
    day         DATE,
    -- Index in the level's list (or the Daily list) of backend/data/sudoku_puzzles.json.
    puzzle      INTEGER     NOT NULL,
    -- The grid as you see it: 81 characters, '.' = empty (givens included).
    entries     CHAR(81)    NOT NULL,
    -- Squares filled by hints (they can't be changed).
    hinted      SMALLINT[]  NOT NULL DEFAULT '{}',
    hints       SMALLINT    NOT NULL DEFAULT 0,
    -- Times you pressed Check on a full grid that had wrong numbers.
    checks      SMALLINT    NOT NULL DEFAULT 0,
    status      VARCHAR(8)  NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'gave_up')),
    time_ms     INTEGER,
    score       INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sudoku_games_user ON sudoku_games (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sudoku_one_daily ON sudoku_games (user_id, day) WHERE level = 'daily';
-- One unfinished game at a time, plus one unfinished Daily.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sudoku_one_playing ON sudoku_games (user_id, (level = 'daily')) WHERE status = 'playing';

CREATE TABLE IF NOT EXISTS sudoku_items (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key   VARCHAR(40) NOT NULL,
    source     VARCHAR(8)  NOT NULL CHECK (source IN ('shop', 'drop')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_key)
);
