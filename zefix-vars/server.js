require("dotenv").config();

const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const cors = require("cors");
const cheerio = require("cheerio");
const multer = require("multer");

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
  return clean(u);
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

async function readCompanies() {
  const arr = await readJsonFile(COMPANIES_FILE, []);
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeCompanyShape).filter((c) => c.id);
}

async function writeCompanies(list) {
  await writeJsonFileAtomic(COMPANIES_FILE, Array.isArray(list) ? list : []);
}

async function listCompanies() {
  const companies = await readCompanies();
  companies.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return companies;
}

async function getCompany(companyId) {
  const companies = await readCompanies();
  return companies.find((c) => c.id === companyId) || null;
}

async function upsertCompany(entry) {
  const companies = await readCompanies();
  const idx = companies.findIndex((c) => c.id === entry.id);
  const normalized = normalizeCompanyShape(entry);

  if (idx >= 0) {
    const existing = companies[idx];
    const merged = normalizeCompanyShape({
      ...existing,
      ...normalized,
      profile: { ...(existing.profile || {}), ...(normalized.profile || {}) },
      projects: Array.isArray(normalized.projects) && normalized.projects.length ? normalized.projects : existing.projects,
      fibu: normalized.fibu !== undefined ? normalized.fibu : existing.fibu,
      updatedAt: nowIso(),
    });
    companies[idx] = merged;
  } else {
    companies.push(normalizeCompanyShape({ ...normalized, createdAt: normalized.createdAt || nowIso(), updatedAt: nowIso() }));
  }

  await writeCompanies(companies);
}

async function deleteCompany(companyId, { purgeVars } = { purgeVars: false }) {
  const companies = await readCompanies();
  const c = companies.find((x) => x.id === companyId);
  if (!c) return { ok: false, reason: "not found" };

  const remaining = companies.filter((x) => x.id !== companyId);
  await writeCompanies(remaining);

  try { await fs.unlink(getMissingPath(companyId)); } catch {}

  if (purgeVars) {
    try { await fs.unlink(getVarsPath(companyId)); } catch {}
  }

  const pc = await readJsonFile(PROJECT_CONTENTS_FILE, {});
  if (pc && typeof pc === "object") {
    const next = { ...pc };
    for (const p of (c.projects || [])) {
      if (p?.id) delete next[p.id];
    }
    await writeJsonFileAtomic(PROJECT_CONTENTS_FILE, next);
  }

  return { ok: true };
}

function getVarsPath(companyId) {
  return path.join(VARS_DIR, `company-${companyId}.json`);
}

async function dbLoadVars(companyId) {
  if (!companyId) return {};
  const data = await readJsonFile(getVarsPath(companyId), {});
  return data && typeof data === "object" ? data : {};
}

async function dbSaveVars(companyId, vars) {
  if (!companyId) return;
  await writeJsonFileAtomic(getVarsPath(companyId), vars && typeof vars === "object" ? vars : {});
}

async function updateCompanyProfileAndUid(companyId, { uidCanon, uidDisplay, profilePatch }) {
  const company = await getCompany(companyId);
  if (!company) return;

  const next = normalizeCompanyShape({
    ...company,
    uidCanon: uidCanon || company.uidCanon || null,
    uid: uidDisplay || company.uid || null,
    profile: { ...(company.profile || {}), ...(profilePatch || {}) },
    updatedAt: nowIso(),
  });

  await upsertCompany(next);
}

async function updateCompanyFibu(companyId, fibuPayload) {
  const company = await getCompany(companyId);
  if (!company) return;

  const next = normalizeCompanyShape({
    ...company,
    fibu: fibuPayload ? fibuPayload : null,
    updatedAt: nowIso(),
  });

  await upsertCompany(next);
}

async function createProject({ companyId, title, status }) {
  const company = await getCompany(companyId);
  if (!company) return null;

  const id = "prj_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  const t = nowIso();
  const prj = { id, title: String(title || ""), status: String(status || "In Arbeit"), createdAt: t, updatedAt: t };

  const next = normalizeCompanyShape({
    ...company,
    projects: [prj, ...(company.projects || [])],
    updatedAt: t,
  });

  await upsertCompany(next);
  return id;
}

async function getProjectContent(projectId) {
  if (!projectId) return "";
  const pc = await readJsonFile(PROJECT_CONTENTS_FILE, {});
  if (!pc || typeof pc !== "object") return "";
  return typeof pc[projectId] === "string" ? pc[projectId] : "";
}

