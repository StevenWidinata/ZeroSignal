-- Sonar Ship Workshop: each player's Mk level per Tactics power (Mk I is the
-- default, so only upgrades are stored). Used vs Zero-Bot and in the Campaign.

CREATE TABLE IF NOT EXISTS sonar_upgrades (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    power      VARCHAR(16) NOT NULL,
    level      SMALLINT    NOT NULL CHECK (level BETWEEN 2 AND 3),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, power)
);
