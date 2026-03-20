// Rebuild the "Rudraksha Transformation Study - Post 40 days" form.
// This is a DB-side rebuild because form_fields were deleted and there are no recoverable submissions.
require("dotenv").config();
const mysql = require("mysql2/promise");
const { execSync } = require("child_process");

const formId = 4;
const slug = "rudraksha-experience";
const title = "Rudraksha Transformation Study - Post 40 days";

function otherOption() {
  return { value: "other", label: "Other" };
}

function shortHash(s) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// Ensure the field_key is safe to use as a column identifier in form_responses_N.
// MySQL identifier limit is 64 characters.
function shortFieldKey(key) {
  const max = 64;
  const k = String(key || "").trim();
  if (!k) return k;
  if (k.length <= max) return k;
  const hash = shortHash(k).slice(0, 8);
  const headLen = Math.max(1, max - hash.length - 1);
  const head = k.slice(0, headLen).replace(/_+$/g, "");
  return head + "_" + hash;
}

function radioOptions(pairs) {
  // pairs: [{value,label}, ...] or [{label} ...]
  return pairs.map((p) => {
    if (typeof p === "string") return { value: p, label: p };
    if (p && typeof p === "object" && p.value !== undefined) return { value: p.value, label: p.label ?? p.value };
    return { value: p.label ?? "", label: p.label ?? "" };
  });
}

