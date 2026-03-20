// Add 'scale' to form_fields.field_type ENUM (required for 0–10 scale fields)
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
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
    await pool.query(`
      ALTER TABLE form_fields
      MODIFY COLUMN field_type ENUM(
        'text', 'textarea', 'number', 'phone', 'email',
        'dropdown', 'radio', 'scale', 'checkbox',
        'date', 'file', 'consent'
      ) NOT NULL
    `);
    console.log("✓ form_fields.field_type now includes 'scale'");
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY" || e.errno === 1060) {
      console.log("(no change needed)", e.message);
    } else {
      console.error(e);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

migrate();
