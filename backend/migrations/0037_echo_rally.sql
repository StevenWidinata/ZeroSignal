-- Echo Rally matches against Zero-Bot. `start` stores the seed and the
-- setup; `finish` replays the player's inputs against it, so the result is
-- always computed by the server. Starting a new match ends any unfinished
-- one as a loss (leaving a match can't hide a defeat).
CREATE TABLE IF NOT EXISTS rally_matches (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- A u32 seed.
    seed          BIGINT      NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
    target        SMALLINT    NOT NULL CHECK (target IN (5, 7, 11)),
    -- 0 Easy .. 3 Master.
    level         SMALLINT    NOT NULL CHECK (level BETWEEN 0 AND 3),
    mode          VARCHAR(8)  NOT NULL CHECK (mode IN ('classic', 'chaos')),
    -- Chaos: the player's 3 power ids, comma-separated; '' in Classic.
    kit           VARCHAR(48) NOT NULL DEFAULT '',
    paddle        VARCHAR(24) NOT NULL,
    ball          VARCHAR(24) NOT NULL,
    court         VARCHAR(24) NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ,
    -- Filled in by `finish` (or by a later `start`: an abandoned match).
    score_me      SMALLINT,
    score_bot     SMALLINT,
    won           BOOLEAN,
    ended_by      VARCHAR(10),
    ticks         INTEGER,
    hits          INTEGER,
    longest_rally INTEGER,
    powers        SMALLINT
);

CREATE INDEX IF NOT EXISTS idx_rally_matches_user ON rally_matches (user_id, started_at DESC);
-- Finding a player's unfinished match on `start`.
CREATE INDEX IF NOT EXISTS idx_rally_matches_open ON rally_matches (user_id) WHERE finished_at IS NULL;

-- Powers, paddles, balls and courts bought in the shop or found as lucky drops.
CREATE TABLE IF NOT EXISTS rally_items (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key   VARCHAR(40) NOT NULL,
    source     VARCHAR(8)  NOT NULL CHECK (source IN ('shop', 'drop')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_key)
);
