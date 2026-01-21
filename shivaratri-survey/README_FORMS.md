# Dynamic Form System - Setup Instructions

## Overview

This system allows admins to create multiple survey forms dynamically. Each form has its own unique URL and can be shown or hidden on the homepage.

## Database Setup

1. Run the new schema to create the forms and form_fields tables:

```bash
mysql -u your_user -p your_database < db/schema_forms.sql
```

Or execute the SQL manually from `db/schema_forms.sql`.

## Migration

To migrate the existing Maha Shivaratri form to the new system:

```bash
cd shivaratri-survey
node db/migrate_maha_shivaratri.js
```

This will:
- Create a form record for "Maha Shivaratri 2026"
- Create all field definitions
- Link existing responses to the new form
- Convert existing response data to JSON format

## Usage

### Admin Access

1. Login at `/admin/login`
2. You'll be redirected to `/admin/forms` (forms management)

### Creating a New Form

1. Go to `/admin/forms`
2. Click "Create New Form"
3. Fill in:
   - Title
   - Description (optional)
   - Slug (URL-friendly identifier)
   - Status (Draft/Published)
   - Show on homepage toggle
4. Add fields:
   - Click "Add Field"
   - Set field key, type, label, placeholder
   - For dropdown/radio/checkbox: add options (one per line, format: `value|Label` or just `Label`)
   - Mark as required if needed
5. Click "Save Form"

### Field Types Supported

- **Text**: Single-line text input
- **Textarea**: Multi-line text input
- **Number**: Numeric input
- **Phone**: Phone number (auto-normalized)
- **Email**: Email validation
- **Date**: Date picker
- **Dropdown**: Single select dropdown
- **Radio**: Single select radio buttons
- **Checkbox**: Multi-select checkboxes
- **Consent**: Checkbox for consent/agreement

### Form URLs

- Published forms are accessible at: `/forms/{slug}`
- Example: `/forms/maha-shivaratri-2026`

### Homepage

- The homepage (`/`) shows all forms where:
  - `show_on_homepage = true`
  - `status = 'published'`

### Viewing Responses

1. Go to `/admin/forms`
2. Click "Responses" on any form
3. View all submissions for that form
4. Export as CSV if needed

## Backward Compatibility

- The existing Maha Shivaratri form continues to work
- Old responses are preserved and linked to the new form
- The legacy route `/survey` redirects to the new form URL if the form exists

## Notes

- Form slugs must be unique
- Draft forms are not accessible publicly
- Fields can be reordered by their display_order
- Response data is stored as JSON for flexibility
