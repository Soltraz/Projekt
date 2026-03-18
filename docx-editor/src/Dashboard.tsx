// src/Dashboard.tsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { API, jGET, jPOST, searchCompanies } from "./api";
import type { CompanyHit } from "./api";
import "./Dashboard.css";
import symbol from "./assets/symbol_E_REVISIA.svg";

type SearchModalProps = {
  open: boolean;
  onClose: () => void;
  onSelectName: (name: string) => void;
  isCreating: boolean;
};

function CompanySearchModal({
  open,
  onClose,
  onSelectName,
  isCreating,
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CompanyHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Reset, wenn Modal öffnet / schliesst
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
  }, [open]);

  // Autocomplete ab 3 Zeichen
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const q = query.trim();
    if (q.length < 3) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }

    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await searchCompanies(q);
        setHits(list || []);
      } catch (e) {
        console.error(e);
        setError("Suche fehlgeschlagen, bitte später erneut versuchen.");
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 300) as unknown as number;
  }, [open, query]);

  if (!open) return null;

  const canCreateFree = query.trim().length >= 2;

  return (
    <div className="rv-modal-overlay">
      <div className="rv-modal">
        <div className="rv-modal-header">
          <div>
            <h2 className="rv-modal-title">Neue Firma anlegen</h2>
            <p className="rv-modal-subtitle">
              Tippe einen Firmennamen ein. Ab 3 Buchstaben werden Vorschläge aus dem Handelsregister angezeigt.
            </p>
          </div>
          <button
            type="button"
            className="rv-modal-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="rv-modal-body">
          <label className="rv-modal-label">
            Firmenname
            <input
              autoFocus
              className="rv-modal-input"
              placeholder="z. B. Meier Treuhand AG"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreateFree && !isCreating) {
                  onSelectName(query.trim());
                }
              }}
            />
          </label>

          {loading && (
            <div className="rv-modal-hint">Suche Firmen…</div>
          )}
          {!loading && query.trim().length < 3 && (
            <div className="rv-modal-hint">
              Gib mindestens 3 Buchstaben ein, um Vorschläge zu sehen.
            </div>
          )}
          {error && <div className="rv-modal-error">{error}</div>}

          {hits.length > 0 && (
            <div className="rv-modal-results">
              {hits.map((h) => (
                <button
                  key={h.uid + h.name}
                  type="button"
                  className="rv-modal-result-row"
                  disabled={isCreating}
                  onClick={() => onSelectName(h.name)}
                >
                  <div className="rv-modal-result-main">
                    <div className="rv-modal-result-name">{h.name}</div>
                    <div className="rv-modal-result-meta">
                      {h.legalForm && <span>{h.legalForm}</span>}
                      {h.legalSeat && (
                        <span>
                          {h.legalForm ? " · " : ""}
                          {h.legalSeat}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="rv-modal-result-uid">
                    {h.uid || "ohne UID"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rv-modal-footer">
          <button
            type="button"
            className="rv-button rv-button--primary"
            disabled={!canCreateFree || isCreating}
            onClick={() => {
              if (!canCreateFree) return;
              onSelectName(query.trim());
            }}
          >
            {isCreating ? "Erstelle Firma…" : "Firma mit diesem Namen anlegen"}
          </button>
          <button
            type="button"
            className="rv-button rv-button--ghost"
            onClick={onClose}
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [shareholders, setShareholders] = useState<any[]>([]);
  const [selectedShareholder, setSelectedShareholder] = useState<any | null>(null);
  const [shareholderModalOpen, setShareholderModalOpen] = useState(false);
  const [newCompany, setNewCompany] = useState<any | null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const nav = useNavigate();

  // Theme Toggle
  const [theme, setTheme] = useState<"light" | "dark">((localStorage.getItem("theme") as "light" | "dark") || "light");
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem("theme", theme); }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  async function load() {
    try {
      setCompanies(await jGET(`${API}/api/companies`));
    } catch {
      setCompanies([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => {
      const profile = c.profile || {};
      const parts = [
        c.name,
        profile.CompanyName,
        profile.Adresse,
        profile.ORT,
        profile.PLZ,
        c.uid,
      ]
        .filter(Boolean)
        .map((x: string) => x.toLowerCase());
      return parts.some((p: string) => p.includes(q));
    });
  }, [companies, search]);


  async function createCompanyFromName(name: string) {
    const clean = name.trim();
    if (clean.length < 2) {
      alert("Firmenname ist zu kurz.");
      return;
    }
    setCreating(true);
    try {
      const r = await jPOST(`${API}/api/companies`, { name: clean });
      const c = (r as any)?.company;

      if (!c) {
        throw new Error("Server hat keine Firma zurückgegeben.");
      }

      // 1) Vars + Personen vom Server holen (wie im alten Frontend)
      // 1) Vars + Personen vom Server holen (wie im alten Frontend)
      let gesellschafterList: any[] = [];

      // immer erst uidCanon, dann uid
      const uid = c.uidCanon || c.uid;

      if (uid) {
        const payload = await jGET(
          `${API}/api/vars/build?uid=${encodeURIComponent(uid)}&id=${c.id}`
        );

        const persons = (payload as any).persons || [];
        console.log("Dashboard persons", persons);

        // zuerst nur echte Gesellschafter
        gesellschafterList = persons.filter(
          (p: any) => p.role === "gesellschafter"
        );

        // Fallback: falls keine role="gesellschafter" gesetzt ist
        if (!gesellschafterList.length) {
          gesellschafterList = persons;
        }
      }


      // 2) Falls mehrere Gesellschafter -> Popup im Dashboard öffnen
      if (gesellschafterList.length > 1) {
        setShareholders(gesellschafterList);
        setSelectedShareholder(null);
        setNewCompany(c);
        setSearchModalOpen(false);
        setShareholderModalOpen(true);
        return; // WICHTIG: hier kein nav, erst nach Auswahl
      }

      // 3) Standardfall: kein oder nur ein Gesellschafter -> direkt zur Firma
      if (c.id) {
        nav(`/companies/${c.id}`);
      } else {
        await load();
      }
      setSearchModalOpen(false);
    } catch (e: any) {
      alert("Firma konnte nicht angelegt werden:\n" + (e?.message || e));
    } finally {
      setCreating(false);
    }
  }


  return (
    <div className="rv-shell">
      {/* Sidebar */}
      <aside className="rv-sidebar">
        <div className="rv-sidebar__brand">
          <div className="rv-logo-circle">
            <img src={symbol} alt="REVISIA" className="rv-logo-img" />
          </div>
          <div className="rv-logo-text">
            <span className="rv-logo-title">Revisia</span>
            <span className="rv-logo-subtitle">Jahresberichte</span>
          </div>
        </div>

        <nav className="rv-sidebar__nav">
          <button className="rv-nav-item rv-nav-item--active" type="button">
            <span className="rv-nav-dot" />
            <span>Firmen</span>
            <span className="rv-nav-count">{companies.length}</span>
          </button>
        </nav>

        <div className="rv-sidebar__footer">
          <button className="rv-pill-btn" type="button" onClick={toggleTheme}>
            {theme === "light" ? "Dark Mode" : "Light Mode"}
          </button>
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

      {/* Main content */}
      <main className="rv-main">
        <header className="rv-page-header">
          <div>
            <h1 className="rv-page-title">Firmen</h1>
            <p className="rv-page-subtitle">
              Übersicht aller Mandate, die mit Revisia verwaltet werden.
            </p>
          </div>

          <div className="rv-page-summary">
            <div className="rv-summary-card">
              <div className="rv-summary-label">Mandate aktiv</div>
              <div className="rv-summary-value">{companies.length}</div>
            </div>
          </div>
        </header>

        {/* Toolbar */}
        <section className="rv-toolbar">
          <div className="rv-toolbar-left">
            <div className="rv-search">
              <span className="rv-search-icon">🔍</span>
              <input
                type="text"
                className="rv-input"
                placeholder="Firmen filtern…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* bisherige Neue-Firma-Leiste = zusätzlicher Filter */}
          <button
            className="rv-button rv-button--primary"
            onClick={() => setSearchModalOpen(true)}
            type="button"
            disabled={creating}
          >
            Neue Firma
          </button>

        </section>

        {/* Table card */}
        <section className="rv-card">
          <div className="rv-table-wrapper">
            <table className="rv-table">
              <thead>
                <tr>
                  <th>Firmenname</th>
                  <th>Strasse und Hausnummer</th>
                  <th>PLZ</th>
                  <th>Ort</th>
                  <th>Manager</th>
                  <th className="rv-col-status">Status</th>
                  <th className="rv-col-actions" />
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.map((c) => {
                  const profile = c.profile || {};
                  const name = profile.CompanyName || c.name;
                  const adresse = profile.Adresse || "–";
                  const plz = profile.PLZ || "–";
                  const ort = profile.ORT || "–";
                  const manager = profile.manager || "Nicht zugewiesen";

                  return (
                    <tr
                      key={c.id}
                      className="rv-row"
                      onClick={() => nav(`/companies/${c.id}`)}
                    >
                      <td>
                        <div className="rv-cell-main">
                          <div className="rv-cell-title">{name}</div>
                          {c.uid && (
                            <div className="rv-cell-sub">UID {c.uid}</div>
                          )}
                        </div>
                      </td>
                      <td>{adresse}</td>
                      <td>{plz}</td>
                      <td>{ort}</td>
                      <td>{manager}</td>
                      <td className="rv-col-status">
                        <span className="rv-status-pill rv-status-pill--active">
                          Aktiv
                        </span>
                      </td>
                      <td
                        className="rv-col-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="rv-link-button"
                          type="button"
                          onClick={() => nav(`/companies/${c.id}`)}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredCompanies.length === 0 && (
                  <tr>
                    <td colSpan={7} className="rv-empty">
                      {companies.length === 0
                        ? "Noch keine Firmen erfasst."
                        : "Keine Firmen passend zur Suche gefunden."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <footer className="rv-footer">
            <span>Footer Content</span>
            <span className="rv-footer-meta">
              Revisia · Entwickelt für Marzo Treuhand
            </span>
          </footer>
        </section>
      </main>

      {/* Such-Modal für neue Firma */}
      <CompanySearchModal
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onSelectName={createCompanyFromName}
        isCreating={creating}
      />

      {shareholderModalOpen && shareholders.length > 1 && (
        <div className="rv-modal-overlay">
          <div className="rv-modal">
            <div className="rv-modal-header">
              <div>
                <h2 className="rv-modal-title">Gesellschafter wählen</h2>
                <p className="rv-modal-subtitle">
                  Diese Firma hat mehrere Personen im Handelsregister.
                  Bitte wähle den relevanten Gesellschafter für den Jahresbericht.
                </p>
              </div>
              <button
                type="button"
                className="rv-modal-close"
                onClick={() => setShareholderModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="rv-modal-body">
              <label className="rv-modal-label">
                Gesellschafter
                <select
                  className="rv-modal-input"
                  value={
                    selectedShareholder
                      ? shareholders.indexOf(selectedShareholder)
                      : ""
                  }
                  onChange={(e) => {
                    const index = Number(e.target.value);
                    const selected = shareholders[index];
                    setSelectedShareholder(selected || null);
                  }}
                >
                  <option value="" disabled>
                    Bitte Gesellschafter wählen
                  </option>
                  {shareholders.map((p, index) => (
                    <option key={index} value={index}>
                      {p.anzeige || p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rv-modal-footer">
              <button
                type="button"
                className="rv-button rv-button--primary"
                onClick={async () => {
                  if (!selectedShareholder || !newCompany) {
                    alert("Bitte einen Gesellschafter auswählen.");
                    return;
                  }

                  try {
                    await jPOST(`${API}/api/vars/person?companyId=${encodeURIComponent(newCompany.id)}`, {
                      name: selectedShareholder.name,
                      anzeige: selectedShareholder.anzeige,
                    });
                  } catch (e: any) {
                    alert(
                      "Gesellschafter konnte nicht gespeichert werden:\n" +
                      (e?.message || e)
                    );
                    return;
                  }

                  setShareholderModalOpen(false);
                  nav(`/companies/${newCompany.id}`);
                }}
              >
                Gesellschafter speichern und fortfahren
              </button>

              <button
                type="button"
                className="rv-button rv-button--ghost"
                onClick={() => {
                  setShareholderModalOpen(false);
                  if (newCompany?.id) {
                    nav(`/companies/${newCompany.id}`);
                  }
                }}
              >
                Überspringen
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
