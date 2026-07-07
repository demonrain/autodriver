export type ParsedMagnetLink = {
  infoHash: string;
  displayName?: string;
};

const HEX_HASH_RE = /^[a-f0-9]{40}$/i;
const BASE32_HASH_RE = /^[a-z2-7]{32}$/i;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function normalizeInfoHash(value: string): string {
  const candidate = value.trim();
  if (HEX_HASH_RE.test(candidate)) {
    return candidate.toLowerCase();
  }

  if (BASE32_HASH_RE.test(candidate)) {
    return base32ToHex(candidate);
  }

  throw new Error("HASH_INVALID");
}

export function parseMagnetLink(value: string): ParsedMagnetLink {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("MAGNET_INVALID");
  }

  if (url.protocol !== "magnet:") {
    throw new Error("MAGNET_INVALID");
  }

  const xt = url.searchParams
    .getAll("xt")
    .find((item) => item.toLowerCase().startsWith("urn:btih:"));

  if (!xt) {
    throw new Error("MAGNET_INVALID");
  }

  const hashPart = xt.slice("urn:btih:".length);
  const displayName = url.searchParams.get("dn")?.trim() || undefined;

  return {
    infoHash: normalizeInfoHash(hashPart),
    displayName
  };
}

function base32ToHex(value: string): string {
  let bits = "";
  let hex = "";

  for (const char of value.toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("HASH_INVALID");
    }
    bits += index.toString(2).padStart(5, "0");
  }

  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
  }

  if (!HEX_HASH_RE.test(hex)) {
    throw new Error("HASH_INVALID");
  }

  return hex.toLowerCase();
}
