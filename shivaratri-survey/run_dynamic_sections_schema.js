require("dotenv").config();
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

async function runSchema() {
  console.log("Starting schema execution...");
  console.log("DB Config:", {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
  });

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    const sqlPath = path.join(__dirname, "db", "schema_dynamic_sections.sql");
    console.log("Reading SQL file from:", sqlPath);
    
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`SQL file not found at: ${sqlPath}`);
    }

    let sql = fs.readFileSync(sqlPath, "utf8");
    console.log("SQL file read successfully, length:", sql.length);
    
    // Remove comment lines (lines starting with --)
    sql = sql.split('\n')
      .map(line => {
        // Remove inline comments (-- at end of line)
        const commentIndex = line.indexOf('--');
        if (commentIndex >= 0) {
          // Check if it's not inside a string
          const beforeComment = line.substring(0, commentIndex);
          const quoteCount = (beforeComment.match(/'/g) || []).length;
          if (quoteCount % 2 === 0) {
            // Even number of quotes means comment is not inside string
            return beforeComment.trim();
          }
        }
        return line;
      })
      .filter(line => line.trim() && !line.trim().startsWith('--'))
      .join('\n');

    // Split by semicolon, but be smarter about it
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => {
        // Filter out empty statements and statements that are just whitespace/comments
        const cleaned = s.replace(/\s+/g, ' ');
        return cleaned.length > 0 && !cleaned.match(/^\s*$/);
      });

    console.log(`Found ${statements.length} SQL statements to execute`);

    // Execute all statements at once using multipleStatements
    console.log("Executing SQL statements...");
    try {
      await pool.query(sql);
      console.log("✓ All statements executed successfully");
    } catch (err) {
      // Some errors are expected (like table already exists)
      if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_DUP_KEY' || err.code === 'ER_TABLE_EXISTS_ERROR') {
        console.log("⚠ Some statements skipped (already exists):", err.message);
      } else {
        console.error("✗ Error executing SQL:", err.message);
        console.error("Error code:", err.code);
        throw err;
      }
    }

    console.log("\n✅ Schema executed successfully!");
    
    // Verify tables were created
    const [tables] = await pool.query("SHOW TABLES LIKE 'dynamic_sections'");
    if (tables.length > 0) {
      console.log("✓ 'dynamic_sections' table exists");
    } else {
      console.log("⚠ 'dynamic_sections' table not found");
    }

    const [navTables] = await pool.query("SHOW TABLES LIKE 'homepage_navigation'");
    if (navTables.length > 0) {
      console.log("✓ 'homepage_navigation' table exists");
    } else {
      console.log("⚠ 'homepage_navigation' table not found");
    }

  } catch (error) {
    console.error("\n❌ Error executing schema:", error);
    console.error("Stack:", error.stack);
    throw error;
  } finally {
    await pool.end();
  }
}

runSchema();
