import React, { useRef, useState, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import { Color } from "@tiptap/extension-color";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Underline from "@tiptap/extension-underline";

import { saveAs } from "file-saver";
import * as mammoth from "mammoth/mammoth.browser";
import JSZip from "jszip";

import AutofillModal from "./autofill/AutofillModal";
import { EXAMPLE_JAHRESRECHNUNG_HTML } from "./templates/jahresrechnung-example";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";

const A4_HEIGHT_PX = 1123;
const PAGE_PADDING_TOP = 32;
const PAGE_PADDING_BOTTOM = 32;

const BLOCK_SELECTOR = [
  "p","h1","h2","h3","h4","h5","h6","ul","ol","blockquote","pre","table","figure","hr",
].join(",");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}
const FontSize = TextStyle.extend({
  name: "fontSize",
  addGlobalAttributes() {
    return [{
      types: ["textStyle"],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el: HTMLElement) => (el.style.fontSize ? el.style.fontSize : null),
          renderHTML: (attrs: Record<string, any>) => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (fontSize: string) => ({ chain }: any) => chain().setMark("textStyle", { fontSize }).run(),
      unsetFontSize: () => ({ chain }: any) => chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

type ColorItem = { name: string; value: string };
type ColorDropdownProps = {
  title: string; buttonLabel: string; colors: ColorItem[];
  onSelect: (hexOrNull: string | null) => void; clearLabel: string; alignRight?: boolean;
};
function ColorDropdown({ title, buttonLabel, colors, onSelect, clearLabel, alignRight }: ColorDropdownProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = detailsRef.current; if (!el) return;
    const positionMenu = () => {
      if (!el.open || !summaryRef.current || !menuRef.current) return;
      const rect = summaryRef.current.getBoundingClientRect();
      const menu = menuRef.current;
      const prevVis = menu.style.visibility, prevDisp = menu.style.display, prevPos = menu.style.position;
      menu.style.visibility = "hidden"; menu.style.display = "block"; menu.style.position = "fixed";
      const mw = menu.offsetWidth || 180, mh = menu.offsetHeight || 200;
      menu.style.visibility = prevVis; menu.style.display = prevDisp; menu.style.position = prevPos;

      const gutter = 8, vw = window.innerWidth, vh = window.innerHeight;
      let left = rect.left, top = rect.bottom + 6; if (alignRight) left = rect.right - mw;
      if (left + mw + gutter > vw) left = Math.max(gutter, vw - mw - gutter);
      if (left < gutter) left = gutter;
      if (top + mh + gutter > vh && rect.top - 6 - mh > gutter) top = rect.top - 6 - mh;
      if (top + mh + gutter > vh) top = Math.max(gutter, vh - mh - gutter);

      menu.style.position = "fixed"; menu.style.top = `${top}px`; menu.style.left = `${left}px`; menu.style.zIndex = "1000";
    };
    const onToggle = () => {
      if (el.open) { positionMenu(); window.addEventListener("resize", positionMenu); window.addEventListener("scroll", positionMenu, true); }
      else { window.removeEventListener("resize", positionMenu); window.removeEventListener("scroll", positionMenu, true); }
    };
    el.addEventListener("toggle", onToggle);
    return () => { window.removeEventListener("resize", positionMenu); window.removeEventListener("scroll", positionMenu, true); el.removeEventListener("toggle", onToggle); };
  }, [alignRight]);

  return (
    <details ref={detailsRef} className="dropdown" title={title}>
      <summary ref={summaryRef as any} className="dropdown__button select select--narrow" role="button">
        {buttonLabel}
      </summary>
      <div ref={menuRef} className="dropdown__menu" role="menu" onClick={(e) => e.stopPropagation()} style={{ position: "fixed" }}>
        <button className="dropdown__item" onClick={() => onSelect(null)} role="menuitem" type="button">
          <span className="swatch" style={{ background: "transparent", border: "1px solid var(--border)" }} />
          {clearLabel}
        </button>
        {colors.map((c) => (
          <button key={c.value} className="dropdown__item" onClick={() => onSelect(c.value)} role="menuitem" type="button">
            <span className="swatch" style={{ background: c.value }} /> {c.name}
          </button>
        ))}
      </div>
    </details>
  );
}

function canDecode(img: HTMLImageElement): boolean { return typeof (img as any).decode === "function"; }
function waitForImage(el: HTMLImageElement): Promise<void> {
  if (canDecode(el)) return (el as any).decode().catch(() => {});
  if (el.complete) return Promise.resolve();
  return new Promise<void>((ok) => { const done = () => ok(); el.addEventListener("load", done, { once: true }); el.addEventListener("error", done, { once: true }); });
}

const PageBreaksPluginKey = new PluginKey<DecorationSet>("page-breaks");

function makePageBreaksExtension(options?: { pageHeightPx?: number; paddingTop?: number; paddingBottom?: number; keepWithNextTags?: string[]; }) {
  const PAGE_HEIGHT = options?.pageHeightPx ?? A4_HEIGHT_PX;
  const PAD_TOP = options?.paddingTop ?? PAGE_PADDING_TOP;
  const PAD_BOTTOM = options?.paddingBottom ?? PAGE_PADDING_BOTTOM;
  const KEEP_WITH_NEXT = new Set((options?.keepWithNextTags ?? ["H1","H2","H3"]).map((s) => s.toUpperCase()));
  const PAGE_CONTENT_MAX = PAGE_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const getOuterHeightWithMargins = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const styles = getComputedStyle(el);
    const mt = parseFloat(styles.marginTop || "0") || 0;
    const mb = parseFloat(styles.marginBottom || "0") || 0;
    return rect.height + mt + mb;
  };

  const extension = Extension.create({
    name: "pageBreaks",
    addProseMirrorPlugins() {
      let lastSignature = ""; let raf: number | null = null;

      const computeDecorations = (view: EditorView) => {

        const root = view.dom as HTMLElement;
        const blocks = Array.from(root.querySelectorAll(BLOCK_SELECTOR)) as HTMLElement[];

        if (!blocks.length) return { decos: DecorationSet.empty, signature: "empty" };

        type BreakInfo = { pos: number; rest: number; kind: 'break' | 'tail' };
        let used = 0;
        const breaks: BreakInfo[] = [];

        function pushBreakBefore(el: HTMLElement) {
          try {
            const pos  = view.posAtDOM(el, 0);
            const rest = Math.max(0, PAGE_CONTENT_MAX - used);
            breaks.push({ pos, rest: Math.max(0, PAGE_CONTENT_MAX - used), kind: 'break' });
          } catch {}
        }

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (!block.isConnected) continue;
        const cs = getComputedStyle(block);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const h = getOuterHeightWithMargins(block);

        const next = blocks[i + 1];
        if (next && KEEP_WITH_NEXT.has(block.tagName) && h <= PAGE_CONTENT_MAX) {
          const nextH = getOuterHeightWithMargins(next);
          const both = h + nextH;
          if (both <= PAGE_CONTENT_MAX && (used + both) > PAGE_CONTENT_MAX) {
            pushBreakBefore(block);   // ← rest wird hier aus aktuellem used berechnet
            used = h;                 // ← neue Seite startet mit diesem Block
            continue;
          }
        }

        if (h > PAGE_CONTENT_MAX) {
          pushBreakBefore(block);
          used = h;
          continue;
        }

        if ((used + h) > PAGE_CONTENT_MAX) {
          pushBreakBefore(block);
          used = h;                   // ← neue Seite
        } else {
          used += h;                  // ← auf aktueller Seite weiter
        }
      }

      const tail = Math.max(0, PAGE_CONTENT_MAX - used);
      if (tail > 0) {
        const endPos = view.state.doc.content.size;  // ⬅️ WICHTIG: ans echte Dokumentende
        breaks.push({ pos: endPos, rest: tail, kind: 'tail' });
      }

      const widgets = breaks.map(({ pos, rest, kind }, idx) =>
        Decoration.widget(
          pos,
          () => {
            const el = document.createElement('div');
            el.className = (kind === 'tail') ? 'page-tail' : 'page-break';
            el.style.setProperty('--fill', `${rest}px`);
            el.setAttribute('contenteditable', 'false');
            return el;
          },
          { key: `pb-${pos}:${kind}-${idx}`, side: (kind === 'tail' ? 1 : -1) } // ⬅️ Tail nach dem letzten Inhalt
        )
      );

        const decos = DecorationSet.create(view.state.doc, widgets);
        const signature = breaks.map(b => `${b.pos}:${b.rest}`).join(",");
        return { decos, signature };
    };

      const schedule = (view: EditorView) => {
        if (raf != null) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(() => {
            const { decos, signature } = computeDecorations(view);
            if (signature === lastSignature) return;
            lastSignature = signature;
            const tr = view.state.tr.setMeta(PageBreaksPluginKey, decos);
            view.dispatch(tr);
          });
        });
      };

      return [new Plugin<DecorationSet>({
        key: PageBreaksPluginKey,
        state: { init: () => DecorationSet.empty, apply(tr, old) { return (tr.getMeta(PageBreaksPluginKey) as DecorationSet) ?? old; } },
        props: { decorations(state) { return this.getState(state) as DecorationSet; } },
        view(editorView) {
          schedule(editorView);
          const onResize = () => schedule(editorView);
          window.addEventListener("resize", onResize, { passive: true });
          const mo = new MutationObserver(() => schedule(editorView));
          const ro = new ResizeObserver(() => schedule(editorView));
          const el = editorView.dom as HTMLElement;
          mo.observe(el, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ["src","style","class"] });
          ro.observe(el);
          return { destroy() { window.removeEventListener("resize", onResize); mo.disconnect(); ro.disconnect(); if (raf != null) cancelAnimationFrame(raf); } };
        },
      })];
    },
  });

  return extension;
}

