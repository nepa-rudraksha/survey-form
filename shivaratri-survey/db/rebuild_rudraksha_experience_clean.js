// Clean rebuild for "Rudraksha Transformation Study - Post 40 days"
// This drops the response table and recreates form_sections + form_fields + response columns.
require("dotenv").config();
const mysql = require("mysql2/promise");
const { execSync } = require("child_process");

const formId = 4;
const formSlug = "rudraksha-experience";

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

function otherOptionColon() {
  // Important: both value and label help our "Other" detection.
  return { value: "other", label: "Other:" };
}

function radioOptions(arr) {
  // arr: [{value,label}, ...] or strings
  return arr.map((x) => {
    if (typeof x === "string") return { value: x, label: x };
    if (x && typeof x === "object") {
      return { value: x.value ?? x.label ?? x, label: x.label ?? x.value ?? x };
    }
    return { value: "", label: "" };
  });
}

async function main() {
  const tableName = `form_responses_${formId}`;

  // 1) Drop response table (fresh columns)
  await pool.query(`DROP TABLE IF EXISTS \`${tableName}\``);

  // 2) Clear old definitions
  await pool.execute("DELETE FROM form_fields WHERE form_id = ?", [formId]);
  await pool.execute("DELETE FROM form_sections WHERE form_id = ?", [formId]);

  // 3) Insert sections
  const sections = [
    {
      title: "Basic Information",
      description: null,
    },
    {
      title: "Usage, Consistency & Intention",
      description: null,
    },
    {
      title: "In the Duration of Rudraksha wear, what changes have you experienced?",
      description: "Rate from scale based on your personal reflection",
    },
    {
      title: "Overall Impact & Selection",
      description: null,
    },
    {
      title: "Feedback & Contact",
      description: null,
    },
  ];

  const sectionIds = [];
  for (let i = 0; i < sections.length; i++) {
    const [r] = await pool.execute(
      `INSERT INTO form_sections (form_id, title, description, display_order)
       VALUES (?, ?, ?, ?)`,
      [formId, sections[i].title, sections[i].description, i]
    );
    sectionIds.push(r.insertId);
  }

  const S_BASIC = sectionIds[0];
  const S_USAGE = sectionIds[1];
  const S_SCALE = sectionIds[2];
  const S_OVERALL = sectionIds[3];
  const S_FEEDBACK = sectionIds[4];

  // IMPORTANT:
  // - field_key is used as a column identifier in form_responses_N, so it must be <= 64 chars.
  // - scale fields live in the S_SCALE section.
  const fields = [
    // Basic
    { key: "name", type: "text", label: "Name", required: true, sectionId: S_BASIC },
    {
      key: "which_rudraksha_using",
      type: "text",
      label: "Which Rudraksha(s) are you currently using?",
      required: true,
      sectionId: S_BASIC,
    },

    // Usage & intention
    {
      key: "primarily_use",
      type: "radio",
      label: "How do you primarily use your Rudraksha?",
      required: false,
      sectionId: S_USAGE,
      options: radioOptions([
        { value: "wear_daily", label: "Wear daily" },
        { value: "during_meditation_sadhana", label: "During meditation / sadhana" },
        { value: "during_specific_rituals", label: "During specific rituals" },
        { value: "occasionally", label: "Occasionally" },
        { value: "kept_in_altar", label: "Kept in altar / sacred space" },
        otherOptionColon(),
      ]),
    },
    {
      key: "consistency_past_40",
      type: "radio",
      label: "On average, how consistently have you used it in the past 40 days?",
      required: false,
      sectionId: S_USAGE,
      options: radioOptions([
        { value: "daily_almost", label: "Daily (almost no misses)" },
        { value: "4_5_week", label: "4–5 times a week" },
        { value: "2_3_week", label: "2–3 times a week" },
        { value: "rarely", label: "Rarely" },
        otherOptionColon(),
      ]),
    },
    {
      key: "primary_intention_start",
      type: "radio",
      label: "What was your primary intention when you started using Rudraksha?",
      required: false,
      sectionId: S_USAGE,
      options: radioOptions([
        { value: "discipline_focus", label: "Discipline & focus" },
        { value: "emotional_stability", label: "Emotional stability / stress relief" },
        { value: "spiritual_growth", label: "Spiritual growth / consciousness" },
        { value: "protection_negativity", label: "Protection / negativity removal" },
        { value: "career_success", label: "Career / success / progress" },
        { value: "health_energy", label: "Health / energy" },
        { value: "clarity_decision", label: "Clarity / decision making" },
        { value: "general_wellbeing", label: "General well-being" },
        otherOptionColon(),
      ]),
    },

    // Scale section (must be inside this section)
    { key: "scale_discipline_consistency", type: "scale", label: "Improvement in Discipline & consistency", required: false, sectionId: S_SCALE },
    { key: "scale_mental_clarity", type: "scale", label: "Improvement in Mental clarity", required: false, sectionId: S_SCALE },
    { key: "scale_emotional_stability", type: "scale", label: "Improvement in Emotional stability", required: false, sectionId: S_SCALE },
    { key: "scale_stress_reduction", type: "scale", label: "Improvement in Stress reduction", required: false, sectionId: S_SCALE },
    { key: "scale_focus_productivity", type: "scale", label: "Improvement in Focus & productivity", required: false, sectionId: S_SCALE },
    { key: "scale_spiritual_awareness", type: "scale", label: "Improvement in Spiritual awareness", required: false, sectionId: S_SCALE },
    { key: "scale_confidence_inner_strength", type: "scale", label: "Improvement in Confidence / inner strength", required: false, sectionId: S_SCALE },
    { key: "scale_energy_levels", type: "scale", label: "Improvement in Energy levels", required: false, sectionId: S_SCALE },

    // Overall selection
    {
      key: "overall_impact_rating",
      type: "radio",
      label: "Overall, how would you rate the impact of Rudraksha in your life so far?",
      required: false,
      sectionId: S_OVERALL,
      options: radioOptions([
        { value: "transformational", label: "Transformational" },
        { value: "clearly_noticeable", label: "Clearly noticeable" },
        { value: "slightly_noticeable", label: "Slightly noticeable" },
        { value: "no_change", label: "No noticeable change yet" },
      ]),
    },
    {
      key: "prana_pratistha_performed",
      type: "radio",
      label: "Was Prana Pratistha Puja (Vedic Energization) Performed on your Rudraksha prior to use?",
      required: false,
      sectionId: S_OVERALL,
      options: radioOptions([
        { value: "yes_by_nepa", label: "Yes (by Nepa Rudraksha)" },
        { value: "yes_self_other", label: "Yes (self / other method)" },
        { value: "no", label: "No" },
        { value: "not_sure", label: "Not sure" },
      ]),
    },
    {
      key: "astrology_consultation_used",
      type: "radio",
      label: "Was Astrology and Rudraksha Consultation used as part of your Rudraksha Selection?",
      required: false,
      sectionId: S_OVERALL,
      options: radioOptions([
        { value: "yes_nepa_expert", label: "Yes (by Nepa Rudraksha Expert)" },
        { value: "yes_sukritya", label: "Yes ( Consulted with Sukritya Khatiwada)" },
        { value: "yes_self_other_astrologer", label: "Yes (Self/Other Astrologer or Expert)" },
        { value: "no", label: "No" },
      ]),
    },
    {
      key: "rudraksha_size_known",
      type: "radio",
      label: "Do you know the size of your Rudraksha?",
      required: false,
      sectionId: S_OVERALL,
      options: radioOptions([
        { value: "small", label: "Small (Regular)" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large (Collector)" },
        { value: "super_collector", label: "Super Collector" },
        { value: "mixed", label: "Mixed Sizes" },
        { value: "not_sure", label: "Not sure" },
      ]),
    },
    {
      key: "height_optional",
      type: "text",
      label: "Optional: What is Your height? (Please specify cm or ft)",
      required: false,
      sectionId: S_OVERALL,
    },
    {
      key: "one_sentence_impact",
      type: "textarea",
      label: "In one sentence, how has Rudraksha impacted your life?",
      required: true,
      sectionId: S_OVERALL,
    },

    // Feedback
    {
      key: "feedback_anonymously_help_others",
      type: "radio",
      label: "Can we use your feedback (anonymously) to help others?",
      required: true,
      sectionId: S_FEEDBACK,
      options: radioOptions([
        { value: "yes_anonymous", label: "Yes" },
        { value: "yes_with_name", label: "Yes, with my name" },
        { value: "no", label: "No" },
      ]),
    },
    {
      key: "virtual_event_interest",
      type: "radio",
      label: "Would you be interested in Speaking in a Virtual Rudraksha Event to share your experience?",
      required: true,
      sectionId: S_FEEDBACK,
      options: radioOptions([
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
        otherOptionColon(),
      ]),
    },
    {
      key: "feedback_for_nepa",
      type: "textarea",
      label: "Do you have Feedback for Nepa Rudraksha?",
      required: false,
      sectionId: S_FEEDBACK,
    },
    {
      key: "expert_reachout",
      type: "radio",
      label: "Do you want a Nepa Rudraksha Expert to reach out to you for any assistance?",
      required: false,
      sectionId: S_FEEDBACK,
      options: radioOptions([
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]),
    },
  ];

  // Insert fields
  let displayOrder = 0;
  for (const f of fields) {
    await pool.execute(
      `INSERT INTO form_fields
        (form_id, section_id, field_key, field_type, label, placeholder, required, options, validation_rules, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        formId,
        f.sectionId,
        f.key,
        f.type,
        f.label,
        null,
        f.required ? 1 : 0,
        f.options ? JSON.stringify(f.options) : null,
        displayOrder,
      ]
    );
    displayOrder++;
  }

  // 4) Recreate response columns using current form_fields definitions
  execSync(`node db/create_response_tables.js`, {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  console.log(`✓ Clean rebuilt ${formSlug} (form_id=${formId})`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e);
    try {
      await pool.end();
    } catch {}
    process.exit(1);
  });