async function upsertProjectContent({ projectId, html }) {
  if (!projectId) return;
  const pc = await readJsonFile(PROJECT_CONTENTS_FILE, {});
  const next = (pc && typeof pc === "object") ? pc : {};
  next[projectId] = String(html || "");
  await writeJsonFileAtomic(PROJECT_CONTENTS_FILE, next);
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
      simulated: true,
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
      const companies = await readCompanies();
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
    const saved = await readMissing(companyId);
    const varsCompany = companyId ? await dbLoadVars(companyId) : {};

    const merged = { ...(saved.values || {}), ...(varsCompany || {}) };

    return res.json({
      vars: merged,
      relevant: saved.relevant || [],
      missing: saved.missing || [],
      invalid: saved.invalid || [],
      missing_count: saved.missing_count || 0,
      docId: saved.docId || "default",
      companyId,
    });
  } catch {
    return res.json({ vars: {}, relevant: [], missing: [], invalid: [], missing_count: 0, docId: "default" });
  }
});

app.post("/api/missing/update", async (req, res) => {
  try {
    const companyId = String(req.query.companyId || "").trim();
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId fehlt" });

    const { relevant, missing, values, timestamp, docId } = req.body || {};
    if (!Array.isArray(relevant) || !Array.isArray(missing) || typeof values !== "object") {
      return res.status(400).json({ ok: false, error: "bad payload" });
    }

    const out = {
      relevant,
      missing,
      values,
      missing_count: missing.length,
      invalid: [],
      docId: docId || "default",
      timestamp: timestamp || new Date().toISOString(),
    };

    await writeMissing(companyId, out);

    const sim = await simulateExtractForCompany(companyId);

    return res.json({ ok: true, missing_count: out.missing_count, simulated: true, filled: sim.patchKeys });
  } catch (e) {
    console.error("missing/update failed", e);
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

function makeSimplePdf(lines) {
  const arr = Array.isArray(lines) ? lines : [String(lines || "")];

  const ops = [];
  ops.push("BT");
  ops.push("/F1 12 Tf");
  ops.push("72 760 Td");
  if (arr.length) {
    ops.push(`(${escapePdfText(arr[0])}) Tj`);
    for (let i = 1; i < arr.length; i++) {
      ops.push("0 -16 Td");
      ops.push(`(${escapePdfText(arr[i])}) Tj`);
    }
  }
  ops.push("ET");

  const stream = ops.join("\n");
  const streamLen = Buffer.byteLength(stream, "utf8");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  const header = "%PDF-1.4\n";
  const offsets = [0];
  let body = header;
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += obj;
  }

  const xrefPos = Buffer.byteLength(body, "utf8");
  let xref = "";
  xref += "xref\n";
  xref += `0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    const off = String(offsets[i]).padStart(10, "0");
    xref += `${off} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  const full = body + xref + trailer;
  return Buffer.from(full, "utf8");
}

async function writeDummyPdf(targetPath, label, originalName) {
  const now = new Date();
  const lines = [
    "SIMULIERTE PDF",
    `Dokument: ${label}`,
    `Original: ${originalName || "-"}`,
    `Zeit: ${now.toISOString()}`,
  ];
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, makeSimplePdf(lines));
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

      const m = req.files || {};
      const fibuIn = m.fibu?.[0];
      const stammIn = m.stamm?.[0];
      const verlustIn = m.verlust?.[0];
      if (!fibuIn || !stammIn || !verlustIn) {
        return res.status(400).json({ ok: false, error: "Alle drei Dateien sind erforderlich." });
      }

      await writeDummyPdf(PDF.fibu, "Fibu", fibuIn.originalname);
      await writeDummyPdf(PDF.stamm, "Stammanteilbewertung", stammIn.originalname);
      await writeDummyPdf(PDF.verlust, "Verlusttabelle", verlustIn.originalname);

      await Promise.allSettled([
        fs.unlink(fibuIn.path),
        fs.unlink(stammIn.path),
        fs.unlink(verlustIn.path),
      ]);

      return res.json({ ok: true, simulated: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  }
);

function singleUploadRoute(route, targetPath, label) {
  app.post(route, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: "kein File" });

      await writeDummyPdf(targetPath, label, req.file.originalname);
      await Promise.allSettled([fs.unlink(req.file.path)]);

      res.json({ ok: true, simulated: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
}

singleUploadRoute("/api/upload/fibu", PDF.fibu, "Fibu");
singleUploadRoute("/api/upload/stamm", PDF.stamm, "Stammanteilbewertung");
singleUploadRoute("/api/upload/verlust", PDF.verlust, "Verlusttabelle");

app.post("/api/reset", async (_req, res) => {
  try {
    await Promise.allSettled([safeUnlink(PDF.fibu), safeUnlink(PDF.stamm), safeUnlink(PDF.verlust)]);
    return res.json({ ok: true, reset: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "reset failed" });
  }
});


app.post("/api/start", async (req, res) => {
  const { companyId, phase = "extract" } = req.body || {};
  if (!companyId) return res.status(400).json({ ok: false, error: "companyId fehlt" });

  if (!lock(companyId)) return res.status(409).json({ ok: false, msg: "Flow läuft bereits", companyId });

  try {
    const missing = await assertAllPdfPresent();
    if (missing.length) return res.status(400).json({ ok: false, error: "missing files", missing });

    const sim = await simulateExtractForCompany(companyId);

    return res.json({ ok: true, phase, simulated: true, filled: sim.patchKeys });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  } finally {
    unlock(companyId);
  }
});

app.post("/api/finalize", async (req, res) => {
  const { companyId, template } = req.body || {};
  if (!companyId) return res.status(400).json({ ok: false, error: "companyId fehlt" });
  if (!template) return res.status(400).json({ ok: false, error: "template fehlt" });

  if (!lock(companyId)) return res.status(409).json({ ok: false, msg: "Flow läuft bereits", companyId });

  try {
    const missing = await assertAllPdfPresent();
    if (missing.length) return res.status(400).json({ ok: false, error: "missing files", missing });

    await simulateExtractForCompany(companyId);

    await Promise.allSettled([safeUnlink(PDF.fibu), safeUnlink(PDF.stamm), safeUnlink(PDF.verlust)]);

    return res.json({ ok: true, simulated: true, template });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  } finally {
    unlock(companyId);
  }
});



app.post("/api/workflow/callback", async (req, res) => {
  const companyId = String(req.query.companyId || "").trim();
  if (!companyId) return res.status(400).json({ ok: false, error: "companyId fehlt" });

  const token = req.get("x-workflow-token");
  if (!token || token !== WORKFLOW_TOKEN) return res.status(401).json({ ok: false, error: "unauthorized" });

  const source = req.body?.vars || req.body?.data || req.body || {};
  const s = Array.isArray(source) ? source[0] : source;
  if (!s || typeof s !== "object" || Object.keys(s).length === 0) {
    return res.status(400).json({ ok: false, error: "empty response" });
  }

  const has = (v) => v !== undefined && v !== null && (typeof v === "number" || String(v).trim() !== "");
  const asTxt = (v) => (v == null ? "" : String(v).trim());

  const curr = await dbLoadVars(companyId);
  const patch = {};

  if (has(s.CompanyName) || has(s.company)) patch.CompanyName = asTxt(s.CompanyName ?? s.company);
  if (has(s.Adresse) || has(s.address)) patch.Adresse = asTxt(s.Adresse ?? s.address);
  if (has(s.PLZ) || has(s.zip)) patch.PLZ = asTxt(s.PLZ ?? s.zip);
  if (has(s.ORT) || has(s.city) || has(s.Ort)) patch.ORT = asTxt(s.ORT ?? s.city ?? s.Ort);

  if (has(s.UID) || has(s.uid)) patch.UID = asTxt(s.UID ?? s.uid);

  if (has(s.currentYear) || has(s.CurrentYear)) patch.currentYear = asTxt(s.currentYear ?? s.CurrentYear);

  const gName = s.gesellschafter ?? s.Gesellschafter ?? s.partners;
  if (has(gName)) patch.gesellschafter = asTxt(gName);
  if (has(s.Gesellschafter_ort) || has(s.partners_city)) patch.Gesellschafter_ort = asTxt(s.Gesellschafter_ort ?? s.partners_city);

  const rk = s.stammkapital ?? s.Stammkapital;
  if (has(rk)) {
    patch.Stammkapital = asTxt(rk);
  }

  const su = s.Stammanteil ?? s.share_unit;
  if (has(su)) patch.Stammanteil = asTxt(su);

  const vars = { ...curr, ...patch };

  await dbSaveVars(companyId, vars);

  const canon = normalizeUid(vars.UID);
  await updateCompanyProfileAndUid(companyId, {
    uidCanon: canon || null,
    uidDisplay: canon || null,
    profilePatch: patch,
  });

  if (s.startOfPeriod || s.endOfPeriod) {
    const fibuPayload = {};
    if (s.startOfPeriod) fibuPayload.startOfPeriod = s.startOfPeriod;
    if (s.endOfPeriod) fibuPayload.endOfPeriod = s.endOfPeriod;
    await updateCompanyFibu(companyId, fibuPayload);
  }

  return res.json({ ok: true, updated: Object.keys(patch) });
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

app.delete("/api/companies/:id", async (req, res) => {
  const companyId = String(req.params.id || "").trim();
  if (!companyId) return res.status(400).json({ ok: false, error: "companyId fehlt" });

  const purgeVars = String(req.query.purgeVars || "").toLowerCase() === "true";

  try {
    const r = await deleteCompany(companyId, { purgeVars });
    if (!r.ok) return res.status(404).json({ ok: false, error: "not found", id: companyId });
    return res.json({ ok: true, deleted: companyId, purged: purgeVars });
  } catch (e) {
    console.error("DELETE /api/companies failed", e);
    return res.status(500).json({ ok: false, error: "delete failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft: http://localhost:${PORT}`));
