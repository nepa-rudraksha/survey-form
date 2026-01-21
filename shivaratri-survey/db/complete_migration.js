// Complete migration - migrate response data even if form exists
require("dotenv").config();
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function completeMigration() {
  try {
    console.log("Checking forms...");

    // Check if form exists
    const [forms] = await pool.execute(
      "SELECT id FROM forms WHERE slug = 'maha-shivaratri-2026' LIMIT 1"
    );

    if (forms.length === 0) {
      console.log("Form does not exist. Please run migrate_maha_shivaratri.js first.");
      return;
    }

    const formId = forms[0].id;
    console.log(`Found form with ID: ${formId}`);

    // Update existing responses to link to this form (if not already linked)
    const [updateResult] = await pool.execute(
      `UPDATE survey_responses 
       SET form_id = ? 
       WHERE form_id IS NULL OR form_id = 0`,
      [formId]
    );

    console.log(`Updated ${updateResult.affectedRows} responses to link to form`);

    // Migrate existing response data to JSON format
    const [responses] = await pool.execute(
      "SELECT * FROM survey_responses WHERE form_id = ? AND (response_data IS NULL OR response_data = '')",
      [formId]
    );

    console.log(`Found ${responses.length} responses to migrate data for`);

    let migrated = 0;
    let errors = 0;

    for (const response of responses) {
      // Parse event_interests safely
      let eventInterests = [];
      if (response.event_interests) {
        try {
          if (typeof response.event_interests === 'string') {
            // Try to parse as JSON
            try {
              eventInterests = JSON.parse(response.event_interests);
            } catch {
              // If not JSON, might be a comma-separated string or other format
              if (response.event_interests.includes('[')) {
                // Try to extract array from string
                const match = response.event_interests.match(/\[(.*?)\]/);
                if (match) {
                  eventInterests = match[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
                }
              } else {
                eventInterests = [];
              }
            }
          } else if (Array.isArray(response.event_interests)) {
            eventInterests = response.event_interests;
          }
        } catch (e) {
          console.log(`Warning: Could not parse event_interests for response ${response.id}`);
          eventInterests = [];
        }
      }

      const responseData = {
        full_name: response.full_name || "",
        mobile_number: response.mobile_number || "",
        email: response.email || "",
        based_in_bangalore: response.based_in_bangalore || "",
        has_purchased: response.has_purchased || "",
        currently_wear: response.currently_wear || "",
        attending_interest: response.attending_interest || "",
        feb14_timing: response.feb14_timing || "",
        event_interests: eventInterests,
        wants_consultation: response.wants_consultation || "",
        rudraksha_interest_type: response.rudraksha_interest_type || "",
        reserve_signed_book: response.reserve_signed_book || "",
        shaligram_darshan: response.shaligram_darshan || "",
        biggest_question: response.biggest_question || "",
        discovered_from: response.discovered_from || "",
        discovered_other: response.discovered_other || "",
        arrangement_notes: response.arrangement_notes || "",
        wants_updates: response.wants_updates ? "yes" : "",
      };

      try {
        await pool.execute(
          "UPDATE survey_responses SET response_data = ? WHERE id = ?",
          [JSON.stringify(responseData), response.id]
        );
        migrated++;
      } catch (e) {
        console.log(`Error updating response ${response.id}:`, e.message);
        errors++;
      }
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   Migrated: ${migrated} responses`);
    console.log(`   Errors: ${errors} responses`);

    // Verify form and fields
    const [formDetails] = await pool.execute(
      "SELECT * FROM forms WHERE id = ?",
      [formId]
    );
    console.log(`\nForm details:`, formDetails[0]);

    const [fieldCount] = await pool.execute(
      "SELECT COUNT(*) as count FROM form_fields WHERE form_id = ?",
      [formId]
    );
    console.log(`Fields count: ${fieldCount[0].count}`);

  } catch (error) {
    console.error("Migration error:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

completeMigration().catch(console.error);
