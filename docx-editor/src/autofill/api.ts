// src/autofill/api.ts
export type CompanyHit = {
  uid: string;
  name: string;
  legalSeat?: string;
  legalForm?: string;
};

export type Vars = {
  CompanyName?: string;
  Adresse?: string;
  PLZ?: string;
  ORT?: string;
  Stammkapital?: string;
  Stammanteil?: string;
  UID?: string;
  Gesellschafter?: string;
  Gesellschafter_ort?: string;
};

const API_BASE: string =
  (import.meta as any)?.env?.VITE_API_BASE || ""; // leer = same-origin

async function j<T>(url: string): Promise<T> {
  
  const r = await fetch(API_BASE + url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}


export async function enrichVarsWithPdfs(files: FileList | File[], currentVars: Record<string,string>) {
  const fd = new FormData();
  Array.from(files).forEach(f => fd.append("files", f));
  fd.append("currentVars", JSON.stringify(currentVars || {}));

  const res = await fetch("/api/vars/enrich", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`/api/vars/enrich -> ${res.status}`);
  return res.json() as Promise<{
    updated: Record<string,string>,
    merged: Record<string,string>,
    sources?: Record<string,string>
  }>;
}


export async function searchCompanies(name: string): Promise<CompanyHit[]> {
  return j<CompanyHit[]>(`/api/search?name=${encodeURIComponent(name)}`);
}

export async function buildVars(uid: string, name?: string) {
  const qs = new URLSearchParams({ uid });
  if (name) qs.set("name", name);
  const res = await fetch(`/api/vars/build?` + qs.toString());
  if (!res.ok) throw new Error(`/api/vars/build?${qs} -> ${res.status} ${res.statusText} | ${await res.text().catch(()=> "")}`);
  return res.json();
}
