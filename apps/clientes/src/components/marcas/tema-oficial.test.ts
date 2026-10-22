import { describe, expect, it } from "vitest";
import { propsTemaOficial } from "./tema-oficial";

describe("propsTemaOficial", () => {
  it("oscuro por defecto, sin acento propio", () => {
    expect(propsTemaOficial({})).toEqual({ "data-tema-marca": "oficial", "data-tono": "oscuro" });
  });
  it("claro y con acento propio", () => {
    expect(propsTemaOficial({ tema: "claro", acento: "#1e5aa8" })).toEqual({
      "data-tema-marca": "oficial",
      "data-tono": "claro",
      style: { "--acento-marca": "#1e5aa8" },
    });
  });
});
