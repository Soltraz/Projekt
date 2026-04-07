require("dotenv").config();

const { convertAnyToPdf } = require("./data/convertfiles/convertAnyToPdf");


const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const cors = require("cors");
const cheerio = require("cheerio");
const multer = require("multer");

const WORKFLOW_WEBHOOK_URL = process.env.WORKFLOW_WEBHOOK_URL || "";
const WORKFLOW_OUT_TOKEN = process.env.WORKFLOW_OUT_TOKEN || "";

const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const DATA_DIR = path.join(__dirname, "data");
const MISSING_DIR = path.join(DATA_DIR, "missing");
const VARS_DIR = path.join(DATA_DIR, "vars");

const TMP_UPLOAD_DIR = path.join(__dirname, "tmp_uploads");

const USERS_FILE = path.join(DATA_DIR, "users.json");
const TEMPLATES_FILE = path.join(DATA_DIR, "templates.json");

const COMPANIES_FILE = path.join(DATA_DIR, "companies.json");               // Array von Companies (inkl. projects, profile, fibu)
const PROJECT_CONTENTS_FILE = path.join(DATA_DIR, "project_contents.json"); // Map: { [projectId]: html }

const PDF_DIR = path.join(__dirname, "public", "marzo", "data");
const PDF = {
  fibu: path.join(PDF_DIR, "Fibu.pdf"),
  stamm: path.join(PDF_DIR, "Stammanteilbewertung.pdf"),
  verlust: path.join(PDF_DIR, "Verlusttabelle.pdf"),
};

fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
fs.mkdir(MISSING_DIR, { recursive: true }).catch(() => {});
fs.mkdir(VARS_DIR, { recursive: true }).catch(() => {});
fs.mkdir(TMP_UPLOAD_DIR, { recursive: true }).catch(() => {});
fs.mkdir(PDF_DIR, { recursive: true }).catch(() => {});


const running = new Set(); // companyId

function lock(companyId) {
  if (!companyId) return true;
  if (running.has(companyId)) return false;
  running.add(companyId);
  return true;
}

function unlock(companyId) {
  if (!companyId) return;
  running.delete(companyId);
}

const fetchFn = global.fetch ? global.fetch.bind(global) : require("node-fetch");

const ZEFIX_USER = process.env.ZEFIX_USER;
const ZEFIX_PASS = process.env.ZEFIX_PASS;
const ZEFIX_BASE = "https://www.zefix.ch/ZefixPublicREST/api/v1";
const AUTH =
  ZEFIX_USER && ZEFIX_PASS
    ? "Basic " + Buffer.from(`${ZEFIX_USER}:${ZEFIX_PASS}`).toString("base64")
    : "";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
let openai = null;
try {
  const { OpenAI } = require("openai");
  if (OPENAI_API_KEY) openai = new OpenAI({ apiKey: OPENAI_API_KEY });
} catch {
}

const WORKFLOW_TOKEN = process.env.WORKFLOW_TOKEN || "";

const app = express();

const ALLOWED = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);


  const pool = require("./db");


app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      return cb(null, ALLOWED.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-workflow-token", "x-admin"],
    maxAge: 86400,
  })
);
app.options("*", cors());

app.use(express.static(path.join(__dirname, "public")));

app.use(
  express.json({
    limit: "10mb",
    type: ["application/json", "application/*+json", "text/plain"],
  })
);
app.use(express.urlencoded({ extended: true }));

const NBSP = /\u00a0/g;
const clean = (s) => String(s ?? "").trim();

function normalizeDateValue(v) {
  const s = String(v || "").trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return s;
}

