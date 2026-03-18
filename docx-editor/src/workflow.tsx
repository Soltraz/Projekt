import React, { useEffect, useState, type ChangeEvent } from "react";
import DocxEditor from "./DocxEditor";
import AutofillModal from "./autofill/AutofillModal";
import { EXAMPLE_JAHRESRECHNUNG_HTML } from "./templates/jahresrechnung-example";
import "./index.css";
import { useSearchParams, useNavigate } from "react-router-dom";
import { API, jGET, jPOST } from "./api";

type UploadFiles = { fibu: File | null; stamm: File | null; verlust: File | null };

function escapeForRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allPlaceholdersFromHtml(html: string): string[] {
  const re = /\{([a-zA-Z][a-zA-Z0-9_.-]*)\}/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.add(m[1]);
  return Array.from(out);
}

function applyValuesIntoHtml(html: string, values: Record<string, string>): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    const rx = new RegExp(`\\{${escapeForRegExp(key)}\\}`, "g");
    doc.body.innerHTML = doc.body.innerHTML.replace(rx, value);
  }
  return doc.body.innerHTML;
}

function niceSize(f?: File | null) {
  if (!f) return "";
  const mb = f.size / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(f.size / 1024).toFixed(0)} kB`;
}

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const ALLOWED_EXT = /\.(pdf|docx?|xlsx?)$/i;

function validateDoc(f?: File | null): string | null {
  if (!f) return "Bitte Datei wählen.";
  const okByMime = ALLOWED_MIME.has(f.type) || f.type === "" || f.type === "application/octet-stream";
  const okByExt = ALLOWED_EXT.test(f.name);
  if (!(okByMime || okByExt)) return "Erlaubt: PDF, DOC/DOCX und XLS/XLSX.";
  if (f.size > 25 * 1024 * 1024) return "Max. 25 MB pro Datei.";
  return null;
}

function SearchSuggestions({
  searchTerm,
  onSelect,
}: {
  searchTerm: string;
  onSelect: (name: string) => void;
}) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchTerm.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await jGET<any[]>(`${API}/api/search?name=${encodeURIComponent(searchTerm)}`);
        setResults(data || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchTerm]);

  if (loading) return <div style={{ marginTop: 8, color: "#888" }}>Suche …</div>;
  if (!loading && results.length === 0) return null;

  return (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        marginTop: 10,
        width: "100%",
        maxWidth: 400,
        marginLeft: "auto",
        marginRight: "auto",
        border: "1px solid #ddd",
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
      }}
    >
      {results.map((h) => (
        <li
          key={h.uid}
          onClick={() => onSelect(h.name)}
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid #eee",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ fontWeight: 600 }}>{h.name}</div>
          <div style={{ color: "#666", fontSize: 13 }}>
            {h.uid} · {h.legalForm || ""} · {h.legalSeat || ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Workflow() {
  type Step = "template" | "autofill" | "upload" | "loading" | "done";
  type TemplateId = "jahresrechnung" | "gewinnverlust" | "stammanteil";

  const [sp] = useSearchParams();
  const nav = useNavigate();

  const companyId = sp.get("companyId") || "";
  const uidParam = sp.get("uid") || "";
  const stepParam = sp.get("step") || "";
  const modeParam = sp.get("mode") || "";
  const projectId = sp.get("projectId") || "";

  const [bootstrapped, setBootstrapped] = useState(false);

  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId | null>(null);
  const [step, setStep] = useState<Step>("template");

  const [html, setHtml] = useState<string>("");

  const [autofillOpen, setAutofillOpen] = useState(false);
  const [autofillValues, setAutofillValues] = useState<Record<string, string>>({});
  const [autofillStage, setAutofillStage] = useState<"search" | "loading">("search");
  const [searchTerm, setSearchTerm] = useState("");
  const [reviewStage, setReviewStage] = useState<"after-search" | "after-processing" | null>(null);

  const [files, setFiles] = useState<UploadFiles>({ fibu: null, stamm: null, verlust: null });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const TEMPLATES: { id: TemplateId; title: string; subtitle?: string; badge?: string }[] = [
    { id: "jahresrechnung", title: "Jahresrechnung", subtitle: "Standard" },
    { id: "gewinnverlust", title: "Gewinnverlusttabelle", subtitle: "Ergänzt" },
    { id: "stammanteil", title: "Stammanteilbewertung", subtitle: "Standard" },
  ];

  const makePickHandler =
    (key: keyof UploadFiles) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0] || null;
      const err = validateDoc(f);
      if (err) {
        alert(err);
        e.currentTarget.value = "";
        setFiles((prev) => ({ ...prev, [key]: null }));
        return;
      }
      setFiles((prev) => ({ ...prev, [key]: f }));
    };

  const allSelected = !!(files.fibu && files.stamm && files.verlust);

  function loadTemplate() {
    setHtml(EXAMPLE_JAHRESRECHNUNG_HTML);
    setStep("autofill");
  }

  async function autofillFromUid(uid: string) {
    setAutofillStage("loading");
    try {
      await jPOST(`${API}/api/reset`);
      setHtml(EXAMPLE_JAHRESRECHNUNG_HTML);

      const buildResp = await jGET<{ vars: Record<string, string> }>(
        `${API}/api/vars/build?uid=${encodeURIComponent(uid)}`
      );

      const serverVars = buildResp?.vars || {};
      const keys = allPlaceholdersFromHtml(EXAMPLE_JAHRESRECHNUNG_HTML);
      const review = Object.fromEntries(keys.map((k) => [k, (serverVars[k] ?? "").toString().trim()]));

      setAutofillValues(review);
      setReviewStage("after-search");
      setAutofillOpen(true);
    } finally {
      setAutofillStage("search");
    }
  }

  async function handleAutofillConfirm(name: string) {
    setAutofillStage("loading");
    try {
      await jPOST(`${API}/api/reset`);
      setAutofillValues({});
      setHtml(EXAMPLE_JAHRESRECHNUNG_HTML);

      const searchResp = await jGET<any[]>(`${API}/api/search?name=${encodeURIComponent(name)}`);
      const hit = searchResp?.[0];
      if (!hit) {
        alert("Keine Firma gefunden. Bitte anderen Namen versuchen.");
        return;
      }

      const buildResp = await jGET<{ vars: Record<string, string> }>(
        `${API}/api/vars/build?uid=${encodeURIComponent(hit.uid)}`
      );
      const serverVars = buildResp?.vars || {};

      const keys = allPlaceholdersFromHtml(EXAMPLE_JAHRESRECHNUNG_HTML);
      const review = Object.fromEntries(keys.map((k) => [k, (serverVars[k] ?? "").toString().trim()]));

      setAutofillValues(review);
      setReviewStage("after-search");
      setAutofillOpen(true);
    } catch {
    } finally {
      setAutofillStage("search");
    }
  }

  useEffect(() => {
    (async () => {
      if (modeParam === "editor" && projectId && companyId) {
        try {
          const res = await jGET<{ ok: boolean; html?: string }>(
            `${API}/api/companies/${companyId}/projects/${projectId}/content`
          );

          let baseHtml = EXAMPLE_JAHRESRECHNUNG_HTML;
          if (res?.ok && typeof res.html === "string" && res.html.trim()) {
            baseHtml = res.html;
          }

          try {
            const varsResp = await jGET<{ vars: Record<string, string> }>(
              `${API}/api/vars/current?companyId=${encodeURIComponent(companyId)}`
            );
            const vars = varsResp?.vars || {};
            if (Object.keys(vars).length) {
              baseHtml = applyValuesIntoHtml(baseHtml, vars);
            }
          } catch {
          }

          setHtml(baseHtml);
        } catch {
          setHtml(EXAMPLE_JAHRESRECHNUNG_HTML);
        }

        setStep("done");
        setBootstrapped(true);
        return;
      }

      if (stepParam === "final" && modeParam === "editor") {
        setHtml(EXAMPLE_JAHRESRECHNUNG_HTML);

        try {
          const url = companyId
            ? `${API}/api/vars/current?companyId=${encodeURIComponent(companyId)}`
            : `${API}/api/vars/current`;

          const resp = await jGET<{ vars: Record<string, string> }>(url);
          const serverVars = resp?.vars || {};
          const filled = applyValuesIntoHtml(EXAMPLE_JAHRESRECHNUNG_HTML, serverVars);
          setHtml(filled);
        } catch {
        }

        setStep("done");
        setBootstrapped(true);
        return;
      }

      if (uidParam) {
        setHtml(EXAMPLE_JAHRESRECHNUNG_HTML);
        setStep("autofill");
        await autofillFromUid(uidParam);
        setBootstrapped(true);
        return;
      }

      if (companyId) {
        try {
          const r = await jGET<{ ok: boolean; company: any }>(`${API}/api/companies/${companyId}`);
          const uid = r?.company?.uid || "";
          if (uid) {
            setHtml(EXAMPLE_JAHRESRECHNUNG_HTML);
            setStep("autofill");
            await autofillFromUid(uid);
            setBootstrapped(true);
            return;
          }
        } catch {
        }
      }

      setHtml(EXAMPLE_JAHRESRECHNUNG_HTML);
    })();
  }, [companyId, uidParam, stepParam, modeParam, projectId]);

  useEffect(() => {
    if (step !== "autofill" || bootstrapped) return;
    (async () => {
      try {
        await jPOST(`${API}/api/reset`);
        setAutofillValues({});
        setHtml(EXAMPLE_JAHRESRECHNUNG_HTML);

        const url = companyId
          ? `${API}/api/vars/current?companyId=${encodeURIComponent(companyId)}`
          : `${API}/api/vars/current`;

        const resp = await jGET<{ vars: Record<string, string> }>(url);
        const serverVars = resp?.vars || {};
        if (Object.keys(serverVars).length) {
          setHtml(applyValuesIntoHtml(EXAMPLE_JAHRESRECHNUNG_HTML, serverVars));
        }
      } catch {
      }
    })();
  }, [step, bootstrapped, companyId]);

  useEffect(() => {
    if (step !== "loading") return;

    (async () => {
      const placeholders = allPlaceholdersFromHtml(html);

      let currentVars: Record<string, string> = {};
      try {
        const url = companyId
          ? `${API}/api/vars/current?companyId=${encodeURIComponent(companyId)}`
          : `${API}/api/vars/current`;
        const r = await jGET<{ vars: Record<string, string> }>(url);
        currentVars = r?.vars || {};
      } catch {
      }

      const missing = placeholders.filter((k) => !currentVars[k] || currentVars[k].trim() === "");

      try {
        await jPOST(`${API}/api/missing/update?companyId=${encodeURIComponent(companyId)}`, {
          relevant: placeholders,
          missing,
          values: currentVars,
          timestamp: new Date().toISOString(),
        });
      } catch {
      }

      try {
        const refreshed = await jGET<{ vars: Record<string, string> }>(
          `${API}/api/vars/current?companyId=${encodeURIComponent(companyId)}`
        );

        if (refreshed?.vars && Object.keys(refreshed.vars).length) {
          const filled = applyValuesIntoHtml(EXAMPLE_JAHRESRECHNUNG_HTML, refreshed.vars);
          setHtml(filled);
          setReviewStage("after-processing");
          setAutofillOpen(true);
        }
      } catch {
      }
    })();
  }, [step, html, companyId]);

  async function uploadAll() {
    setUploading(true);
    try {
      const errs = [validateDoc(files.fibu), validateDoc(files.stamm), validateDoc(files.verlust)].filter(Boolean);
      if (errs.length) {
        alert(errs[0] as string);
        return;
      }

      const fd = new FormData();
      fd.append("fibu", files.fibu!);
      fd.append("stamm", files.stamm!);
      fd.append("verlust", files.verlust!);

      const r = await fetch(`${API}/api/upload`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(await r.text().catch(() => "Upload fehlgeschlagen"));
      setConfirmOpen(false);
      setStep("loading");
    } catch (e: any) {
      alert(e?.message || "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      {step === "template" && (
        <>
          <h2>Template wählen</h2>
          <p>Bitte eines der Templates auswählen.</p>

          <div className="tpl-grid">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className={`tpl-card ${selectedTemplate === t.id ? "is-selected" : ""}`}
                onClick={() => setSelectedTemplate(t.id)}
                type="button"
              >
                <div className="tpl-thumb" aria-hidden />
                <div className="tpl-meta">
                  <div className="tpl-title">{t.title}</div>
                  {t.subtitle && <div className="tpl-sub">{t.subtitle}</div>}
                </div>
                {t.badge && <span className="tpl-badge">{t.badge}</span>}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <button className="btn btn--primary" disabled={!selectedTemplate} onClick={loadTemplate}>
              Weiter →
            </button>
          </div>
        </>
      )}

      {step === "autofill" && autofillStage === "search" && (
        <>
          <h2>Firma im Handelsregister suchen</h2>
          <p>Bitte gib den Firmennamen ein. Ab 3 Buchstaben erscheinen Vorschläge.</p>

          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="z. B. Bieger Maler GmbH"
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #ccc",
              minWidth: "320px",
              fontSize: "14px",
            }}
          />

          {searchTerm.trim().length >= 3 && (
            <SearchSuggestions searchTerm={searchTerm} onSelect={handleAutofillConfirm} />
          )}

          <div style={{ marginTop: 20 }}>
            <button className="btn btn--primary" disabled={!searchTerm.trim()} onClick={() => handleAutofillConfirm(searchTerm)}>
              Bestätigen
            </button>
            <button className="btn" onClick={() => setStep("upload")} style={{ marginLeft: 8 }}>
              Überspringen
            </button>
          </div>
        </>
      )}

      {step === "autofill" && autofillStage === "loading" && (
        <>
          <h2>Firmendaten werden geladen…</h2>
          <p>Bitte warten, die Daten aus dem Handelsregister werden eingetragen.</p>
          <div
            style={{
              margin: "30px auto",
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "4px solid #ccc",
              borderTopColor: "#2563eb",
              animation: "spin 1s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      )}

      {step === "upload" && (
        <>
          <h2>Unterlagen hochladen</h2>
          <p>Bitte alle drei Dateien auswählen. Danach bestätigen.</p>

          <div style={{ display: "grid", gap: 14, maxWidth: 520, margin: "18px auto" }}>
            <label>
              <div className="font-medium">FIBU</div>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={makePickHandler("fibu")}
              />
              {files.fibu && (
                <div className="text-sm" style={{ color: "#666" }}>
                  {files.fibu.name} · {niceSize(files.fibu)}
                </div>
              )}
            </label>

            <label>
              <div className="font-medium">Stammanteilbewertung</div>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={makePickHandler("stamm")}
              />
              {files.stamm && (
                <div className="text-sm" style={{ color: "#666" }}>
                  {files.stamm.name} · {niceSize(files.stamm)}
                </div>
              )}
            </label>

            <label>
              <div className="font-medium">Verlusttabelle</div>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={makePickHandler("verlust")}
              />
              {files.verlust && (
                <div className="text-sm" style={{ color: "#666" }}>
                  {files.verlust.name} · {niceSize(files.verlust)}
                </div>
              )}
            </label>
          </div>

          <button className="btn btn--primary" disabled={!allSelected || uploading} onClick={() => setConfirmOpen(true)}>
            {uploading ? "Lade hoch …" : "Hochladen"}
          </button>
        </>
      )}

      {confirmOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: 520,
              maxWidth: "92vw",
              background: "#fff",
              color: "#0f172a",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              boxShadow: "0 20px 70px rgba(2,6,23,.25)",
              padding: 16,
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Bitte bestätigen"
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>Bitte bestätigen</div>
              <button className="af-x" onClick={() => setConfirmOpen(false)} aria-label="Schliessen">
                ✕
              </button>
            </div>

            <p style={{ marginTop: 0, color: "#334155" }}>Diese Dateien werden hochgeladen:</p>
            <ul style={{ marginTop: 8 }}>
              <li>
                FIBU: <strong>{files.fibu?.name}</strong> ({niceSize(files.fibu)})
              </li>
              <li>
                Stammanteilbewertung: <strong>{files.stamm?.name}</strong> ({niceSize(files.stamm)})
              </li>
              <li>
                Verlusttabelle: <strong>{files.verlust?.name}</strong> ({niceSize(files.verlust)})
              </li>
            </ul>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn" onClick={() => setConfirmOpen(false)}>
                Zurück
              </button>
              <button className="btn btn--primary" onClick={uploadAll} disabled={uploading}>
                Jetzt hochladen
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "loading" && (
        <>
          <h2>Ihr Jahresbericht wird fertiggestellt</h2>
          <p>Bitte warten…</p>
          <div
            style={{
              margin: "30px auto",
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "4px solid #ccc",
              borderTopColor: "#2563eb",
              animation: "spin 1s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      )}

      {step === "done" && (
        <>
          <h2>Fertiges Dokument</h2>
          <DocxEditor initialContent={html} />

          <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "center" }}>
            {companyId && (
              <button className="btn" onClick={() => nav(`/companies/${companyId}`)}>
                Zur Firma
              </button>
            )}
            <button className="btn btn--primary" onClick={() => nav("/dashboard")}>
              Zurück zum Dashboard
            </button>
          </div>
        </>
      )}

      <AutofillModal
        open={autofillOpen}
        html={html}
        initialValues={autofillValues}
        onClose={() => setAutofillOpen(false)}
        onApply={(replacedHtml) => {
          setHtml(replacedHtml);
          setAutofillOpen(false);
          if (reviewStage === "after-search") setStep("upload");
          if (reviewStage === "after-processing") setStep("done");
        }}
      />
    </div>
  );
}