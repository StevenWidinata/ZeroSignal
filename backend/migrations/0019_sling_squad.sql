-- The slingshot game gets its own identity: "Sling Squad" (was a name and
-- characters borrowed from another game). Rename its id and its birds in
-- the saved data; every score, best and weekly prize is kept.
UPDATE scores SET game_id = 'sling-squad' WHERE game_id = 'angry-bird';
UPDATE weekly_prize_claims SET game_id = 'sling-squad' WHERE game_id = 'angry-bird';
ALTER TABLE scores ALTER COLUMN game_id SET DEFAULT 'sling-squad';

UPDATE scores SET bird_variant = CASE bird_variant
    WHEN 'red' THEN 'pip'
    WHEN 'chuck' THEN 'zip'
    WHEN 'bomb' THEN 'boomer'
    WHEN 'matilda' THEN 'eggbert'
    WHEN 'terence' THEN 'tank'
    WHEN 'blues' THEN 'trio'
    ELSE bird_variant
END
WHERE bird_variant IN ('red', 'chuck', 'bomb', 'matilda', 'terence', 'blues');