function normalizeAndValidateVars(vars, relevantKeys = []) {
  const src = vars && typeof vars === "object" ? vars : {};
  const out = {};
  const invalid = [];

  for (const [key, value] of Object.entries(src)) {
    let v = value == null ? "" : String(value).trim();

    if (key === "UID" && v) {
      const canon = normalizeUid(v);
      if (!canon) {
        invalid.push({ key, reason: "invalid_uid", value: v });
      } else {
        v = formatUID(canon);
      }
    }

    if ((key === "PLZ") && v && !/^\d{4}$/.test(v)) {
      invalid.push({ key, reason: "invalid_plz", value: v });
    }

    out[key] = v;
  }

  return { vars: out, invalid };
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function toText(html) {
  return decodeHtml(String(html || "").replace(/<[^>]+>/g, " "))
    .replace(NBSP, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCHNumber(input) {
  if (input == null) return NaN;
  const s = String(input).replace(/\u00a0/g, " ").replace(/[’']/g, "").trim();
  const cleaned = s.replace(/[^0-9.,-]/g, "");
  const normalized = cleaned.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function chf(n) {
  const x = parseCHNumber(n);
  return Number.isFinite(x) ? String(x) : clean(n);
}

function formatUID(u) {
  const canon = normalizeUid(u);
  if (!canon) return clean(u);

  const digits = canon.slice(3);
  return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}`;
}

function normalizeUid(u) {
  const s = String(u || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/^CHE(\d{9})$/);
  return m ? `CHE${m[1]}` : "";
}

async function safeUnlink(p) {
  try {
    await fs.unlink(p);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    const txt = await fs.readFile(filePath, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

async function writeJsonFileAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeCompanyShape(c) {
  const createdAt = c.createdAt || c.created_at || nowIso();
  const updatedAt = c.updatedAt || c.updated_at || createdAt;
  return {
    id: String(c.id || "").trim(),
    name: String(c.name || "").trim(),
    uid: c.uid || null,
    uidCanon: c.uidCanon || c.uid_canon || null,
    archived: !!c.archived,
    profile: c.profile && typeof c.profile === "object" ? c.profile : {},
    fibu: c.fibu && typeof c.fibu === "object" ? c.fibu : (c.fibu ?? null),
    createdAt,
    updatedAt,
    projects: Array.isArray(c.projects) ? c.projects.map((p) => ({
      id: String(p.id || "").trim(),
      title: String(p.title || "").trim(),
      status: String(p.status || "In Arbeit"),
      createdAt: p.createdAt || p.created_at || createdAt,
      updatedAt: p.updatedAt || p.updated_at || updatedAt,
    })) : [],
  };
}


async function writeCompanies(list) {
  await writeJsonFileAtomic(COMPANIES_FILE, Array.isArray(list) ? list : []);
}

async function listCompanies() {
  return dbListCompanies();
}

async function getCompany(companyId) {
  return dbGetCompany(companyId);
}

async function upsertCompany(entry) {
  return dbUpsertCompany(entry);
}


function getVarsPath(companyId) {
  return path.join(VARS_DIR, `company-${companyId}.json`);
}

async function updateCompany(companyId, payload) {
  return dbUpdateCompany(companyId, payload);
}


async function updateCompanyProfileAndUid(companyId, payload) {
return dbUpdateCompanyProfileAndUid(companyId, payload)
}

async function updateCompanyFibu(companyId, fibuPayload) {
return dbUpdateCompanyFibu(companyId, fibuPayload)
}

async function updateProject(companyId, projectId, payload) {
  return dbUpdateProject(companyId, projectId, payload);
}

async function createProject(payload) {
return dbCreateProject(payload)
}

async function deleteProject(companyId, projectId) {
  return dbDeleteProject(companyId, projectId);
}

async function getProjectContent(projectId) {
return dbGetProjectContent(projectId)
}

async function upsertProjectContent(payload) {
return dbUpsertProjectContent(payload)
}

function getMissingPath(companyId) {
  return path.join(MISSING_DIR, `company-${companyId}.json`);
}

async function readMissing(companyId) {
  if (!companyId) {
    return { relevant: [], missing: [], values: {}, invalid: [], missing_count: 0, docId: "default" };
  }
  try {
    return JSON.parse(await fs.readFile(getMissingPath(companyId), "utf8"));
  } catch {
    return { relevant: [], missing: [], values: {}, invalid: [], missing_count: 0, docId: "default" };
  }
}

async function writeMissing(companyId, payload) {
  if (!companyId) return;
  await fs.mkdir(path.dirname(getMissingPath(companyId)), { recursive: true });
  await fs.writeFile(getMissingPath(companyId), JSON.stringify(payload, null, 2), "utf8");
}

//db load/save

async function dbLoadVars(companyId) {
  if (!companyId) return {};
  const [rows] = await pool.query(
    "SELECT vars_json FROM company_vars WHERE company_id=? LIMIT 1",
    [companyId]
  );
  if (!rows.length) return {};

  try {
    const raw = rows[0].vars_json;
    return typeof raw === "string" ? JSON.parse(raw) : (raw || {});
  } catch {
    return {};
  }
}


async function dbSaveVars(companyId, vars) {
  if (!companyId) return;
  await pool.query(
    `INSERT INTO company_vars (company_id, vars_json)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE vars_json=VALUES(vars_json)`,
    [companyId, JSON.stringify(vars || {})]
  );
}


//db companies/projects

function rowToCompany(r) {
  return {
    id: r.id,
    name: r.name,
    uid: r.uid_display || null,
    uidCanon: r.uid_canon || null,
    archived: !!r.archived,
    profile: r.profile_json ? (typeof r.profile_json === "string" ? JSON.parse(r.profile_json) : r.profile_json) : {},
    fibu: r.fibu_json ? (typeof r.fibu_json === "string" ? JSON.parse(r.fibu_json) : r.fibu_json) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    projects: [],
  };
}

async function dbProjectsByCompanyIds(companyIds = []) {
  const map = new Map();
  if (!companyIds.length) return map;

  const placeholders = companyIds.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT id, company_id, title, status, created_at, updated_at
     FROM projects
     WHERE company_id IN (${placeholders})
     ORDER BY created_at DESC`,
    companyIds
  );

  for (const r of rows) {
    const arr = map.get(r.company_id) || [];
    arr.push({
      id: r.id,
      title: r.title || "",
      status: r.status || "In Arbeit",
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    });
    map.set(r.company_id, arr);
  }
  return map;
}


async function dbListCompanies() {
  const [rows] = await pool.query(
    `SELECT id,name,uid_display,uid_canon,archived,profile_json,fibu_json,created_at,updated_at
     FROM companies
     ORDER BY created_at DESC`
  );
  const companies = rows.map(rowToCompany);
  const ids = companies.map((c) => c.id);
  const projectsMap = await dbProjectsByCompanyIds(ids);
  for (const c of companies) c.projects = projectsMap.get(c.id) || [];
  return companies;
}


async function dbGetCompany(companyId) {
  const [rows] = await pool.query(
    `SELECT id,name,uid_display,uid_canon,archived,profile_json,fibu_json,created_at,updated_at
     FROM companies
     WHERE id=? LIMIT 1`,
    [companyId]
  );
  if (!rows.length) return null;
  const c = rowToCompany(rows[0]);
  const pm = await dbProjectsByCompanyIds([companyId]);
  c.projects = pm.get(companyId) || [];
  return c;
}


async function dbUpsertCompany(entry) {
  const createdAt = entry.createdAt ? new Date(entry.createdAt) : new Date();
  const updatedAt = new Date();
  await pool.query(
    `INSERT INTO companies
       (id,name,uid_display,uid_canon,archived,profile_json,fibu_json,created_at,updated_at)
     VALUES
       (?,?,?,?,?,?,?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name=VALUES(name),
       uid_display=VALUES(uid_display),
       uid_canon=VALUES(uid_canon),
       archived=VALUES(archived),
       profile_json=VALUES(profile_json),
       fibu_json=VALUES(fibu_json),
       updated_at=VALUES(updated_at)`,
    [
      entry.id,
      entry.name,
      entry.uid || null,
      entry.uidCanon || null,
      entry.archived ? 1 : 0,
      JSON.stringify(entry.profile || {}),
      entry.fibu ? JSON.stringify(entry.fibu) : null,
      createdAt,
      updatedAt,
    ]
  );
}

async function dbUpdateProject(companyId, projectId, { title, status }) {
  const [rows] = await pool.query(
    `SELECT id, title, status
     FROM projects
     WHERE id=? AND company_id=? LIMIT 1`,
    [projectId, companyId]
  );

  if (!rows.length) return false;

  const current = rows[0];

  await pool.query(
    `UPDATE projects
     SET title=?, status=?, updated_at=NOW()
     WHERE id=? AND company_id=?`,
    [
      title != null && String(title).trim() !== "" ? String(title).trim() : current.title,
      status != null && String(status).trim() !== "" ? String(status).trim() : current.status,
      projectId,
      companyId,
    ]
  );

  return true;
}

async function dbUpdateCompany(companyId, { name, archived }) {
  const [rows] = await pool.query(
    `SELECT id, name, archived
     FROM companies
     WHERE id=? LIMIT 1`,
    [companyId]
  );

  if (!rows.length) return false;

  const current = rows[0];

  await pool.query(
    `UPDATE companies
     SET name=?, archived=?, updated_at=NOW()
     WHERE id=?`,
    [
      name != null && String(name).trim() !== "" ? String(name).trim() : current.name,
      archived != null ? (archived ? 1 : 0) : current.archived,
      companyId,
    ]
  );

  return true;
}


async function dbUpdateCompanyProfileAndUid(companyId, { uidCanon, uidDisplay, profilePatch }) {
  const company = await dbGetCompany(companyId);
  if (!company) return;

  const profile = { ...(company.profile || {}), ...(profilePatch || {}) };
  await pool.query(
    `UPDATE companies
     SET uid_canon=?, uid_display=?, profile_json=?, updated_at=NOW()
     WHERE id=?`,
    [uidCanon || company.uidCanon || null, uidDisplay || company.uid || null, JSON.stringify(profile), companyId]
  );
}


async function dbUpdateCompanyFibu(companyId, fibuPayload) {
  const company = await dbGetCompany(companyId);
  if (!company) return;

  const mergedFibu = {
    ...(company.fibu || {}),
    ...(fibuPayload || {}),
  };

  await pool.query(
    `UPDATE companies
     SET fibu_json=?, updated_at=NOW()
     WHERE id=?`,
    [Object.keys(mergedFibu).length ? JSON.stringify(mergedFibu) : null, companyId]
  );
}


async function dbCreateProject({ companyId, title, status }) {
  const id = "prj_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  await pool.query(
    `INSERT INTO projects (id, company_id, title, status) VALUES (?,?,?,?)`,
    [id, companyId, title, status || "In Arbeit"]
  );
  return id;
}

async function dbDeleteProject(companyId, projectId) {
  const [rows] = await pool.query(
    `SELECT id
     FROM projects
     WHERE id=? AND company_id=? LIMIT 1`,
    [projectId, companyId]
  );

  if (!rows.length) return false;

  await pool.query(
    `DELETE FROM project_contents WHERE project_id=?`,
    [projectId]
  );

  await pool.query(
    `DELETE FROM projects WHERE id=? AND company_id=?`,
    [projectId, companyId]
  );

  return true;
}

async function dbUpsertProjectContent({ projectId, html }) {
  await pool.query(
    `INSERT INTO project_contents (project_id, html)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE html=VALUES(html)`,
    [projectId, html]
  );
}


async function dbGetProjectContent(projectId) {
  const [rows] = await pool.query(
    `SELECT html FROM project_contents WHERE project_id=? LIMIT 1`,
    [projectId]
  );
  return rows.length ? (rows[0].html || "") : "";
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function dbCreateUploadMeta({
  id,
  companyId,
  projectId = null,
  docType,
  originalName,
  storedPath,
  fileSize = null,
  mimeType = null,
}) {
  await pool.query(
    `INSERT INTO project_uploads
      (id, company_id, project_id, doc_type, original_name, stored_path, file_size, mime_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      companyId,
      projectId,
      docType,
      originalName,
      storedPath,
      fileSize,
      mimeType,
    ]
  );
}

async function dbCreateRun({
  id,
  companyId,
  projectId = null,
  phase,
  status = "running",
}) {
  await pool.query(
    `INSERT INTO project_runs
      (id, company_id, project_id, phase, status)
     VALUES (?, ?, ?, ?, ?)`,
    [id, companyId, projectId, phase, status]
  );
}

async function dbFinishRun(runId, status, result = null) {
  await pool.query(
    `UPDATE project_runs
     SET status = ?, ended_at = NOW(), result_json = ?
     WHERE id = ?`,
    [status, result ? JSON.stringify(result) : null, runId]
  );
}

async function dbCreateRawResult({
  id,
  companyId,
  projectId = null,
  runId = null,
  source,
  payload,
}) {
  await pool.query(
    `INSERT INTO workflow_results_raw
      (id, company_id, project_id, run_id, source, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, companyId, projectId, runId, source, JSON.stringify(payload || {})]
  );
}

function mapWorkflowPayloadToVars(s) {
  const has = (v) =>
    v !== undefined &&
    v !== null &&
    (typeof v === "number" || String(v).trim() !== "");

  const asTxt = (v) => (v == null ? "" : String(v).trim());

  const patch = {};

  if (has(s.CompanyName) || has(s.company)) {
    patch.CompanyName = asTxt(s.CompanyName ?? s.company);
  }

  if (has(s.Adresse) || has(s.address)) {
    patch.Adresse = asTxt(s.Adresse ?? s.address);
  }

  if (has(s.PLZ) || has(s.zip)) {
    patch.PLZ = asTxt(s.PLZ ?? s.zip);
  }

  if (has(s.ORT) || has(s.city) || has(s.Ort)) {
    patch.ORT = asTxt(s.ORT ?? s.city ?? s.Ort);
  }

  if (has(s.UID) || has(s.uid)) {
    patch.UID = asTxt(s.UID ?? s.uid);
  }

  if (has(s.currentYear) || has(s.CurrentYear)) {
    patch.currentYear = asTxt(s.currentYear ?? s.CurrentYear);
  }

  if (has(s.gesellschafter) || has(s.Gesellschafter) || has(s.partners)) {
    patch.gesellschafter = asTxt(s.gesellschafter ?? s.Gesellschafter ?? s.partners);
  }

  if (has(s.Gesellschafter_ort) || has(s.partners_city)) {
    patch.Gesellschafter_ort = asTxt(s.Gesellschafter_ort ?? s.partners_city);
  }

  if (has(s.gesellschafterHerkunft)) {
    patch.gesellschafterHerkunft = asTxt(s.gesellschafterHerkunft);
  }

  if (has(s.stammkapital) || has(s.Stammkapital)) {
    patch.Stammkapital = asTxt(s.stammkapital ?? s.Stammkapital);
  }

  if (has(s.Stammanteil) || has(s.share_unit)) {
    patch.Stammanteil = asTxt(s.Stammanteil ?? s.share_unit);
  }

  if (has(s.StammanteilBeschreibung)) {
    patch.StammanteilBeschreibung = asTxt(s.StammanteilBeschreibung);

    if (!has(s.Stammanteil)) {
      patch.Stammanteil = asTxt(s.StammanteilBeschreibung);
    }
  }

  if (has(s.totaleAktiven)) {
    patch.totaleAktiven = asTxt(s.totaleAktiven);
  }

  if (has(s.gesetzlicheReserven)) {
    patch.gesetzlicheReserven = asTxt(s.gesetzlicheReserven);
  }

  if (has(s.Gewinnvortrag)) {
    patch.Gewinnvortrag = asTxt(s.Gewinnvortrag);
  }

  if (has(s.Gewinn)) {
    patch.Gewinn = asTxt(s.Gewinn);
  }

  if (has(s.gewinnVerlustVortrag)) {
    patch.gewinnVerlustVortrag = asTxt(s.gewinnVerlustVortrag);
  }

  if (has(s.schlussZeit)) {
    patch.schlussZeit = asTxt(s.schlussZeit);
  }

  if (has(s.protokollDatum)) {
    patch.protokollDatum = asTxt(s.protokollDatum);
  }

  if (has(s.VorsorgeVerbindlichkeit)) {
    patch.VorsorgeVerbindlichkeit = asTxt(s.VorsorgeVerbindlichkeit);
  }

  if (has(s.TreuhandName)) {
    patch.TreuhandName = asTxt(s.TreuhandName);
  }

  if (has(s.vollstaendigkeitDatum)) {
    patch.vollstaendigkeitDatum = asTxt(s.vollstaendigkeitDatum);
  }

  return patch;
}

function logEvent(level, message, context = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

function apiError(res, status, error, message, details = {}) {
  return res.status(status).json({
    ok: false,
    error,
    message,
    status,
    timestamp: new Date().toISOString(),
    ...details,
  });
}

async function triggerWorkflow({
  companyId,
  projectId = null,
  runId,
  phase = "extract",
}) {
  if (!WORKFLOW_WEBHOOK_URL) {
    throw new Error("WORKFLOW_WEBHOOK_URL fehlt");
  }

  const company = await getCompany(companyId);
  if (!company) {
    throw new Error(`Firma ${companyId} nicht gefunden`);
  }

  const missingState = projectId
    ? await buildMissingFromProject(companyId, projectId)
    : await readMissing(companyId);

  const payload = {
    companyId,
    projectId,
    runId,
    phase,
    company: {
      id: company.id,
      name: company.name,
      uid: company.uid || "",
      uidCanon: company.uidCanon || "",
    },
    missing: {
      relevant: missingState?.relevant || [],
      missing: missingState?.missing || [],
      values: missingState?.values || {},
      invalid: missingState?.invalid || [],
      timestamp: new Date().toISOString(),
    },
    files: {
      fibu: PDF.fibu,
      stamm: PDF.stamm,
      verlust: PDF.verlust,
      fibuUrl: `${APP_BASE_URL}/marzo/data/Fibu.pdf`,
      stammUrl: `${APP_BASE_URL}/marzo/data/Stammanteilbewertung.pdf`,
      verlustUrl: `${APP_BASE_URL}/marzo/data/Verlusttabelle.pdf`,
    },
    callback: {
      url: `${APP_BASE_URL}/api/workflow/callback`,
    },
  };

  const headers = {
    "Content-Type": "application/json",
  };

  if (WORKFLOW_OUT_TOKEN) {
    headers["x-workflow-token"] = WORKFLOW_OUT_TOKEN;
  }

  logEvent("info", "workflow trigger start", {
    companyId,
    projectId,
    runId,
    phase,
    webhook: WORKFLOW_WEBHOOK_URL,
  });

  const response = await fetchFn(WORKFLOW_WEBHOOK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(
      `Workflow-Webhook Fehler: ${response.status} ${body?.error || response.statusText}`
    );
  }

  logEvent("info", "workflow trigger ok", {
    companyId,
    projectId,
    runId,
    response: body,
  });

  return body;
}


async function jget(url, init = {}) {
  if (!AUTH) throw new Error("ZEFIX_USER/ZEFIX_PASS fehlen");
  const r = await fetchFn(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: AUTH,
      Accept: "application/json",
      "Accept-Language": "de",
    },
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function getHtml(url) {
  if (!url) return "";
  try {
    const r = await fetchFn(url);
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  }
}

function parseJSONfromText(t) {
  const m = String(t || "").match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function normName(nachname, vorname) {
  return `${clean(vorname)} ${clean(nachname)}`.replace(/\s+/g, " ").trim();
}

function fixOrtAbbrev(ort, originalText) {
  if (/^St\b\.?$/i.test(ort)) {
    const m = originalText.match(/in\s+(St\.\s+[A-Za-zÄÖÜäöü\-]+(?:\s+[A-Za-zÄÖÜäöü\-]+)?)/i);
    if (m) return m[1].trim();
  }
  return ort;
}


function extractPlaceholdersFromHtml(html) {
  const src = String(html || "");
  const re = /\{([A-Za-z0-9_]+)\}/g;
  const out = [];
  const seen = new Set();

  let m;
  while ((m = re.exec(src)) !== null) {
    const key = String(m[1] || "").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out;
}

function computeMissingFromVars(vars, relevant) {
  const rel = Array.isArray(relevant) ? relevant : [];
  const source = vars && typeof vars === "object" ? vars : {};

  const { vars: normalizedValues, invalid } = normalizeAndValidateVars(source, rel);
  const invalidKeys = new Set(invalid.map((x) => x.key));

  const missing = rel.filter((key) => {
    if (invalidKeys.has(key)) return false;

    const v = normalizedValues[key];
    return !(
      v !== undefined &&
      v !== null &&
      (typeof v === "number" || String(v).trim() !== "")
    );
  });

  return {
    relevant: rel,
    missing,
    missing_count: missing.length,
    values: normalizedValues,
    invalid,
  };
}

async function buildMissingFromProject(companyId, projectId) {
  const html = await dbGetProjectContent(projectId);
  const relevant = extractPlaceholdersFromHtml(html);
  const vars = await dbLoadVars(companyId);

  return {
    ...computeMissingFromVars(vars, relevant),
    docId: projectId || "default",
    timestamp: new Date().toISOString(),
  };
}


function personsFromSogc(list = []) {
  const out = [];
  const re =
    /([A-ZÄÖÜ][A-Za-zÄÖÜäöü'’\-\. ]+),\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöü'’\-\. ]+),\s*(?:von|aus)\s+([^,;]+),\s*in\s+([^,;\.]+)/g;

  for (const pub of list) {
    const t = toText(pub?.message || "");
    let m;
    while ((m = re.exec(t)) !== null) {
      const nachname = clean(m[1]);
      const vorname = clean(m[2]);
      if (/^\s*CHE\b/i.test(nachname)) continue;

      const herkunft = clean(m[3]);
      let ort = clean(m[4]);
      ort = fixOrtAbbrev(ort, t);

      const ctx = t.slice(Math.max(0, m.index - 160), m.index + 240);
      const role =
        /Gesellschafter/i.test(ctx) ? "gesellschafter" :
        /Geschaeftsfuehrer|Gesch[aä]ftsf[üu]hrer/i.test(ctx) ? "gf" :
        /Verwaltungsrat/i.test(ctx) ? "vr" : "other";

      const funktion =
        /Gesellschafter/i.test(ctx) ? "Gesellschafter" :
        /Verwaltungsrat/i.test(ctx) ? "Verwaltungsrat" :
        /Geschaeftsfuehrer|Gesch[aä]ftsf[üu]hrer/i.test(ctx) ? "Geschäftsführer" : "";

      const signatur =
        (ctx.match(/(Einzelunterschrift|Kollektivprokura|Kollektivunterschrift(?:\s+zu\s+zweien)?)/i) || ["", ""])[1] || "";

      const name = normName(nachname, vorname);
      out.push({ name, anzeige: `${name}, von ${herkunft}, in ${ort}`, funktion, signatur, role, source: "sogc" });
    }
  }
  return out;
}

function personsFromHtml(html) {
  const out = [];
  if (!html) return out;
  const $ = cheerio.load(html);

  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (!tds.length) return;

    const col0 = toText($(tds[0]).html());
    if (!/, (?:von|aus)\s+.+,\s*in\s+/i.test(col0)) return;
    if (/CHE-\d{3}\.\d{3}\.\d{3}/i.test(col0)) return;

    const m = col0.match(/^([^,]+),\s*([^,]+).*?(?:von|aus)\s+([^,;]+),\s*in\s+([^,;]+)/i);
    if (!m) return;

    const nachname = clean(m[1]);
    const vorname = clean(m[2]);
    const herkunft = clean(m[3]);
    let ort = clean(m[4]);
    ort = fixOrtAbbrev(ort, col0);

    const name = normName(nachname, vorname);
    const funktion = clean(toText($(tds[1]).html() || ""));
    const signatur = clean(toText($(tds[2]).html() || ""));

    const role =
      /Gesellschafter/i.test(funktion) ? "gesellschafter" :
      /Geschaeftsfuehrer|Gesch[aä]ftsf[üu]hrer/i.test(funktion) ? "gf" :
      /Verwaltungsrat|Präsident/i.test(funktion) ? "vr" : "other";

    out.push({ name, anzeige: `${name}, von ${herkunft}, in ${ort}`, funktion, signatur, role, source: "html" });
  });

  const seen = new Set();
  return out.filter((p) => {
    const k = `${p.name}||${p.anzeige}||${p.funktion}||${p.signatur}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function personsFromAI(rawText) {
  if (!openai) return [];
  try {
    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input:
`Extrahiere alle Personen als JSON-Array.
Jedes Objekt: { "name":"Vorname Nachname", "anzeige":"Vorname Nachname, von X, in Y", "funktion":"...", "signatur":"..." }.
Gib NUR JSON aus, ohne Erklärtext.
Texte:
${rawText}`,
      max_output_tokens: 1000,
    });

    const data = parseJSONfromText(resp.output_text || "");
    if (!Array.isArray(data)) return [];

    return data
      .map((x) => ({
        name: clean(x.name),
        anzeige: clean(x.anzeige),
        funktion: clean(x.funktion),
        signatur: clean(x.signatur),
        role:
          /Gesellschafter/i.test(x.funktion) ? "gesellschafter" :
          /Geschaeftsfuehrer|Gesch[aä]ftsf[üu]hrer/i.test(x.funktion) ? "gf" :
          /Verwaltungsrat|Präsident/i.test(x.funktion) ? "vr" : "other",
        source: "ai",
      }))
      .filter((p) => p.name);
  } catch {
    return [];
  }
}

function shareLineFromHtmlExact(html) {
  if (!html) return "";
  const $ = cheerio.load(html);
  let exact = "";

  $("tr").each((_, tr) => {
    const cells = $(tr)
      .find("th,td")
      .map((i, el) => toText($(el).html()))
      .get()
      .map((s) => s.trim())
      .filter(Boolean);

    if (!cells.length) return;

    const row = cells.join(" | ");
    if (/Aktien[\s\-]?St(ü|ue)ckelung/i.test(row)) {
      const cell = cells.find((c) => /(Namenaktien|Stammanteile)/i.test(c));
      if (cell) {
        exact = cell;
        return false;
      }
      if (cells.length >= 2 && /Aktien[\s\-]?St(ü|ue)ckelung/i.test(cells[0])) {
        exact = cells.slice(1).join(" ").trim();
        return false;
      }
    }

    const direct = cells.find((c) => /(Namenaktien|Stammanteile)/i.test(c) && /CHF/i.test(c));
    if (direct) {
      exact = direct;
      return false;
    }
  });

  return exact;
}

function shareLineFromHtmlLoose(html) {
  const txt = toText(html);
  let m = txt.match(/(\d{1,12}(?:[’']\d{3})*)\s+(Namenaktien|Stammanteile)[^A-Za-z]{0,30}(zu|à)\s*CHF\s*([0-9'’.,]+)/i);
  if (m) return `${m[1]} ${m[2]} ${m[3]} CHF ${m[4]}`;

  m = txt.match(/(\d{1,12}(?:[’']\d{3})*)\s+(Namenaktien|Stammanteile)[^A-Za-z]{0,40}CHF\s*([0-9'’.,]+)/i);
  if (m) return `${m[1]} ${m[2]} à CHF ${m[3]}`;

  return "";
}

function shareLineFromSogc(list = []) {
  const re = /(\d{1,12}(?:[’']\d{3})*)\s+(?:Stammanteile|Namenaktien)[^C]*?(à|zu)\s*CHF\s*([0-9'’.,]+)/i;
  for (const pub of list) {
    const t = toText(pub?.message || "");
    const m = t.match(re);
    if (m) {
      const typ = /Namenaktien/i.test(m[0]) ? "Namenaktien" : "Stammanteile";
      return `${m[1]} ${typ} ${m[2]} CHF ${m[3]}`;
    }
  }
  return "";
}

function collectShareContext(html) {
  if (!html) return "";
  const $ = cheerio.load(html);
  const lines = [];
  const KEY = /(Aktien|Stammanteil|Stammkapital|Nennwert|St(ü|ue)ckelung|Liberierung|Kapital)/i;

  $("tr").each((_, tr) => {
    const cells = $(tr)
      .find("th,td")
      .map((i, el) => toText($(el).html()))
      .get()
      .map((s) => s.trim());
    if (!cells.length) return;
    const row = cells.join(" | ");
    if (KEY.test(row)) lines.push(row);
  });

  return lines.join("\n");
}

async function shareLineFromAI(html, sogcList, legalForm, companyName) {
  if (!openai) return "";
  const sogcText = (sogcList || []).map((p) => toText(p.message)).join("\n");
  const context = collectShareContext(html);
  if (!context && !sogcText) return "";

  const prompt =
`Aufgabe: Finde die exakte Zeile zur Aktien oder Stammanteils Stückelung.
Gib GENAU EINE Zeile zurück, ohne weitere Worte, exakt so wie sie in den Quellen steht.
Die Zeile muss "Namenaktien" ODER "Stammanteile" enthalten und "CHF".

Firmenname: ${companyName || ""}
Rechtsform Hinweis: ${legalForm || ""}

Relevante Auszüge (kantonaler Auszug – tabellarische Zeilen):
${context || "(leer)"}

SOGC Texte:
${sogcText || "(leer)"}

Antworte NUR mit der Zeile.
Wenn absolut nichts verlässlich vorhanden ist: ""`;

  try {
    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 200,
    });
    let out = (resp.output_text || "").trim();
    if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
      out = out.slice(1, -1);
    }
    if (/(Namenaktien|Stammanteile)/i.test(out) && /CHF/i.test(out)) return out.trim();
    return "";
  } catch {
    return "";
  }
}

async function buildVarsAndPersons({ uidCanon, companyId }) {
  const arr = await jget(`${ZEFIX_BASE}/company/uid/${encodeURIComponent(uidCanon)}`);
  const full = Array.isArray(arr) ? arr[0] : arr;
  if (!full) return { vars: {}, persons: [] };

  const legalShort = full?.legalForm?.shortName?.de || full?.legalForm?.name?.de || "";
  const adr = full?.address || full?.domicileAddress || {};
  const adresse = [adr.street, adr.houseNumber].filter(Boolean).join(" ").trim();
  const plz = adr.swissZipCode || adr.postalCode || "";
  const ort = adr.city || full?.legalSeat || "";

  let persons = personsFromSogc(full?.sogcPub || []);
  const html = await getHtml(full?.cantonalExcerptWeb);
  persons = persons.concat(personsFromHtml(html));

  if (openai) {
    const ai = await personsFromAI(
      toText(html) + "\n\n" + (full?.sogcPub || []).map((p) => toText(p.message)).join("\n")
    );
    persons = persons.concat(ai);
  }

  const seen = new Set();
  persons = persons.filter((p) => {
    const k = `${p.name}||${p.anzeige}||${p.funktion}||${p.signatur}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const rank = { gesellschafter: 3, gf: 2, vr: 1, other: 0 };
  persons.sort((a, b) => (rank[b.role] - rank[a.role]) || a.name.localeCompare(b.name, "de"));

  const stueckelung =
    shareLineFromHtmlExact(html) ||
    shareLineFromHtmlLoose(html) ||
    shareLineFromSogc(full?.sogcPub || []) ||
    (await shareLineFromAI(html, full?.sogcPub || [], legalShort, clean(full?.name)));

  const builtVars = {
    CompanyName: clean(full?.name),
    Adresse: adresse,
    PLZ: String(plz || ""),
    ORT: clean(ort),
    UID: clean(full?.uid),
    Stammkapital: (full?.capitalNominal != null ? String(full.capitalNominal) : ""),
    Stammanteil: stueckelung || "",
    currentYear: String(new Date().getFullYear()),
    gesellschafter: "",
    Gesellschafter_ort: "",
  };

  const auto = persons.find((p) => p.role === "gesellschafter");
  if (auto) {
    builtVars.gesellschafter = auto.name;
    builtVars.Gesellschafter_ort = auto.anzeige;
  }

  if (companyId) {
    const curr = await dbLoadVars(companyId);
    const merged = { ...curr, ...builtVars };
    await dbSaveVars(companyId, merged);

    const canon = normalizeUid(merged.UID);
    await updateCompanyProfileAndUid(companyId, {
      uidCanon: canon || null,
      uidDisplay: canon || null,
      profilePatch: {
        CompanyName: merged.CompanyName || "",
        Adresse: merged.Adresse || "",
        PLZ: merged.PLZ || "",
        ORT: merged.ORT || "",
        Stammkapital: merged.Stammkapital || "",
        Stammanteil: merged.Stammanteil || "",
        gesellschafter: merged.gesellschafter || "",
        Gesellschafter_ort: merged.Gesellschafter_ort || "",
        currentYear: merged.currentYear || "",
      },
    });

    return { vars: merged, persons };
  }

  return { vars: builtVars, persons };
}

async function loadUsers() {
  const raw = await fs.readFile(USERS_FILE, "utf8");
  return JSON.parse(raw);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateCH(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickNumber(companyId, salt, min, max) {
  const h = hash32(`${companyId}::${salt}`);
  const t = h / 0xffffffff;
  return Math.round(min + t * (max - min));
}

function computeSimValue(key, companyId) {
  const k = String(key || "").toLowerCase();

  if (k.includes("datum")) return dateCH(new Date());
  if (k.includes("zeit")) return "10:00";

  if (k.includes("treuhand")) return "Marzo Treuhand";

  if (k.includes("totaleaktiven") || k.includes("aktiven")) return String(pickNumber(companyId, key, 90000, 250000));
  if (k.includes("reserven")) return String(pickNumber(companyId, key, 2000, 25000));
  if (k.includes("gewinnvortrag")) return String(pickNumber(companyId, key, 0, 30000));
  if (k === "gewinn") return String(pickNumber(companyId, key, 0, 60000));
  if (k.includes("gewinnverlust")) return String(pickNumber(companyId, key, -20000, 40000));

  return "";
}

async function simulateExtractForCompany(companyId) {
  const curr = await dbLoadVars(companyId);

  const miss = await readMissing(companyId);
  const missingKeys = Array.isArray(miss.missing) ? miss.missing : [];

  const patch = {};
  for (const key of missingKeys) {
    const curVal = String(curr?.[key] ?? "").trim();
    if (curVal) continue;

    const v = computeSimValue(key, companyId);
    if (v) patch[key] = v;
  }

  if (!missingKeys.length) {
    const fallbackKeys = ["schlussZeit", "protokollDatum", "TreuhandName", "vollstaendigkeitDatum"];
    for (const key of fallbackKeys) {
      const curVal = String(curr?.[key] ?? "").trim();
      if (curVal) continue;
      const v = computeSimValue(key, companyId);
      if (v) patch[key] = v;
    }
  }

  const vars = { ...curr, ...patch };
  if (Object.keys(patch).length) {
    await dbSaveVars(companyId, vars);

    await updateCompanyProfileAndUid(companyId, {
      uidCanon: normalizeUid(vars.UID) || null,
      uidDisplay: normalizeUid(vars.UID) ? formatUID(normalizeUid(vars.UID)) : null,
      profilePatch: patch,
    });
  }

  const year = Number(String(vars.currentYear || new Date().getFullYear()));
  const fibuPayload = {
    startOfPeriod: `${year}-01-01`,
    endOfPeriod: `${year}-12-31`,
    simulated: true,
  };
  await updateCompanyFibu(companyId, fibuPayload);

  if (Array.isArray(miss.relevant) && miss.relevant.length) {
    const relevant = miss.relevant;
    const newMissing = relevant.filter((k) => !String(vars?.[k] ?? "").trim());
    await writeMissing(companyId, {
      ...miss,
      values: vars,
      missing: newMissing,
      missing_count: newMissing.length,
      timestamp: new Date().toISOString(),
      simulated: false,
    });
  }

  return { patchKeys: Object.keys(patch) };
}

async function assertAllPdfPresent() {
  const missing = [];
  for (const [k, p] of Object.entries(PDF)) {
    try {
      await fs.stat(p);
    } catch {
      missing.push({ k, path: p });
    }
  }
  return missing;
}

app.get("/api/templates", async (_req, res) => {
  try {
    const txt = await fs.readFile(TEMPLATES_FILE, "utf8");
    const arr = JSON.parse(txt);
    return res.json({ ok: true, templates: Array.isArray(arr) ? arr : [] });
  } catch {
    return res.json({
      ok: true,
      templates: [
        { id: "std", name: "Standard" },
        { id: "gmbh", name: "GmbH" },
        { id: "ag", name: "AG" },
      ],
    });
  }
});

app.get("/api/db-ping", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    return res.json({ ok: true, rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, message: "Email und Passwort nötig" });

  const users = await loadUsers();
  const user = users.find((u) => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ ok: false, message: "Login fehlgeschlagen" });

  return res.json({ ok: true, user: { email: user.email, role: user.role } });
});

app.get("/api/companies", async (_req, res) => {
  const list = await listCompanies();
  res.json(list);
});

app.get("/api/companies/:id", async (req, res) => {
  const c = await getCompany(String(req.params.id).trim());
  if (!c) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, company: c });
});

app.post("/api/companies", async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ ok: false, error: "Firmenname fehlt" });
    }

    const now = nowIso();
    const id = Date.now().toString(36);

    const entry = normalizeCompanyShape({
      id,
      name: String(name).trim(),
      uid: null,
      uidCanon: null,
      archived: false,
      profile: {},
      fibu: null,
      createdAt: now,
      updatedAt: now,
      projects: [],
    });

    let best = null;
    try {
      const s = await jget(`${ZEFIX_BASE}/company/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: entry.name, max: 5, offset: 0 }),
      });
      const list = Array.isArray(s?.companies) ? s.companies : (Array.isArray(s) ? s : []);
      best = list[0] || null;
    } catch {}

    if (best) {
      const rawUid = best.uid || best.uidNumber || "";
      const canon = normalizeUid(rawUid);
      if (canon) {
        entry.uidCanon = canon;
        entry.uid = canon;
      }
    }

    await upsertCompany(entry);

    if (entry.uidCanon) {
      try {
        await buildVarsAndPersons({ uidCanon: entry.uidCanon, companyId: entry.id });
      } catch {}
    }

    const reloaded = await getCompany(entry.id);
    return res.json({ ok: true, company: reloaded || entry });
  } catch (e) {
    console.error("POST /api/companies", e);
    return res.status(500).json({ ok: false, error: "create failed" });
  }
});

app.post("/api/companies/:id/hydrate-vars", async (req, res) => {
  try {
    const companyId = String(req.params.id).trim();
    const company = await getCompany(companyId);
    if (!company) return res.status(404).json({ ok: false, error: "not found" });

    const curr = await dbLoadVars(companyId);
    const p = company.profile || {};

    const base = {
      CompanyName: p.CompanyName || company.name || "",
      Adresse: p.Adresse || "",
      PLZ: p.PLZ || "",
      ORT: p.ORT || "",
      UID: company.uid || "",
      Stammkapital: p.Stammkapital || "",
      Stammanteil: p.Stammanteil || "",
      gesellschafter: p.gesellschafter || "",
      Gesellschafter_ort: p.Gesellschafter_ort || "",
      currentYear: p.currentYear || String(new Date().getFullYear()),
    };

    const vars = { ...base, ...curr };
    await dbSaveVars(companyId, vars);

    return res.json({ ok: true, vars, companyId });
  } catch (e) {
    console.error("hydrate-vars failed", e);
    return res.status(500).json({ ok: false, error: "hydrate failed" });
  }
});

app.post("/api/companies/:id/projects", async (req, res) => {
  try {
    const companyId = String(req.params.id).trim();
    const { title, status } = req.body || {};
    if (!title) return res.status(400).json({ ok: false, error: "title fehlt" });

    const company = await getCompany(companyId);
    if (!company) return res.status(404).json({ ok: false, error: "company not found" });

    const projectId = await createProject({ companyId, title: String(title), status: status || "In Arbeit" });
    if (!projectId) return res.status(500).json({ ok: false, error: "project create failed" });

    const reloaded = await getCompany(companyId);
    const created = (reloaded.projects || []).find((p) => p.id === projectId) || { id: projectId, title, status };

    return res.json({ ok: true, project: created });
  } catch (e) {
    console.error("create project failed", e);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

app.get("/api/companies/:id/projects/:projectId/content", async (req, res) => {
  try {
    const companyId = String(req.params.id).trim();
    const projectId = String(req.params.projectId).trim();

    const company = await getCompany(companyId);
    const exists = !!(company && (company.projects || []).some((p) => p.id === projectId));
    if (!exists) return res.status(404).json({ ok: false, error: "project not found" });

    const html = await getProjectContent(projectId);
    return res.json({ ok: true, html });
  } catch (e) {
    console.error("get project content failed", e);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

app.post("/api/companies/:id/projects/:projectId/content", async (req, res) => {
  try {
    const companyId = String(req.params.id).trim();
    const projectId = String(req.params.projectId).trim();
    const { html } = req.body || {};
    if (typeof html !== "string") return res.status(400).json({ ok: false, error: "html muss string sein" });

    const company = await getCompany(companyId);
    const exists = !!(company && (company.projects || []).some((p) => p.id === projectId));
    if (!exists) return res.status(404).json({ ok: false, error: "project not found" });

    await upsertProjectContent({ projectId, html });
    return res.json({ ok: true });
  } catch (e) {
    console.error("save project content failed", e);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

app.get("/api/vars/current", async (req, res) => {
  try {
    const companyId = String(req.query.companyId || "").trim();
    if (!companyId) return res.json({ ok: true, vars: {}, companyId: "" });
    const vars = await dbLoadVars(companyId);
    return res.json({ ok: true, vars, companyId });
  } catch (e) {
    console.error("vars/current failed", e);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

app.post("/api/vars/patch", async (req, res) => {
  try {
    const companyId = String(req.query.companyId || "").trim();
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId fehlt" });

    const incoming = req.body || {};
    const curr = await dbLoadVars(companyId);

    const ALLOWED_KEYS = [
      "CompanyName", "Adresse", "PLZ", "ORT", "UID",
      "Stammkapital", "Stammanteil",
      "gesellschafter", "Gesellschafter_ort", "currentYear",
      "gesellschafterHerkunft",
      "schlussZeit",
      "protokollDatum",
      "TreuhandName",
      "vollstaendigkeitDatum",
      "totaleAktiven",
      "gesetzlicheReserven",
      "Gewinnvortrag",
      "Gewinn",
      "gewinnVerlustVortrag",
    ];

    const patch = {};
    for (const k of ALLOWED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(incoming, k)) {
        patch[k] = incoming[k] == null ? "" : String(incoming[k]).trim();
      }
    }

    const vars = { ...curr, ...patch };
    await dbSaveVars(companyId, vars);

    const canon = normalizeUid(vars.UID);
    await updateCompanyProfileAndUid(companyId, {
      uidCanon: canon || null,
      uidDisplay: canon || null,
      profilePatch: {
        CompanyName: vars.CompanyName || "",
        Adresse: vars.Adresse || "",
        PLZ: vars.PLZ || "",
        ORT: vars.ORT || "",
        Stammkapital: vars.Stammkapital || "",
        Stammanteil: vars.Stammanteil || "",
        gesellschafter: vars.gesellschafter || "",
        Gesellschafter_ort: vars.Gesellschafter_ort || "",
        currentYear: vars.currentYear || "",
        gesellschafterHerkunft: vars.gesellschafterHerkunft || "",
        schlussZeit: vars.schlussZeit || "",
        protokollDatum: vars.protokollDatum || "",
        TreuhandName: vars.TreuhandName || "",
        vollstaendigkeitDatum: vars.vollstaendigkeitDatum || "",
      },
    });

    return res.json({ ok: true, vars });
  } catch (e) {
    console.error("vars/patch failed", e);
    return res.status(500).json({ ok: false, error: "patch failed" });
  }
});

app.post("/api/vars/person", async (req, res) => {
  try {
    const companyId = String(req.query.companyId || "").trim();
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId fehlt" });

    const { name, anzeige } = req.body || {};
    const curr = await dbLoadVars(companyId);

    const vars = {
      ...curr,
      gesellschafter: clean(name),
      Gesellschafter_ort: clean(anzeige),
    };

    await dbSaveVars(companyId, vars);
    await updateCompanyProfileAndUid(companyId, {
      uidCanon: normalizeUid(vars.UID) || null,
      uidDisplay: normalizeUid(vars.UID) ? formatUID(normalizeUid(vars.UID)) : null,
      profilePatch: {
        gesellschafter: vars.gesellschafter || "",
        Gesellschafter_ort: vars.Gesellschafter_ort || "",
      },
    });

    return res.json({ ok: true, vars });
  } catch (e) {
    console.error("vars/person failed", e);
    return res.status(500).json({ ok: false, error: "persist failed" });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const name = clean(req.query.name || "");
    if (name.length < 3) return res.json([]);

    const data = await jget(`${ZEFIX_BASE}/company/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, max: 20, offset: 0 }),
    });

    const list = Array.isArray(data?.companies) ? data.companies : (Array.isArray(data) ? data : []);
    res.json(
      list.map((c) => ({
        uid: c.uid || c.uidNumber || "",
        name: c.name || "",
        legalSeat: c.legalSeat || c.city || "",
        legalForm: c.legalForm?.shortName?.de || c.legalForm?.name?.de || "",
      }))
    );
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/vars/build", async (req, res) => {
  try {
    const uid = normalizeUid(clean(req.query.uid || ""));
    const id = clean(req.query.id || "");
    if (!uid) return res.status(400).json({ error: "uid fehlt" });

    let companyId = id;
    if (!companyId) {
      const companies = await listCompanies();
      const c = companies.find((x) => (x.uidCanon || "") === uid) || null;
      companyId = c ? c.id : "";
    }

    const out = await buildVarsAndPersons({ uidCanon: uid, companyId: companyId || null });
    return res.json(out);
  } catch (e) {
    console.error("vars/build failed", e);
    return res.status(500).json({ error: "build failed" });
  }
});

