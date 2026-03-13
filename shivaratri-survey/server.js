// server.js
require("dotenv").config();

const path = require("path");
const crypto = require("crypto");

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieSession = require("cookie-session");
const mysql = require("mysql2/promise");
const multer = require("multer");
const cors = require("cors");

const app = express();

// -------------------- App / Proxy --------------------
// Needed on Coolify / reverse proxies so IP + secure cookies behave correctly
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// CORS configuration for API endpoints
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow requests from nepalirudraksha.com and its subdomains
    const allowedPatterns = [
      /^https?:\/\/(www\.)?nepalirudraksha\.com$/,
      /^https?:\/\/.*\.nepalirudraksha\.com$/,
    ];
    
    if (allowedPatterns.some(pattern => pattern.test(origin))) {
      callback(null, true);
    } else {
      // For development/testing, allow all origins
      // In production, you may want to restrict this
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Multer for multipart/form-data (as fallback)
const upload = multer();
app.use(express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// -------------------- DB --------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 10),
  queueLimit: 0,
});

// -------------------- Session (Admin) --------------------
app.use(
  cookieSession({
    name: "nr_admin",
    keys: [process.env.SESSION_SECRET || "change_me_please"],
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // HTTPS only in prod
  })
);

// -------------------- Rate limiting --------------------
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many submissions. Please try again later.",
});

app.post("/submit", submitLimiter);
app.post("/update/:key", submitLimiter);
app.post("/forms/:slug/submit", submitLimiter);
app.post("/forms/:slug/update/:key", submitLimiter);

// -------------------- Helpers --------------------
function normalizeMobile(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
}

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

// IMPORTANT: Express query can turn values into arrays.
// This prevents mysql2 prepared-statement errors.
function pickOne(v) {
  return Array.isArray(v) ? v[0] : v;
}

function makeEditKey() {
  return crypto.randomBytes(16).toString("hex");
}

function getClientIp(req) {
  // with trust proxy, req.ip will be correct on Coolify too
  return (req.ip || "").slice(0, 45);
}

function safeEq(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect("/admin/login");
}

function buildWhereFromQuery(q) {
  const where = [];
  const params = [];

  const allowed = ["attending_interest", "feb14_timing", "wants_consultation", "discovered_from"];

  for (const key of allowed) {
    const val = pickOne(q[key]);
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      where.push(`${key} = ?`);
      params.push(String(val));
    }
  }

  const searchVal = pickOne(q.search);
  if (searchVal && String(searchVal).trim()) {
    const s = `%${String(searchVal).trim()}%`;
    where.push(`(full_name LIKE ? OR mobile_number LIKE ? OR email LIKE ?)`);
    params.push(s, s, s);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { whereSql, params };
}

