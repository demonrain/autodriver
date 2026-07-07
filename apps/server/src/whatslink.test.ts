import { describe, expect, it } from "vitest";
import {
  getCacheTtlMs,
  normalizeWhatslinkResponse,
  sanitizeWhatslinkBaseUrl
} from "./whatslink";

describe("whatslink normalization", () => {
  it("normalizes a successful folder response", () => {
    const normalized = normalizeWhatslinkResponse({
      error: "",
      type: "FOLDER",
      file_type: "folder",
      name: "ROYD-327-C",
      size: 6321789982,
      count: 5,
      screenshots: [
        { time: 0, screenshot: "https://whatslink.info/image/example" }
      ]
    });

    expect(normalized.status).toBe("ok");
    expect(normalized.fileType).toBe("folder");
    expect(normalized.screenshots).toHaveLength(1);
  });

  it("maps UNKNOWN responses to a cacheable unknown status", () => {
    const normalized = normalizeWhatslinkResponse({
      error: "",
      type: "UNKNOWN",
      file_type: "",
      name: "",
      size: 0,
      count: 0,
      screenshots: null
    });

    expect(normalized.status).toBe("unknown");
    expect(normalized.screenshots).toEqual([]);
  });

  it("uses the planned cache windows", () => {
    expect(getCacheTtlMs("ok")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(getCacheTtlMs("unknown")).toBe(60 * 60 * 1000);
    expect(getCacheTtlMs("error")).toBe(10 * 60 * 1000);
  });

  it("only accepts http or https upstream base URLs", () => {
    expect(sanitizeWhatslinkBaseUrl("https://whatslink.info").origin).toBe(
      "https://whatslink.info"
    );
    expect(() => sanitizeWhatslinkBaseUrl("file:///etc/passwd")).toThrow(
      "WHATSLINK_BASE_URL_INVALID"
    );
  });
});
