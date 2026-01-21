// Fix duplicate sections by keeping only the first one of each title per form
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

async function fixDuplicateSections() {
  try {
    console.log("Finding duplicate sections...");

    // Find forms with duplicate sections
    const [duplicates] = await pool.query(`
      SELECT form_id, title, COUNT(*) as count, GROUP_CONCAT(id ORDER BY id) as ids
      FROM form_sections
      GROUP BY form_id, title
      HAVING count > 1
    `);

    if (duplicates.length === 0) {
      console.log("No duplicate sections found!");
      return;
    }

    console.log(`Found ${duplicates.length} sets of duplicate sections`);

    for (const dup of duplicates) {
      const ids = dup.ids.split(',').map(id => parseInt(id, 10));
      const keepId = ids[0]; // Keep the first one
      const deleteIds = ids.slice(1); // Delete the rest

      console.log(`\nForm ${dup.form_id}, Section "${dup.title}":`);
      console.log(`  Keeping section ID: ${keepId}`);
      console.log(`  Deleting section IDs: ${deleteIds.join(', ')}`);

      // Update fields to point to the kept section
      for (const deleteId of deleteIds) {
        await pool.execute(
          `UPDATE form_fields SET section_id = ? WHERE section_id = ?`,
          [keepId, deleteId]
        );
      }

      // Delete duplicate sections
      const placeholders = deleteIds.map(() => '?').join(',');
      await pool.execute(
        `DELETE FROM form_sections WHERE id IN (${placeholders})`,
        deleteIds
      );

      console.log(`  ✓ Fixed duplicates for "${dup.title}"`);
    }

    console.log("\n✅ All duplicate sections have been fixed!");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

fixDuplicateSections().catch(console.error);
