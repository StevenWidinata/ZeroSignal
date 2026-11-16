-- Whack-a-Mole "Normal": a calmer 60-second mode (its own board, level 5).
ALTER TABLE wam_runs DROP CONSTRAINT IF EXISTS wam_runs_mode_check;
ALTER TABLE wam_runs ADD CONSTRAINT wam_runs_mode_check
    CHECK (mode IN ('normal', 'classic', 'frenzy', 'survival', 'daily'));
