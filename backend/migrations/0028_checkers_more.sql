-- Online checkers rooms.
ALTER TABLE online_rooms DROP CONSTRAINT IF EXISTS online_rooms_game_check;
ALTER TABLE online_rooms ADD CONSTRAINT online_rooms_game_check
    CHECK (game IN ('connect-four', 'tic-tac-toe', 'chess', 'sonar', 'checkers'));

-- Your pieces left when a game vs Zero-Bot ended (for the "Iron Wall" achievement).
ALTER TABLE checkers_games ADD COLUMN IF NOT EXISTS pieces_left SMALLINT;
