// src/autofill/autofill-utils.ts

// Zwei Regex-Varianten: global fürs Sammeln/Ersetzen, single fürs .test()
const CURLY_VAR_GLOBAL = /\{([A-Za-z0-9_]+)\}/g;
const CURLY_VAR_SINGLE = /\{([A-Za-z0-9_]+)\}/;

export const escapeHtml = (s: string) =>
  (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// „Schlüssel“ (Keys) aus beliebigem Text ableiten
export const toKey = (s: string) =>
  (s || "")
    .normalize("NFKD")
    // Unicode Letter/Number (benötigt moderne Browser) – plus Fallback:
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/[^A-Za-z0-9 ]+/g, "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^[^A-Za-z_]/, "_"); // Key muss mit Buchstabe/Unterstrich starten

const isFilled = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Alle {…}-Platzhalter aus einem HTML-String sammeln */
export function extractCurlyVars(html: string): string[] {
  const set = new Set<string>();
  (html || "").replace(CURLY_VAR_GLOBAL, (_, name: string) => {
    set.add(name);
    return "";
  });
  return Array.from(set);
}

/** Alle markierten Segmente <mark>…</mark> als Variablen-Kandidaten (aus HTML) */
export function extractMarkedVarsFromHtml(html: string): string[] {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";

  const marks = Array.from(tmp.querySelectorAll("mark"));
  const keys: string[] = [];
  let idx = 1;

  for (const m of marks) {
    const raw = (m.textContent || "").trim();
    if (!raw) continue;

    // wenn im markierten Text bereits {Key} steht → diese Keys nehmen
    const inside: string[] = [];
    (raw.match(CURLY_VAR_GLOBAL) || []).forEach((frag) => {
      const mm = frag.match(CURLY_VAR_SINGLE);
      if (mm?.[1]) inside.push(mm[1]);
    });
    if (inside.length) {
      inside.forEach((k) => keys.push(k));
      continue;
    }

    const k = toKey(raw) || `VAR_${idx++}`;
    keys.push(k);
  }

  return Array.from(new Set(keys));
}

/** Sammle alle erkennbaren Keys (Union aus {…} und <mark>) */
export function collectVariableKeys(html: string): string[] {
  const keys = new Set<string>();
  extractCurlyVars(html).forEach((k) => keys.add(k));
  extractMarkedVarsFromHtml(html).forEach((k) => keys.add(k));
  return Array.from(keys);
}

/**
 * Ersetzt Variablen im HTML:
 *  - {Key} → escapeHtml(values[Key]) **nur wenn der Wert nicht leer ist**
 *    (sonst bleibt {Key} stehen, damit später befüllbar)
 *  - <mark>PlainKey</mark> → values[PlainKey] **nur wenn Wert nicht leer**
 *    (sonst bleibt die Markierung stehen)
 *  - removeMarks=true: Markierungen werden **nur dann** entfernt,
 *    wenn sie ersetzt wurden. Unbefüllte Marks bleiben.
 */
export function replaceVarsInHtml(
  html: string,
  values: Record<string, string>,
  removeMarks = true
): string {
  const val = values || {};
  let out = html || "";

  // 1) {…}-Platzhalter ersetzen – nur wenn ausgefüllt
  out = out.replace(CURLY_VAR_GLOBAL, (_, name: string) => {
    const v = val[name];
    return isFilled(v) ? escapeHtml(v) : `{${name}}`;
  });

  // 2) Markierte Segmente ersetzen/entmarken
  const tmp = document.createElement("div");
  tmp.innerHTML = out;

  Array.from(tmp.querySelectorAll("mark")).forEach((m) => {
    const originalText = (m.textContent || "").trim();

    // Fall A: Mark enthält {…}
    //   - Wenn nach Schritt (1) noch {…} vorhanden → war nicht befüllt → Mark bleibt
    //   - Wenn kein {…} mehr → wurde ersetzt → Mark ggf. entfernen
    if (CURLY_VAR_SINGLE.test(originalText)) {
      const currentText = (m.textContent || "").trim();
      const stillHasCurly = CURLY_VAR_SINGLE.test(currentText);
      if (!stillHasCurly && removeMarks) {
        // wurde ersetzt → Mark entfernen, Text behalten
        const span = document.createElement("span");
        span.textContent = currentText;
        m.replaceWith(span);
      }
      return;
    }

    // Fall B: Mark hat Plain-Text → wir interpretieren ihn als Key
    const key = toKey(originalText);
    if (key && isFilled(val[key])) {
      const span = document.createElement("span");
      span.textContent = val[key]; // sicher als Text
      // Mark entfernen, wenn "befüllt" und removeMarks=true
      m.replaceWith(removeMarks ? span : (() => { m.textContent = val[key]; return m; })());
    } else {
      // Unbefüllt → Mark bleibt stehen (für späteres Ausfüllen)
    }
  });

  return tmp.innerHTML;
}
