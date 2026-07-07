import { describe, expect, it } from "vitest";
import {
  hashSessionToken,
  isAdmin,
  safeUser,
  verifyPasswordHash
} from "./auth/security";

describe("auth security helpers", () => {
  it("hashes session tokens with the configured secret", () => {
    const one = hashSessionToken("secret-a", "token");
    const two = hashSessionToken("secret-b", "token");

    expect(one).not.toBe("token");
    expect(one).not.toBe(two);
  });

  it("verifies argon2id password hashes", async () => {
    const result = await verifyPasswordHash(
      "$argon2id$v=19$m=19456,t=2,p=1$Jm5vdCBhIHJlYWwgc2FsdA$Jm5vdCBhIHJlYWwgaGFzaA",
      "wrong"
    );

    expect(result).toBe(false);
  });

  it("redacts password hashes and checks admin role", () => {
    const user = {
      id: "u_1",
      email: "admin@example.com",
      passwordHash: "hash",
      role: "admin",
      createdAt: 1
    } as const;

    expect(isAdmin(user)).toBe(true);
    expect(safeUser(user)).toEqual({
      id: "u_1",
      email: "admin@example.com",
      role: "admin",
      createdAt: 1
    });
  });
});