app.get("/api/missing", async (req, res) => {
  try {
    const companyId = String(req.query.companyId || "").trim();
    const projectId = String(req.query.projectId || "").trim();

    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId fehlt" });
    }

    if (projectId) {
      const company = await getCompany(companyId);
      const exists = !!(company && (company.projects || []).some((p) => p.id === projectId));
      if (!exists) {
        return res.status(404).json({ ok: false, error: "project not found" });
      }

      const out = await buildMissingFromProject(companyId, projectId);
      await writeMissing(companyId, out);

      return res.json({
        ok: true,
        companyId,
        projectId,
        ...out,
      });
    }

    const saved = await readMissing(companyId);
    const varsCompany = await dbLoadVars(companyId);
    const merged = { ...(saved.values || {}), ...(varsCompany || {}) };

    return res.json({
      ok: true,
      vars: merged,
      relevant: saved.relevant || [],
      missing: saved.missing || [],
      invalid: saved.invalid || [],
      missing_count: saved.missing_count || 0,
      docId: saved.docId || "default",
      companyId,
    });
  } catch (e) {
    console.error("GET /api/missing failed", e);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

app.post("/api/missing/update", async (req, res) => {
  try {
    const companyId = String(req.query.companyId || "").trim();
    const projectId = String(req.query.projectId || "").trim();

    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId fehlt" });
    }

    if (!projectId) {
      return res.status(400).json({ ok: false, error: "projectId fehlt" });
    }

    const company = await getCompany(companyId);
    const exists = !!(company && (company.projects || []).some((p) => p.id === projectId));
    if (!exists) {
      return res.status(404).json({ ok: false, error: "project not found" });
    }

    const incoming = req.body?.values;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({ ok: false, error: "values fehlt oder ist ungültig" });
    }

    const html = await dbGetProjectContent(projectId);
    const relevant = extractPlaceholdersFromHtml(html);

    const curr = await dbLoadVars(companyId);
    const patch = {};

    for (const key of relevant) {
      if (Object.prototype.hasOwnProperty.call(incoming, key)) {
        patch[key] = incoming[key] == null ? "" : String(incoming[key]).trim();
      }
    }

    const mergedVars = { ...curr, ...patch };
    const normalized = normalizeAndValidateVars(mergedVars, Object.keys(mergedVars));
    const vars = normalized.vars;

    await dbSaveVars(companyId, vars);

    const canon = normalizeUid(vars.UID);
    await updateCompanyProfileAndUid(companyId, {
      uidCanon: canon || null,
      uidDisplay: canon ? formatUID(canon) : null,
      profilePatch: patch,
    });

    const out = {
      ...computeMissingFromVars(vars, relevant),
      docId: projectId,
      timestamp: new Date().toISOString(),
    };

    await writeMissing(companyId, out);

    return res.json({
      ok: true,
      companyId,
      projectId,
      updated: Object.keys(patch),
      ...out,
    });
  } catch (e) {
    console.error("POST /api/missing/update failed", e);
    return res.status(500).json({ ok: false, error: "missing update failed" });
  }
});

