// Copy all data directly from survey_responses to form_responses_1
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

async function copyData() {
  try {
    console.log("Copying data from survey_responses to form_responses_1...\n");

    const formId = 1;
    const tableName = `form_responses_${formId}`;

    // Check if form exists
    const [forms] = await pool.execute("SELECT * FROM forms WHERE id = ? LIMIT 1", [formId]);
    if (forms.length === 0) {
      console.log(`⚠ Form with ID ${formId} does not exist. Please create it first.`);
      return;
    }

    console.log(`✓ Found form: ${forms[0].title} (ID: ${formId})`);

    // Get all columns from survey_responses
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'survey_responses'
      ORDER BY ORDINAL_POSITION
    `);

    console.log(`\nFound ${columns.length} columns in survey_responses`);

    // Check if form_responses_1 exists
    const [tableExists] = await pool.query(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_name = ?
    `, [tableName]);

    if (tableExists[0].count > 0) {
      console.log(`\n⚠ Table ${tableName} already exists. Dropping it first...`);
      await pool.query(`DROP TABLE \`${tableName}\``);
      console.log(`✓ Dropped existing table`);
    }

    // Create table with same structure as survey_responses
    console.log(`\nCreating table ${tableName} with same structure as survey_responses...`);
    
    let createSql = `CREATE TABLE \`${tableName}\` (`;
    const columnDefs = [];

    for (const col of columns) {
      let colDef = `\`${col.COLUMN_NAME}\` ${col.COLUMN_TYPE}`;
      
      // Handle DEFAULT values
      if (col.COLUMN_DEFAULT !== null) {
        if (col.COLUMN_DEFAULT === 'CURRENT_TIMESTAMP' || col.COLUMN_DEFAULT.includes('CURRENT_TIMESTAMP')) {
          colDef += ` DEFAULT CURRENT_TIMESTAMP`;
        } else if (col.COLUMN_TYPE.includes('timestamp') && col.EXTRA && col.EXTRA.includes('on update')) {
          // Handle ON UPDATE CURRENT_TIMESTAMP
          colDef += ` DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`;
        } else if (col.COLUMN_DEFAULT !== 'NULL') {
          colDef += ` DEFAULT ${col.COLUMN_DEFAULT}`;
        }
      }
      
      // Handle NULL/NOT NULL
      if (col.IS_NULLABLE === 'NO' && col.COLUMN_NAME !== 'id') {
        // Keep NOT NULL for most columns, but make some nullable if needed
        if (!col.COLUMN_DEFAULT && col.EXTRA !== 'auto_increment' && !col.COLUMN_TYPE.includes('timestamp')) {
          colDef = colDef.replace(/NOT NULL/, 'NULL');
        }
      } else if (col.IS_NULLABLE === 'YES') {
        colDef += ' NULL';
      }
      
      // Handle EXTRA (auto_increment, on update, etc.)
      if (col.EXTRA) {
        if (col.EXTRA.includes('auto_increment')) {
          colDef += ' AUTO_INCREMENT';
        }
        if (col.EXTRA.includes('on update') && !colDef.includes('ON UPDATE')) {
          colDef += ' ON UPDATE CURRENT_TIMESTAMP';
        }
      }
      
      // Handle PRIMARY KEY
      if (col.COLUMN_NAME === 'id') {
        colDef += ' PRIMARY KEY';
      }
      
      columnDefs.push(colDef);
    }

    createSql += columnDefs.join(',\n    ') + '\n)';

    await pool.query(createSql);
    console.log(`✓ Created table ${tableName}`);

    // Copy all data from survey_responses
    console.log(`\nCopying data from survey_responses to ${tableName}...`);
    
    const columnNames = columns.map(c => `\`${c.COLUMN_NAME}\``).join(', ');
    const [result] = await pool.query(`
      INSERT INTO \`${tableName}\` (${columnNames})
      SELECT ${columnNames}
      FROM survey_responses
    `);

    console.log(`✓ Copied ${result.affectedRows} rows`);

    // Verify the copy
    const [count] = await pool.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
    const [originalCount] = await pool.query(`SELECT COUNT(*) as count FROM survey_responses`);
    
    console.log(`\n✓ Verification:`);
    console.log(`  - Original survey_responses: ${originalCount[0].count} rows`);
    console.log(`  - Copied to ${tableName}: ${count[0].count} rows`);

    if (count[0].count === originalCount[0].count) {
      console.log(`\n✅ Success! All data copied correctly.`);
    } else {
      console.log(`\n⚠ Warning: Row counts don't match!`);
    }

  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

copyData().catch(console.error);
