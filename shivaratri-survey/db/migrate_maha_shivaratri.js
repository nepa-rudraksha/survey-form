// Migration script to convert existing Maha Shivaratri form to dynamic system
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

async function migrate() {
  try {
    console.log("Starting migration...");

    // Check if form already exists
    const [existing] = await pool.execute(
      "SELECT id FROM forms WHERE slug = 'maha-shivaratri-2026' LIMIT 1"
    );

    if (existing.length > 0) {
      console.log("Form already exists. Skipping migration.");
      return;
    }

    // Create form
    const [formResult] = await pool.execute(
      `INSERT INTO forms (title, description, slug, show_on_homepage, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        "Maha Shivaratri 2026",
        "Secrets of Rudraksha — Bangalore (In-Person Event). Bangalore Exhibition with Sukritya Khatiwada • Rare Rudraksha Display • Free 1:1 Consultation",
        "maha-shivaratri-2026",
        1, // show on homepage
        "published",
      ]
    );

    const formId = formResult.insertId;
    console.log(`Created form with ID: ${formId}`);

    // Define fields based on existing schema
    const fields = [
      {
        field_key: "full_name",
        field_type: "text",
        label: "Full name",
        placeholder: "Your full name",
        required: true,
        display_order: 0,
      },
      {
        field_key: "mobile_number",
        field_type: "phone",
        label: "Mobile number",
        placeholder: "e.g. +91...",
        required: true,
        display_order: 1,
      },
      {
        field_key: "email",
        field_type: "email",
        label: "Email address",
        placeholder: "you@example.com",
        required: true,
        display_order: 2,
      },
      {
        field_key: "based_in_bangalore",
        field_type: "dropdown",
        label: "Are you currently based in Bangalore?",
        required: true,
        options: [
          { value: "live", label: "Yes — I live in Bangalore" },
          { value: "travel", label: "I will travel to Bangalore" },
          { value: "maybe", label: "Maybe" },
          { value: "no", label: "No" },
        ],
        display_order: 3,
      },
      {
        field_key: "has_purchased",
        field_type: "dropdown",
        label: "Have you purchased Rudraksha from Nepa Rudraksha?",
        required: true,
        options: [
          { value: "wearing", label: "Yes — I am wearing currently" },
          { value: "not_wearing", label: "Yes — not wearing currently" },
          { value: "plan_to", label: "No — but plan to purchase" },
          { value: "no", label: "No" },
        ],
        display_order: 4,
      },
      {
        field_key: "currently_wear",
        field_type: "text",
        label: "If you currently wear Rudraksha, which one?",
        placeholder: "Optional",
        required: false,
        display_order: 5,
      },
      {
        field_key: "attending_interest",
        field_type: "dropdown",
        label: "Are you interested in attending?",
        required: true,
        options: [
          { value: "definitely", label: "Definitely" },
          { value: "most_likely", label: "Most likely" },
          { value: "maybe_dates", label: "Maybe (depends on date/time)" },
          { value: "not_now", label: "Not now" },
        ],
        display_order: 6,
      },
      {
        field_key: "feb14_timing",
        field_type: "dropdown",
        label: "Preferred timing on Feb 14",
        required: true,
        options: [
          { value: "sat_morning", label: "Morning" },
          { value: "sat_afternoon", label: "Afternoon" },
          { value: "sat_evening", label: "Evening" },
        ],
        display_order: 7,
      },
      {
        field_key: "event_interests",
        field_type: "checkbox",
        label: "Which experiences interest you? (select all that apply)",
        required: false,
        options: [
          { value: "consultation", label: "Consultation" },
          { value: "rare_exhibition", label: "Rare Rudraksha exhibition" },
          { value: "book_launch", label: "Launch of Sukritya's upcoming book" },
          { value: "shaligram_darshan", label: "Rare Shaligram Darshan" },
        ],
        display_order: 8,
      },
      {
        field_key: "wants_consultation",
        field_type: "dropdown",
        label: "Would you like a consultation?",
        required: true,
        options: [
          { value: "yes", label: "Yes" },
          { value: "maybe", label: "Maybe" },
          { value: "no", label: "No" },
        ],
        display_order: 9,
      },
      {
        field_key: "rudraksha_interest_type",
        field_type: "dropdown",
        label: "What type of Rudraksha interests you most?",
        required: true,
        options: [
          { value: "healing_spiritual", label: "Healing / Spiritual growth" },
          { value: "planetary", label: "Planetary remedies" },
          { value: "siddha", label: "Siddha combinations" },
          { value: "rare", label: "Rare collection" },
          { value: "family", label: "Family wellbeing" },
          { value: "not_sure", label: "Not sure" },
        ],
        display_order: 10,
      },
      {
        field_key: "reserve_signed_book",
        field_type: "dropdown",
        label: "Would you like to reserve a signed book?",
        required: true,
        options: [
          { value: "yes", label: "Yes" },
          { value: "maybe", label: "Maybe" },
          { value: "no", label: "No" },
        ],
        display_order: 11,
      },
      {
        field_key: "shaligram_darshan",
        field_type: "dropdown",
        label: "Would you like Shaligram Darshan?",
        required: true,
        options: [
          { value: "yes", label: "Yes" },
          { value: "maybe", label: "Maybe" },
          { value: "no", label: "No" },
        ],
        display_order: 12,
      },
      {
        field_key: "biggest_question",
        field_type: "textarea",
        label: "What is the biggest question you have about Rudraksha?",
        placeholder: "Write your question here",
        required: true,
        display_order: 13,
      },
      {
        field_key: "discovered_from",
        field_type: "dropdown",
        label: "How did you first discover Nepa Rudraksha?",
        required: true,
        options: [
          { value: "instagram", label: "Instagram" },
          { value: "youtube", label: "YouTube" },
          { value: "word_of_mouth", label: "Word of mouth" },
          { value: "event_talk", label: "Event / Talk" },
          { value: "friend_family", label: "Friend / Family" },
          { value: "other", label: "Other" },
        ],
        display_order: 14,
      },
      {
        field_key: "discovered_other",
        field_type: "text",
        label: "If other, please specify (optional)",
        placeholder: "Type source",
        required: false,
        display_order: 15,
      },
      {
        field_key: "arrangement_notes",
        field_type: "textarea",
        label: "Anything you'd like us to know or arrange for you during the event? (optional)",
        placeholder: "Any preferences or notes",
        required: false,
        display_order: 16,
      },
      {
        field_key: "wants_updates",
        field_type: "consent",
        label: "I would like to receive updates and early invitations to future events",
        placeholder: "I would like to receive updates and early invitations to future events",
        required: false,
        display_order: 17,
      },
    ];

    // Insert fields
    for (const field of fields) {
      await pool.execute(
        `INSERT INTO form_fields (form_id, field_key, field_type, label, placeholder, required, options, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          formId,
          field.field_key,
          field.field_type,
          field.label,
          field.placeholder || null,
          field.required ? 1 : 0,
          field.options ? JSON.stringify(field.options) : null,
          field.display_order,
        ]
      );
    }

    console.log(`Created ${fields.length} fields`);

    // Update existing responses to link to this form
    const [updateResult] = await pool.execute(
      `UPDATE survey_responses 
       SET form_id = ? 
       WHERE form_id IS NULL`,
      [formId]
    );

    console.log(`Updated ${updateResult.affectedRows} existing responses to link to form`);

    // Migrate existing response data to JSON format
    const [responses] = await pool.execute(
      "SELECT * FROM survey_responses WHERE form_id = ? AND response_data IS NULL",
      [formId]
    );

    for (const response of responses) {
      // Parse event_interests safely
      let eventInterests = [];
      if (response.event_interests) {
        try {
          if (typeof response.event_interests === 'string') {
            eventInterests = JSON.parse(response.event_interests);
          } else if (Array.isArray(response.event_interests)) {
            eventInterests = response.event_interests;
          }
        } catch (e) {
          console.log(`Warning: Could not parse event_interests for response ${response.id}:`, e.message);
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
      } catch (e) {
        console.log(`Warning: Could not update response ${response.id}:`, e.message);
      }
    }

    console.log(`Migrated ${responses.length} response data to JSON format`);

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration error:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

migrate().catch(console.error);
