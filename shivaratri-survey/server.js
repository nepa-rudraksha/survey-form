// Server.js
require("dotenv").config();

const path = require("path");
const crypto = require("crypto");

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieSession = require("cookie-session");
const mysql = require("mysql2/promise");

const app = express();

// -------------------- App / Proxy --------------------
// Needed on Coolify / reverse proxies so IP + secure cookies behave correctly
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
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

function makeEditKey() {
  return crypto.randomBytes(16).toString("hex");
}

function getClientIp(req) {
  // with trust proxy, req.ip will be correct on Coolify too
  return (req.ip || "").slice(0, 45);
}

function validate(body) {
  const errors = {};
  const values = { ...body };

  values.full_name = String(values.full_name || "").trim();
  values.mobile_number = normalizeMobile(values.mobile_number);
  values.email = String(values.email || "").trim();

  // required
  if (!values.full_name) errors.full_name = "Full name is required.";
  if (!values.mobile_number) errors.mobile_number = "Mobile number is required.";
  if (!values.based_in_bangalore) errors.based_in_bangalore = "Please select one option.";
  if (!values.has_purchased) errors.has_purchased = "Please select one option.";
  if (!values.attending_interest) errors.attending_interest = "Please select one option.";
  if (!values.feb14_timing) errors.feb14_timing = "Please select one option.";
  if (!values.wants_consultation) errors.wants_consultation = "Please select one option.";
  if (!values.rudraksha_interest_type) errors.rudraksha_interest_type = "Please select one option.";
  if (!values.reserve_signed_book) errors.reserve_signed_book = "Please select one option.";
  if (!values.shaligram_darshan) errors.shaligram_darshan = "Please select one option.";
  if (!values.biggest_question || !String(values.biggest_question).trim())
    errors.biggest_question = "Please write your biggest question.";

  if (!values.discovered_from) errors.discovered_from = "Please select one option.";

  // optional email (only validate if present)
  if (values.email) {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email);
    if (!ok) errors.email = "Please enter a valid email address.";
  }

  values.event_interests = asArray(values.event_interests);
  values.wants_updates = values.wants_updates === "on" ? 1 : 0;

  return { errors, values };
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect("/admin/login");
}

function safeEq(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function buildWhereFromQuery(q) {
  const where = [];
  const params = [];

  const allowed = ["attending_interest", "feb14_timing", "wants_consultation", "discovered_from"];
  for (const key of allowed) {
    if (q[key]) {
      where.push(`${key} = ?`);
      params.push(q[key]);
    }
  }

  if (q.search) {
    const s = `%${String(q.search).trim()}%`;
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

// -------------------- Routes --------------------
app.get("/", (req, res) => {
  res.render("survey", {
    errors: {},
    values: {
      wants_updates: "on",
    },
    pageMode: "new",
    editKey: null,
  });
});

// Edit existing
app.get("/edit/:key", async (req, res) => {
  const key = String(req.params.key || "").trim();
  if (!key) return res.status(404).send("Not found");

  const [rows] = await pool.execute("SELECT * FROM survey_responses WHERE edit_key = ? LIMIT 1", [key]);
  if (!rows.length) return res.status(404).send("Not found");

  const row = rows[0];

  let interests = [];
  try {
    interests = Array.isArray(row.event_interests)
      ? row.event_interests
      : JSON.parse(row.event_interests || "[]");
  } catch {
    interests = [];
  }

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

  // NOTE: 25 columns => 25 values (this fixes your mismatch)
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

  return res.render("success", {
    editUrl: `/edit/${editKey}`,
    mobile_number: mobile,
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

  return res.render("success", {
    editUrl: `/edit/${key}`,
    mobile_number: normalizeMobile(values.mobile_number),
  });
});

// -------------------- Admin (Login Page, no browser prompt) --------------------
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
    return res.redirect("/admin/responses");
  }

  return res.status(401).render("admin_login", { error: "Invalid username or password." });
});

app.post("/admin/logout", (req, res) => {
  req.session = null;
  res.redirect("/admin/login");
});


app.get("/admin/responses", requireAdmin, async (req, res) => {
  const pageRaw = parseInt(req.query.page, 10);
  const perRaw = parseInt(req.query.per, 10);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const perPage =
    Number.isFinite(perRaw) && perRaw > 0
      ? Math.min(200, Math.max(10, perRaw))
      : 50;

  const offset = (page - 1) * perPage;

  const { whereSql, params } = buildWhereFromQuery(req.query);
  const safeParams = Array.isArray(params) ? params : [];

  // 1. Get Total Count
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) as c FROM survey_responses ${whereSql}`,
    safeParams
  );
  const total = countRows[0]?.c || 0;

  // 2. Get Data
  // FIX: Use pool.query instead of pool.execute for LIMIT/OFFSET queries
  const [rows] = await pool.query(
    `
      SELECT 
        id, full_name, mobile_number, email, 
        attending_interest, feb14_timing, wants_consultation, discovered_from,
        event_interests, wants_updates, 
        utm_source, utm_medium, utm_campaign, referrer,
        ip_address, user_agent,
        created_at
      FROM survey_responses
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    [...safeParams, parseInt(perPage), parseInt(offset)]
  );

const pages = Math.max(1, Math.ceil(total / perPage));

const buildQS = (override = {}) => {
  const q = { ...req.query, ...override };

  // remove empty keys so URL is clean
  Object.keys(q).forEach((k) => {
    if (q[k] === "" || q[k] === undefined || q[k] === null) delete q[k];
  });

  return new URLSearchParams(q).toString();
};

// export should keep filters, not pagination
const qs = buildQS({ page: undefined, per: undefined });

// pagination links keep filters + per, and only change page
const qsPrev = buildQS({ page: Math.max(1, page - 1), per: perPage });
const qsNext = buildQS({ page: Math.min(pages, page + 1), per: perPage });

res.render("admin_responses", {
  rows,
  filters: req.query,
  page,
  perPage,
  total,
  pages,
  qs,
  qsPrev,
  qsNext,
});



});

// Admin CSV export
app.get("/admin/responses.csv", requireAdmin, async (req, res) => {
  const { whereSql, params } = buildWhereFromQuery(req.query);

  const [rows] = await pool.execute(
    `
      SELECT
        id, full_name, mobile_number, email,
        based_in_bangalore, has_purchased, currently_wear,
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

  const headers = Object.keys(rows[0] || { id: "" });
  const lines = [];
  lines.push(headers.map(toCsvValue).join(","));

  for (const r of rows) {
    const row = headers.map((h) => {
      let v = r[h];
      if (h === "event_interests") {
        try {
          v = Array.isArray(v) ? v.join(" | ") : JSON.parse(v || "[]").join(" | ");
        } catch {
          v = "";
        }
      }
      return toCsvValue(v);
    });
    lines.push(row.join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=survey_responses.csv");
  res.send(lines.join("\n"));
});

// -------------------- Start --------------------
const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`Survey running on http://localhost:${PORT}`);
});
