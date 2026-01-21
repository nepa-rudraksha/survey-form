-- Make old columns nullable to support dynamic forms
-- Dynamic forms store data in response_data JSON, so old columns can be NULL

ALTER TABLE survey_responses 
  MODIFY COLUMN full_name VARCHAR(120) NULL,
  MODIFY COLUMN mobile_number VARCHAR(30) NULL,
  MODIFY COLUMN email VARCHAR(191) NULL,
  MODIFY COLUMN based_in_bangalore ENUM('live','travel','maybe','no') NULL,
  MODIFY COLUMN has_purchased ENUM('wearing','not_wearing','plan_to','no') NULL,
  MODIFY COLUMN attending_interest ENUM('definitely','most_likely','maybe_dates','not_now') NULL,
  MODIFY COLUMN feb14_timing ENUM('sat_morning','sat_afternoon','sat_evening') NULL,
  MODIFY COLUMN wants_consultation ENUM('yes','maybe','no') NULL,
  MODIFY COLUMN rudraksha_interest_type ENUM('healing_spiritual','planetary','siddha','rare','family','not_sure') NULL,
  MODIFY COLUMN reserve_signed_book ENUM('yes','maybe','no') NULL,
  MODIFY COLUMN shaligram_darshan ENUM('yes','maybe','no') NULL,
  MODIFY COLUMN biggest_question TEXT NULL,
  MODIFY COLUMN discovered_from ENUM('instagram','youtube','word_of_mouth','event_talk','friend_family','other') NULL,
  MODIFY COLUMN wants_updates TINYINT(1) NULL DEFAULT NULL;