function escapePdfText(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}



const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TMP_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${file.fieldname}-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

app.get("/api/upload/state", async (_req, res) => {
  try {
    const out = { fibu: false, stamm: false, verlust: false, all: false, files: {} };
    for (const [k, p] of Object.entries(PDF)) {
      try {
        const st = await fs.stat(p);
        out[k] = st.isFile();
        out.files[k] = { path: p, mtime: st.mtimeMs };
      } catch {
        out[k] = false;
        out.files[k] = { path: p, mtime: 0 };
      }
    }
    out.all = !!(out.fibu && out.stamm && out.verlust);
    return res.json({ ok: true, ...out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post(
  "/api/upload",
  upload.fields([
    { name: "fibu", maxCount: 1 },
    { name: "stamm", maxCount: 1 },
    { name: "verlust", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      await fs.mkdir(PDF_DIR, { recursive: true });

      const companyId = String(req.body?.companyId || req.query?.companyId || "").trim();
      const projectId = String(req.body?.projectId || req.query?.projectId || "").trim() || null;

      if (!companyId) {
        return res.status(400).json({ ok: false, error: "companyId fehlt" });
      }

      const m = req.files || {};
      const fibuIn = m.fibu?.[0];
      const stammIn = m.stamm?.[0];
      const verlustIn = m.verlust?.[0];

      if (!fibuIn || !stammIn || !verlustIn) {
        return res.status(400).json({ ok: false, error: "Alle drei Dateien sind erforderlich." });
      }

      const outDir = path.join(__dirname, "data", "converted");
      await fs.mkdir(outDir, { recursive: true });

      const fibuPdf = await convertAnyToPdf(fibuIn.path, outDir);
      const stammPdf = await convertAnyToPdf(stammIn.path, outDir);
      const verlustPdf = await convertAnyToPdf(verlustIn.path, outDir);

      await fs.mkdir(PDF_DIR, { recursive: true });
      await fs.copyFile(fibuPdf, PDF.fibu);
      await fs.copyFile(stammPdf, PDF.stamm);
      await fs.copyFile(verlustPdf, PDF.verlust);

      await dbCreateUploadMeta({
        id: makeId("upl"),
        companyId,
        projectId,
        docType: "fibu",
        originalName: fibuIn.originalname,
        storedPath: PDF.fibu,
        fileSize: fibuIn.size ?? null,
        mimeType: fibuIn.mimetype ?? null,
      });

      await dbCreateUploadMeta({
        id: makeId("upl"),
        companyId,
        projectId,
        docType: "stamm",
        originalName: stammIn.originalname,
        storedPath: PDF.stamm,
        fileSize: stammIn.size ?? null,
        mimeType: stammIn.mimetype ?? null,
      });

      await dbCreateUploadMeta({
        id: makeId("upl"),
        companyId,
        projectId,
        docType: "verlust",
        originalName: verlustIn.originalname,
        storedPath: PDF.verlust,
        fileSize: verlustIn.size ?? null,
        mimeType: verlustIn.mimetype ?? null,
      });

      await Promise.allSettled([
        fs.unlink(fibuIn.path),
        fs.unlink(stammIn.path),
        fs.unlink(verlustIn.path),
        fs.unlink(fibuPdf).catch(() => {}),
        fs.unlink(stammPdf).catch(() => {}),
        fs.unlink(verlustPdf).catch(() => {}),
      ]);

      return res.json({ ok: true, simulated: false });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  }
);


app.post("/api/upload/fibu", upload.single("file"), async (req, res) => {
  try {
    const companyId = String(req.body?.companyId || req.query?.companyId || "").trim();
    const projectId = String(req.body?.projectId || req.query?.projectId || "").trim() || null;

    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId fehlt" });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "kein File" });
    }

    const outDir = path.join(__dirname, "data", "converted");
    await fs.mkdir(PDF_DIR, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    const pdf = await convertAnyToPdf(req.file.path, outDir);
    await fs.copyFile(pdf, PDF.fibu);

    await dbCreateUploadMeta({
      id: makeId("upl"),
      companyId,
      projectId,
      docType: "fibu",
      originalName: req.file.originalname,
      storedPath: PDF.fibu,
      fileSize: req.file.size ?? null,
      mimeType: req.file.mimetype ?? null,
    });

    await Promise.allSettled([
      fs.unlink(req.file.path),
      fs.unlink(pdf).catch(() => {}),
    ]);

    res.json({ ok: true, simulated: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/upload/verlust", upload.single("file"), async (req, res) => {
  try {
    const companyId = String(req.body?.companyId || req.query?.companyId || "").trim();
    const projectId = String(req.body?.projectId || req.query?.projectId || "").trim() || null;

    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId fehlt" });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "kein File" });
    }

    const outDir = path.join(__dirname, "data", "converted");
    await fs.mkdir(PDF_DIR, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    const pdf = await convertAnyToPdf(req.file.path, outDir);
    await fs.copyFile(pdf, PDF.verlust);

    await dbCreateUploadMeta({
      id: makeId("upl"),
      companyId,
      projectId,
      docType: "verlust",
      originalName: req.file.originalname,
      storedPath: PDF.verlust,
      fileSize: req.file.size ?? null,
      mimeType: req.file.mimetype ?? null,
    });

    await Promise.allSettled([
      fs.unlink(req.file.path),
      fs.unlink(pdf).catch(() => {}),
    ]);

    res.json({ ok: true, simulated: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/upload/stamm", upload.single("file"), async (req, res) => {
  try {
    const companyId = String(req.body?.companyId || req.query?.companyId || "").trim();
    const projectId = String(req.body?.projectId || req.query?.projectId || "").trim() || null;

    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId fehlt" });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "kein File" });
    }

    const outDir = path.join(__dirname, "data", "converted");
    await fs.mkdir(PDF_DIR, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    const pdf = await convertAnyToPdf(req.file.path, outDir);
    await fs.copyFile(pdf, PDF.stamm);

    await dbCreateUploadMeta({
      id: makeId("upl"),
      companyId,
      projectId,
      docType: "stamm",
      originalName: req.file.originalname,
      storedPath: PDF.stamm,
      fileSize: req.file.size ?? null,
      mimeType: req.file.mimetype ?? null,
    });

    await Promise.allSettled([
      fs.unlink(req.file.path),
      fs.unlink(pdf).catch(() => {}),
    ]);

    res.json({ ok: true, simulated: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});


app.post("/api/reset", async (_req, res) => {
  try {
    await Promise.allSettled([safeUnlink(PDF.fibu), safeUnlink(PDF.stamm), safeUnlink(PDF.verlust)]);
    return res.json({ ok: true, reset: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "reset failed" });
  }
});


app.post("/api/start", async (req, res) => {
  const companyId = String(req.body?.companyId || "").trim();
  const projectId = String(req.body?.projectId || "").trim() || null;
  const phase = String(req.body?.phase || "extract").trim() || "extract";

  if (!companyId) {
    return apiError(res, 400, "VALIDATION_ERROR", "companyId fehlt");
  }

  if (!lock(companyId)) {
    return apiError(
      res,
      409,
      "RUN_ALREADY_ACTIVE",
      "Für diese Firma läuft bereits ein Workflow",
      { companyId }
    );
  }

  const runId = makeId("run");

  try {
    await dbCreateRun({
      id: runId,
      companyId,
      projectId,
      phase,
      status: "running",
    });

    const missingFiles = await assertAllPdfPresent();
    if (missingFiles.length) {
      await dbFinishRun(runId, "failed", {
        error: "missing files",
        missing: missingFiles,
      });

      logEvent("warn", "workflow start failed - missing files", {
        companyId,
        projectId,
        runId,
        missingFiles,
      });

      return apiError(
        res,
        400,
        "MISSING_FILES",
        "Nicht alle erforderlichen Dateien sind vorhanden",
        { runId, missing: missingFiles }
      );
    }

    const workflowResponse = await triggerWorkflow({
      companyId,
      projectId,
      runId,
      phase,
    });

    await pool.query(
      `UPDATE project_runs
       SET status = ?
       WHERE id = ?`,
      ["waiting_callback", runId]
    );

    logEvent("info", "workflow started", {
      companyId,
      projectId,
      runId,
      phase,
    });

    return res.json({
      ok: true,
      runId,
      phase,
      status: "waiting_callback",
      workflow: workflowResponse || null,
    });
  } catch (e) {
    await dbFinishRun(runId, "failed", {
      error: String(e),
    }).catch(() => {});

    logEvent("error", "workflow start exception", {
      companyId,
      projectId,
      runId,
      error: String(e),
    });

    return apiError(
      res,
      500,
      "WORKFLOW_START_FAILED",
      "Workflow konnte nicht gestartet werden",
      { runId, details: String(e) }
    );
  } finally {
    unlock(companyId);
  }
});

app.post("/api/finalize", async (req, res) => {
  const companyId = String(req.body?.companyId || "").trim();
  const projectId = String(req.body?.projectId || "").trim() || null;
  const template = String(req.body?.template || "").trim();

  if (!companyId) {
    return res.status(400).json({ ok: false, error: "companyId fehlt" });
  }

  if (!template) {
    return res.status(400).json({ ok: false, error: "template fehlt" });
  }

  if (!lock(companyId)) {
    return res.status(409).json({ ok: false, msg: "Flow läuft bereits", companyId });
  }

  const runId = makeId("run");

  try {
    await dbCreateRun({
      id: runId,
      companyId,
      projectId,
      phase: "finalize",
      status: "running",
    });

    const missing = await assertAllPdfPresent();
    if (missing.length) {
      await dbFinishRun(runId, "failed", { error: "missing files", missing });
      return res.status(400).json({ ok: false, error: "missing files", missing, runId });
    }

    await simulateExtractForCompany(companyId);

    await Promise.allSettled([
      safeUnlink(PDF.fibu),
      safeUnlink(PDF.stamm),
      safeUnlink(PDF.verlust),
    ]);

    await dbFinishRun(runId, "success", {
      simulated: false,
      template,
    });

    return res.json({ ok: true, simulated: false, template, runId });
  } catch (e) {
    await dbFinishRun(runId, "failed", { error: String(e) }).catch(() => {});
    return res.status(500).json({ ok: false, error: String(e), runId });
  } finally {
    unlock(companyId);
  }
});

app.post("/api/workflow/callback", async (req, res) => {
  const companyId = String(req.query.companyId || req.body?.companyId || "").trim();
  const projectId = String(req.query.projectId || req.body?.projectId || "").trim() || null;
  const runId = String(req.query.runId || req.body?.runId || "").trim() || null;

  const token = req.get("x-workflow-token");
  if (!token || token !== WORKFLOW_TOKEN) {
    logEvent("warn", "workflow callback unauthorized", { companyId, projectId, runId });
    return apiError(res, 401, "UNAUTHORIZED", "Ungültiger Workflow-Token");
  }

  if (!companyId) {
    return apiError(res, 400, "VALIDATION_ERROR", "companyId fehlt");
  }

  if (!runId) {
    return apiError(res, 400, "VALIDATION_ERROR", "runId fehlt");
  }

  const source = req.body?.vars || req.body?.data || req.body || {};
  const payload = Array.isArray(source) ? source[0] : source;

  if (!payload || typeof payload !== "object" || Object.keys(payload).length === 0) {
    logEvent("warn", "workflow callback empty payload", { companyId, projectId, runId });
    return apiError(res, 400, "EMPTY_PAYLOAD", "Workflow hat keine Daten geliefert", {
      companyId,
      projectId,
      runId,
    });
  }

  try {
    await dbCreateRawResult({
      id: makeId("raw"),
      companyId,
      projectId,
      runId,
      source: "workflow_callback",
      payload: req.body,
    });

    const currentVars = await dbLoadVars(companyId);
    const patch = mapWorkflowPayloadToVars(payload);
    const mergedVars = { ...currentVars, ...patch };

    const normalized = normalizeAndValidateVars(
      mergedVars,
      Object.keys(mergedVars)
    );

    await dbSaveVars(companyId, normalized.vars);

    const canon = normalizeUid(normalized.vars.UID);
    await updateCompanyProfileAndUid(companyId, {
      uidCanon: canon || null,
      uidDisplay: canon ? formatUID(canon) : null,
      profilePatch: patch,
    });

    if (payload.startOfPeriod || payload.endOfPeriod) {
      const fibuPayload = {};
      if (payload.startOfPeriod) {
        const normalizedStart = normalizeDateValue(payload.startOfPeriod);
        fibuPayload.startOfPeriod = normalizedStart || payload.startOfPeriod;
      }
      if (payload.endOfPeriod) {
        const normalizedEnd = normalizeDateValue(payload.endOfPeriod);
        fibuPayload.endOfPeriod = normalizedEnd || payload.endOfPeriod;
      }
      await updateCompanyFibu(companyId, fibuPayload);
    }

    if (projectId) {
      const missingState = await buildMissingFromProject(companyId, projectId);
      await writeMissing(companyId, missingState);
    }

    await dbFinishRun(runId, "success", {
      callbackReceived: true,
      updated: Object.keys(patch),
      invalid: normalized.invalid,
    }).catch(() => {});

    logEvent("info", "workflow callback processed", {
      companyId,
      projectId,
      runId,
      updated: Object.keys(patch),
      invalid: normalized.invalid,
    });

    return res.json({
      ok: true,
      runId,
      updated: Object.keys(patch),
      invalid: normalized.invalid,
    });
  } catch (e) {
    await dbFinishRun(runId, "failed", {
      callbackReceived: true,
      error: String(e),
    }).catch(() => {});

    logEvent("error", "workflow callback exception", {
      companyId,
      projectId,
      runId,
      error: String(e),
    });

    return apiError(
      res,
      500,
      "CALLBACK_PROCESSING_FAILED",
      "Workflow-Callback konnte nicht verarbeitet werden",
      {
        companyId,
        projectId,
        runId,
        details: String(e),
      }
    );
  }
});

app.get("/api/companies/:id/fibu", async (req, res) => {
  try {
    const id = String(req.params.id).trim();
    const company = await getCompany(id);
    if (!company) return res.status(404).json({ ok: false, error: "not found" });
    return res.json({ ok: true, fibu: company.fibu || null });
  } catch (e) {
    console.error("get fibu failed", e);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

app.patch("/api/companies/:id", async (req, res) => {
  try {
    const companyId = String(req.params.id || "").trim();
    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId fehlt" });
    }

    const { name, archived } = req.body || {};

    if (name !== undefined && String(name).trim().length < 2) {
      return res.status(400).json({ ok: false, error: "Firmenname zu kurz" });
    }

    const updated = await updateCompany(companyId, { name, archived });

    if (!updated) {
      return res.status(404).json({ ok: false, error: "not found" });
    }

    const company = await getCompany(companyId);
    return res.json({ ok: true, company });
  } catch (e) {
    console.error("PATCH /api/companies/:id failed", e);
    return res.status(500).json({ ok: false, error: "update failed" });
  }
});

app.delete("/api/companies/:id", async (req, res) => {
  const companyId = String(req.params.id || "").trim();
  if (!companyId) return res.status(400).json({ ok: false, error: "companyId fehlt" });

  const purgeVars = String(req.query.purgeVars || "").toLowerCase() === "true";

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [cRows] = await conn.query(`SELECT id FROM companies WHERE id=? LIMIT 1`, [companyId]);
    if (!cRows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "not found", id: companyId });
    }

    const [pRows] = await conn.query(`SELECT id FROM projects WHERE company_id=?`, [companyId]);
    const projectIds = pRows.map(r => r.id).filter(Boolean);

    if (projectIds.length) {
      const ph = projectIds.map(() => "?").join(",");
      await conn.query(`DELETE FROM project_contents WHERE project_id IN (${ph})`, projectIds);
    }

    await conn.query(`DELETE FROM projects WHERE company_id=?`, [companyId]);

    if (purgeVars) {
      await conn.query(`DELETE FROM company_vars WHERE company_id=?`, [companyId]);
    }

    await conn.query(`DELETE FROM project_uploads WHERE company_id=?`, [companyId]);
    await conn.query(`DELETE FROM workflow_results_raw WHERE company_id=?`, [companyId]);
    await conn.query(`DELETE FROM project_runs WHERE company_id=?`, [companyId]);
    await conn.query(`DELETE FROM companies WHERE id=?`, [companyId]);

    await conn.commit();

    try { await fs.unlink(getMissingPath(companyId)); } catch {}

    return res.json({ ok: true, deleted: companyId, purged: purgeVars });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error("DELETE /api/companies failed", e);
    return res.status(500).json({ ok: false, error: "delete failed" });
  } finally {
    conn.release();
  }
});

app.patch("/api/companies/:id/projects/:projectId", async (req, res) => {
  try {
    const companyId = String(req.params.id || "").trim();
    const projectId = String(req.params.projectId || "").trim();

    if (!companyId || !projectId) {
      return res.status(400).json({ ok: false, error: "companyId oder projectId fehlt" });
    }

    const { title, status } = req.body || {};

    if (title !== undefined && String(title).trim().length < 2) {
      return res.status(400).json({ ok: false, error: "Projekttitel zu kurz" });
    }

    const updated = await updateProject(companyId, projectId, { title, status });

    if (!updated) {
      return res.status(404).json({ ok: false, error: "project not found" });
    }

    const company = await getCompany(companyId);
    const project = (company?.projects || []).find((p) => p.id === projectId) || null;

    return res.json({ ok: true, project });
  } catch (e) {
    console.error("PATCH /api/companies/:id/projects/:projectId failed", e);
    return res.status(500).json({ ok: false, error: "update failed" });
  }
});

app.delete("/api/companies/:id/projects/:projectId", async (req, res) => {
  try {
    const companyId = String(req.params.id || "").trim();
    const projectId = String(req.params.projectId || "").trim();

    if (!companyId || !projectId) {
      return res.status(400).json({ ok: false, error: "companyId oder projectId fehlt" });
    }

    const deleted = await deleteProject(companyId, projectId);

    if (!deleted) {
      return res.status(404).json({ ok: false, error: "project not found" });
    }

    return res.json({ ok: true, deleted: projectId });
  } catch (e) {
    console.error("DELETE /api/companies/:id/projects/:projectId failed", e);
    return res.status(500).json({ ok: false, error: "delete failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft: http://localhost:${PORT}`));
