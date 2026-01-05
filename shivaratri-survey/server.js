// server.js
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
app.get("/", (req, res) => {
  res.render("survey", {
    errors: {},
    values: { wants_updates: "on" },
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
    return res.redirect("/admin/responses");
  }

  return res.status(401).render("admin_login", { error: "Invalid username or password." });
});

app.post("/admin/logout", (req, res) => {
  req.session = null;
  res.redirect("/admin/login");
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


// -------------------- Admin: Report / Analytics --------------------
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


// -------------------- Start --------------------
const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`Survey running on http://localhost:${PORT}`);
});
