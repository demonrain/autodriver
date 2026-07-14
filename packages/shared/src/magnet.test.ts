import { describe, expect, it } from "vitest";
import { normalizeInfoHash, parseMagnetLink } from "./magnet";

describe("magnet helpers", () => {
  it("extracts lowercase btih hash and display name from a magnet link", () => {
    const parsed = parseMagnetLink(
      "magnet:?xt=urn:btih:7C1DA06EF6898EAF9CABF879E44450417F5AE63F&dn=ROYD-327-C"
    );

    expect(parsed.infoHash).toBe("7c1da06ef6898eaf9cabf879e44450417f5ae63f");
    expect(parsed.displayName).toBe("ROYD-327-C");
  });

  it("rejects values without a btih identifier", () => {
    expect(() => parseMagnetLink("https://example.com/file.torrent")).toThrow(
      "MAGNET_INVALID"
    );
  });

  it("accepts bare hex info-hash as magnet input", () => {
    const parsed = parseMagnetLink(
      "709314680ed7fdec766e5d11441295d2e01a9251"
    );
    expect(parsed.infoHash).toBe("709314680ed7fdec766e5d11441295d2e01a9251");
  });

  it("normalizes info hashes and rejects invalid hash text", () => {
    expect(normalizeInfoHash("ABCDEF0123456789ABCDEF0123456789ABCDEF01")).toBe(
      "abcdef0123456789abcdef0123456789abcdef01"
    );
    expect(() => normalizeInfoHash("not-a-hash")).toThrow("HASH_INVALID");
  });
});
