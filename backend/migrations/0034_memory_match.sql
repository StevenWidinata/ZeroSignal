-- Memory Match: online-only rooms (Classic or Chaos with power-ups),
-- the power-ups people bought, and one row per player per finished game.

ALTER TABLE online_rooms DROP CONSTRAINT IF EXISTS online_rooms_game_check;
ALTER TABLE online_rooms ADD CONSTRAINT online_rooms_game_check
    CHECK (game IN ('connect-four', 'tic-tac-toe', 'chess', 'sonar', 'checkers', 'memory-match'));

-- The whole room plays one mode and one board size (other games keep the defaults).
ALTER TABLE online_rooms ADD COLUMN IF NOT EXISTS memory_mode VARCHAR(8) NOT NULL DEFAULT 'classic';
ALTER TABLE online_rooms DROP CONSTRAINT IF EXISTS online_rooms_memory_mode_check;
ALTER TABLE online_rooms ADD CONSTRAINT online_rooms_memory_mode_check CHECK (memory_mode IN ('classic', 'chaos'));
ALTER TABLE online_rooms ADD COLUMN IF NOT EXISTS memory_size VARCHAR(8) NOT NULL DEFAULT 'medium';
ALTER TABLE online_rooms DROP CONSTRAINT IF EXISTS online_rooms_memory_size_check;
ALTER TABLE online_rooms ADD CONSTRAINT online_rooms_memory_size_check CHECK (memory_size IN ('small', 'medium', 'large'));
-- Chaos: the 3 powers each seat brought to this game ("shuffle,swap,peek").
ALTER TABLE online_rooms ADD COLUMN IF NOT EXISTS host_kit TEXT;
ALTER TABLE online_rooms ADD COLUMN IF NOT EXISTS guest_kit TEXT;

CREATE TABLE IF NOT EXISTS memory_items (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key   VARCHAR(40) NOT NULL,
    source     VARCHAR(8)  NOT NULL CHECK (source IN ('shop')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_key)
);

CREATE TABLE IF NOT EXISTS memory_games (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id    UUID        NOT NULL REFERENCES online_rooms(id) ON DELETE CASCADE,
    mode       VARCHAR(8)  NOT NULL CHECK (mode IN ('classic', 'chaos')),
    size       VARCHAR(8)  NOT NULL CHECK (size IN ('small', 'medium', 'large')),
    result     VARCHAR(4)  NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
    pairs      SMALLINT    NOT NULL,
    misses     SMALLINT    NOT NULL,
    best_run   SMALLINT    NOT NULL,
    powers     SMALLINT    NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_games_user ON memory_games (user_id, created_at DESC);
