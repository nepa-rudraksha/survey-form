CREATE TABLE IF NOT EXISTS survey_responses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  full_name VARCHAR(120) NOT NULL,
  mobile_number VARCHAR(30) NOT NULL,
  email VARCHAR(191) NULL,

  based_in_bangalore ENUM('live','travel','maybe','no') NOT NULL,

  has_purchased ENUM('wearing','not_wearing','plan_to','no') NOT NULL,
  currently_wear VARCHAR(255) NULL,

  attending_interest ENUM('definitely','most_likely','maybe_dates','not_now') NOT NULL,
  feb14_timing ENUM('sat_morning','sat_afternoon','sat_evening') NOT NULL,

  event_interests JSON NOT NULL,

  wants_consultation ENUM('yes','maybe','no') NOT NULL,
  rudraksha_interest_type ENUM('healing_spiritual','planetary','siddha','rare','family','not_sure') NOT NULL,

  reserve_signed_book ENUM('yes','maybe','no') NOT NULL,
  shaligram_darshan ENUM('yes','maybe','no') NOT NULL,

  biggest_question TEXT NOT NULL,

  discovered_from ENUM('instagram','youtube','word_of_mouth','event_talk','friend_family','other') NOT NULL,
  discovered_other VARCHAR(120) NULL,

  wants_updates TINYINT(1) NOT NULL DEFAULT 1,

  arrangement_notes TEXT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
