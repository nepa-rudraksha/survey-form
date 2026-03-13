-- Add 'success' as a page_type option for dynamic_sections
ALTER TABLE dynamic_sections 
MODIFY COLUMN page_type ENUM('homepage', 'form', 'success') NOT NULL COMMENT 'Where this section appears';
