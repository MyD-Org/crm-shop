import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vercel rechaza el vercel.json entero (y falla el deploy) si `ignoreCommand` pasa de 256 caracteres.
describe("vercel.json", () => {
  it.each(["clientes", "admin"])("ignoreCommand de %s entra en el límite de Vercel", (app) => {
    const config = JSON.parse(readFileSync(join(__dirname, "../../..", app, "vercel.json"), "utf8"));
    expect(config.ignoreCommand.length).toBeLessThanOrEqual(256);
  });
});
