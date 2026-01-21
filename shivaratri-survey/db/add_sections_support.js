// Add sections support to existing forms
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

async function addSectionsSupport() {
  try {
    console.log("Adding sections support...");

    // Create form_sections table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS form_sections (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        form_id BIGINT UNSIGNED NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NULL,
        display_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
        INDEX idx_form_order (form_id, display_order)
      )
    `);
    console.log("✓ Created form_sections table");

    // Add section_id to form_fields if it doesn't exist
    try {
      await pool.query(`
        ALTER TABLE form_fields 
          ADD COLUMN section_id BIGINT UNSIGNED NULL AFTER form_id
      `);
      console.log("✓ Added section_id column to form_fields");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("⚠ section_id column already exists");
      } else {
        throw e;
      }
    }

    // Add index and foreign key
    try {
      await pool.query(`
        ALTER TABLE form_fields 
          ADD INDEX idx_section_id (section_id)
      `);
      console.log("✓ Added index on section_id");
    } catch (e) {
      if (e.code === 'ER_DUP_KEYNAME') {
        console.log("⚠ Index already exists");
      } else {
        throw e;
      }
    }

    try {
      await pool.query(`
        ALTER TABLE form_fields 
          ADD CONSTRAINT fk_field_section FOREIGN KEY (section_id) REFERENCES form_sections(id) ON DELETE SET NULL
      `);
      console.log("✓ Added foreign key constraint");
    } catch (e) {
      if (e.code === 'ER_DUP_KEYNAME' || e.code === 'ER_DUP_FIELDNAME') {
        console.log("⚠ Foreign key already exists");
      } else {
        throw e;
      }
    }

    console.log("\n✅ Sections support added successfully!");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

addSectionsSupport().catch(console.error);
