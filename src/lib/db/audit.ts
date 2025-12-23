import { db, type AuditEvent } from "./store";

function nowISO() {
  return new Date().toISOString();
}

function id() {
  return `AUD_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function logAudit(e: Omit<AuditEvent, "id" | "at">) {
  const event: AuditEvent = { id: id(), at: nowISO(), ...e };
  db.audit.unshift(event);
  return event;
}

export function listAudit(limit = 50) {
  return db.audit.slice(0, limit);
}
