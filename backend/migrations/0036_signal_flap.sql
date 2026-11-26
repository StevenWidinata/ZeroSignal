-- Signal Flap runs. `start` stores the seed; `finish` replays the player's
-- flap ticks against it, so the score is always computed by the server.
CREATE TABLE IF NOT EXISTS flap_runs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode         VARCHAR(8)  NOT NULL CHECK (mode IN ('endless', 'daily')),
    -- A u32 seed.
    seed         BIGINT      NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
    -- WIB day of a Daily run (one per player per day); NULL for Endless.
    day          DATE,
    drone        VARCHAR(24) NOT NULL,
    trail        VARCHAR(24) NOT NULL,
    sky          VARCHAR(24) NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    -- Filled in by `finish`.
    score        INTEGER,
    gaps         INTEGER,
    bars         INTEGER,
    flaps        INTEGER,
    ticks        INTEGER,
    ended_by     VARCHAR(8),
    CHECK ((mode = 'daily') = (day IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_flap_runs_user ON flap_runs (user_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_flap_daily ON flap_runs (user_id, day) WHERE mode = 'daily';

-- Drones, trails and skies bought in the shop or found as lucky drops.
CREATE TABLE IF NOT EXISTS flap_items (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key   VARCHAR(40) NOT NULL,
    source     VARCHAR(8)  NOT NULL CHECK (source IN ('shop', 'drop')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_key)
);