function toCsvValue(v) {
  if (v === null || v === undefined) return '""';
  const s = String(v).replace(/"/g, '""');
  return `"${s}"`;
}

// -------------------- Human readable labels --------------------
const LABELS = {
  based_in_bangalore: {
    live: "Lives in Bangalore",
    travel: "Can travel to Bangalore",
    maybe: "Maybe (depends on dates)",
    no: "Not in Bangalore",
  },
  has_purchased: {
    wearing: "Purchased & wearing",
    not_wearing: "Purchased but not wearing",
    plan_to: "Planning to buy",
    no: "Never purchased",
  },
  attending_interest: {
    definitely: "Definitely attending",
    most_likely: "Most likely attending",
    maybe_dates: "Maybe (depends on dates)",
    not_now: "Not attending now",
  },
  feb14_timing: {
    sat_morning: "Saturday morning",
    sat_afternoon: "Saturday afternoon",
    sat_evening: "Saturday evening",
  },
  wants_consultation: { yes: "Yes", maybe: "Maybe", no: "No" },
  rudraksha_interest_type: {
    healing_spiritual: "Healing / Spiritual growth",
    planetary: "Planetary / Astrology",
    siddha: "Siddha Mala",
    rare: "Rare / Collector",
    family: "Family / Home",
    not_sure: "Not sure",
  },
  reserve_signed_book: { yes: "Yes", maybe: "Maybe", no: "No" },
  shaligram_darshan: { yes: "Yes", maybe: "Maybe", no: "No" },
  discovered_from: {
    instagram: "Instagram",
    youtube: "YouTube",
    word_of_mouth: "Word of mouth",
    event_talk: "Event / Talk",
    friend_family: "Friend / Family",
    other: "Other",
  },
};

function label(field, value) {
  if (value === null || value === undefined) return "";
  const map = LABELS[field];
  if (!map) return String(value);
  return map[String(value)] || String(value);
}

function parseEventInterests(v) {
  try {
    const arr = Array.isArray(v) ? v : JSON.parse(v || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// -------------------- Dynamic Form Helpers --------------------
function generateSlug(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getFormBySlug(slug) {
  const [rows] = await pool.execute(
    "SELECT * FROM forms WHERE slug = ? AND status = 'published' LIMIT 1",
    [slug]
  );
  return rows[0] || null;
}

async function getFormFields(formId) {
  const [rows] = await pool.execute(
    "SELECT * FROM form_fields WHERE form_id = ? ORDER BY section_id ASC, display_order ASC",
    [formId]
  );
  return rows;
}

async function getFormSections(formId) {
  const [rows] = await pool.execute(
    "SELECT * FROM form_sections WHERE form_id = ? ORDER BY display_order ASC",
    [formId]
  );
  return rows;
}

async function getFormFieldsBySection(formId) {
  const sections = await getFormSections(formId);
  const fields = await getFormFields(formId);
  
  // Group fields by section
  const fieldsBySection = {};
  const fieldsWithoutSection = [];
  
  for (const field of fields) {
    if (field.section_id) {
      if (!fieldsBySection[field.section_id]) {
        fieldsBySection[field.section_id] = [];
      }
      fieldsBySection[field.section_id].push(field);
    } else {
      fieldsWithoutSection.push(field);
    }
  }
  
  return { sections, fieldsBySection, fieldsWithoutSection };
}

// -------------------- Dynamic Sections Helpers --------------------
async function getDynamicSections(pageType, formId = null) {
  let query = "SELECT * FROM dynamic_sections WHERE page_type = ? AND is_active = 1";
  const params = [pageType];
  
  if (pageType === 'form' && formId) {
    query += " AND form_id = ?";
    params.push(formId);
  } else if (pageType === 'homepage') {
    query += " AND form_id IS NULL";
  } else if (pageType === 'success' && formId) {
    query += " AND form_id = ?";
    params.push(formId);
  } else if (pageType === 'success') {
    query += " AND form_id IS NULL";
  }
  
  query += " ORDER BY display_order ASC";
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getHomepageNavigation() {
  const [rows] = await pool.execute(
    "SELECT * FROM homepage_navigation WHERE is_active = 1 ORDER BY display_order ASC"
  );
  return rows;
}

async function validateDynamicForm(body, fields) {
  const errors = {};
  const values = { ...body };

  for (const field of fields) {
    const fieldKey = field.field_key;
    let value = body[fieldKey];

    // Handle checkbox arrays
    if (field.field_type === "checkbox") {
      value = asArray(value);
      values[fieldKey] = value;
    } else if (field.field_type === "phone") {
      value = normalizeMobile(value);
      values[fieldKey] = value;
    } else {
      value = String(value || "").trim();
      values[fieldKey] = value;
    }

    // Required validation
    if (field.required) {
      if (field.field_type === "checkbox") {
        if (!value || value.length === 0) {
          errors[fieldKey] = `${field.label} is required.`;
        }
      } else {
        if (!value || value.length === 0) {
          errors[fieldKey] = `${field.label} is required.`;
        }
      }
    }

    // Type-specific validation
    if (value && value.length > 0) {
      if (field.field_type === "email") {
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        if (!ok) errors[fieldKey] = "Please enter a valid email address.";
      } else if (field.field_type === "number") {
        if (isNaN(value)) errors[fieldKey] = "Please enter a valid number.";
      } else if (field.field_type === "date") {
        if (isNaN(Date.parse(value))) errors[fieldKey] = "Please enter a valid date.";
      }
    }
  }

  return { errors, values };
}

function parseFieldOptions(options) {
  try {
    if (!options) return [];
    const parsed = typeof options === "string" ? JSON.parse(options) : options;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Get table name for form responses
function getFormResponseTableName(formId) {
  return `form_responses_${formId}`;
}

// Get response table name (alias for consistency)
function getResponseTableName(formId) {
  return getFormResponseTableName(formId);
}

// Create response table for a form
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
        // For single select, store as VARCHAR
        columnDef = `\`${fieldKey}\` VARCHAR(255) NULL`;
        break;
      case "checkbox":
        // For multi-select, store as JSON array
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

// Drop form response table
async function dropFormResponseTable(formId) {
  const tableName = getFormResponseTableName(formId);
  try {
    await pool.query(`DROP TABLE IF EXISTS \`${tableName}\``);
    console.log(`Dropped response table: ${tableName}`);
  } catch (e) {
    console.error(`Error dropping table ${tableName}:`, e);
  }
}

// -------------------- Validation --------------------
function validate(body) {
  const errors = {};
  const values = { ...body };

  values.full_name = String(values.full_name || "").trim();
  values.mobile_number = normalizeMobile(values.mobile_number);
  values.email = String(values.email || "").trim();

  // required
  if (!values.full_name) errors.full_name = "Full name is required.";
  if (!values.mobile_number) errors.mobile_number = "Mobile number is required.";

  // If you truly want email required, keep this:
  if (!values.email) errors.email = "Email is required.";
  if (values.email) {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email);
    if (!ok) errors.email = "Please enter a valid email address.";
  }

  if (!values.based_in_bangalore) errors.based_in_bangalore = "Please select one option.";
  if (!values.has_purchased) errors.has_purchased = "Please select one option.";
  if (!values.attending_interest) errors.attending_interest = "Please select one option.";
  if (!values.feb14_timing) errors.feb14_timing = "Please select one option.";
  if (!values.wants_consultation) errors.wants_consultation = "Please select one option.";
  if (!values.rudraksha_interest_type) errors.rudraksha_interest_type = "Please select one option.";
  if (!values.reserve_signed_book) errors.reserve_signed_book = "Please select one option.";
  if (!values.shaligram_darshan) errors.shaligram_darshan = "Please select one option.";

  if (!values.biggest_question || !String(values.biggest_question).trim()) {
    errors.biggest_question = "Please write your biggest question.";
  }

  if (!values.discovered_from) errors.discovered_from = "Please select one option.";

  values.event_interests = asArray(values.event_interests);
  values.wants_updates = values.wants_updates === "on" ? 1 : 0;

  return { errors, values };
}

// -------------------- Routes --------------------
// Homepage: Show forms with show_on_homepage = true
app.get("/", async (req, res) => {
  try {
    const [forms] = await pool.execute(
      "SELECT * FROM forms WHERE show_on_homepage = 1 AND status = 'published' ORDER BY created_at DESC"
    );
    const sections = await getDynamicSections('homepage');
    const navigation = await getHomepageNavigation();
    res.render("homepage", { forms, sections, navigation });
  } catch (e) {
    console.error(e);
    res.render("homepage", { forms: [], sections: [], navigation: [] });
  }
});

// Legacy route: Keep for backward compatibility (redirects to form if exists)
app.get("/survey", async (req, res) => {
  // Try to find a form with slug 'maha-shivaratri-2026' or redirect to homepage
  const form = await getFormBySlug("maha-shivaratri-2026");
  if (form) {
    return res.redirect(`/forms/${form.slug}`);
  }
  res.redirect("/");
});

// Dynamic form route
app.get("/forms/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  if (!slug) return res.status(404).render("404");

  const form = await getFormBySlug(slug);
  if (!form) {
    return res.status(404).render("form_not_found", { slug });
  }

  const { sections, fieldsBySection, fieldsWithoutSection } = await getFormFieldsBySection(form.id);
  const dynamicSections = await getDynamicSections('form', form.id);

  res.render("dynamic_form", {
    form,
    sections,
    fieldsBySection,
    fieldsWithoutSection,
    dynamicSections,
    errors: {},
    values: {},
    pageMode: "new",
    editKey: null,
  });
});

// Edit existing dynamic form response
app.get("/forms/:slug/edit/:key", async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  const key = String(req.params.key || "").trim();
  if (!slug || !key) return res.status(404).send("Not found");

  const form = await getFormBySlug(slug);
  if (!form) return res.status(404).send("Form not found");

  const tableName = getFormResponseTableName(form.id);
  const [rows] = await pool.execute(
    `SELECT * FROM \`${tableName}\` WHERE edit_key = ? LIMIT 1`,
    [key]
  );
  if (!rows.length) return res.status(404).send("Not found");

  const row = rows[0];
  const { sections, fieldsBySection, fieldsWithoutSection } = await getFormFieldsBySection(form.id);
  const dynamicSections = await getDynamicSections('form', form.id);
  
  // Extract values from row (excluding default columns)
  const defaultColumns = ["id", "edit_key", "created_at", "updated_at", "utm_source", "utm_medium", "utm_campaign", "referrer", "ip_address", "user_agent"];
  const values = {};
  const allFields = [...Object.values(fieldsBySection).flat(), ...fieldsWithoutSection];
  for (const field of allFields) {
    const value = row[field.field_key];
    if (field.field_type === "checkbox" && value) {
      try {
        values[field.field_key] = typeof value === "string" ? JSON.parse(value) : value;
      } catch {
        values[field.field_key] = [];
      }
    } else {
      values[field.field_key] = value || "";
    }
  }

  res.render("dynamic_form", {
    form,
    sections,
    fieldsBySection,
    fieldsWithoutSection,
    dynamicSections,
    errors: {},
    values,
    pageMode: "edit",
    editKey: row.edit_key,
  });
});

// Submit new dynamic form
app.post("/forms/:slug/submit", async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  if (!slug) return res.status(404).send("Form not found");

  const form = await getFormBySlug(slug);
  if (!form) return res.status(404).send("Form not found");

  const { sections, fieldsBySection, fieldsWithoutSection } = await getFormFieldsBySection(form.id);
  const allFields = [...Object.values(fieldsBySection).flat(), ...fieldsWithoutSection];
  const { errors, values } = await validateDynamicForm(req.body, allFields);

  if (Object.keys(errors).length) {
    return res.status(422).render("dynamic_form", {
      form,
      sections,
      fieldsBySection,
      fieldsWithoutSection,
      errors,
      values,
      pageMode: "new",
      editKey: null,
    });
  }

  const editKey = makeEditKey();
  const ip = getClientIp(req);
  const ua = String(req.headers["user-agent"] || "").slice(0, 255);

  const utm_source = (req.body.utm_source || "").slice(0, 120) || null;
  const utm_medium = (req.body.utm_medium || "").slice(0, 120) || null;
  const utm_campaign = (req.body.utm_campaign || "").slice(0, 120) || null;
  const referrer = (req.body.referrer || "").slice(0, 255) || null;

  // Insert into form-specific table
  const tableName = getFormResponseTableName(form.id);
  
  // Check if table exists, create if not
  try {
    const [tableCheck] = await pool.query(
      `SELECT COUNT(*) as count FROM information_schema.tables 
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName]
    );
    
    if (tableCheck[0].count === 0) {
      // Table doesn't exist, create it
      console.log(`Creating missing table: ${tableName}`);
      await createFormResponseTable(form.id, allFields);
    }
  } catch (e) {
    console.error("Error checking table:", e);
  }
  
  // Build column names and values
  const columns = ["edit_key", "utm_source", "utm_medium", "utm_campaign", "referrer", "ip_address", "user_agent"];
  const columnValues = [editKey, utm_source, utm_medium, utm_campaign, referrer, ip || null, ua || null];
  
  // Add form field columns
  for (const field of allFields) {
    const value = values[field.field_key];
    columns.push(`\`${field.field_key}\``);
    
    if (field.field_type === "checkbox") {
      // Store checkbox as JSON array
      columnValues.push(JSON.stringify(Array.isArray(value) ? value : []));
    } else {
      columnValues.push(value || null);
    }
  }

  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO \`${tableName}\` (${columns.join(", ")}) VALUES (${placeholders})`;

  try {
    await pool.execute(sql, columnValues);
  } catch (e) {
    console.error("Error inserting response:", e);
    return res.status(500).send("Server error");
  }

  // Get dynamic sections for success page
  const successSections = await getDynamicSections('success', form.id);
  
  return res.render("success", {
    editUrl: `/forms/${form.slug}/edit/${editKey}`,
    mobile_number: values.mobile_number || values.phone || "",
    sections: successSections,
    form: form,
  });
});

// Update existing dynamic form response
app.post("/forms/:slug/update/:key", async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  const key = String(req.params.key || "").trim();
  if (!slug || !key) return res.status(404).send("Not found");

  const form = await getFormBySlug(slug);
  if (!form) return res.status(404).send("Form not found");

  const tableName = getFormResponseTableName(form.id);
  const [rows] = await pool.execute(
    `SELECT id FROM \`${tableName}\` WHERE edit_key = ? LIMIT 1`,
    [key]
  );
  if (!rows.length) return res.status(404).send("Not found");

  const { sections, fieldsBySection, fieldsWithoutSection } = await getFormFieldsBySection(form.id);
  const allFields = [...Object.values(fieldsBySection).flat(), ...fieldsWithoutSection];
  const { errors, values } = await validateDynamicForm(req.body, allFields);

  if (Object.keys(errors).length) {
    return res.status(422).render("dynamic_form", {
      form,
      sections,
      fieldsBySection,
      fieldsWithoutSection,
      errors,
      values,
      pageMode: "edit",
      editKey: key,
    });
  }

  const ip = getClientIp(req);
  const ua = String(req.headers["user-agent"] || "").slice(0, 255);

  const utm_source = (req.body.utm_source || "").slice(0, 120) || null;
  const utm_medium = (req.body.utm_medium || "").slice(0, 120) || null;
  const utm_campaign = (req.body.utm_campaign || "").slice(0, 120) || null;
  const referrer = (req.body.referrer || "").slice(0, 255) || null;

  // Build UPDATE statement
  const updateColumns = ["utm_source", "utm_medium", "utm_campaign", "referrer", "ip_address", "user_agent"];
  const updateValues = [utm_source, utm_medium, utm_campaign, referrer, ip || null, ua || null];
  
  for (const field of allFields) {
    const value = values[field.field_key];
    updateColumns.push(`\`${field.field_key}\``);
    if (field.field_type === "checkbox") {
      updateValues.push(JSON.stringify(Array.isArray(value) ? value : []));
    } else {
      updateValues.push(value || null);
    }
  }

  updateValues.push(key); // for WHERE clause

  const setClause = updateColumns.map(col => `${col} = ?`).join(", ");
  const sql = `UPDATE \`${tableName}\` SET ${setClause} WHERE edit_key = ?`;

  try {
    await pool.execute(sql, updateValues);
  } catch (e) {
    console.error("Error updating response:", e);
    return res.status(500).send("Server error");
  }

  // Get dynamic sections for success page
  const successSections = await getDynamicSections('success', form.id);
  
  return res.render("success", {
    editUrl: `/forms/${form.slug}/edit/${key}`,
    mobile_number: values.mobile_number || values.phone || "",
    sections: successSections,
    form: form,
  });
});

// Edit existing
app.get("/edit/:key", async (req, res) => {
  const key = String(req.params.key || "").trim();
  if (!key) return res.status(404).send("Not found");

  const [rows] = await pool.execute("SELECT * FROM survey_responses WHERE edit_key = ? LIMIT 1", [key]);
  if (!rows.length) return res.status(404).send("Not found");

  const row = rows[0];
  const interests = parseEventInterests(row.event_interests);

  res.render("survey", {
    errors: {},
    values: {
      ...row,
      event_interests: interests,
      wants_updates: row.wants_updates ? "on" : "",
    },
    pageMode: "edit",
    editKey: row.edit_key,
  });
});

// Submit new
app.post("/submit", async (req, res) => {
  const { errors, values } = validate(req.body);

  if (Object.keys(errors).length) {
    return res.status(422).render("survey", {
      errors,
      values: { ...values, wants_updates: values.wants_updates ? "on" : "" },
      pageMode: "new",
      editKey: null,
    });
  }

  const mobile = values.mobile_number;

  // Duplicate check (unique per mobile)
  const [existing] = await pool.execute(
    "SELECT id, edit_key FROM survey_responses WHERE mobile_number = ? LIMIT 1",
    [mobile]
  );

  if (existing.length) {
    return res.status(409).render("already_submitted", {
      mobile_number: mobile,
      existingEditKey: existing[0].edit_key || null,
    });
  }

  const editKey = makeEditKey();

  const ip = getClientIp(req);
  const ua = String(req.headers["user-agent"] || "").slice(0, 255);

  const utm_source = (req.body.utm_source || "").slice(0, 120) || null;
  const utm_medium = (req.body.utm_medium || "").slice(0, 120) || null;
  const utm_campaign = (req.body.utm_campaign || "").slice(0, 120) || null;
  const referrer = (req.body.referrer || "").slice(0, 255) || null;

  const sql = `
    INSERT INTO survey_responses (
      edit_key,
      full_name, mobile_number, email,
      based_in_bangalore,
      has_purchased, currently_wear,
      attending_interest, feb14_timing,
      event_interests,
      wants_consultation, rudraksha_interest_type,
      reserve_signed_book, shaligram_darshan,
      biggest_question,
      discovered_from, discovered_other,
      wants_updates,
      arrangement_notes,
      utm_source, utm_medium, utm_campaign,
      referrer,
      ip_address, user_agent
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `;

  const params = [
    editKey,
    values.full_name,
    mobile,
    values.email || null,
    values.based_in_bangalore,
    values.has_purchased,
    values.currently_wear || null,
    values.attending_interest,
    values.feb14_timing,
    JSON.stringify(values.event_interests || []),
    values.wants_consultation,
    values.rudraksha_interest_type,
    values.reserve_signed_book,
    values.shaligram_darshan,
    values.biggest_question,
    values.discovered_from,
    values.discovered_other || null,
    values.wants_updates,
    values.arrangement_notes || null,
    utm_source,
    utm_medium,
    utm_campaign,
    referrer,
    ip || null,
    ua || null,
  ];

  try {
    await pool.execute(sql, params);
  } catch (e) {
    if (String(e.code) === "ER_DUP_ENTRY") {
      return res.status(409).render("already_submitted", {
        mobile_number: mobile,
        existingEditKey: null,
      });
    }
    console.error(e);
    return res.status(500).send("Server error");
  }

  // Get dynamic sections for success page (legacy form - no form_id)
  const successSections = await getDynamicSections('success', null);
  
  return res.render("success", {
    editUrl: `/edit/${editKey}`,
    mobile_number: mobile,
    sections: successSections,
    form: null,
  });
});

// Update existing
app.post("/update/:key", async (req, res) => {
  const key = String(req.params.key || "").trim();
  if (!key) return res.status(404).send("Not found");

  const [rows] = await pool.execute("SELECT id FROM survey_responses WHERE edit_key = ? LIMIT 1", [key]);
  if (!rows.length) return res.status(404).send("Not found");

  const { errors, values } = validate(req.body);
  if (Object.keys(errors).length) {
    return res.status(422).render("survey", {
      errors,
      values: { ...values, wants_updates: values.wants_updates ? "on" : "" },
      pageMode: "edit",
      editKey: key,
    });
  }

  const ip = getClientIp(req);
  const ua = String(req.headers["user-agent"] || "").slice(0, 255);

  const utm_source = (req.body.utm_source || "").slice(0, 120) || null;
  const utm_medium = (req.body.utm_medium || "").slice(0, 120) || null;
  const utm_campaign = (req.body.utm_campaign || "").slice(0, 120) || null;
  const referrer = (req.body.referrer || "").slice(0, 255) || null;

  const updateSql = `
    UPDATE survey_responses SET
      full_name=?,
      mobile_number=?,
      email=?,
      based_in_bangalore=?,
      has_purchased=?,
      currently_wear=?,
      attending_interest=?,
      feb14_timing=?,
      event_interests=?,
      wants_consultation=?,
      rudraksha_interest_type=?,
      reserve_signed_book=?,
      shaligram_darshan=?,
      biggest_question=?,
      discovered_from=?,
      discovered_other=?,
      wants_updates=?,
      arrangement_notes=?,
      utm_source=?,
      utm_medium=?,
      utm_campaign=?,
      referrer=?,
      ip_address=?,
      user_agent=?
    WHERE edit_key=?
  `;

  const updateParams = [
    values.full_name,
    normalizeMobile(values.mobile_number),
    values.email || null,
    values.based_in_bangalore,
    values.has_purchased,
    values.currently_wear || null,
    values.attending_interest,
    values.feb14_timing,
    JSON.stringify(values.event_interests || []),
    values.wants_consultation,
    values.rudraksha_interest_type,
    values.reserve_signed_book,
    values.shaligram_darshan,
    values.biggest_question,
    values.discovered_from,
    values.discovered_other || null,
    values.wants_updates,
    values.arrangement_notes || null,
    utm_source,
    utm_medium,
    utm_campaign,
    referrer,
    ip || null,
    ua || null,
    key,
  ];

  try {
    await pool.execute(updateSql, updateParams);
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server error");
  }

  // Get dynamic sections for success page (legacy form - no form_id)
  const successSections = await getDynamicSections('success', null);
  
  return res.render("success", {
    editUrl: `/edit/${key}`,
    mobile_number: normalizeMobile(values.mobile_number),
    sections: successSections,
    form: null,
  });
});

// -------------------- Admin (Login) --------------------
const adminUser = process.env.ADMIN_USER || "admin";
const adminPass = process.env.ADMIN_PASS || "change_me";

app.get("/admin/login", (req, res) => {
  res.render("admin_login", { error: null });
});

app.post("/admin/login", (req, res) => {
  const u = String(req.body.username || "");
  const p = String(req.body.password || "");

  if (safeEq(u, adminUser) && safeEq(p, adminPass)) {
    req.session.isAdmin = true;
    return res.redirect("/admin");
  }

  return res.status(401).render("admin_login", { error: "Invalid username or password." });
});

app.post("/admin/logout", (req, res) => {
  req.session = null;
  res.redirect("/admin/login");
});

// Admin Dashboard
app.get("/admin", requireAdmin, async (req, res) => {
  try {
    // Get stats
    const [forms] = await pool.execute("SELECT * FROM forms ORDER BY created_at DESC");
    const totalForms = forms.length;
    const publishedForms = forms.filter(f => f.status === 'published').length;
    const draftForms = forms.filter(f => f.status === 'draft').length;

    // Get total responses across all forms
    let totalResponses = 0;
    let last7Days = 0;
    
    for (const form of forms) {
      const tableName = getFormResponseTableName(form.id);
      try {
        const [countRows] = await pool.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
        const [recentRows] = await pool.query(
          `SELECT COUNT(*) as count FROM \`${tableName}\` WHERE created_at >= (NOW() - INTERVAL 7 DAY)`
        );
        totalResponses += countRows[0]?.count || 0;
        last7Days += recentRows[0]?.count || 0;
      } catch (e) {
        // Table doesn't exist yet
      }
    }

    // Also count legacy survey_responses
    try {
      const [legacyCount] = await pool.query("SELECT COUNT(*) as count FROM survey_responses");
      const [legacyRecent] = await pool.query(
        "SELECT COUNT(*) as count FROM survey_responses WHERE created_at >= (NOW() - INTERVAL 7 DAY)"
      );
      totalResponses += legacyCount[0]?.count || 0;
      last7Days += legacyRecent[0]?.count || 0;
    } catch (e) {
      // Table might not exist
    }

    // Get response counts for each form
    const formsWithCounts = await Promise.all(forms.map(async (form) => {
      const tableName = getFormResponseTableName(form.id);
      try {
        const [countRows] = await pool.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
        form.response_count = countRows[0]?.count || 0;
      } catch (e) {
        form.response_count = 0;
      }
      return form;
    }));

    res.render("admin_dashboard", {
      stats: {
        totalForms,
        publishedForms,
        draftForms,
        totalResponses,
        last7Days,
      },
      recentForms: formsWithCounts,
    });
  } catch (e) {
    console.error("Error loading dashboard:", e);
    res.status(500).send("Server error");
  }
});

// -------------------- Admin: Form Management --------------------
// List all forms
app.get("/admin/forms", requireAdmin, async (req, res) => {
  try {
    const [forms] = await pool.execute(
      "SELECT * FROM forms ORDER BY created_at DESC"
    );
    
    // Get response count for each form from their specific tables
    for (const form of forms) {
      const tableName = getFormResponseTableName(form.id);
      try {
        const [countRows] = await pool.execute(
          `SELECT COUNT(*) as count FROM \`${tableName}\``
        );
        form.response_count = countRows[0]?.count || 0;
      } catch (e) {
        // Table doesn't exist yet
        form.response_count = 0;
      }
    }
    
    console.log(`Found ${forms.length} forms in database`);
    res.render("admin_forms_list", { forms });
  } catch (e) {
    console.error("Error fetching forms:", e);
    res.render("admin_forms_list", { forms: [] });
  }
});

// Create new form
app.get("/admin/forms/new", requireAdmin, (req, res) => {
  res.render("admin_form_edit", {
    form: null,
    sections: [],
    fieldsBySection: {},
    fieldsWithoutSection: [],
    mode: "create",
  });
});

// Edit form
app.get("/admin/forms/:id/edit", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(404).send("Not found");

  try {
    const [forms] = await pool.execute("SELECT * FROM forms WHERE id = ? LIMIT 1", [id]);
    if (!forms.length) return res.status(404).send("Form not found");

    const form = forms[0];
    const { sections, fieldsBySection, fieldsWithoutSection } = await getFormFieldsBySection(id);

    res.render("admin_form_edit", {
      form,
      sections,
      fieldsBySection,
      fieldsWithoutSection,
      mode: "edit",
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error");
  }
});

// Save form (create or update)
app.post("/admin/forms/save", requireAdmin, async (req, res) => {
  const formId = req.body.form_id && req.body.form_id !== "" ? parseInt(req.body.form_id, 10) : null;
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const slug = String(req.body.slug || "").trim() || generateSlug(title);
  const showOnHomepage = req.body.show_on_homepage === "on" ? 1 : 0;
  const status = String(req.body.status || "draft");

  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  try {
    let form;
    if (formId && Number.isFinite(formId)) {
      // Update existing
      await pool.execute(
        "UPDATE forms SET title = ?, description = ?, slug = ?, show_on_homepage = ?, status = ? WHERE id = ?",
        [title, description, slug, showOnHomepage, status, formId]
      );
      form = { id: formId };
    } else {
      // Create new
      const [result] = await pool.execute(
        "INSERT INTO forms (title, description, slug, show_on_homepage, status) VALUES (?, ?, ?, ?, ?)",
        [title, description, slug, showOnHomepage, status]
      );
      form = { id: result.insertId };
    }

    // Save fields
    let fieldsData = [];
    try {
      fieldsData = typeof req.body.fields === "string" ? JSON.parse(req.body.fields) : (req.body.fields || []);
    } catch (e) {
      console.error("Error parsing fields:", e);
      fieldsData = [];
    }
    
    // Save sections first
    let sectionsData = [];
    try {
      sectionsData = typeof req.body.sections === "string" ? JSON.parse(req.body.sections) : (req.body.sections || []);
    } catch (e) {
      console.error("Error parsing sections:", e);
      sectionsData = [];
    }
    
    // Deduplicate sections by temp_id (in case of duplicates)
    const seenTempIds = new Set();
    sectionsData = sectionsData.filter(section => {
      if (!section.temp_id) return true; // Keep sections without temp_id
      if (seenTempIds.has(section.temp_id)) {
        console.warn(`Duplicate section temp_id detected: ${section.temp_id}, skipping`);
        return false;
      }
      seenTempIds.add(section.temp_id);
      return true;
    });
    
    // Delete existing sections and fields
    await pool.execute("DELETE FROM form_fields WHERE form_id = ?", [form.id]);
    await pool.execute("DELETE FROM form_sections WHERE form_id = ?", [form.id]);

    // Insert sections
    const sectionMap = {}; // Maps temp section IDs to real IDs
    for (let i = 0; i < sectionsData.length; i++) {
      const section = sectionsData[i];
      const sectionTitle = String(section.title || "").trim() || `Section ${i + 1}`;
      const sectionDescription = section.description ? String(section.description).trim() : null;
      
      const [sectionResult] = await pool.execute(
        `INSERT INTO form_sections (form_id, title, description, display_order)
         VALUES (?, ?, ?, ?)`,
        [
          form.id,
          sectionTitle,
          sectionDescription,
          i,
        ]
      );
      // Map temp ID to real ID
      if (section.temp_id) {
        sectionMap[section.temp_id] = sectionResult.insertId;
      }
    }

    // Insert fields
    const savedFields = [];
    for (let i = 0; i < fieldsData.length; i++) {
      const field = fieldsData[i];
      const sectionId = field.section_id && sectionMap[field.section_id] ? sectionMap[field.section_id] : null;
      
      await pool.execute(
        `INSERT INTO form_fields (form_id, section_id, field_key, field_type, label, placeholder, required, options, validation_rules, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          form.id,
          sectionId,
          field.field_key || `field_${i}`,
          field.field_type || "text",
          field.label || "",
          field.placeholder || null,
          field.required ? 1 : 0,
          field.options ? JSON.stringify(field.options) : null,
          field.validation_rules ? JSON.stringify(field.validation_rules) : null,
          i,
        ]
      );
      savedFields.push({
        ...field,
        field_key: field.field_key || `field_${i}`,
        field_type: field.field_type || "text",
      });
    }

    // Create or recreate the response table for this form
    if (!formId || !Number.isFinite(formId)) {
      // New form - create table
      await createFormResponseTable(form.id, savedFields);
    } else {
      // Existing form - check if table exists, if fields changed, recreate it
      const tableName = getFormResponseTableName(form.id);
      const [existingTable] = await pool.query(
        `SELECT COUNT(*) as count FROM information_schema.tables 
         WHERE table_schema = DATABASE() AND table_name = ?`,
        [tableName]
      );
      
      if (existingTable[0].count === 0) {
        // Table doesn't exist, create it
        await createFormResponseTable(form.id, savedFields);
      } else {
        // Table exists - check if we need to add new columns
        const [existingColumns] = await pool.query(
          `SELECT COLUMN_NAME FROM information_schema.columns 
           WHERE table_schema = DATABASE() AND table_name = ?`,
          [tableName]
        );
        const existingColumnNames = new Set(existingColumns.map(c => c.COLUMN_NAME));
        
        // Add missing columns
        for (const field of savedFields) {
          if (!existingColumnNames.has(field.field_key)) {
            let alterSql = "";
            switch (field.field_type) {
              case "text":
              case "phone":
              case "email":
                alterSql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${field.field_key}\` VARCHAR(255) NULL`;
                break;
              case "textarea":
                alterSql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${field.field_key}\` TEXT NULL`;
                break;
              case "number":
                alterSql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${field.field_key}\` DECIMAL(20, 2) NULL`;
                break;
              case "date":
                alterSql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${field.field_key}\` DATE NULL`;
                break;
              case "dropdown":
              case "radio":
                alterSql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${field.field_key}\` VARCHAR(255) NULL`;
                break;
              case "checkbox":
                alterSql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${field.field_key}\` JSON NULL`;
                break;
              case "consent":
                alterSql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${field.field_key}\` TINYINT(1) NULL DEFAULT 0`;
                break;
              default:
                alterSql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${field.field_key}\` VARCHAR(255) NULL`;
            }
            try {
              await pool.query(alterSql);
              console.log(`Added column ${field.field_key} to ${tableName}`);
            } catch (e) {
              console.error(`Error adding column ${field.field_key}:`, e.message);
            }
          }
        }
      }
    }

    res.json({ success: true, form_id: form.id });
  } catch (e) {
    console.error(e);
    if (e.code === "ER_DUP_ENTRY") {
      res.status(400).json({ error: "Slug already exists. Please choose a different one." });
    } else {
      res.status(500).json({ error: "Server error: " + e.message });
    }
  }
});

// Delete form
app.post("/admin/forms/:id/delete", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(404).json({ error: "Not found" });

  try {
    // Drop the form's response table
    await dropFormResponseTable(id);
    // Delete form and fields (cascade will handle fields)
    await pool.execute("DELETE FROM forms WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// View form responses
app.get("/admin/forms/:id/responses", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(404).send("Not found");

  const pageRaw = parseInt(pickOne(req.query.page), 10);
  const perRaw = parseInt(pickOne(req.query.per), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const perPage = Number.isFinite(perRaw) && perRaw > 0 ? Math.min(200, Math.max(10, perRaw)) : 50;
  const offset = (page - 1) * perPage;

  // Filter parameters
  const search = String(pickOne(req.query.search) || "").trim();
  const dateFrom = String(pickOne(req.query.date_from) || "").trim();
  const dateTo = String(pickOne(req.query.date_to) || "").trim();

  try {
    const [forms] = await pool.execute("SELECT * FROM forms WHERE id = ? LIMIT 1", [id]);
    if (!forms.length) return res.status(404).send("Form not found");

    const form = forms[0];
    const fields = await getFormFields(id);

    const tableName = getFormResponseTableName(id);
    
    // Build WHERE clause for filters
    let whereConditions = [];
    let whereParams = [];
    
    if (search) {
      // Search across all text fields
      const searchConditions = [];
      for (const field of fields) {
        if (["text", "email", "phone", "textarea"].includes(field.field_type)) {
          searchConditions.push(`\`${field.field_key}\` LIKE ?`);
          whereParams.push(`%${search}%`);
        }
      }
      if (searchConditions.length > 0) {
        whereConditions.push(`(${searchConditions.join(" OR ")})`);
      }
    }
    
    if (dateFrom) {
      whereConditions.push(`DATE(created_at) >= ?`);
      whereParams.push(dateFrom);
    }
    
    if (dateTo) {
      whereConditions.push(`DATE(created_at) <= ?`);
      whereParams.push(dateTo);
    }
    
    // Field-specific filters
    for (const field of fields) {
      if (["dropdown", "radio"].includes(field.field_type)) {
        const filterValue = String(pickOne(req.query[`filter_${field.field_key}`]) || "").trim();
        if (filterValue) {
          whereConditions.push(`\`${field.field_key}\` = ?`);
          whereParams.push(filterValue);
        }
      }
    }
    
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(" AND ")}` 
      : "";

    // Get total count with filters
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as c FROM \`${tableName}\` ${whereClause}`,
      whereParams
    );
    const total = countRows[0]?.c || 0;

    // Get filtered and paginated rows
    const [rows] = await pool.query(
      `SELECT * FROM \`${tableName}\` ${whereClause} ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${offset}`,
      whereParams
    );

    // Extract field values from rows
    const parsedRows = rows.map((row) => {
      const fieldData = {};
      for (const field of fields) {
        let value = row[field.field_key];
        if (field.field_type === "checkbox" && value) {
          try {
            value = typeof value === "string" ? JSON.parse(value) : value;
          } catch {
            value = [];
          }
        }
        fieldData[field.field_key] = value !== null && value !== undefined ? value : null;
      }
      return {
        ...row,
        response_data_parsed: fieldData,
      };
    });

    // Get unique values for filter dropdowns (for dropdown/radio fields)
    const filterOptions = {};
    for (const field of fields) {
      if (["dropdown", "radio"].includes(field.field_type)) {
        try {
          const [options] = await pool.query(
            `SELECT DISTINCT \`${field.field_key}\` as value, COUNT(*) as count
             FROM \`${tableName}\`
             WHERE \`${field.field_key}\` IS NOT NULL
             GROUP BY \`${field.field_key}\`
             ORDER BY count DESC
             LIMIT 50`
          );
          filterOptions[field.field_key] = options.map(o => o.value).filter(Boolean);
        } catch (e) {
          console.error(`Error getting filter options for ${field.field_key}:`, e);
          filterOptions[field.field_key] = [];
        }
      }
    }

    res.render("admin_form_responses", {
      form,
      fields,
      rows: parsedRows,
      page,
      perPage,
      total,
      search,
      dateFrom,
      dateTo,
      filterOptions,
      query: req.query,
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error");
  }
});

// Export form responses as CSV
app.get("/admin/forms/:id/responses.csv", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(404).send("Not found");

  try {
    const [forms] = await pool.execute("SELECT * FROM forms WHERE id = ? LIMIT 1", [id]);
    if (!forms.length) return res.status(404).send("Form not found");

    const form = forms[0];
    const fields = await getFormFields(id);

    const tableName = getFormResponseTableName(id);
    const [rows] = await pool.execute(
      `SELECT * FROM \`${tableName}\` ORDER BY created_at DESC`
    );

    // Build CSV headers - default columns first, then form fields
    const headers = ["id", "created_at", "edit_key", "utm_source", "utm_medium", "utm_campaign", "referrer", "ip_address", "user_agent", "updated_at"];
    fields.forEach((field) => {
      headers.push(field.field_key);
    });

    const lines = [];
    lines.push(headers.map(toCsvValue).join(","));

    for (const row of rows) {
      const csvRow = [
        row.id,
        row.created_at,
        row.edit_key || "",
        row.utm_source || "",
        row.utm_medium || "",
        row.utm_campaign || "",
        row.referrer || "",
        row.ip_address || "",
        row.user_agent || "",
        row.updated_at || "",
      ];

      fields.forEach((field) => {
        let value = row[field.field_key];
        if (field.field_type === "checkbox" && value) {
          try {
            const arr = typeof value === "string" ? JSON.parse(value) : value;
            csvRow.push(Array.isArray(arr) ? arr.join(" | ") : "");
          } catch {
            csvRow.push("");
          }
        } else {
          csvRow.push(value || "");
        }
      });

      lines.push(csvRow.map(toCsvValue).join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=form_${form.slug}_responses.csv`);
    res.send(lines.join("\n"));
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error");
  }
});

// -------------------- Admin: Responses (FULL TABLE) --------------------
app.get("/admin/responses", requireAdmin, async (req, res) => {
  const pageRaw = parseInt(pickOne(req.query.page), 10);
  const perRaw = parseInt(pickOne(req.query.per), 10);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const perPage = Number.isFinite(perRaw) && perRaw > 0 ? Math.min(200, Math.max(10, perRaw)) : 50;

  const offset = (page - 1) * perPage;

  const { whereSql, params } = buildWhereFromQuery(req.query);

  // Build querystring for pagination + CSV
  const qClean = { ...req.query };
  delete qClean.page;
  const qs = new URLSearchParams(
    Object.entries(qClean).reduce((acc, [k, v]) => {
      const vv = pickOne(v);
      if (vv !== undefined && vv !== null && String(vv).trim() !== "") acc[k] = String(vv);
      return acc;
    }, {})
  ).toString();

  // Use pool.query instead of pool.execute to avoid stmt_execute issues
  const [countRows] = await pool.query(`SELECT COUNT(*) as c FROM survey_responses ${whereSql}`, params);
  const total = countRows[0]?.c || 0;

  const [rowsRaw] = await pool.query(
    `
      SELECT
        id,
        full_name, mobile_number, email,
        based_in_bangalore,
        has_purchased, currently_wear,
        attending_interest, feb14_timing,
        event_interests,
        wants_consultation, rudraksha_interest_type,
        reserve_signed_book, shaligram_darshan,
        biggest_question,
        discovered_from, discovered_other,
        wants_updates,
        arrangement_notes,
        utm_source, utm_medium, utm_campaign,
        referrer,
        ip_address, user_agent,
        created_at
      FROM survey_responses
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    [...params, perPage, offset]
  );

  const rows = rowsRaw.map((r) => {
    const interests = parseEventInterests(r.event_interests);

    return {
      ...r,
      event_interests_list: interests,
      event_interests_text: interests.join(", "),
      based_in_bangalore_label: label("based_in_bangalore", r.based_in_bangalore),
      has_purchased_label: label("has_purchased", r.has_purchased),
      attending_interest_label: label("attending_interest", r.attending_interest),
      feb14_timing_label: label("feb14_timing", r.feb14_timing),
      wants_consultation_label: label("wants_consultation", r.wants_consultation),
      rudraksha_interest_type_label: label("rudraksha_interest_type", r.rudraksha_interest_type),
      reserve_signed_book_label: label("reserve_signed_book", r.reserve_signed_book),
      shaligram_darshan_label: label("shaligram_darshan", r.shaligram_darshan),
      discovered_from_label: label("discovered_from", r.discovered_from),
      wants_updates_label: r.wants_updates ? "Yes" : "No",
      discovered_display:
        r.discovered_from === "other" && r.discovered_other
          ? `Other: ${r.discovered_other}`
          : label("discovered_from", r.discovered_from),
    };
  });

  res.render("admin_responses", {
    rows,
    q: req.query,
    qs,
    page,
    perPage,
    total,
  });
});

// -------------------- Admin CSV Export --------------------
app.get("/admin/responses.csv", requireAdmin, async (req, res) => {
  const { whereSql, params } = buildWhereFromQuery(req.query);

  const [rows] = await pool.query(
    `
      SELECT
        id,
        full_name, mobile_number, email,
        based_in_bangalore,
        has_purchased, currently_wear,
        attending_interest, feb14_timing,
        event_interests,
        wants_consultation, rudraksha_interest_type,
        reserve_signed_book, shaligram_darshan,
        biggest_question,
        discovered_from, discovered_other,
        wants_updates,
        arrangement_notes,
        utm_source, utm_medium, utm_campaign,
        referrer,
        ip_address, user_agent,
        created_at
      FROM survey_responses
      ${whereSql}
      ORDER BY created_at DESC
    `,
    params
  );

  // Friendly headers
  const headers = [
    "id",
    "full_name",
    "mobile_number",
    "email",
    "based_in_bangalore",
    "has_purchased",
    "currently_wear",
    "attending_interest",
    "feb14_timing",
    "event_interests",
    "wants_consultation",
    "rudraksha_interest_type",
    "reserve_signed_book",
    "shaligram_darshan",
    "biggest_question",
    "discovered_from",
    "discovered_other",
    "wants_updates",
    "arrangement_notes",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "referrer",
    "ip_address",
    "user_agent",
    "created_at",
  ];

  const lines = [];
  lines.push(headers.map(toCsvValue).join(","));

  for (const r of rows) {
    const interests = parseEventInterests(r.event_interests).join(" | ");
    const row = headers.map((h) => {
      let v = r[h];

      if (h === "event_interests") v = interests;

      // You can export human labels instead of raw codes:
      if (h === "based_in_bangalore") v = label("based_in_bangalore", r.based_in_bangalore);
      if (h === "has_purchased") v = label("has_purchased", r.has_purchased);
      if (h === "attending_interest") v = label("attending_interest", r.attending_interest);
      if (h === "feb14_timing") v = label("feb14_timing", r.feb14_timing);
      if (h === "wants_consultation") v = label("wants_consultation", r.wants_consultation);
      if (h === "rudraksha_interest_type") v = label("rudraksha_interest_type", r.rudraksha_interest_type);
      if (h === "reserve_signed_book") v = label("reserve_signed_book", r.reserve_signed_book);
      if (h === "shaligram_darshan") v = label("shaligram_darshan", r.shaligram_darshan);
      if (h === "discovered_from") {
        v =
          r.discovered_from === "other" && r.discovered_other
            ? `Other: ${r.discovered_other}`
            : label("discovered_from", r.discovered_from);
      }
      if (h === "wants_updates") v = r.wants_updates ? "Yes" : "No";

      return toCsvValue(v);
    });

    lines.push(row.join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=survey_responses.csv");
  res.send(lines.join("\n"));
});


// -------------------- Admin: Report / Analytics (Dynamic) --------------------
app.get("/admin/forms/:id/report", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(404).send("Not found");

  try {
    const [forms] = await pool.execute("SELECT * FROM forms WHERE id = ? LIMIT 1", [id]);
    if (!forms.length) return res.status(404).send("Form not found");

    const form = forms[0];
    const fields = await getFormFields(id);
    const tableName = getFormResponseTableName(id);

    // Check if table exists
    const [tableCheck] = await pool.query(
      `SELECT COUNT(*) as count FROM information_schema.tables 
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName]
    );

    if (tableCheck[0].count === 0) {
      return res.status(404).send("No responses found for this form yet.");
    }

    // Date range filter
    const dateFrom = pickOne(req.query.date_from) || null;
    const dateTo = pickOne(req.query.date_to) || null;
    const daysRaw = parseInt(pickOne(req.query.days), 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(365, daysRaw) : 90;

    // Build WHERE clause for date filtering
    let dateWhereClause = "";
    const dateParams = [];
    if (dateFrom && dateTo) {
      dateWhereClause = "WHERE created_at >= ? AND created_at <= ?";
      dateParams.push(dateFrom + " 00:00:00", dateTo + " 23:59:59");
    } else if (dateFrom) {
      dateWhereClause = "WHERE created_at >= ?";
      dateParams.push(dateFrom + " 00:00:00");
    } else if (dateTo) {
      dateWhereClause = "WHERE created_at <= ?";
      dateParams.push(dateTo + " 23:59:59");
    }

    // Get totals
    const [totalsRows] = await pool.query(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN created_at >= (NOW() - INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS last_7_days,
        SUM(CASE WHEN created_at >= (NOW() - INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS last_30_days
      FROM \`${tableName}\` ${dateWhereClause}`,
      dateParams
    );

    const totals = totalsRows?.[0] || {};

    // Generic group counter for any field
    async function groupCount(fieldKey) {
      const field = fields.find(f => f.field_key === fieldKey);
      if (!field) return [];

      let whereClause = `WHERE \`${fieldKey}\` IS NOT NULL`;
      const queryParams = [...dateParams];
      if (dateWhereClause) {
        whereClause = dateWhereClause + ` AND \`${fieldKey}\` IS NOT NULL`;
      }

      const [rows] = await pool.query(
        `SELECT \`${fieldKey}\` AS k, COUNT(*) AS c
         FROM \`${tableName}\`
         ${whereClause}
         GROUP BY \`${fieldKey}\`
         ORDER BY c DESC
         LIMIT 20`,
        queryParams
      );

      return rows.map((r) => {
        let displayValue = r.k;
        // Handle checkbox (JSON arrays)
        if (field.field_type === "checkbox") {
          try {
            const arr = typeof r.k === "string" ? JSON.parse(r.k) : r.k;
            displayValue = Array.isArray(arr) ? arr.join(", ") : String(r.k);
          } catch {
            displayValue = String(r.k);
          }
        }
        return {
          key: r.k,
          label: displayValue,
          count: Number(r.c || 0),
        };
      });
    }

    // Get field statistics for dropdown/radio fields
    const fieldStats = {};
    for (const field of fields) {
      if (["dropdown", "radio", "checkbox"].includes(field.field_type)) {
        fieldStats[field.field_key] = await groupCount(field.field_key);
      }
    }

    // Daily trend (use date range if provided, otherwise last N days)
    let dailyWhereClause = "";
    let dailyParams = [];
    if (dateWhereClause) {
      dailyWhereClause = dateWhereClause;
      dailyParams = [...dateParams];
    } else {
      dailyWhereClause = "WHERE created_at >= (NOW() - INTERVAL ? DAY)";
      dailyParams = [days];
    }

    const [dailyRows] = await pool.query(
      `SELECT DATE(created_at) AS d, COUNT(*) AS c
       FROM \`${tableName}\`
       ${dailyWhereClause}
       GROUP BY DATE(created_at)
       ORDER BY d ASC`,
      dailyParams
    );

    const daily = dailyRows.map((r) => ({
      date: r.d,
      count: Number(r.c || 0),
    }));

    // KPI percentages
    const total = Number(totals.total || 0) || 0;
    const pct = (n) => (total ? Math.round((Number(n || 0) / total) * 100) : 0);

    const kpis = {
      total,
      last_7_days: Number(totals.last_7_days || 0),
      last_30_days: Number(totals.last_30_days || 0),
      last_7_days_pct: pct(totals.last_7_days),
      last_30_days_pct: pct(totals.last_30_days),
    };

    res.render("admin_form_report", {
      form,
      fields,
      kpis,
      fieldStats,
      daily,
      days,
      dateFrom,
      dateTo,
    });
  } catch (e) {
    console.error("Error generating report:", e);
    res.status(500).send("Server error");
  }
});

// Legacy report route (for old survey_responses table)
app.get("/admin/report", requireAdmin, async (req, res) => {
  // optional: date range filter (default: last 90 days)
  const daysRaw = parseInt(pickOne(req.query.days), 10);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(365, daysRaw) : 90;

  // MySQL: last N days
  const [totalsRows] = await pool.query(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN wants_updates = 1 THEN 1 ELSE 0 END) AS updates_yes,
        SUM(CASE WHEN wants_updates = 0 THEN 1 ELSE 0 END) AS updates_no,
        SUM(CASE WHEN attending_interest = 'definitely' THEN 1 ELSE 0 END) AS definitely_count,
        SUM(CASE WHEN wants_consultation = 'yes' THEN 1 ELSE 0 END) AS consult_yes,
        SUM(CASE WHEN reserve_signed_book = 'yes' THEN 1 ELSE 0 END) AS signed_book_yes,
        SUM(CASE WHEN shaligram_darshan = 'yes' THEN 1 ELSE 0 END) AS shaligram_yes,
        SUM(CASE WHEN created_at >= (NOW() - INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS last_7_days,
        SUM(CASE WHEN created_at >= (NOW() - INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS last_30_days
      FROM survey_responses
    `
  );

  const totals = totalsRows?.[0] || {};

  // Generic group counter
  async function groupCount(field) {
    const [rows] = await pool.query(
      `
        SELECT ${field} AS k, COUNT(*) AS c
        FROM survey_responses
        GROUP BY ${field}
        ORDER BY c DESC
      `
    );

    // Convert to chart-friendly structure with labels
    return rows.map((r) => ({
      key: r.k,
      label: label(field, r.k),
      count: Number(r.c || 0),
    }));
  }

  const attendance = await groupCount("attending_interest");
  const timing = await groupCount("feb14_timing");
  const consultation = await groupCount("wants_consultation");
  const interestType = await groupCount("rudraksha_interest_type");
  const discoveredFrom = await groupCount("discovered_from");
  const bangaloreStatus = await groupCount("based_in_bangalore");
  const purchaseStatus = await groupCount("has_purchased");
  const signedBook = await groupCount("reserve_signed_book");
  const shaligram = await groupCount("shaligram_darshan");

  // Daily trend (last N days)
  const [dailyRows] = await pool.query(
    `
      SELECT DATE(created_at) AS d, COUNT(*) AS c
      FROM survey_responses
      WHERE created_at >= (NOW() - INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY d ASC
    `,
    [days]
  );

  const daily = dailyRows.map((r) => ({
    date: r.d, // YYYY-MM-DD
    count: Number(r.c || 0),
  }));

  // Top event interests (JSON field)
  const [interestRows] = await pool.query(
    `SELECT event_interests FROM survey_responses`
  );

  const interestCountMap = new Map();
  for (const row of interestRows) {
    const list = parseEventInterests(row.event_interests); // returns array
    for (const item of list) {
      const key = String(item || "").trim();
      if (!key) continue;
      interestCountMap.set(key, (interestCountMap.get(key) || 0) + 1);
    }
  }

  const topEventInterests = Array.from(interestCountMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // KPI percentages
  const total = Number(totals.total || 0) || 0;
  const pct = (n) => (total ? Math.round((Number(n || 0) / total) * 100) : 0);

  const kpis = {
    total,
    last_7_days: Number(totals.last_7_days || 0),
    last_30_days: Number(totals.last_30_days || 0),
    updates_yes: Number(totals.updates_yes || 0),
    updates_no: Number(totals.updates_no || 0),
    definitely_count: Number(totals.definitely_count || 0),
    consult_yes: Number(totals.consult_yes || 0),
    signed_book_yes: Number(totals.signed_book_yes || 0),
    shaligram_yes: Number(totals.shaligram_yes || 0),

    updates_yes_pct: pct(totals.updates_yes),
    definitely_pct: pct(totals.definitely_count),
    consult_yes_pct: pct(totals.consult_yes),
    signed_book_yes_pct: pct(totals.signed_book_yes),
    shaligram_yes_pct: pct(totals.shaligram_yes),
  };

  res.render("admin_report", {
    kpis,
    charts: {
      attendance,
      timing,
      consultation,
      interestType,
      discoveredFrom,
      bangaloreStatus,
      purchaseStatus,
      signedBook,
      shaligram,
      daily,
      topEventInterests,
    },
    days,
  });
});

// -------------------- Admin: Dynamic Sections Management --------------------
app.get("/admin/sections", requireAdmin, async (req, res) => {
  try {
    const pageType = req.query.page_type || 'homepage';
    const formId = req.query.form_id ? parseInt(req.query.form_id, 10) : null;
    
    let sections = [];
    if (pageType === 'homepage') {
      sections = await getDynamicSections('homepage');
    } else if (pageType === 'form' && formId) {
      sections = await getDynamicSections('form', formId);
    }
    
    const navigation = pageType === 'homepage' ? await getHomepageNavigation() : [];
    const [forms] = await pool.execute("SELECT id, title, slug FROM forms ORDER BY title ASC");
    
    res.render("admin_sections", {
      sections,
      navigation,
      pageType,
      formId,
      forms: forms || [],
    });
  } catch (e) {
    console.error("Error loading sections:", e);
    res.status(500).send("Server error");
  }
});

app.post("/admin/sections/save", requireAdmin, upload.none(), async (req, res) => {
  try {
    const contentType = req.get('content-type') || '';
    let sectionsData = [];
    let navigationData = [];
    let pageType = 'homepage';
    let formId = null;
    
    // Handle different content types
    if (contentType.includes('application/json')) {
      // JSON request
      if (!req.body) {
        return res.status(400).json({ error: "Request body is missing." });
      }
      sectionsData = Array.isArray(req.body.sections) ? req.body.sections : [];
      navigationData = Array.isArray(req.body.navigation) ? req.body.navigation : [];
      pageType = req.body.page_type || 'homepage';
      if (req.body.form_id && req.body.form_id !== "" && req.body.form_id !== "null" && req.body.form_id !== null) {
        formId = parseInt(req.body.form_id, 10);
        if (isNaN(formId)) formId = null;
      }
    } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      // Form data - parse JSON strings
      if (!req.body) {
        return res.status(400).json({ error: "Request body is missing." });
      }
      try {
        sectionsData = req.body.sections ? (typeof req.body.sections === 'string' ? JSON.parse(req.body.sections) : req.body.sections) : [];
        navigationData = req.body.navigation ? (typeof req.body.navigation === 'string' ? JSON.parse(req.body.navigation) : req.body.navigation) : [];
      } catch (e) {
        console.error("Error parsing form data:", e);
        return res.status(400).json({ error: "Invalid JSON in form data: " + e.message });
      }
      pageType = req.body.page_type || 'homepage';
      if (req.body.form_id && req.body.form_id !== "" && req.body.form_id !== "null" && req.body.form_id !== null) {
        formId = parseInt(req.body.form_id, 10);
        if (isNaN(formId)) formId = null;
      }
    } else {
      return res.status(400).json({ error: "Unsupported content type. Please use application/json." });
    }
    
    // Ensure arrays
    if (!Array.isArray(sectionsData)) sectionsData = [];
    if (!Array.isArray(navigationData)) navigationData = [];
    
    // Delete existing sections for this page
    if (pageType === 'homepage') {
      await pool.execute("DELETE FROM dynamic_sections WHERE page_type = 'homepage' AND form_id IS NULL");
      await pool.execute("DELETE FROM homepage_navigation");
    } else if (pageType === 'form' && formId) {
      await pool.execute("DELETE FROM dynamic_sections WHERE page_type = 'form' AND form_id = ?", [formId]);
    } else if (pageType === 'success' && formId) {
      await pool.execute("DELETE FROM dynamic_sections WHERE page_type = 'success' AND form_id = ?", [formId]);
    } else if (pageType === 'success') {
      await pool.execute("DELETE FROM dynamic_sections WHERE page_type = 'success' AND form_id IS NULL");
    }
    
    // Insert sections
    for (let i = 0; i < sectionsData.length; i++) {
      const section = sectionsData[i];
      await pool.execute(
        `INSERT INTO dynamic_sections (page_type, form_id, section_type, title, description, image_url, link_url, link_text, button_style, display_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pageType,
          formId,
          section.section_type || 'image_text',
          section.title || null,
          section.description || null,
          section.image_url || null,
          section.link_url || null,
          section.link_text || null,
          section.button_style || 'primary',
          i,
          section.is_active !== false ? 1 : 0,
        ]
      );
    }
    
    // Insert navigation (homepage only)
    if (pageType === 'homepage') {
      for (let i = 0; i < navigationData.length; i++) {
        const nav = navigationData[i];
        await pool.execute(
          `INSERT INTO homepage_navigation (link_text, section_id, scroll_target, display_order, is_active)
           VALUES (?, ?, ?, ?, ?)`,
          [
            nav.link_text || '',
            nav.section_id || null,
            nav.scroll_target || null,
            i,
            nav.is_active !== false ? 1 : 0,
          ]
        );
      }
    }
    
    res.json({ success: true });
  } catch (e) {
    console.error("Error saving sections:", e);
    res.status(500).json({ error: "Server error: " + e.message });
  }
});

// -------------------- Admin: Interested Signups View --------------------
app.get("/admin/interested-signups", requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const perPage = parseInt(req.query.per || "50", 10);
    const offset = (page - 1) * perPage;

    const search = req.query.search ? req.query.search.trim() : null;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;
    const filterSource = req.query.filter_source || null;
    const filterCountry = req.query.filter_country || null;

    // Build WHERE clause
    let whereConditions = [];
    let queryParams = [];

    if (search) {
      whereConditions.push("(email LIKE ? OR source LIKE ?)");
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern);
    }

    if (dateFrom) {
      whereConditions.push("DATE(created_at) >= ?");
      queryParams.push(dateFrom);
    }

    if (dateTo) {
      whereConditions.push("DATE(created_at) <= ?");
      queryParams.push(dateTo);
    }

    if (filterSource) {
      whereConditions.push("source = ?");
      queryParams.push(filterSource);
    }

    if (filterCountry) {
      whereConditions.push("country_code = ?");
      queryParams.push(filterCountry);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // Get total count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM interested_signups ${whereClause}`,
      queryParams
    );
    const total = countResult[0]?.total || 0;

    // Get paginated results
    const [rows] = await pool.query(
      `SELECT id, email, source, country_code, created_at 
       FROM interested_signups 
       ${whereClause}
       ORDER BY created_at DESC 
       LIMIT ${perPage} OFFSET ${offset}`,
      queryParams
    );

    // Get unique sources and country codes for filters
    const [sources] = await pool.query(
      `SELECT DISTINCT source FROM interested_signups WHERE source IS NOT NULL ORDER BY source ASC`
    );
    const [countries] = await pool.query(
      `SELECT DISTINCT country_code FROM interested_signups WHERE country_code IS NOT NULL ORDER BY country_code ASC`
    );

    const totalPages = Math.ceil(total / perPage);

    res.render("admin_interested_signups", {
      rows: rows || [],
      total,
      page,
      perPage,
      totalPages,
      search,
      dateFrom,
      dateTo,
      filterSource,
      filterCountry,
      sources: sources.map((s) => s.source),
      countries: countries.map((c) => c.country_code),
      query: req.query,
    });
  } catch (e) {
    console.error("Error loading interested signups:", e);
    res.status(500).send("Server error: " + e.message);
  }
});

// -------------------- Admin: Interested Signups CSV Export --------------------
app.get("/admin/interested-signups.csv", requireAdmin, async (req, res) => {
  try {
    const search = req.query.search ? req.query.search.trim() : null;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;
    const filterSource = req.query.filter_source || null;
    const filterCountry = req.query.filter_country || null;

    // Build WHERE clause (same as view route)
    let whereConditions = [];
    let queryParams = [];

    if (search) {
      whereConditions.push("(email LIKE ? OR source LIKE ?)");
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern);
    }

    if (dateFrom) {
      whereConditions.push("DATE(created_at) >= ?");
      queryParams.push(dateFrom);
    }

    if (dateTo) {
      whereConditions.push("DATE(created_at) <= ?");
      queryParams.push(dateTo);
    }

    if (filterSource) {
      whereConditions.push("source = ?");
      queryParams.push(filterSource);
    }

    if (filterCountry) {
      whereConditions.push("country_code = ?");
      queryParams.push(filterCountry);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `SELECT id, email, source, country_code, created_at 
       FROM interested_signups 
       ${whereClause}
       ORDER BY created_at DESC`,
      queryParams
    );

    // Generate CSV
    const headers = ["ID", "Email", "Source", "Country Code", "Created At"];
    const csvRows = [headers.join(",")];

    for (const row of rows) {
      const csvRow = [
        row.id,
        `"${(row.email || "").replace(/"/g, '""')}"`,
        `"${(row.source || "").replace(/"/g, '""')}"`,
        `"${(row.country_code || "").replace(/"/g, '""')}"`,
        row.created_at ? new Date(row.created_at).toISOString() : "",
      ];
      csvRows.push(csvRow.join(","));
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="interested-signups-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csvRows.join("\n"));
  } catch (e) {
    console.error("Error exporting interested signups CSV:", e);
    res.status(500).send("Server error: " + e.message);
  }
});

// -------------------- API: Interested Signups --------------------
// POST /api/interested-signups
// Body: { email, source, country_code }
app.post("/api/interested-signups", async (req, res) => {
  try {
    const { email, source, country_code } = req.body;

    // Validation
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (!source || typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ error: "Source is required" });
    }

    if (!country_code || typeof country_code !== 'string' || !country_code.trim()) {
      return res.status(400).json({ error: "Country code is required" });
    }

    // Insert into database
    const [result] = await pool.execute(
      `INSERT INTO interested_signups (email, source, country_code) 
       VALUES (?, ?, ?)`,
      [email.trim(), source.trim(), country_code.trim()]
    );

    res.status(201).json({
      success: true,
      id: result.insertId,
      message: "Signup saved successfully"
    });
  } catch (e) {
    console.error("Error saving interested signup:", e);
    
    // Handle duplicate email if there's a unique constraint
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: "Email already exists" });
    }
    
    res.status(500).json({ error: "Server error: " + e.message });
  }
});

// 404 handler - must be last, after all routes
app.use((req, res) => {
  res.status(404).render("404");
});

// -------------------- Start --------------------
const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`Survey running on http://localhost:${PORT}`);
});
