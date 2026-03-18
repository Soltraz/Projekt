// src/autofill/AutofillModal.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildVars, searchCompanies } from "./api";
import type { Vars } from "./api";
import type { CompanyHit } from "./api";
import { applyPlaceholdersToHtml } from "./replacePlaceholders";

type Props = {
  open: boolean;
  html: string;
  initialValues?: Record<string, string>;
  onClose: () => void;
  onApply: (replacedHtml: string, values: Record<string, string>) => void;
};

const KNOWN_ORDER: (keyof Vars)[] = [
  "CompanyName",
  "Adresse",
  "PLZ",
  "ORT",
  "Stammkapital",
  "Stammanteil",
  "UID",
  "Gesellschafter",
  "Gesellschafter_ort",
];

export default function AutofillModal({ open, html, initialValues, onClose, onApply }: Props) {
  const [step, setStep] = useState<"search" | "vars">("search");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CompanyHit[]>([]);
  const [selected, setSelected] = useState<CompanyHit | null>(null);
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(initialValues || {});
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    // Wenn es bereits vorbefüllte Werte gibt, direkt in die Variablen-Ansicht
    const hasPreset = initialValues && Object.keys(initialValues).length > 0;
    setStep(hasPreset ? "vars" : "search");

    setQ("");
    setHits([]);
    setSelected(null);
    // values aus initialValues bleiben erhalten
  }, [open, initialValues]);

  // Suche (debounced)
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.trim().length < 3) { setHits([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true);
        const list = await searchCompanies(q.trim());
        setHits(list || []);
      } catch (e) {
        console.error(e);
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [q, open]);

  useEffect(() => {
  if (!open) return;
  setValues(initialValues || {}); // <-- Props in den lokalen State übernehmen
}, [open, initialValues]);

  async function pick(hit: CompanyHit) {
    try {
      setLoading(true);
      setSelected(hit);
      const payload: any = await buildVars(hit.uid);
      const vars: Vars = payload?.vars || payload || {};
      // in bestehende values mergen, damit man manuell schon gesetzte Werte behält
      setValues((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v ?? ""])) }));
      setStep("vars");
    } catch (e) {
      console.error(e);
      alert("Autofill fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    const newHtml = applyPlaceholdersToHtml(html, values);
    onApply(newHtml, values);
  }

  const orderedKeys = useMemo(() => {
    const keys = new Set(Object.keys(values));
    // bekannte zuerst, unbekannte (falls später mehr Variablen dazukommen) danach
    const first: string[] = KNOWN_ORDER.filter((k) => keys.has(k)).map(String);
    const rest: string[] = Array.from(keys).filter((k) => !first.includes(k));
    return [...first, ...rest];
  }, [values]);

  if (!open) return null;

  return (
    <div className="af-backdrop" onClick={onClose}>
      <div className="af-modal" onClick={(e) => e.stopPropagation()}>
        <div className="af-header">
          <div className="af-title">Autofill</div>
          <button className="af-x" onClick={onClose} aria-label="Schliessen">✕</button>
        </div>

        {step === "search" && (
          <div className="af-body">
            <label className="af-label">Firma suchen</label>
            <input
              autoFocus
              className="af-input"
              placeholder="z.B. Bieger Maler GmbH"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {loading && <div className="af-muted" style={{marginTop:8}}>Suche…</div>}
            {!loading && hits.length === 0 && q.trim().length >= 3 && (
              <div className="af-muted" style={{marginTop:8}}>Keine Treffer</div>
            )}
            <ul className="af-list">
              {hits.map((h) => (
                <li key={h.uid} className="af-item" onClick={() => pick(h)}>
                  <div className="af-item-title">{h.name}</div>
                  <div className="af-item-sub">
                    {h.uid} · {h.legalForm || ""} · {h.legalSeat || ""}
                  </div>
                </li>
              ))}
            </ul>
            <div className="af-footer">
              <button className="af-btn" onClick={onClose}>Abbrechen</button>
            </div>
          </div>
        )}

        {step === "vars" && (
          <div className="af-body">
            <div className="af-label">
              Werte aus Handelsregister {selected ? `für „${selected.name}“` : ""} (bearbeitbar)
            </div>
            <div className="af-vars">
              {orderedKeys.map((k) => (
                <div key={k} className="af-row">
                  <div className="af-key">{`{${k}}`}</div>
                  <input
                    className="af-val"
                    value={values[k] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                    placeholder="(leer lassen, wenn NICHT ersetzen)"
                  />
                </div>
              ))}
              {orderedKeys.length === 0 && (
                <div className="af-muted">Keine Variablen geladen.</div>
              )}
            </div>

            <div className="af-note">
              Es werden nur Felder ersetzt, die hier einen Wert haben. Alle übrigen
              Platzhalter (z.&nbsp;B. <code>{'{Stammanteil}'}</code>) bleiben im Text erhalten.
            </div>

            <div className="af-footer">
              <button className="af-btn" onClick={() => setStep("search")}>← Andere Firma</button>
              <div style={{ flex: 1 }} />
              <button className="af-btn" onClick={onClose}>Abbrechen</button>
              <button className="af-btn af-primary" onClick={apply}>Anwenden</button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .af-backdrop{position:fixed;inset:0;background:rgba(2,6,23,.45);display:flex;align-items:center;justify-content:center;z-index:9999;}
        .af-modal{width:min(860px,calc(100vw - 32px));max-height:86vh;overflow:auto;background:#fff;color:#0f172a;border-radius:16px;border:1px solid #e5e7eb;box-shadow:0 20px 70px rgba(2,6,23,.25);}
        .af-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #eef2f7;}
        .af-title{font-weight:600}
        .af-x{border:0;background:transparent;cursor:pointer;font-size:18px;line-height:1}
        .af-body{padding:16px}
        .af-label{font-size:14px;color:#334155;margin-bottom:6px}
        .af-input{width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px}
        .af-list{list-style:none;margin:10px 0 0;padding:0}
        .af-item{padding:10px 12px;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:8px;cursor:pointer}
        .af-item:hover{background:#f9fafb}
        .af-item-title{font-weight:600}
        .af-item-sub{color:#6b7280;font-size:12px;margin-top:2px}
        .af-vars{display:flex;flex-direction:column;gap:8px;margin-top:8px}
        .af-row{display:flex;gap:8px}
        .af-key{flex:0 0 260px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#334155;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:8px}
        .af-val{flex:1;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px}
        .af-footer{display:flex;gap:8px;align-items:center;margin-top:14px}
        .af-btn{border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;background:#fff;cursor:pointer}
        .af-btn:hover{background:#f8fafc}
        .af-primary{background:#2563eb;color:#fff;border-color:#2563eb}
        .af-note{color:#475569;font-size:12px;margin-top:8px}
        .af-muted{color:#94a3b8}
      `}</style>
    </div>
  );
}
