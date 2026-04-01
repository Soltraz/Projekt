import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  API,
  jGET,
  jPOST,
  jDELETE,
  uploadAll,
  getTemplates,
  patchVars,
  finalizeRun,
  getUploadState,
  runExtract,
  getMissing,
  updateMissing,
} from "./api";
import { EXAMPLE_JAHRESRECHNUNG_HTML } from "./templates/jahresrechnung-example";
import { extractPlaceholdersFromHtml } from "./autofill/replacePlaceholders";
import "./Dashboard.css";
import "./CompanyPage.css";

const relevant = extractPlaceholdersFromHtml(EXAMPLE_JAHRESRECHNUNG_HTML);

type TemplateDef = { id: string; name: string };

type Project = {
  id: string;
  title: string;
  bilanzstichtag?: string;
  status?: string;
  reportStatus?: string;
};

export default function CompanyPage() {

const [activeProjectId, setActiveProjectId] = useState<string>("");
const location = useLocation();
const justCreated =
  (location.state as any)?.justCreated === true;

  const { id } = useParams();
  const nav = useNavigate();

  const [company, setCompany] = useState<any>(null);

  const [fibu, setFibu] = useState<File | null>(null);
  const [stamm, setStamm] = useState<File | null>(null);
  const [verlust, setVerlust] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedOk, setUploadedOk] = useState(false);
  const [fibuData, setFibuData] = useState<any | null>(null);
  const [shareholders, setShareholders] = useState<any[]>([]);
  const [selectedShareholder, setSelectedShareholder] = useState<any | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateDef[]>([]);
  const [template, setTemplate] = useState<string>("std");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [savingVars, setSavingVars] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [searchingMissing, setSearchingMissing] = useState(false);

  const [activeTab, setActiveTab] = useState<"overview" | "data">("overview");

  const requiredKeys = useMemo(() => relevant, []);
  const missingKeys = useMemo(
    () =>
      requiredKeys.filter(
        (k) => !vars?.[k] || String(vars[k]).trim() === ""
      ),
    [requiredKeys, vars]
  );

  const varEntries = useMemo(
    () =>
      Object.entries(vars).sort(([a], [b]) =>
        a.localeCompare(b, "de-CH")
      ),
    [vars]
  );

  async function load() {
    if (!id) return;
    const r = await jGET(`${API}/api/companies/${id}`);
    setCompany(r.company);
  }

