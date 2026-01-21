// Create response tables for all existing forms
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

function getFormResponseTableName(formId) {
  return `form_responses_${formId}`;
}

async function createFormResponseTable(formId, fields) {
  const tableName = getFormResponseTableName(formId);
  
  // Default columns that are always included
  let sql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
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

  // Add columns for each field
  for (const field of fields) {
    const fieldKey = field.field_key;
    let columnDef = "";

    switch (field.field_type) {
      case "text":
      case "phone":
      case "email":
        columnDef = `\`${fieldKey}\` VARCHAR(255) NULL`;
        break;
      case "textarea":
        columnDef = `\`${fieldKey}\` TEXT NULL`;
        break;
      case "number":
        columnDef = `\`${fieldKey}\` DECIMAL(20, 2) NULL`;
        break;
      case "date":
        columnDef = `\`${fieldKey}\` DATE NULL`;
        break;
      case "dropdown":
      case "radio":
        columnDef = `\`${fieldKey}\` VARCHAR(255) NULL`;
        break;
      case "checkbox":
        columnDef = `\`${fieldKey}\` JSON NULL`;
        break;
      case "consent":
        columnDef = `\`${fieldKey}\` TINYINT(1) NULL DEFAULT 0`;
        break;
      default:
        columnDef = `\`${fieldKey}\` VARCHAR(255) NULL`;
    }

    sql += `,\n    ${columnDef}`;
  }

  // Add indexes at the end
  sql += `,\n    INDEX idx_edit_key (edit_key),
    INDEX idx_created_at (created_at)
  )`;

  await pool.query(sql);
  console.log(`Created response table: ${tableName}`);
}

async function migrate() {
  try {
    console.log("Creating response tables for all forms...");

    // Get all forms
    const [forms] = await pool.execute("SELECT * FROM forms ORDER BY id");

    for (const form of forms) {
      console.log(`\nProcessing form: ${form.title} (ID: ${form.id})`);

      // Get fields for this form
      const [fields] = await pool.execute(
        "SELECT * FROM form_fields WHERE form_id = ? ORDER BY display_order",
        [form.id]
      );

      if (fields.length === 0) {
        console.log(`  ⚠ No fields found, skipping table creation`);
        continue;
      }

      // Check if table already exists
      const tableName = getFormResponseTableName(form.id);
      const [existing] = await pool.query(
        `SELECT COUNT(*) as count FROM information_schema.tables 
         WHERE table_schema = DATABASE() AND table_name = ?`,
        [tableName]
      );

      if (existing[0].count > 0) {
        console.log(`  ✓ Table ${tableName} already exists`);
        
        // Migrate existing data from survey_responses if any
        const [existingResponses] = await pool.execute(
          "SELECT * FROM survey_responses WHERE form_id = ?",
          [form.id]
        );

        if (existingResponses.length > 0) {
          console.log(`  Migrating ${existingResponses.length} responses from survey_responses...`);
          
          for (const response of existingResponses) {
            try {
              // Parse response_data
              let responseData = {};
              if (response.response_data) {
                try {
                  responseData = typeof response.response_data === "string" 
                    ? JSON.parse(response.response_data) 
                    : response.response_data;
                } catch {
                  responseData = {};
                }
              }

              // Build insert columns and values
              const columns = ["edit_key", "utm_source", "utm_medium", "utm_campaign", "referrer", "ip_address", "user_agent", "created_at", "updated_at"];
              const values = [
                response.edit_key || makeEditKey(),
                response.utm_source || null,
                response.utm_medium || null,
                response.utm_campaign || null,
                response.referrer || null,
                response.ip_address || null,
                response.user_agent || null,
                response.created_at || new Date(),
                response.updated_at || new Date(),
              ];

              // Add field values
              for (const field of fields) {
                const value = responseData[field.field_key];
                columns.push(`\`${field.field_key}\``);
                if (field.field_type === "checkbox") {
                  values.push(JSON.stringify(Array.isArray(value) ? value : []));
                } else {
                  values.push(value || null);
                }
              }

              const placeholders = columns.map(() => "?").join(", ");
              const insertSql = `INSERT INTO \`${tableName}\` (${columns.join(", ")}) VALUES (${placeholders})`;
              
              await pool.execute(insertSql, values);
            } catch (e) {
              console.log(`  ⚠ Error migrating response ${response.id}:`, e.message);
            }
          }
          console.log(`  ✓ Migration complete`);
        }
      } else {
        // Create new table
        await createFormResponseTable(form.id, fields);
        console.log(`  ✓ Created table ${tableName}`);
      }
    }

    console.log("\n✅ All response tables created/migrated successfully!");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

function makeEditKey() {
  const crypto = require("crypto");
  return crypto.randomBytes(16).toString("hex");
}

migrate().catch(console.error);