const VAR_RX = /\{([a-zA-Z][a-zA-Z0-9_.-]*)\}/g;

function wrapMissingVariablesInHtml(html: string, provided: Record<string, string>): string {
  let counter = 0;
  const escape = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return html.replace(VAR_RX, (_m, key: string) => {
    const val = (provided?.[key] ?? "").trim();
    if (val) return escape(val);
    const id = `var-${counter++}`;
    return `<span class="var-chip var-missing" data-var="${key}" data-var-id="${id}" contenteditable="false" title="Klicken zum Ausfuellen">{${key}}</span>`;
  });
}

function convertTextPlaceholdersToChips(rootEl: Element) {
  const existing = rootEl.querySelectorAll('[data-var-id^="var-"]').length;
  let counter = existing;
  const tw = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const re = /\{([a-zA-Z][a-zA-Z0-9_.-]*)\}/g;

  const todo: Text[] = [];
  let n: Node | null;
  while ((n = tw.nextNode())) {
    const t = n as Text;
    if (t.nodeValue && re.test(t.nodeValue)) { re.lastIndex = 0; todo.push(t); }
  }

  for (const textNode of todo) {
    const text = textNode.nodeValue || ""; re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0; let m: RegExpExecArray | null;

    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const key = m[1]; const id = `var-${counter++}`;
      const span = document.createElement("span");
      span.className = "var-chip var-missing";
      span.setAttribute("data-var", key);
      span.setAttribute("data-var-id", id);
      span.setAttribute("contenteditable", "false");
      span.setAttribute("title", "Klicken zum Ausfuellen");
      span.textContent = `{${key}}`;
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.replaceWith(frag);
  }
}

