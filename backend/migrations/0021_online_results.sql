-- One row per decided online series (rooms are reused for rematches, so
-- results are kept here for the online leaderboard).
CREATE TABLE IF NOT EXISTS online_results (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID        NOT NULL REFERENCES online_rooms(id) ON DELETE CASCADE,
    game        VARCHAR(16) NOT NULL,
    host_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id    UUID        REFERENCES users(id) ON DELETE CASCADE,
    -- 1 or 2 = that seat won, 0 = draw.
    winner      SMALLINT    NOT NULL,
    abandoned   BOOLEAN     NOT NULL DEFAULT FALSE,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_online_results_game ON online_results (game);
