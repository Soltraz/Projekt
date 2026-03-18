// src/autofill/replacePlaceholders.ts
export type Values = Record<string, string>;

export function applyPlaceholdersToHtml(html: string, values: Values): string {
  const filtered = Object.fromEntries(
    Object.entries(values).filter(
      ([, v]) => typeof v === "string" && v.trim() !== ""
    )
  );
  if (Object.keys(filtered).length === 0) return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);

  let n: Node | null;
  while ((n = walker.nextNode())) {
    const old = n.nodeValue ?? "";
    let next = old;
    for (const [key, val] of Object.entries(filtered)) {
      const token = `{${key}}`; // z.B. {CompanyName}
      if (next.includes(token)) next = next.split(token).join(val);
    }
    if (next !== old) n.nodeValue = next;
  }
  return doc.body.innerHTML;
}

export function extractPlaceholdersFromHtml(html: string): string[] {
  const re = /\{([a-zA-Z][a-zA-Z0-9_.-]*)\}/g;
  const keys = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = re.exec(html))) {
    keys.add(match[1]);
  }

  return Array.from(keys);
}