function collectMissingKeys(rootEl: Element): string[] {
  const chips = Array.from(rootEl.querySelectorAll<HTMLElement>("span.var-missing"));
  return Array.from(new Set(chips.map(c => c.getAttribute("data-var") || "").filter(Boolean)));
}

function replaceAllChipsForKey(doc: Document, key: string, value: string) {
  doc.querySelectorAll<HTMLElement>(`span.var-missing[data-var="${CSS.escape(key)}"]`)
     .forEach(chip => chip.replaceWith(doc.createTextNode(value)));
}

function applyValuesIntoHtml(html: string, values: Record<string,string>): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  convertTextPlaceholdersToChips(doc.body);
  Object.entries(values).forEach(([k,v]) => { if ((v ?? "").trim()) replaceAllChipsForKey(doc, k, v.trim()); });
  return doc.body.innerHTML;
}

export default function DocxEditor({
  readonly = false,
  initialContent = "<p>Neu: schreibe hier…</p>",
}: {
  readonly?: boolean;
  initialContent?: string;
}) {
  const bulkAbortRef = useRef(false);

  const [autofillOpen, setAutofillOpen] = useState(false);
  const [autofillValues, setAutofillValues] = useState<Record<string, string>>({});
  const originalTitleRef = useRef<string>(document.title);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [filename, setFilename] = useState<string>("Dokument.docx");

  const [varValues, setVarValues] = useState<Record<string,string>>({});
  const varValuesRef = useRef(varValues);
  useEffect(() => { varValuesRef.current = varValues; }, [varValues]);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkKeys, setBulkKeys] = useState<string[]>([]);
  const [bulkDraft, setBulkDraft] = useState<Record<string,string>>({});

  const [theme, setTheme] = useState<"light" | "dark">((localStorage.getItem("theme") as "light" | "dark") || "light");
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem("theme", theme); }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Underline, Image,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle, FontSize, FontFamily,
      Color.configure({ types: ["textStyle"] }),
      Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: true, lastColumnResizable: true }),
      TableRow, TableHeader, TableCell,
      makePageBreaksExtension({ pageHeightPx: A4_HEIGHT_PX, paddingTop: PAGE_PADDING_TOP, paddingBottom: PAGE_PADDING_BOTTOM, keepWithNextTags: ["H1","H2","H3"] }),
    ],
      content: initialContent,
      autofocus: !readonly,
      editable: !readonly,
      editorProps: { attributes: { class: "tiptap" } },
  });

  useEffect(() => {
    const before = () => { originalTitleRef.current = document.title; document.title = (filename || "Dokument").replace(/\.docx$/i, ""); };
    const after = () => { document.title = originalTitleRef.current; };
    window.addEventListener("beforeprint", before); window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, [filename]);

  const editorRootRef = useRef<HTMLDivElement | null>(null);

  function triggerWorkflowWebhook(docId = "default") {
    const base = import.meta.env.VITE_WORKFLOW_WEBHOOK_URL;
    const key  = import.meta.env.VITE_WORKFLOW_WEBHOOK_KEY;
    if (!base) { console.warn("VITE_WORKFLOW_WEBHOOK_URL fehlt"); return; }
    const url  = `${base}?doc=${encodeURIComponent(docId)}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
    fetch(url, { method: "GET", cache: "no-store" }).catch(e => console.warn("workflow webhook failed", e));
  }

  useEffect(() => {
    if (!editor) return;
    const root = editorRootRef.current?.querySelector(".tiptap") as HTMLElement | null;
    if (!root) return;

    const onClick = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement)?.closest(".var-missing") as HTMLElement | null;
      if (!el) return;

      const key = el.getAttribute("data-var") || "";
      let value = (varValuesRef.current[key] ?? "").trim();

      if (!value) {
        const val = window.prompt(`Wert fuer {${key}}`, "");
        if (val == null || !val.trim()) return;
        value = val.trim();
        setVarValues(prev => ({ ...prev, [key]: value }));
      }

      const html = (editorRootRef.current!.querySelector(".tiptap") as HTMLElement).innerHTML;
      const doc  = new DOMParser().parseFromString(html, "text/html");
      convertTextPlaceholdersToChips(doc.body);
      replaceAllChipsForKey(doc, key, value);

      editor.commands.setContent(doc.body.innerHTML, { emitUpdate: true, parseOptions: { preserveWhitespace: "full" } });
    };

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [editor]);

  async function openAutofill() {
  if (!editor) return;
  const html = editor.getHTML();
  const keysInDoc = allPlaceholdersFromHtml(html);       // z.B. ["CompanyName","Stammkapital",...]
  let serverVars: Record<string,string> = {};

  try {
    const resp = await fetch("/api/vars/current", { cache: "no-store" }).then(r => r.json());
    serverVars = (resp?.vars || {}) as Record<string, string>;
  } catch (e) {
    console.warn("vars/current failed", e);
  }

  const filtered = Object.fromEntries(
    keysInDoc
      .map(k => [k, (serverVars[k] ?? "").toString().trim()] as const)
      .filter(([_, v]) => !!v)
  );

  setAutofillValues(filtered);           // diese Werte zeigt das Modal an
  setAutofillOpen(true);
}

async function openBulkFill() {
  if (!editor) return;
  const root = editorRootRef.current?.querySelector(".tiptap") as HTMLElement | null;
  if (!root) return;

  bulkAbortRef.current = false;
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const html = editor.getHTML();
  const dom  = new DOMParser().parseFromString(html, "text/html");
  convertTextPlaceholdersToChips(dom.body);
  const missing = collectMissingKeys(dom.body);
  if (!missing.length) { console.info("Keine fehlenden Variablen gefunden."); return; }

  const draft: Record<string,string> = {};
  missing.forEach(k => { draft[k] = (varValuesRef.current[k] ?? "").trim(); });
  setBulkKeys(missing);
  setBulkDraft(draft);
  setBulkOpen(true);

  const relevantNow = allPlaceholdersFromHtml(html);
  const values: Record<string,string> = {};
  for (const k of relevantNow) {
    const v = (varValuesRef.current[k] ?? "").trim();
    if (v) values[k] = v;
  }

  try {
    await fetch("/api/missing/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relevant: relevantNow,
        missing,
        values,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn("missing/update failed", e);
  }

  triggerWorkflowWebhook("default");

  const AUTO_APPLY_WHEN_COMPLETE = false;     // bei Bedarf true
  const toFill = new Set(missing);            // <- wichtig: außerhalb der Schleife

  for (let t = 0; t < 30 && !bulkAbortRef.current; t++) {  // ~60s bei 2s Sleep
    let resp: any = null;
    try {
      resp = await fetch("/api/vars/current", { cache: "no-store" }).then(r => r.json());
    } catch {}

    const vars  = resp?.vars || {};
    const newly: Record<string,string> = {};

    toFill.forEach(k => {
      const v = (vars[k] ?? "").toString().trim();
      if (v) newly[k] = v;
    });

    if (Object.keys(newly).length) {
      setBulkDraft(prev => ({ ...prev, ...newly }));
      setVarValues(prev => ({ ...prev, ...newly }));
      Object.keys(newly).forEach(k => toFill.delete(k));
    }

    if (toFill.size === 0) {
      if (AUTO_APPLY_WHEN_COMPLETE) await submitBulkFill();
      break;
    }

    await sleep(2000);
  }
}

async function submitBulkFill() {
  const filled = Object.fromEntries(
    Object.entries(bulkDraft)
      .filter(([_, v]) => (v ?? "").trim())
      .map(([k, v]) => [k, v.trim()])
  );
  if (Object.keys(filled).length === 0) { setBulkOpen(false); return; }

  setVarValues(prev => ({ ...prev, ...filled }));

  const root = editorRootRef.current?.querySelector(".tiptap") as HTMLElement | null;
  if (!root || !editor) { setBulkOpen(false); return; }

  const html = root.innerHTML;
  const newHtml = applyValuesIntoHtml(html, { ...varValuesRef.current, ...filled });
  editor.commands.setContent(newHtml, { emitUpdate: true, parseOptions: { preserveWhitespace: "full" } });

  bulkAbortRef.current = true;

  try {
    await fetch("/api/reset", { method: "POST" });
  } catch (e) {
    console.warn("reset failed", e);
  }

  setVarValues({});
  setAutofillValues({});
  setBulkDraft({});
  setBulkKeys([]);

  setBulkOpen(false);
}

    function allPlaceholdersFromHtml(html: string): string[] {
    const re = /\{([a-zA-Z][a-zA-Z0-9_.-]*)\}/g;
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) out.add(m[1]);
    return Array.from(out);
  }

  const openFilePicker = () => fileInputRef.current?.click();
  const openImagePicker = () => imageInputRef.current?.click();

  function setHighlightColor(hex: string) { editor?.chain().focus().unsetHighlight().setHighlight({ color: hex }).run(); }
  function clearHighlight() { editor?.chain().focus().unsetHighlight().run(); }

  function looksLikeDocx(ab: ArrayBuffer) { const u8 = new Uint8Array(ab.slice(0,4)); return u8[0]===0x50 && u8[1]===0x4b && u8[2]===0x03 && u8[3]===0x04; }
  function escapeHtml(s: string) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function extractParasFromXmlAnyNs(xml: string): string[] {
    const doc = new DOMParser().parseFromString(xml,"application/xml");
    const all = Array.from(doc.getElementsByTagName("*"));
    const ps = all.filter((el) => el.localName === "p");
    const out: string[] = [];
    for (const p of ps) {
      let txt = ""; const it = doc.createNodeIterator(p, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let n: Node | null; while ((n = it.nextNode())) {
        if (n.nodeType === Node.TEXT_NODE) txt += n.nodeValue ?? "";
        else { const ln = (n as Element).localName; if (ln === "br") txt += "\n"; if (ln === "tab") txt += "\t"; }
      }
      const cleaned = txt.replace(/[ \t]+/g," ").replace(/\s*\n\s*/g,"\n").trim();
      if (cleaned) out.push(cleaned);
    }
    return out;
  }
  function toHtmlParagraph(s: string) { return `<p>${escapeHtml(s).replace(/\n/g,"<br/>")}</p>`; }
  function stripScripts(html: string) { return html.replace(/<script[\s\S]*?<\/script>/gi,""); }
  function normalizeWordTarget(target: string) { let t = target.replace(/^\/+/,""); if (!/^word\//i.test(t)) t = `word/${t}`; return t; }

  function isMhtml(s: string) { return /^\s*MIME-Version:\s*1\.0/i.test(s) && /Content-Type:\s*multipart\/related/i.test(s); }

  function decodeQuotedPrintable(input: string) {
    let s = input.replace(/=\r?\n/g,""); s = s.replace(/=([0-9A-F]{2})/gi,(_,hex)=>{ try { return String.fromCharCode(parseInt(hex,16)); } catch { return _; } }); return s;
  }
  
  function stripMhtml(raw: string) {
    const headerEnd = raw.search(/\r?\n\r?\n/); const header = headerEnd >= 0 ? raw.slice(0,headerEnd) : raw;
    const m = header.match(/boundary\s*=\s*("?)([^"\r\n]+)\1/i); const boundary = m ? m[2] : ""; if (!boundary) return raw;
    const parts = raw.split(new RegExp(`--${boundary}`));
    for (const part of parts) {
      if (!/Content-Type:\s*text\/html/i.test(part)) continue;
      const pHeaderEnd = part.search(/\r?\n\r?\n/); const pHeader = pHeaderEnd >= 0 ? part.slice(0,pHeaderEnd) : "";
      let body = pHeaderEnd >= 0 ? part.slice(pHeaderEnd + 2) : part;
      if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(pHeader)) body = decodeQuotedPrintable(body);
      return body;
    }
    return raw;
  }

  function stripMhtmlScaffolding(html: string) {
    return html.replace(/MIME-Version:.*?------=.*?--/gis,"").replace(/Content-Type:[^\n]*\n/gi,"").replace(/Content-Transfer-Encoding:[^\n]*\n/gi,"")
               .replace(/Content-Location:[^\n]*\n/gi,"").replace(/------=mhtDocumentPart(?:--)?/gi,"").trim();
  }

  async function fallbackExtractHtmlFromDocx(ab: ArrayBuffer): Promise<string> {
    const zip = await JSZip.loadAsync(ab);
    const textParts = Object.keys(zip.files).filter((n)=>/^word\/(document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/i.test(n));
    const paras: string[] = [];
    for (const name of textParts) { const xml = await zip.file(name)!.async("string"); paras.push(...extractParasFromXmlAnyNs(xml)); }
    const altHtml: string[] = [];
    const docXml = await zip.file("word/document.xml")?.async("string");
    const relXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
    if (docXml && relXml) {
      const doc = new DOMParser().parseFromString(docXml,"application/xml");
      const rels = new DOMParser().parseFromString(relXml,"application/xml");
      const relMap = new Map<string,{type:string;target:string}>();
      Array.from(rels.getElementsByTagName("Relationship")).forEach((rel)=>{ const id=rel.getAttribute("Id")||""; const type=rel.getAttribute("Type")||""; const target=rel.getAttribute("Target")||""; if (id && target) relMap.set(id,{type,target}); });
      const chunks = Array.from(doc.getElementsByTagName("*")).filter((el)=>el.localName==="altChunk");
      for (const ch of chunks) {
        const rid = ch.getAttribute("r:id") || ch.getAttribute("rId") || ch.getAttribute("Id") || ch.getAttribute("id") || "";
        if (!rid) continue; const rel = relMap.get(rid); if (!rel) continue; if (!/aF?Chunk/i.test(rel.type)) continue;
        const targetPath = normalizeWordTarget(rel.target); const file = zip.file(targetPath); if (!file) continue;
        const raw = await file.async("string"); const rawHtml = isMhtml(raw) ? stripMhtml(raw) : raw;
        const parsed = new DOMParser().parseFromString(rawHtml, "text/html"); const bodyHtml = parsed.body?.innerHTML || rawHtml;
        altHtml.push(`<div class="imported-html">${stripScripts(bodyHtml)}</div>`);
      }
    }
    if (!paras.length && !altHtml.length) return "";
    const out: string[] = []; if (paras.length) out.push(paras.map(toHtmlParagraph).join("")); if (altHtml.length) out.push(altHtml.join("\n")); return out.join("\n<hr/>\n");
  }

  const loadExample = () => {
    editor?.commands.setContent(EXAMPLE_JAHRESRECHNUNG_HTML, { emitUpdate: true, parseOptions: { preserveWhitespace: "full" } });
  };

  async function handleOpenDocx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return; setFilename(file.name.replace(/\.docx$/i,"") + ".docx");
    const arrayBuffer = await file.arrayBuffer();
    try {
      if (!looksLikeDocx(arrayBuffer)) { editor?.commands.setContent(`<p>⚠️ Die Datei wirkt nicht wie ein echtes .docx (Zip).</p>`, { emitUpdate: true }); e.target.value=""; return; }
      const { value: rawHtml, messages } = await mammoth.convertToHtml({ arrayBuffer }, { includeDefaultStyleMap: true });
      let html = (rawHtml ?? "").trim();
      if (html.includes("<body")) { const parsed = new DOMParser().parseFromString(html,"text/html"); html = (parsed.body?.innerHTML ?? "").trim(); }
      html = stripMhtmlScaffolding(html);
      const textOnly = html.replace(/<[^>]*>/g,"").trim();
      if (!textOnly) {
        console.warn("Mammoth messages:", messages);
        const fallbackHtml = await fallbackExtractHtmlFromDocx(arrayBuffer);
        if (fallbackHtml && fallbackHtml.replace(/<[^>]*>/g,"").trim()) {
          editor?.commands.setContent(fallbackHtml, { emitUpdate: true, parseOptions: { preserveWhitespace: "full" } });
        } else {
          editor?.commands.setContent(`<p>⚠️ Konnte keinen sichtbaren Inhalt extrahieren.</p>`, { emitUpdate: true });
        }
      } else {
        editor?.commands.setContent(html, { emitUpdate: true, parseOptions: { preserveWhitespace: "full" } });
      }
    } catch (err) {
      console.error("DOCX import failed:", err);
      editor?.commands.setContent(`<p>⚠️ Import fehlgeschlagen. Details in der Konsole.</p>`, { emitUpdate: true });
    } finally { e.target.value = ""; }
  }

  async function handlePrint() {
    window.dispatchEvent(new Event("resize"));
    await new Promise<void>((resolve)=>{ requestAnimationFrame(()=>{ requestAnimationFrame(()=>resolve()); }); });
    const root = editorRootRef.current?.querySelector(".tiptap") as HTMLElement | null;
    if (root) { const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img")); await Promise.all(imgs.map(waitForImage)); }
    window.print();
  }

  async function handleInsertImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const src = typeof reader.result === "string" ? reader.result : ""; if (src) editor?.commands.setImage({ src }); };
    reader.readAsDataURL(file); (e.target as HTMLInputElement).value = "";
  }

  function ensureHtmlDocx(): Promise<void> {
    if ((window as any).htmlDocx) return Promise.resolve();
    return new Promise((resolve, reject) => { const s = document.createElement("script"); s.src="/html-docx.js"; s.onload=()=>resolve(); s.onerror=()=>reject(new Error("html-docx.js konnte nicht geladen werden")); document.head.appendChild(s); });
  }

  async function handleExportDocx() {
    await ensureHtmlDocx();
    const body = editor?.getHTML() ?? "<p></p>";
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,Helvetica,sans-serif} p{margin:0 0 8px} table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ddd;padding:6px}
    </style></head><body>${body}</body></html>`;
    const blob = (window as any).htmlDocx.asBlob(fullHtml, { orientation: "portrait", margins: { top: 720, right: 720, bottom: 720, left: 720 } });
    saveAs(blob, filename || "Dokument.docx");
  }

  const fontSizes = ["11px","12px","14px","16px","18px","20px","24px","28px"];
  const fontFamilies = [
    { label: "Arial", value: "Arial, Helvetica, sans-serif" },
    { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
    { label: "Courier New", value: "'Courier New', Courier, monospace" },
  ];
  const highlightColors: ColorItem[] = [
    { name: "Gelb (Hell)", value: "#fff59d" }, { name: "Vanille", value: "#ffe9a8" }, { name: "Rosa", value: "#ffd1dc" },
    { name: "Hellblau", value: "#c7f0ff" }, { name: "Mint", value: "#baffc9" }, { name: "Lavendel", value: "#d1c4e9" },
  ];
  const textColors: ColorItem[] = [
    { name: "Grau", value: "#374151" }, { name: "Rot", value: "#ef4444" }, { name: "Orange", value: "#f59e0b" },
    { name: "Gruen", value: "#10b981" }, { name: "Blau", value: "#3b82f6" }, { name: "Violett", value: "#8b5cf6" },
  ];

  return (
    <div className="container">
      <div className="card">
        <div className="header">
          <h2 className="title">Online Steuerschreiber</h2>
          {!readonly && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={toggleTheme} title="Theme umschalten">
                {theme === "light" ? "Darkmode" : "Lightmode"}
              </button>
            </div>
          )}
        </div>

        {}
        <div className="ribbon ribbon--dense">
          <div className="ribbon-scroll">
            {}
            <div className="ribbon-group">
              <div className="group-body">
                <button className="btn" title="Oeffnen" onClick={openFilePicker}>Öffnen</button>
                <input ref={fileInputRef} type="file" accept=".docx" onChange={handleOpenDocx} className="input-file" />
                <button className="btn btn--primary" title="Als .docx exportieren" onClick={handleExportDocx}>Export</button>
                <button className="btn" title="Drucken (Browser-Dialog)" onClick={handlePrint}>Drucken</button>
              </div>
            </div>

            {}
            <div className="ribbon-group">
              <div className="group-body">
                <button className="btn" title="Rueckgaengig" onClick={() => editor?.chain().focus().undo().run()}>↶</button>
                <button className="btn" title="Wiederholen" onClick={() => editor?.chain().focus().redo().run()}>↷</button>
              </div>
            </div>

            {}
            <div className="ribbon-group">
              <div className="group-body">
                <select className="select" onChange={(e)=>editor?.chain().focus().setFontFamily(e.target.value).run()} defaultValue={fontFamilies[0].value} title="Schriftart">
                  {fontFamilies.map((f)=> (<option key={f.label} value={f.value}>{f.label}</option>))}
                </select>

                <select className="select select--narrow" onChange={(e)=>editor?.chain().focus().setFontSize(e.target.value).run()} defaultValue="14px" title="Schriftgroesse">
                  {fontSizes.map((s)=> (<option key={s} value={s}>{s}</option>))}
                </select>

                <button className="btn" title="Fett" onClick={()=>editor?.chain().focus().toggleBold().run()}>B</button>
                <button className="btn" title="Kursiv" onClick={()=>editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
                <button className="btn" title="Unterstrichen" onClick={()=>editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>

                <ColorDropdown title="Markierungsfarbe" buttonLabel="Mark-Farbe" colors={highlightColors} clearLabel="Keine Markierung" onSelect={(hex)=> (hex ? setHighlightColor(hex) : clearHighlight())} />
                <ColorDropdown title="Textfarbe" buttonLabel="Text-Farbe" colors={textColors} clearLabel="Ursprungstextfarbe"
                  onSelect={(hex)=> hex ? editor?.chain().focus().setColor(hex).run() : editor?.chain().focus().unsetColor().run()} alignRight />
              </div>
            </div>

            {}
            <div className="ribbon-group">
              <div className="group-body">
                <button className="btn" title="Links ausrichten" onClick={()=>editor?.chain().focus().setTextAlign("left").run()}>⟸</button>
                <button className="btn" title="Zentrieren" onClick={()=>editor?.chain().focus().setTextAlign("center").run()}>⟷</button>
                <button className="btn" title="Rechts ausrichten" onClick={()=>editor?.chain().focus().setTextAlign("right").run()}>⟹</button>
                <button className="btn" title="Aufzaehlung" onClick={()=>editor?.chain().focus().toggleBulletList().run()}>•</button>
                <button className="btn" title="Nummeriert" onClick={()=>editor?.chain().focus().toggleOrderedList().run()}>1.</button>
              </div>
            </div>

            {}
            <div className="ribbon-group">
              <div className="group-body">
                <button className="btn" title="Bild einfuegen" onClick={openImagePicker}>Bild</button>
                <input ref={imageInputRef} type="file" accept="image/*" onChange={handleInsertImage} className="input-file" />
              </div>
            </div>
          </div>
        </div>

        {}
        <div className="workspace" ref={editorRootRef}>
          <div className="page a4 portrait">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {}
      <AutofillModal
        open={autofillOpen}
        html={editor?.getHTML() ?? ""}
        initialValues={autofillValues}
        onClose={() => setAutofillOpen(false)}
        onApply={(replacedHtml, values) => {
          const withChips = wrapMissingVariablesInHtml(replacedHtml, values);
          editor?.commands.setContent(withChips, { emitUpdate: true, parseOptions: { preserveWhitespace: "full" } });
          setAutofillValues(values);
          setVarValues(prev => ({ ...prev, ...values }));
          setAutofillOpen(false);

          const usedKeys = Object.keys(values);
          const STICKY: string[] = []; // z.B.: ['CompanyName','Adresse','PLZ','ORT','UID']
          const toClear = usedKeys.filter(k => !STICKY.includes(k));

          if (toClear.length) {
            fetch("/api/vars/consume", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ keys: toClear }),
            }).catch(() => {});
          }
        }}
      />

      {}
      {bulkOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ width: 520, maxWidth: "92vw", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow)", padding: 16 }}>
            <h3 style={{ margin: "0 0 8px" }}>Fehlende Variablen ausfüllen</h3>
            <p style={{ margin: "0 0 12px", color: "var(--muted)" }}>Jede Variable wird einmal gesetzt und auf alle Vorkommen angewendet.</p>
            <div style={{ display: "grid", gap: 10, maxHeight: "50vh", overflow: "auto", paddingRight: 4 }}>
              {bulkKeys.map(k => (
                <label key={k} style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{`{${k}}`}</span>
                  <input
                    className="select" style={{ height: 32 }}
                    value={bulkDraft[k] ?? ""}
                    onChange={e => setBulkDraft(d => ({ ...d, [k]: e.target.value }))}
                    placeholder={`Wert fuer {${k}}`}
                  />
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn" onClick={() => setBulkOpen(false)}>Abbrechen</button>
              <button className="btn btn--primary" onClick={submitBulkFill}>Übernehmen</button>
            </div>
          </div>
        </div>
      )}

      {}
      <style>{`
        .dropdown { position: relative; }
        .dropdown[open] > .dropdown__menu { display: block; }
        .dropdown__button {
          height: 26px; padding: 0 8px; font-size: 12px; line-height: 26px;
          border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text);
          cursor: pointer; list-style: none; user-select: none;
        }
        .dropdown__button::-webkit-details-marker { display: none; }
        .dropdown__menu {
          display: none; min-width: 160px; padding: 6px; border: 1px solid var(--border); border-radius: 10px;
          background: var(--surface); box-shadow: var(--shadow); max-height: 260px; overflow: auto;
        }
        .dropdown__item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; background: transparent; color: var(--text); border: 1px solid transparent; border-radius: 8px; cursor: pointer; text-align: left; font-size: 13px; }
        .dropdown__item:hover { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 18%, transparent); }
        .swatch { width: 14px; height: 14px; border-radius: 4px; display: inline-block; }

        :root { --page-gap: 64px; --page-break-thickness: 14px; --page-padding-x: 28px; }
        .page.a4.portrait { padding: 32px var(--page-padding-x); }

        .page-break { display: block; position: relative; height: var(--page-gap); margin: 0; border: 0; user-select: none; }
        .page-break::before {
          content: ""; position: absolute; left: calc(-1 * var(--page-padding-x)); right: calc(-1 * var(--page-padding-x));
          top: calc(50% - var(--page-break-thickness) / 2); height: var(--page-break-thickness);
          background: var(--workspace); border-radius: 6px; box-shadow: 0 0 0 1px var(--border) inset; pointer-events: none;
        }
        .page-break::after {
          content: "Seitenumbruch"; position: absolute; left: 12px; top: calc(50% - var(--page-break-thickness) / 2 - 14px);
          font-size: 11px; line-height: 1; padding: 2px 8px; color: var(--muted); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; pointer-events: none;
        }

        .var-chip { display: inline-block; padding: 0 6px; border-radius: 8px;
          border: 1px dashed color-mix(in srgb, var(--primary) 45%, var(--border));
          background: color-mix(in srgb, var(--primary) 10%, #fff);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 12%, transparent);
        }
        .var-missing { cursor: pointer; }
        .var-missing:hover { box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 18%, transparent); border-color: var(--primary); }

        @media print {
          .ribbon, .header { display: none !important; }
          .workspace .page {
            display: contents !important;
            width: auto !important; min-height: auto !important; height: auto !important;
            margin: 0 !important; padding: 0 !important; background: transparent !important;
            border: 0 !important; box-shadow: none !important;
            break-before: auto !important; break-after: auto !important; page-break-before: auto !important; page-break-after: auto !important;
          }
          .page-break { margin: 0 !important; height: 0 !important; border: 0 !important; break-before: page !important; page-break-before: always !important; }
          .page-break::before, .page-break::after { display: none !important; }
          .tiptap, .tiptap * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .tiptap table thead { display: table-header-group; }
          .tiptap table tfoot { display: table-footer-group; }
          .tiptap table, .tiptap tr, .tiptap th, .tiptap td, .tiptap img, .tiptap pre, .tiptap blockquote { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
