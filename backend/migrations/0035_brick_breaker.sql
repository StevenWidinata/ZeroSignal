-- Brick Breaker runs. `start` stores the seed; `finish` replays the player's
-- paddle inputs against it, so the score is always computed by the server.
CREATE TABLE IF NOT EXISTS brick_runs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode         VARCHAR(8)  NOT NULL CHECK (mode IN ('campaign', 'endless', 'daily')),
    -- Campaign level (1-24); NULL for Endless and Daily.
    level        SMALLINT    CHECK (level BETWEEN 1 AND 24),
    -- A u32 seed.
    seed         BIGINT      NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
    -- WIB day of a Daily run (one per player per day); NULL for other modes.
    day          DATE,
    paddle       VARCHAR(24) NOT NULL,
    ball         VARCHAR(24) NOT NULL,
    theme        VARCHAR(24) NOT NULL,
    backdrop     VARCHAR(24) NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    -- Filled in by `finish`.
    score        INTEGER,
    bricks       INTEGER,
    cleared      BOOLEAN,
    stars        SMALLINT,
    wave         INTEGER,
    best_combo   INTEGER,
    best_chain   INTEGER,
    drops        INTEGER,
    lost         INTEGER,
    ticks        INTEGER,
    ended_by     VARCHAR(8),
    CHECK ((mode = 'campaign') = (level IS NOT NULL)),
    CHECK ((mode = 'daily') = (day IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_brick_runs_user ON brick_runs (user_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_brick_daily ON brick_runs (user_id, day) WHERE mode = 'daily';

-- Campaign progress: one row per cleared level with the best stars (each new
-- star pays coins once) and the best clearing score.
CREATE TABLE IF NOT EXISTS brick_levels (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level      SMALLINT    NOT NULL CHECK (level BETWEEN 1 AND 24),
    stars      SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 3),
    best_score INTEGER     NOT NULL CHECK (best_score >= 0),
    cleared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, level)
);

-- Paddles, balls, brick themes and backdrops bought in the shop or found as
-- lucky drops.
CREATE TABLE IF NOT EXISTS brick_items (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key   VARCHAR(40) NOT NULL,
    source     VARCHAR(8)  NOT NULL CHECK (source IN ('shop', 'drop')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_key)
);
