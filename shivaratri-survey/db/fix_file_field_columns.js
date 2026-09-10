// Converts response columns for photo/video ("file") fields to JSON.
//
//   node db/fix_file_field_columns.js
//
// Needed for any file field whose response column was created before photo/video
// support existed - those came out as VARCHAR(255), which makes submissions fail
// with "Data too long for column ...". Safe to re-run: columns that are already
// JSON are left alone.
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

async function main() {
  const [fields] = await pool.query(
    "SELECT form_id, field_key FROM form_fields WHERE field_type = 'file' ORDER BY form_id, display_order"
  );

  if (!fields.length) {
    console.log("No photo/video fields found - nothing to do.");
    return;
  }

  let fixed = 0;
  let skipped = 0;

  for (const field of fields) {
    const tableName = `form_responses_${field.form_id}`;

    const [cols] = await pool.query(
      `SELECT DATA_TYPE FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [tableName, field.field_key]
    );

    if (!cols.length) {
      console.log(`- ${tableName}.${field.field_key}: column missing (form not saved yet), skipping`);
      continue;
    }

    if (String(cols[0].DATA_TYPE).toLowerCase() === "json") {
      skipped++;
      continue;
    }

    // Existing non-JSON values cannot be meaningful file lists, so blank them
    // out first; otherwise MySQL rejects the type change.
    await pool.query(`UPDATE \`${tableName}\` SET \`${field.field_key}\` = NULL`);
    await pool.query(`ALTER TABLE \`${tableName}\` MODIFY \`${field.field_key}\` JSON NULL`);

    console.log(`✓ ${tableName}.${field.field_key}: ${cols[0].DATA_TYPE} -> json`);
    fixed++;
  }

  console.log(`\nDone. ${fixed} column(s) converted, ${skipped} already correct.`);
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
