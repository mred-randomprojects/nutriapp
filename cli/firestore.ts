/**
 * The cloud document over the Firestore REST API, for the terminal tools
 * (`npm run nutri`, the MCP server). Auth is the gcloud login
 * (`gcloud auth print-access-token`), which owns the Firebase project.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FsDocument, FsValue } from "../src/estimateEntry.js";

export const PROJECT = process.env.NUTRIAPP_PROJECT ?? "nutriapp-9ac19";
export const DOC = process.env.NUTRIAPP_DOC ?? "users/w8uyqK5tE3gMScvin2yUI1VG8ec2/data/appData";
export const PROFILE = process.env.NUTRIAPP_PROFILE ?? "Me";
const URL_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${DOC}`;

/** Firestore refused the write because the document changed since it was read. */
export class StaleDocumentError extends Error {}

function token(): string {
  return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

async function call(url: string, init: { method?: string; body?: string } = {}): Promise<FsDocument> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, "x-goog-user-project": PROJECT, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (res.status === 400 && text.includes("FAILED_PRECONDITION")) {
    throw new StaleDocumentError("The app saved the document in between; nothing was written.");
  }
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as FsDocument;
}

export function readDoc(): Promise<FsDocument> {
  return call(URL_BASE);
}

/** Saves the whole document to ~/.nutriapp/backups/ and returns the file. */
export function backupDoc(doc: FsDocument): string {
  const dir = join(homedir(), ".nutriapp", "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(doc));
  return file;
}

/**
 * Replaces only the one top-level `field`, and only if the document is still
 * the one read (its update time as a precondition). Returns what Firestore stored.
 */
export function writeField(before: FsDocument, field: string, value: FsValue): Promise<FsDocument> {
  if (!/^[A-Za-z]+$/.test(field)) throw new Error(`Not a top-level field name: "${field}".`);
  const query = `updateMask.fieldPaths=${field}&currentDocument.updateTime=${encodeURIComponent(before.updateTime)}`;
  return call(`${URL_BASE}?${query}`, { method: "PATCH", body: JSON.stringify({ fields: { [field]: value } }) });
}
