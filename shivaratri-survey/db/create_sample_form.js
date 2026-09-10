// Creates (or rebuilds) the "Sample - All Field Types" test form.
//
//   node db/create_sample_form.js
//
// The form exercises every supported field type, including the photo/video
// upload fields, sections, an "Other:" free-text option, and unique-submission
// enforcement. Re-running it wipes and recreates the form from scratch, so it
// is safe to use as a scratch form while testing.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const FORM_SLUG = "sample-all-fields";

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

function options(list) {
  return list.map((x) =>
    typeof x === "string" ? { value: x, label: x } : { value: x.value, label: x.label }
  );
}

// Both value and label read as "Other", which is what the server's
// "Other" detection looks for.
const OTHER = { value: "other", label: "Other:" };

const SECTIONS = [
  {
    key: "about",
    title: "About You",
    description: "Basic contact details. Email is set as the unique field, so the same address cannot submit twice.",
  },
  {
    key: "preferences",
    title: "Your Preferences",
    description: "Covers dropdown, radio, checkbox and scale inputs, including free-text \"Other\" options.",
  },
  {
    key: "media",
    title: "Photos & Videos",
    description: "Photos are resized automatically. Each file can be up to 25 MB.",
  },
  {
    key: "wrapup",
    title: "Anything Else",
    description: null,
  },
];

const FIELDS = [
  // --- About You ---
  { section: "about", key: "full_name", type: "text", label: "Full Name", placeholder: "Your full name", required: true },
  { section: "about", key: "email", type: "email", label: "Email Address", placeholder: "you@example.com", required: true },
  { section: "about", key: "mobile_number", type: "phone", label: "Mobile Number", placeholder: "+977 98XXXXXXXX", required: false },
  { section: "about", key: "age", type: "number", label: "Age", placeholder: "e.g. 32", required: false },
  { section: "about", key: "date_of_visit", type: "date", label: "Preferred Visit Date", required: false },

  // --- Preferences ---
  {
    section: "preferences",
    key: "city",
    type: "dropdown",
    label: "Which city are you in?",
    required: true,
    options: options(["Kathmandu", "Pokhara", "Bangalore", "Delhi"]),
  },
  {
    section: "preferences",
    key: "how_did_you_hear",
    type: "radio",
    label: "How did you hear about us?",
    required: true,
    options: options(["Instagram", "YouTube", "Friend or family", OTHER]),
  },
  {
    section: "preferences",
    key: "interests",
    type: "checkbox",
    label: "What are you interested in? (select all that apply)",
    required: false,
    options: options(["Rudraksha consultation", "Live darshan", "Workshops", "Book launch", OTHER]),
  },
  {
    section: "preferences",
    key: "satisfaction",
    type: "scale",
    label: "How likely are you to recommend us? (0 = not at all, 10 = extremely likely)",
    required: false,
  },

  // --- Photos & Videos ---
  {
    section: "media",
    key: "profile_photo",
    type: "file",
    label: "Upload your photo",
    placeholder: "A clear photo of yourself",
    required: false,
    validation_rules: { accept: "image", max_files: 1 },
  },
  {
    section: "media",
    key: "rudraksha_photos",
    type: "file",
    label: "Photos of your Rudraksha (up to 3)",
    required: false,
    validation_rules: { accept: "image", max_files: 3 },
  },
  {
    section: "media",
    key: "experience_video",
    type: "file",
    label: "Short video sharing your experience",
    placeholder: "Under a minute is perfect",
    required: false,
    validation_rules: { accept: "video", max_files: 1 },
  },
  {
    section: "media",
    key: "extra_media",
    type: "file",
    label: "Anything else you'd like to share (photos or videos, up to 5)",
    required: false,
    validation_rules: { accept: "both", max_files: 5 },
  },

  // --- Wrap up ---
  { section: "wrapup", key: "biggest_question", type: "textarea", label: "What is your biggest question for us?", placeholder: "Type your question here", required: false },
  { section: "wrapup", key: "consent", type: "consent", label: "Consent", placeholder: "I agree to be contacted about my submission.", required: true },
];

