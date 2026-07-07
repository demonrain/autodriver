import { createHmac, timingSafeEqual } from "node:crypto";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import type { SafeUserDto } from "../../../../packages/shared/src";
import type { UserRecord } from "../db/schema";

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyPasswordHash(
  passwordHash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function hashSessionToken(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function safeUser(user: UserRecord): SafeUserDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

export function isAdmin(user: Pick<UserRecord, "role"> | SafeUserDto): boolean {
  return user.role === "admin";
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
