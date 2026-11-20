import { describe, expect, it } from "vitest";
import { esErrorDeVersionVieja } from "./error-version-vieja";

describe("esErrorDeVersionVieja", () => {
  it.each([
    { name: "ChunkLoadError", message: "Loading chunk 123 failed." },
    { message: "Failed to fetch dynamically imported module: https://tienda.example/_next/static/chunks/a.js" },
    { message: "Importing a module script failed." },
    { message: 'Failed to find Server Action "abc". This request might be from an older or newer deployment.' },
  ])("detecta %o", (e) => expect(esErrorDeVersionVieja(e)).toBe(true));

  it("no confunde otros errores", () => {
    expect(esErrorDeVersionVieja({ message: "Cannot read properties of undefined" })).toBe(false);
    expect(esErrorDeVersionVieja(null)).toBe(false);
  });
});
