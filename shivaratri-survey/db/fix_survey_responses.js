// Fix survey_responses table to make old columns nullable
require("dotenv").config();
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

async function fixSchema() {
  console.log("Fixing survey_responses table...");

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    const sqlPath = path.join(__dirname, "fix_survey_responses.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");

    console.log("Executing ALTER TABLE statements...");
    await pool.query(sql);
    
    console.log("✅ Successfully made old columns nullable!");
    console.log("Dynamic forms can now save data without populating old columns.");

  } catch (error) {
    // Some errors are expected (like column already nullable)
    if (error.code === 'ER_DUP_FIELDNAME' || error.message.includes('already')) {
      console.log("⚠ Some columns may already be nullable:", error.message);
    } else {
      console.error("❌ Error:", error.message);
      throw error;
    }
  } finally {
    await pool.end();
  }
}

fixSchema().catch(console.error);
