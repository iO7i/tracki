import { timingSafeEqual } from "node:crypto";
import { CcoError, id, object } from "./contract";
export type Project = {
  orgId: string;
  projectId: string;
  appKey: string;
  environment: string;
  producerKey: string;
};
export type CcoConfig = { readKey: string; projects: Project[] };
export function constantEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function configuration(): CcoConfig | null {
  if (process.env.TRACKI_CCO_ENABLED !== "true") return null;
  const readKey = process.env.TRACKI_CCO_READ_KEY ?? "";
  if (readKey.length < 32) throw new CcoError("cco_reader_key_missing", 503);
  const raw: unknown = JSON.parse(process.env.TRACKI_CCO_PROJECTS_JSON ?? "[]");
  if (!Array.isArray(raw) || !raw.length || raw.length > 32)
    throw new CcoError("cco_projects_missing", 503);
  const projects = raw.map((value) => {
    const r = object(value);
    const producerKey = String(r.producerKey ?? "");
    if (producerKey.length < 32 || constantEqual(producerKey, readKey))
      throw new CcoError("cco_producer_key_invalid", 503);
    return {
      orgId: id(r.orgId),
      projectId: id(r.projectId),
      appKey: id(r.appKey),
      environment: id(r.environment),
      producerKey,
    };
  });
  if (
    new Set(projects.map((p) => p.producerKey)).size !== projects.length ||
    new Set(projects.map((p) => p.projectId)).size !== projects.length
  )
    throw new CcoError("cco_ambiguous_scope", 503);
  return { readKey, projects };
}
