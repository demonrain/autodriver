import { randomBytes } from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