async function main() {
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

  // Backup existing form_fields (best-effort; may be empty after prior deletions)
  try {
    const [backup] = await pool.execute("SELECT * FROM form_fields WHERE form_id = ? ORDER BY display_order", [formId]);
    console.log(`Backup: existing form_fields rows for form_id=${formId}:`, backup.length);
  } catch (e) {
    console.warn("Backup read failed:", e.message);
  }

  // Delete old form + field definitions. FK cascades should remove form_fields / form_sections.
  // Then drop response table so we can recreate columns fresh.
  const tableName = `form_responses_${formId}`;

  const fields = [
    { field_key: "name", field_type: "text", label: "Name", placeholder: null, required: true, options: null },
    {
      field_key: "which_rudraksha_are_you_using",
      field_type: "text",
      label: "Which Rudraksha(s) are you currently using?",
      placeholder: null,
      required: true,
      options: null,
    },
    {
      field_key: "how_do_you_primarily_use_your_rudraksha",
      field_type: "radio",
      label: "How do you primarily use your Rudraksha?",
      placeholder: null,
      required: false,
      options: radioOptions([
        { value: "wear_daily", label: "Wear daily" },
        { value: "during_meditation_sadhana", label: "During meditation / sadhana" },
        { value: "during_specific_rituals", label: "During specific rituals" },
        { value: "occasionally", label: "Occasionally" },
        { value: "kept_in_altar_sacred_space", label: "Kept in altar / sacred space" },
        otherOption(),
      ]),
    },
    {
      field_key: "on_average_how_consistently_have_you_used_it_in_the_past_40_days",
      field_type: "radio",
      label: "On average, how consistently have you used it in the past 40 days?",
      placeholder: null,
      required: false,
      options: radioOptions([
        { value: "daily_almost_no_misses", label: "Daily (almost no misses)" },
        { value: "4_5_times_a_week", label: "4–5 times a week" },
        { value: "2_3_times_a_week", label: "2–3 times a week" },
        { value: "rarely", label: "Rarely" },
        otherOption(),
      ]),
    },
    {
      field_key: "what_was_your_primary_intention_when_you_started_using_rudraksha",
      field_type: "radio",
      label: "What was your primary intention when you started using Rudraksha?",
      placeholder: null,
      required: false,
      options: radioOptions([
        { value: "discipline_focus", label: "Discipline & focus" },
        { value: "emotional_stability_stress_relief", label: "Emotional stability / stress relief" },
        { value: "spiritual_growth_consciousness", label: "Spiritual growth / consciousness" },
        { value: "protection_negativity_removal", label: "Protection / negativity removal" },
        { value: "career_success_progress", label: "Career / success / progress" },
        { value: "health_energy", label: "Health / energy" },
        { value: "clarity_decision_making", label: "Clarity / decision making" },
        { value: "general_well_being", label: "General well-being" },
        otherOption(),
      ]),
    },

    // 0–10 scales
    { field_key: "improvement_in_discipline_consistency", field_type: "scale", label: "Improvement in Discipline & consistency", required: false, placeholder: null, options: null },
    { field_key: "improvement_in_mental_clarity", field_type: "scale", label: "Improvement in Mental clarity", required: false, placeholder: null, options: null },
    { field_key: "improvement_in_emotional_stability", field_type: "scale", label: "Improvement in Emotional stability", required: false, placeholder: null, options: null },
    { field_key: "improvement_in_stress_reduction", field_type: "scale", label: "Improvement in Stress reduction", required: false, placeholder: null, options: null },
    { field_key: "improvement_in_focus_productivity", field_type: "scale", label: "Improvement in Focus & productivity", required: false, placeholder: null, options: null },
    { field_key: "improvement_in_spiritual_awareness", field_type: "scale", label: "Improvement in Spiritual awareness", required: false, placeholder: null, options: null },
    { field_key: "improvement_in_confidence_inner_strength", field_type: "scale", label: "Improvement in Confidence / inner strength", required: false, placeholder: null, options: null },
    { field_key: "improvement_in_energy_levels", field_type: "scale", label: "Improvement in Energy levels", required: false, placeholder: null, options: null },

    {
      field_key: "overall_impact_of_rudraksha_in_your_life_so_far",
      field_type: "radio",
      label: "Overall, how would you rate the impact of Rudraksha in your life so far?",
      placeholder: null,
      required: false,
      options: radioOptions([
        { value: "transformational", label: "Transformational" },
        { value: "clearly_noticeable", label: "Clearly noticeable" },
        { value: "slightly_noticeable", label: "Slightly noticeable" },
        { value: "no_change_yet", label: "No noticeable change yet" },
      ]),
    },
    {
      field_key: "was_prana_pratistha_puja_performed_on_rudraksha",
      field_type: "radio",
      label: "Was Prana Pratistha Puja (Vedic Energization) Performed on your Rudraksha prior to use?",
      placeholder: null,
      required: false,
      options: radioOptions([
        { value: "yes_by_nepa", label: "Yes (by Nepa Rudraksha)" },
        { value: "yes_self_other", label: "Yes (self / other method)" },
        { value: "no", label: "No" },
        { value: "not_sure", label: "Not sure" },
      ]),
    },
    {
      field_key: "was_astrology_and_rudraksha_consultation_used_as_part_of_selection",
      field_type: "radio",
      label: "Was Astrology and Rudraksha Consultation used as part of your Rudraksha Selection?",
      placeholder: null,
      required: false,
      options: radioOptions([
        { value: "yes_by_nepa_expert", label: "Yes (by Nepa Rudraksha Expert)" },
        { value: "yes_by_sukritya", label: "Yes ( Consulted with Sukritya Khatiwada)" },
        { value: "yes_self_other_astrologer", label: "Yes (Self/Other Astrologer or Expert)" },
        { value: "no", label: "No" },
      ]),
    },
    {
      field_key: "do_you_know_the_size_of_your_rudraksha",
      field_type: "radio",
      label: "Do you know the size of your Rudraksha?",
      placeholder: null,
      required: false,
      options: radioOptions([
        { value: "small_regular", label: "Small (Regular)" },
        { value: "medium", label: "Medium" },
        { value: "large_collector", label: "Large (Collector)" },
        { value: "super_collector", label: "Super Collector" },
        { value: "mixed_sizes", label: "Mixed Sizes" },
        { value: "not_sure", label: "Not sure" },
      ]),
    },
    {
      field_key: "optional_what_is_your_height_please_specify_cm_or_ft",
      field_type: "text",
      label: "Optional: What is Your height? (Please specify cm or ft)",
      placeholder: null,
      required: false,
      options: null,
    },
    {
      field_key: "in_one_sentence_how_has_rudraksha_impacted_your_life",
      field_type: "textarea",
      label: "In one sentence, how has Rudraksha impacted your life?",
      placeholder: null,
      required: true,
      options: null,
    },
    {
      field_key: "can_we_use_your_feedback_anonymously_to_help_others",
      field_type: "radio",
      label: "Can we use your feedback (anonymously) to help others?",
      placeholder: null,
      required: true,
      options: radioOptions([
        { value: "yes_anonymous", label: "Yes" },
        { value: "yes_with_name", label: "Yes, with my name" },
        { value: "no", label: "No" },
      ]),
    },
    {
      field_key: "would_you_be_interested_in_speaking_in_a_virtual_rudraksha_event",
      field_type: "radio",
      label: "Would you be interested in Speaking in a Virtual Rudraksha Event to share your experience?",
      placeholder: null,
      required: true,
      options: radioOptions([
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
        { value: "other", label: "Other" },
      ]),
    },
    {
      field_key: "do_you_have_feedback_for_nepa_rudraksha",
      field_type: "textarea",
      label: "Do you have Feedback for Nepa Rudraksha?",
      placeholder: null,
      required: false,
      options: null,
    },
    {
      field_key: "do_you_want_a_nepa_rudraksha_expert_to_reach_out_to_you_for_any_assistance",
      field_type: "radio",
      label: "Do you want a Nepa Rudraksha Expert to reach out to you for any assistance?",
      placeholder: null,
      required: false,
      options: radioOptions([
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]),
    },
  ];

  const conn = pool;
  try {
    console.log("Rebuilding form:", { formId, slug, title });

    // Delete form and related rows
    await conn.execute("DELETE FROM forms WHERE id = ?", [formId]);
    await conn.query(`DROP TABLE IF EXISTS \`${tableName}\``);

    // Reinsert form
    await conn.execute(
      "INSERT INTO forms (id, title, slug, description, show_on_homepage, status) VALUES (?, ?, ?, NULL, 0, 'published')",
      [formId, title, slug]
    );

    // Insert fields without sections
    const usedKeys = new Set();
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      let fieldKey = shortFieldKey(f.field_key);
      if (usedKeys.has(fieldKey)) {
        const hash = shortHash(f.field_key + "_" + i).slice(0, 8);
        const headLen = Math.max(1, 64 - hash.length - 1);
        fieldKey = f.field_key.slice(0, headLen).replace(/_+$/g, "") + "_" + hash;
      }
      usedKeys.add(fieldKey);

      await conn.execute(
        `INSERT INTO form_fields
          (form_id, section_id, field_key, field_type, label, placeholder, required, options, validation_rules, display_order)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [
          formId,
          fieldKey,
          f.field_type,
          f.label,
          f.placeholder,
          f.required ? 1 : 0,
          f.field_type === "radio" || f.field_type === "checkbox" ? JSON.stringify(f.options || []) : null,
          i,
        ]
      );
    }

    console.log(`Inserted ${fields.length} fields.`);

    // Recreate response table columns for this form.
    // create_response_tables.js scans all forms, but that's fine.
    console.log("Recreating response table columns...");
    execSync(`node db/create_response_tables.js`, { cwd: process.cwd(), stdio: "inherit" });

    console.log("Done rebuilding form.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Rebuild failed:", e);
  process.exit(1);
});

