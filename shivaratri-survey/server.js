require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const mysql = require("mysql2/promise");
const { z } = require("zod");

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false, // allow Tailwind CDN
  })
);
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const EVENT_INTEREST_KEYS = new Set([
  "science",
  "rare_powerful",
  "free_consult",
  "shaligram",
  "book_talk",
  "team",
  "curious",
]);

const SurveySchema = z.object({
  full_name: z.string().min(2).max(120),
  mobile_number: z.string().min(6).max(30),
  email: z.string().email().optional().or(z.literal("")),
  based_in_bangalore: z.enum(["live", "travel", "maybe", "no"]),

  has_purchased: z.enum(["wearing", "not_wearing", "plan_to", "no"]),
  currently_wear: z.string().max(255).optional().or(z.literal("")),

  attending_interest: z.enum(["definitely", "most_likely", "maybe_dates", "not_now"]),
  feb14_timing: z.enum(["sat_morning", "sat_evening"]),

  event_interests: z.any(),

  wants_consultation: z.enum(["yes", "maybe", "no"]),
  rudraksha_interest_type: z.enum([
    "healing_spiritual",
    "planetary",
    "siddha",
    "rare",
    "family",
    "not_sure",
  ]),

  reserve_signed_book: z.enum(["yes", "maybe", "no"]),
  shaligram_darshan: z.enum(["yes", "maybe", "no"]),

  biggest_question: z.string().min(5),

  discovered_from: z.enum([
    "instagram",
    "youtube",
    "word_of_mouth",
    "event_talk",
    "friend_family",
    "other",
  ]),
  discovered_other: z.string().max(120).optional().or(z.literal("")),

  wants_updates: z.any(),
  arrangement_notes: z.string().optional().or(z.literal("")),
});

function normalizeCheckboxList(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(
    new Set(
      raw
        .map((v) => String(v).trim())
        .filter((v) => EVENT_INTEREST_KEYS.has(v))
    )
  );
}

function normalizeBooleanCheckbox(value) {
  return value === "on" ? 1 : 0;
}

app.get("/", (req, res) => {
  res.render("survey", { errors: {}, values: {} });
});

app.post("/submit", async (req, res) => {
  try {
    const parsed = SurveySchema.safeParse(req.body);
    if (!parsed.success) {
      const fieldErrors = {};
      parsed.error.issues.forEach((i) => {
        const key = i.path[0] || "form";
        fieldErrors[key] = i.message;
      });
      return res.status(400).render("survey", { errors: fieldErrors, values: req.body });
    }

    const data = parsed.data;

    const eventInterests = normalizeCheckboxList(data.event_interests);
    if (eventInterests.length === 0) {
      return res.status(400).render("survey", {
        errors: { event_interests: "Please select at least one interest." },
        values: req.body,
      });
    }

    const email = (data.email || "").trim() || null;

    const discoveredOther =
      data.discovered_from === "other" ? (data.discovered_other || "").trim() || null : null;

    const currentlyWear =
      data.has_purchased === "wearing" || data.has_purchased === "not_wearing"
        ? (data.currently_wear || "").trim() || null
        : null;

    const wantsUpdates = normalizeBooleanCheckbox(data.wants_updates);

const insertSql = `
INSERT INTO survey_responses (
  full_name, mobile_number, email,
  based_in_bangalore,
  has_purchased, currently_wear,
  attending_interest, feb14_timing,
  event_interests,
  wants_consultation, rudraksha_interest_type,
  reserve_signed_book, shaligram_darshan,
  biggest_question,
  discovered_from, discovered_other,
  wants_updates
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`;

const insertParams = [
  data.full_name.trim(),
  data.mobile_number.trim(),
  email,
  data.based_in_bangalore,
  data.has_purchased,
  currentlyWear,
  data.attending_interest,
  data.feb14_timing,
  JSON.stringify(eventInterests),
  data.wants_consultation,
  data.rudraksha_interest_type,
  data.reserve_signed_book,
  data.shaligram_darshan,
  data.biggest_question.trim(),
  data.discovered_from,
  discoveredOther,
  wantsUpdates
];

console.log("INSERT PARAMS COUNT:", insertParams.length); // should be 17
await pool.execute(insertSql, insertParams);

// Then update arrangement_notes separately if you want:
if ((data.arrangement_notes || "").trim()) {
  await pool.execute(
    `UPDATE survey_responses SET arrangement_notes=? WHERE mobile_number=? ORDER BY id DESC LIMIT 1`,
    [(data.arrangement_notes || "").trim(), data.mobile_number.trim()]
  );
}
    return res.render("success");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Server error. Please try again.");
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Survey running on http://localhost:${process.env.PORT || 3000}`);
});
