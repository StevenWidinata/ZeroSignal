-- Snake Signal runs. `start` stores the seed; `finish` replays the player's
-- turns against it, so the score is always computed by the server.
CREATE TABLE IF NOT EXISTS snake_runs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode        VARCHAR(8)  NOT NULL CHECK (mode IN ('classic', 'wrap', 'daily')),
    size        VARCHAR(8)  NOT NULL CHECK (size IN ('small', 'medium', 'large')),
    -- A u32 seed.
    seed        BIGINT      NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
    -- WIB day of a Daily run (one per player per day); NULL for other modes.
    day         DATE,
    skin        VARCHAR(24) NOT NULL DEFAULT 'neon',
    arena       VARCHAR(24) NOT NULL DEFAULT 'grid',
    trail       VARCHAR(24) NOT NULL DEFAULT 'none',
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    -- Filled in by `finish`.
    score       INTEGER,
    max_length  INTEGER,
    best_combo  SMALLINT,
    eaten       INTEGER,
    golden      INTEGER,
    powers      INTEGER,
    close_calls INTEGER,
    bugs_eaten  INTEGER,
    ticks       INTEGER,
    ended_by    VARCHAR(8)
);

CREATE INDEX IF NOT EXISTS idx_snake_runs_user ON snake_runs (user_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_snake_daily ON snake_runs (user_id, day) WHERE mode = 'daily';

-- Skins, arenas and trails bought in the shop or found as lucky drops.
CREATE TABLE IF NOT EXISTS snake_items (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key   VARCHAR(40) NOT NULL,
    source     VARCHAR(8)  NOT NULL CHECK (source IN ('shop', 'drop')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_key)
);
