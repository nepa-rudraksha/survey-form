-- Form sections table: stores section definitions for forms
CREATE TABLE IF NOT EXISTS form_sections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
  INDEX idx_form_order (form_id, display_order)
);

-- Add section_id to form_fields
ALTER TABLE form_fields 
  ADD COLUMN section_id BIGINT UNSIGNED NULL AFTER form_id,
  ADD INDEX idx_section_id (section_id),
  ADD CONSTRAINT fk_field_section FOREIGN KEY (section_id) REFERENCES form_sections(id) ON DELETE SET NULL;
