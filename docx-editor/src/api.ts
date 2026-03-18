export const API = import.meta.env.VITE_API_BASE || "";
const ADMIN = import.meta.env.VITE_ADMIN_TOKEN;

export async function jGET<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

export async function jPOST<T = any>(url: string, body?: any): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (url.includes("/api/reset") && ADMIN) {
    headers["x-admin"] = ADMIN;
  }

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });

  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  try {
    return (await r.json()) as T;
  } catch {
    return undefined as any;
  }
}

export async function jDELETE<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { method: "DELETE" });
  let body: any = null;
  try {
    body = await r.json();
  } catch {

  }
  if (!r.ok) {
    const msg = body?.error || r.statusText || "request failed";
    const ids = body?.knownIds
      ? ` knownIds=[${body.knownIds.join(", ")}]`
      : "";
    throw new Error(`${url} → ${r.status} ${msg}${ids}`);
  }
  return body as T;
}

export async function deleteCompany(id: string, purgeVars = false) {
  const q = purgeVars ? `?purgeVars=true` : "";
  return jDELETE(
    `${API}/api/companies/${encodeURIComponent(id)}${q}`
  );
}

export async function uploadAll(files: {
  fibu: File;
  stamm: File;
  verlust: File;
}) {
  const fd = new FormData();
  fd.append("fibu", files.fibu);
  fd.append("stamm", files.stamm);
  fd.append("verlust", files.verlust);

  const r = await fetch(`${API}/api/upload`, {
    method: "POST",
    body: fd,
  });

  let data: any = null;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) {
    const msg = data?.error || r.statusText || "upload failed";
    throw new Error(`${API}/api/upload → ${r.status} ${msg}`);
  }
  return data;
}

export async function getTemplates() {
  return jGET<{
    ok: boolean;
    templates: { id: string; name: string }[];
  }>(`${API}/api/templates`);
}

export async function patchVars(
  patch: Record<string, string>,
  companyId: string
) {
  return jPOST<{ ok: boolean; vars: any }>(
    `${API}/api/vars/patch?companyId=${encodeURIComponent(companyId)}`,
    patch
  );
}

export async function finalizeRun(payload: {
  companyId?: string;
  uid?: string;
  template: string;
}) {
  return jPOST<{ ok: boolean }>(`${API}/api/finalize`, payload);
}

export async function getUploadState() {
  return jGET<{
    ok: boolean;
    all: boolean;
    fibu: boolean;
    stamm: boolean;
    verlust: boolean;
    files: any;
  }>(`${API}/api/upload/state`);
}

export async function runExtract(companyId: string) {
  return jPOST<{ ok: boolean }>(`${API}/api/start`, {
    companyId,
    phase: "extract",
  });
}

export async function getMissing(companyId: string) {
  return jGET<{
    vars: Record<string, string>;
    relevant: string[];
    missing: string[];
    invalid: string[];
    missing_count: number;
    docId: string;
  }>(`${API}/api/missing?companyId=${encodeURIComponent(companyId)}`);
}

export type CompanyHit = {
  uid: string;
  name: string;
  legalSeat: string;
  legalForm: string;
};

export async function searchCompanies(
  name: string
): Promise<CompanyHit[]> {
  const term = name.trim();
  if (!term) return [];

  return jGET<CompanyHit[]>(
    `${API}/api/search?name=${encodeURIComponent(term)}`
  );
}