useEffect(() => {
  if (!id) return;

  const fetchCompanyData = async () => {
    try {
      const response = await jGET(`${API}/api/companies/${id}`);
      const c = response.company;
      setCompany(c);

      const uid = c.uidCanon || c.uid;
      if (!uid) return;

      const payload = await jGET(
        `${API}/api/vars/build?uid=${encodeURIComponent(uid)}&id=${c.id}`
      );

      const persons = payload.persons || [];

      const gesellschafterList = persons.filter(
        (p: any) => p.role === "gesellschafter"
      );

      if (gesellschafterList.length > 1) {
        setShareholders(gesellschafterList);
      }
    } catch (error) {
      console.error("Fehler beim Laden der Firma", error);
    }
  };

  fetchCompanyData();
}, [id]);

  useEffect(() => {
    getTemplates()
      .then((res) => {
        if (res?.ok && res.templates?.length) {
          setTemplates(res.templates);
          setTemplate(res.templates[0].id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!company || activeTab !== "data") return;

    (async () => {
      try {
        await jPOST(`${API}/api/companies/${company.id}/hydrate-vars`);

        const cur = await jGET<{ vars: Record<string, string> }>(
          `${API}/api/vars/current?companyId=${company.id}`
        );
        setVars(cur?.vars || {});

        const res = await jGET(`${API}/api/companies/${company.id}/fibu`);
        console.log("FIBU RESPONSE", res);

        const nextFibu =
          (res as any).data ??     // falls du es irgendwann anders nennst
          (res as any).fibu ??     // das ist jetzt dein Hauptpfad
          (res as any);

        setFibuData(nextFibu || null);

      } catch (e) {
        console.error(
          "Daten für Daten-Tab konnten nicht geladen werden:",
          e
        );
      }
    })();
  }, [activeTab, company]);

function openProject(p: Project) {
  if (!company) return;

  const uid =
    company.uid || company.uidCanon || "";

  nav(
    `/workflow?uid=${encodeURIComponent(uid)}&companyId=${encodeURIComponent(
      company.id
    )}&projectId=${encodeURIComponent(p.id)}&mode=editor`
  );
}

async function addProject() {
  if (!id || !company) return;

  const title = prompt("Projekttitel (z.B. Jahresbericht 2024)?")?.trim();
  if (!title) return;

  const res = await jPOST(`${API}/api/companies/${id}/projects`, {
    title,
    status: "In Arbeit",
    reportStatus: "Offen",
  });

  if (!res?.ok || !res.project) {
    alert("Projekt konnte nicht angelegt werden.");
    return;
  }

  await jPOST(
    `${API}/api/companies/${id}/projects/${res.project.id}/content`,
    {
      html: EXAMPLE_JAHRESRECHNUNG_HTML,
    }
  );

  setCompany((prev: any) =>
    !prev
      ? prev
      : {
          ...prev,
          projects: [...(prev.projects || []), res.project],
        }
  );

  setActiveProjectId(res.project.id);
  await startReport(res.project.id);
}

  async function doUpload() {
    if (!fibu || !stamm || !verlust) {
      alert(
        "Bitte alle drei Dateien wählen: Fibu, Stammanteilbewertung und Verlusttabelle."
      );
      return;
    }
    setUploading(true);
    setUploadedOk(false);
    try {
      await uploadAll(company.id, { fibu, stamm, verlust });
      setUploadedOk(true);
      alert("Belege erfolgreich hochgeladen.");
    } catch (e: any) {
      alert("Upload fehlgeschlagen:\n" + e.message);
    } finally {
      setUploading(false);
    }
  }

  async function deleteCompanyFn() {
    if (!id) return;
    if (!confirm("Firma wirklich löschen?")) return;
    try {
      await jDELETE(`${API}/api/companies/${id}?purgeVars=true`);
      nav("/");
    } catch (e: any) {
      alert("Löschen fehlgeschlagen:\n" + e.message);
    }
  }

  async function pollMissingUntilReady(
    timeoutMs = 20000
  ): Promise<Awaited<ReturnType<typeof getMissing>>> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const r = await getMissing(company.id).catch(() => null);
      if (r && typeof r.missing_count === "number") return r;
      await new Promise((ok) => setTimeout(ok, 800));
    }
    throw new Error("Timeout: missing.json wurde nicht rechtzeitig erstellt");
  }

const handleShareholderChange = (e: any) => {
  const index = Number(e.target.value);
  const selected = shareholders[index];
  setSelectedShareholder(selected || null);
};

const saveShareholderSelection = async () => {
  if (!selectedShareholder) {
    alert("Kein Gesellschafter ausgewählt.");
    return;
  }

  try {
    const resp = await jPOST(`${API}/api/vars/person?companyId=${company.id}`, {
      name: selectedShareholder.name,
      anzeige: selectedShareholder.anzeige,
    });

    const cur = await jGET<{ vars: Record<string, string> }>(
      `${API}/api/vars/current?companyId=${company.id}`
    );

    setVars(cur.vars || {});

    alert("Gesellschafter wurde gespeichert.");
  } catch (error) {
    console.error("Fehler beim Speichern der Auswahl", error);
    alert("Es gab ein Problem beim Speichern der Auswahl.");
  }
};

async function startReport(projectIdArg?: string) {
  if (!company) return;

  const projectId = projectIdArg || activeProjectId;

  if (!projectId) {
    alert("Bitte zuerst ein Projekt auswählen oder anlegen.");
    return;
  }

  try {
    const up = await getUploadState().catch(() => null);
    if (!up?.ok || !up.all) {
      const fehlend = [
        !up?.fibu ? "Fibu" : null,
        !up?.stamm ? "Stammanteilbewertung" : null,
        !up?.verlust ? "Verlusttabelle" : null,
      ]
        .filter(Boolean)
        .join(", ");
      alert(`Bitte zuerst alle Belege hochladen: ${fehlend || "unbekannt"}.`);
      return;
    }

    await jPOST(`${API}/api/companies/${company.id}/hydrate-vars`);

    const cur = await jGET<{ vars: Record<string, string> }>(
      `${API}/api/vars/current?companyId=${company.id}`
    );
    const nextVars = cur?.vars || {};
    setVars(nextVars);

    const missing = requiredKeys.filter(
      (k) => !nextVars[k] || String(nextVars[k]).trim() === ""
    );

    setActiveProjectId(projectId);

    if (missing.length === 0) {
      setStep(3);
    } else {
      setStep(2);
    }
    setWizardOpen(true);
  } catch (e: any) {
    alert("Start fehlgeschlagen:\n" + e.message);
  }
}

async function writeMissing(current: Record<string, string>) {
  if (!activeProjectId) {
    throw new Error("Kein aktives Projekt ausgewählt");
  }

  await updateMissing(company.id, activeProjectId, current || {});
}

  async function saveVars() {
    setSavingVars(true);
    try {
      await patchVars(vars, company.id);
      setStep(3);
    } catch (e: any) {
      alert("Speichern fehlgeschlagen:\n" + e.message);
    } finally {
      setSavingVars(false);
    }
  }

async function findMissingValues() {
  if (!company) return;

  if (!activeProjectId) {
    alert("Bitte zuerst ein Projekt auswählen oder anlegen.");
    return;
  }

  if (!missingKeys.length) {
    alert("Es fehlen aktuell keine Werte – alles ist ausgefüllt.");
    return;
  }

  setSearchingMissing(true);
  try {
    await patchVars(vars, company.id);

    const beforeVars = { ...vars };
    const missingBefore = [...missingKeys];

    await writeMissing(beforeVars);

    await runExtract(company.id, activeProjectId);

    const timeoutMs = 60000;
    const startTs = Date.now();
    let last = beforeVars;

    while (Date.now() - startTs < timeoutMs) {
      const r = await jGET<{ vars: Record<string, string> }>(
        `${API}/api/vars/current?companyId=${company.id}`
      ).catch(() => null);
      const cur = r?.vars || {};

      const newlyFilled = missingBefore.filter((k) => {
        const v = (cur[k] ?? "").trim();
        const old = (last[k] ?? "").trim();
        return v !== "" && v !== old;
      });

      if (newlyFilled.length) {
        setVars(cur);
        alert(`Automatisch gefundene Werte für: ${newlyFilled.join(", ")}`);
        return;
      }

      last = cur;
      await new Promise((ok) => setTimeout(ok, 1500));
    }

    alert("Es konnten keine zusätzlichen Werte automatisch gefunden werden.");
  } catch (e: any) {
    alert("Automatische Suche fehlgeschlagen:\n" + e.message);
  } finally {
    setSearchingMissing(false);
  }
}

  async function finalize() {
    if (!company) return;
    setFinalizing(true);
    try {
      const r = await finalizeRun({ companyId: company.id, template });
      if (r?.ok) {
        const uidNav = company.uid || company.uidCanon || "";
        nav(
          `/workflow?uid=${encodeURIComponent(
            uidNav
          )}&companyId=${encodeURIComponent(
            company.id
          )}&step=final&mode=editor`
        );
      }
    } catch (e: any) {
      alert(
        "Finalisieren fehlgeschlagen:\n" +
          e.message +
          "\nFalls 'missing files' gemeldet wird, bitte zuerst die drei PDFs hochladen."
      );
    } finally {
      setFinalizing(false);
    }
  }

  if (!company) {
    return (
      <div className="rv-shell">
        <aside className="rv-sidebar">
          <div className="rv-sidebar__brand">
            <div className="rv-logo-circle">R</div>
            <div className="rv-logo-text">
              <span className="rv-logo-title">Revisia</span>
              <span className="rv-logo-subtitle">Jahresberichte</span>
            </div>
          </div>
        </aside>
        <main className="rv-main">
          <div className="company-page company-page--loading">Laden…</div>
        </main>
      </div>
    );
  }

  const profile = company.profile || {};
  const uidNav = company.uid || company.uidCanon || "";
  const projects: Project[] = company.projects || [];

  return (
    <div className="rv-shell">
      {}
      <aside className="rv-sidebar">
        <div className="rv-sidebar__brand">
          <div className="rv-logo-circle">R</div>
          <div className="rv-logo-text">
            <span className="rv-logo-title">Revisia</span>
          </div>
        </div>

        <nav className="rv-sidebar__nav">
          <button
            className="rv-nav-item"
            type="button"
            onClick={() => nav("/")}
          >
            <span className="rv-nav-dot" />
            <span>Firmen</span>
          </button>

          <button
            className="rv-nav-item rv-nav-item--active"
            type="button"
          >
            <span className="rv-nav-dot" />
            <span>Firma Detail</span>
          </button>
        </nav>

        <div className="rv-sidebar__footer">
          <button className="rv-pill-btn" type="button">
            <span>Support</span>
          </button>

          <div className="rv-account">
            <div className="rv-account-avatar">M</div>
            <div className="rv-account-meta">
              <div className="rv-account-name">Marzo Treuhand AG</div>
              <div className="rv-account-sub">Admin</div>
            </div>
          </div>
        </div>
      </aside>

      {}
      <main className="rv-main company-page">
        <header className="rv-page-header company-header">
          <div className="company-header-left">
            <button
              type="button"
              className="rv-button rv-button--ghost company-back"
              onClick={() => nav(-1)}
            >
              ← Zurück
            </button>
            <div>
              <h1 className="rv-page-title">
                {profile.CompanyName || company.name}
              </h1>
              <p className="rv-page-subtitle">
                {uidNav ? `UID ${uidNav}` : "Firmendaten und Jahresbericht"}
              </p>
            </div>
          </div>

        </header>

        {}
        <section className="company-tabs">
          <button
            type="button"
            className={
              activeTab === "overview"
                ? "company-tab company-tab--active"
                : "company-tab"
            }
            onClick={() => setActiveTab("overview")}
          >
            Übersicht
          </button>
          <button
            type="button"
            className={
              activeTab === "data"
                ? "company-tab company-tab--active"
                : "company-tab"
            }
            onClick={() => setActiveTab("data")}
          >
            Daten
          </button>
        </section>

        {}
        <section className="company-toolbar">
          <div className="company-toolbar-left">
            <button
              type="button"
              className="rv-button rv-button--ghost company-danger"
              onClick={deleteCompanyFn}
            >
              Firma löschen
            </button>
          </div>
        </section>

        {}
        {activeTab === "overview" && (
          <>
            <section className="company-grid">
              <div className="company-col">
                <div className="rv-card company-card">
                  <h3 className="company-card-title">Belege hochladen</h3>
                  <p className="company-card-subtitle">
                    Bitte Fibu, Stammanteilbewertung und Verlusttabelle wählen.
                    Der Server konvertiert automatisch zu PDF.
                  </p>

                  <div className="company-upload-grid">
                    <label>Fibu</label>
                    <input
                      type="file"
                      accept=".pdf,.docx,.xlsx,.xls"
                      onChange={(e) =>
                        setFibu(e.currentTarget.files?.[0] ?? null)
                      }
                    />
                    <label>Stammanteilbewertung</label>
                    <input
                      type="file"
                      accept=".pdf,.docx,.xlsx,.xls"
                      onChange={(e) =>
                        setStamm(e.currentTarget.files?.[0] ?? null)
                      }
                    />
                    <label>Verlusttabelle</label>
                    <input
                      type="file"
                      accept=".pdf,.docx,.xlsx,.xls"
                      onChange={(e) =>
                        setVerlust(e.currentTarget.files?.[0] ?? null)
                      }
                    />
                  </div>

                  <div className="company-upload-actions">
                    <button
                      type="button"
                      className="rv-button rv-button--primary"
                      onClick={doUpload}
                      disabled={uploading}
                    >
                      {uploading ? "Lädt hoch…" : "Belege hochladen"}
                    </button>
                    {uploadedOk && (
                      <span className="company-upload-ok">✓ Hochgeladen</span>
                    )}
                  </div>
                </div>

                <div className="rv-card company-card">
                  <h3 className="company-card-title">Profil</h3>
                  <div className="company-profile-row">
                    <span className="company-profile-label">Firmenname</span>
                    <span className="company-profile-value">
                      {profile.CompanyName || "–"}
                    </span>
                  </div>
                  <div className="company-profile-row">
                    <span className="company-profile-label">Adresse</span>
                    <span className="company-profile-value">
                      {profile.Adresse || "–"}
                    </span>
                  </div>
                  <div className="company-profile-row">
                    <span className="company-profile-label">PLZ / Ort</span>
                    <span className="company-profile-value">
                      {(profile.PLZ || "–") + " " + (profile.ORT || "")}
                    </span>
                  </div>
                  {uidNav && (
                    <div className="company-profile-row">
                      <span className="company-profile-label">UID</span>
                      <span className="company-profile-value">{uidNav}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="company-col">
                <div className="rv-card company-card">
                  <h3 className="company-card-title">Jahresbericht Wizard</h3>
                  <p className="company-card-subtitle">
                    Führt dich Schritt für Schritt durch Template,
                    Variablen und Finalisierung.
                  </p>
                  <button
                    type="button"
                    className="rv-button rv-button--primary"
                    onClick={() => startReport()}
                  >
                    Wizard starten
                  </button>
                </div>
              </div>
            </section>

            {}
            <section className="company-projects">
              <div className="rv-card company-card">
                <h3 className="company-card-title">Projekte / Jahresberichte</h3>
                <p className="company-card-subtitle">
                  Hier kannst du angelegte Jahresberichte zu dieser Firma sehen.
                </p>

                {projects.length === 0 ? (
                  <p>Für diese Firma wurden noch keine Projekte angelegt.</p>
                ) : (
                <ul className="company-project-list">
                  {projects.map((p: Project) => (
                    <li
                      key={p.id}
                      className="company-project-list-item"
                      onClick={() => openProject(p)}
                    >
                      <div className="company-project-title">{p.title}</div>
                      <div className="company-project-meta">
                        <span>Status: {p.status}</span>
                        {p.bilanzstichtag && (
                          <span> · Bilanzstichtag: {p.bilanzstichtag}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                )}

                <button
                  type="button"
                  className="rv-button rv-button--primary"
                  onClick={addProject}
                >
                  Neues Projekt anlegen
                </button>
              </div>
            </section>
          </>
        )}

        {}
        {activeTab === "data" && (
          <section className="rv-card company-data-card">
            <h3 className="company-card-title">Ausgelesene Daten</h3>
            <p className="company-card-subtitle">
              Alle aktuell für diese Firma hydratisierten Variablen (vars.json).
              Ideal, um zu sehen, was aus Fibu / Stamm / Verlust bereits gelesen
              wurde.
            </p>

            <div className="company-data-table-wrapper">
              {}
              <table className="company-data-table">
                <thead>
                  <tr>
                    <th>Schlüssel</th>
                    <th>Wert</th>
                  </tr>
                </thead>
                <tbody>
                  {varEntries.length === 0 && (
                    <tr>
                      <td colSpan={2} className="company-data-empty-row">
                        Noch keine Daten verfügbar. Wechsel ggf. kurz zum
                        Wizard oder starte den Extract-Workflow.
                      </td>
                    </tr>
                  )}
                  {varEntries.map(([key, value]) => (
                    <tr key={key}>
                      <td className="company-data-key">{key}</td>
                      <td className="company-data-value">
                        {value && String(value).trim() !== "" ? (
                          value
                        ) : (
                          <span className="company-data-empty">– leer –</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {}
              {fibuData && (
                <table
                  className="company-data-table"
                  style={{ marginTop: "1rem" }}
                >
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th>Start</th>
                      <th>Ende</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(fibuData.startOfPeriod?.Aktiven || {}).map(
                      ([key, value]) => {
                        const start = String(value ?? "");
                        const end = String(
                          fibuData.endOfPeriod?.Aktiven?.[key] ?? ""
                        );

                        return (
                          <tr key={key}>
                            <td>{key}</td>
                            <td>{start}</td>
                            <td>{end}</td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )}

        {}
        {wizardOpen && (
          <div className="company-wizard-overlay">
            <div className="company-wizard">
              <div className="company-wizard-header">
                <h3>Jahresbericht – Quick Wizard</h3>
                <button
                  type="button"
                  className="company-wizard-close"
                  onClick={() => setWizardOpen(false)}
                >
                  ✕
                </button>
              </div>

              {}
              {step === 1 && (
                <div className="company-wizard-step">
                  <label className="company-wizard-label">
                    Template auswählen
                  </label>
                  <div className="company-wizard-field">
                    <select
                      value={template}
                      onChange={(e) => setTemplate(e.target.value)}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="company-wizard-actions">
                    <button
                      type="button"
                      className="rv-button rv-button--primary"
                      onClick={() => setStep(2)}
                    >
                      Weiter
                    </button>
                    <button
                      type="button"
                      className="rv-button rv-button--ghost"
                      onClick={() => setWizardOpen(false)}
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}

              {}
              {step === 2 && (
                <div className="company-wizard-step">
                  <p className="company-wizard-text">
                    Fehlende/zu prüfende Variablen für{" "}
                    <b>
                      {templates.find((t) => t.id === template)?.name ||
                        template}
                    </b>
                    :
                  </p>

                  <div className="company-vars-grid">
                    {requiredKeys.map((k) => (
                      <FragmentRow key={k} label={k}>
                        <input
                          value={vars?.[k] ?? ""}
                          onChange={(e) =>
                            setVars((v) => ({
                              ...v,
                              [k]: e.target.value,
                            }))
                          }
                          placeholder={
                            missingKeys.includes(k) ? "Fehlt…" : ""
                          }
                          className={
                            missingKeys.includes(k)
                              ? "company-var-input company-var-input--missing"
                              : "company-var-input"
                          }
                        />
                      </FragmentRow>
                    ))}
                  </div>

                  <div
                    className={
                      missingKeys.length
                        ? "company-vars-status company-vars-status--missing"
                        : "company-vars-status company-vars-status--ok"
                    }
                  >
                    {missingKeys.length
                      ? `Es fehlen noch ${missingKeys.length} Wert(e).`
                      : "Alles vollständig."}
                  </div>

                  <div className="company-wizard-actions">
                    <button
                      type="button"
                      className="rv-button rv-button--outline"
                      onClick={findMissingValues}
                      disabled={searchingMissing || !missingKeys.length}
                    >
                      {searchingMissing
                        ? "Suche fehlende Werte…"
                        : "Fehlende Werte suchen"}
                    </button>

                    <button
                      type="button"
                      className="rv-button rv-button--primary"
                      onClick={saveVars}
                      disabled={savingVars}
                    >
                      {savingVars
                        ? "Speichert…"
                        : "Speichern und weiter"}
                    </button>

                    <button
                      type="button"
                      className="rv-button rv-button--ghost"
                      onClick={() => setStep(1)}
                    >
                      Zurück
                    </button>
                  </div>
                </div>
              )}

              {}
              {step === 3 && (
                <div className="company-wizard-step">
                  <p className="company-wizard-text">
                    Alles bereit. Jetzt direkt den letzten Schritt im
                    Workflow ausführen.
                  </p>
                  <div className="company-wizard-actions">
                    <button
                      type="button"
                      className="rv-button rv-button--primary"
                      onClick={finalize}
                      disabled={finalizing}
                    >
                      {finalizing ? "Startet…" : "Finalisieren"}
                    </button>
                    <button
                      type="button"
                      className="rv-button rv-button--ghost"
                      onClick={() => setStep(2)}
                    >
                      Zurück
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function FragmentRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="company-vars-label">{label}</div>
      <div>{children}</div>
    </>
  );
}
