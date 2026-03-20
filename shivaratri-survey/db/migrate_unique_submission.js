// One-time migration: add unique-submission settings columns to `forms`.
require("dotenv").config();
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
});

async function columnExists(columnName) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) as c
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'forms'
       AND column_name = ?`,
    [columnName]
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

async function main() {
  // Add: unique_submission_enabled
  if (!(await columnExists("unique_submission_enabled"))) {
    await pool.query(
      `ALTER TABLE forms
       ADD COLUMN unique_submission_enabled TINYINT(1) NOT NULL DEFAULT 0`
    );
    console.log("Added column forms.unique_submission_enabled");
  } else {
    console.log("Column forms.unique_submission_enabled already exists");
  }

  // Add: unique_field_key
  if (!(await columnExists("unique_field_key"))) {
    await pool.query(
      `ALTER TABLE forms
       ADD COLUMN unique_field_key VARCHAR(100) NULL`
    );
    console.log("Added column forms.unique_field_key");
  } else {
    console.log("Column forms.unique_field_key already exists");
  }
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (e) => {
    console.error("Migration failed:", e);
    try {
      await pool.end();
    } catch {}
    process.exit(1);
  });

