-- Dynamic sections for homepage and form pages
CREATE TABLE IF NOT EXISTS dynamic_sections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  page_type ENUM('homepage', 'form') NOT NULL COMMENT 'Where this section appears',
  form_id BIGINT UNSIGNED NULL COMMENT 'NULL for homepage, form_id for form pages',
  section_type ENUM('image_text', 'link', 'button') NOT NULL DEFAULT 'image_text',
  title VARCHAR(255) NULL COMMENT 'Section title/heading',
  description TEXT NULL COMMENT 'Section description/text',
  image_url VARCHAR(500) NULL COMMENT 'Image URL for image_text type',
  link_url VARCHAR(500) NULL COMMENT 'URL for link/button',
  link_text VARCHAR(255) NULL COMMENT 'Text for link/button',
  button_style VARCHAR(50) NULL DEFAULT 'primary' COMMENT 'Button style: primary, secondary, outline',
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
  INDEX idx_page_type (page_type),
  INDEX idx_form_id (form_id),
  INDEX idx_display_order (page_type, form_id, display_order)
);

-- Navigation links for scroll-to-section (homepage only)
CREATE TABLE IF NOT EXISTS homepage_navigation (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  link_text VARCHAR(255) NOT NULL COMMENT 'Text to display in navigation',
  section_id BIGINT UNSIGNED NULL COMMENT 'ID of dynamic_section to scroll to (NULL for forms section)',
  scroll_target VARCHAR(100) NULL COMMENT 'Custom scroll target (e.g., "forms", "section_1")',
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (section_id) REFERENCES dynamic_sections(id) ON DELETE SET NULL,
  INDEX idx_display_order (display_order)
);
