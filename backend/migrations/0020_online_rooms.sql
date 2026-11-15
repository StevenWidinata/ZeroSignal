-- Online play: two players, one room, a best-of series of Connect Four or
-- Tic-Tac-Toe. Seat 1 is the host, seat 2 the friend who joined. `moves`
-- holds the current game; `version` goes up on every change so clients can
-- wait for news.
CREATE TABLE IF NOT EXISTS online_rooms (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(6)  NOT NULL UNIQUE,
    game          VARCHAR(16) NOT NULL CHECK (game IN ('connect-four', 'tic-tac-toe')),
    best_of       SMALLINT    NOT NULL CHECK (best_of IN (1, 3, 5)),
    host_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
    status        VARCHAR(10) NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting', 'playing', 'finished', 'abandoned')),
    moves         TEXT        NOT NULL DEFAULT '',
    game_no       SMALLINT    NOT NULL DEFAULT 1,
    -- Seat that moves first in the current game (alternates every game).
    first_seat    SMALLINT    NOT NULL DEFAULT 1 CHECK (first_seat IN (1, 2)),
    host_wins     SMALLINT    NOT NULL DEFAULT 0,
    guest_wins    SMALLINT    NOT NULL DEFAULT 0,
    draws         SMALLINT    NOT NULL DEFAULT 0,
    game_over     BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Series result: 1 or 2 = that seat won, 0 = draw.
    winner        SMALLINT,
    rewarded      BOOLEAN     NOT NULL DEFAULT FALSE,
    host_rematch  BOOLEAN     NOT NULL DEFAULT FALSE,
    guest_rematch BOOLEAN     NOT NULL DEFAULT FALSE,
    host_emote    VARCHAR(8),
    host_emote_at TIMESTAMPTZ,
    guest_emote   VARCHAR(8),
    guest_emote_at TIMESTAMPTZ,
    host_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
    guest_seen    TIMESTAMPTZ,
    version       INTEGER     NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_online_rooms_host ON online_rooms (host_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_online_rooms_guest ON online_rooms (guest_id, created_at DESC);
