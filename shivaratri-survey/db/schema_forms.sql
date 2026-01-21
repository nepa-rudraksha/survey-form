-- Forms table: stores form definitions
CREATE TABLE IF NOT EXISTS forms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  show_on_homepage TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_slug (slug),
  INDEX idx_status (status),
  INDEX idx_homepage (show_on_homepage, status)
);

-- Form fields table: stores field definitions for each form
CREATE TABLE IF NOT EXISTS form_fields (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(100) NOT NULL,
  field_type ENUM('text', 'textarea', 'number', 'phone', 'email', 'dropdown', 'radio', 'checkbox', 'date', 'file', 'consent') NOT NULL,
  label VARCHAR(255) NOT NULL,
  placeholder VARCHAR(255) NULL,
  required TINYINT(1) NOT NULL DEFAULT 0,
  options JSON NULL COMMENT 'For dropdown, radio, checkbox: array of option objects {value, label}',
  validation_rules JSON NULL COMMENT 'Additional validation rules',
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
  INDEX idx_form_order (form_id, display_order),
  UNIQUE KEY unique_form_field_key (form_id, field_key)
);

-- Update survey_responses to link to forms and store flexible responses
-- First, add form_id column
ALTER TABLE survey_responses 
  ADD COLUMN form_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN response_data JSON NULL COMMENT 'Flexible JSON storage for dynamic form responses',
  ADD INDEX idx_form_id (form_id);

-- Add foreign key constraint
ALTER TABLE survey_responses
  ADD CONSTRAINT fk_survey_form FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE SET NULL;

-- Keep existing columns for backward compatibility with Maha Shivaratri form
-- These will be populated for the migrated form