function buildCreateTableSql(tableName, fields) {
  let sql = `CREATE TABLE \`${tableName}\` (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    edit_key VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    utm_source VARCHAR(120) NULL,
    utm_medium VARCHAR(120) NULL,
    utm_campaign VARCHAR(120) NULL,
    referrer VARCHAR(255) NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(255) NULL`;

  for (const field of fields) {
    let columnDef;
    switch (field.type) {
      case "textarea":
        columnDef = `\`${field.key}\` TEXT NULL`;
        break;
      case "number":
        columnDef = `\`${field.key}\` DECIMAL(20, 2) NULL`;
        break;
      case "date":
        columnDef = `\`${field.key}\` DATE NULL`;
        break;
      case "checkbox":
      case "file":
        columnDef = `\`${field.key}\` JSON NULL`;
        break;
      case "consent":
        columnDef = `\`${field.key}\` TINYINT(1) NULL DEFAULT 0`;
        break;
      default:
        columnDef = `\`${field.key}\` VARCHAR(255) NULL`;
    }
    sql += `,\n    ${columnDef}`;

    // Free-text companion column for fields that offer an "Other" option.
    const hasOther =
      ["radio", "checkbox"].includes(field.type) &&
      (field.options || []).some((o) => String(o.value).toLowerCase().replace(/[^a-z]/g, "") === "other");
    if (hasOther) {
      sql += `,\n    \`${field.key}_other_text\` VARCHAR(255) NULL`;
    }
  }

  sql += `,\n    INDEX idx_edit_key (edit_key),
    INDEX idx_created_at (created_at)
  )`;

  return sql;
}

async function main() {
  // 1) Remove any previous copy of the sample form, including its response table.
  const [existing] = await pool.execute("SELECT id FROM forms WHERE slug = ?", [FORM_SLUG]);
  for (const row of existing) {
    await pool.query(`DROP TABLE IF EXISTS \`form_responses_${row.id}\``);
    await pool.execute("DELETE FROM forms WHERE id = ?", [row.id]); // cascades to sections + fields
    fs.rmSync(path.join(__dirname, "..", "public", "uploads", `form_${row.id}`), {
      recursive: true,
      force: true,
    });
    console.log(`Removed previous sample form (id=${row.id})`);
  }

  // 2) Create the form.
  const [formResult] = await pool.execute(
    `INSERT INTO forms (title, description, slug, show_on_homepage, status, unique_submission_enabled, unique_field_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      "Sample - All Field Types",
      "<p>A test form covering every field type, including <strong>photo and video uploads</strong>. Use it to check the whole flow: submit, edit, admin responses, CSV export and the report.</p>",
      FORM_SLUG,
      1,
      "published",
      1,
      "email",
    ]
  );
  const formId = formResult.insertId;

  // 3) Sections.
  const sectionIds = {};
  for (let i = 0; i < SECTIONS.length; i++) {
    const section = SECTIONS[i];
    const [result] = await pool.execute(
      `INSERT INTO form_sections (form_id, title, description, display_order) VALUES (?, ?, ?, ?)`,
      [formId, section.title, section.description, i]
    );
    sectionIds[section.key] = result.insertId;
  }

  // 4) Fields.
  for (let i = 0; i < FIELDS.length; i++) {
    const field = FIELDS[i];
    await pool.execute(
      `INSERT INTO form_fields
        (form_id, section_id, field_key, field_type, label, placeholder, required, options, validation_rules, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        formId,
        sectionIds[field.section],
        field.key,
        field.type,
        field.label,
        field.placeholder || null,
        field.required ? 1 : 0,
        field.options ? JSON.stringify(field.options) : null,
        field.validation_rules ? JSON.stringify(field.validation_rules) : null,
        i,
      ]
    );
  }

  // 5) Response table.
  const tableName = `form_responses_${formId}`;
  await pool.query(buildCreateTableSql(tableName, FIELDS));

  console.log(`\n✓ Sample form created (form_id=${formId})`);
  console.log(`  Public form : /forms/${FORM_SLUG}`);
  console.log(`  Admin edit  : /admin/forms/${formId}/edit`);
  console.log(`  Responses   : /admin/forms/${formId}/responses`);
  console.log(`  Report      : /admin/forms/${formId}/report`);
  console.log(`  Table       : ${tableName}`);
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
