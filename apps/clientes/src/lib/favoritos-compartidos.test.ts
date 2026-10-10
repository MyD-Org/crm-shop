import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ getDb: () => ({}) }));

import { MAX_FAVORITOS } from "./favoritos";
import {
  MAX_IDS_COMPARTIDOS,
  hrefFavoritosCompartidos,
  mensajeFavoritos,
  parsearIdsFavoritos,
} from "./favoritos-compartidos";

describe("favoritos compartidos", () => {
  it("el tope es el de los favoritos", () => {
    expect(MAX_IDS_COMPARTIDOS).toBe(MAX_FAVORITOS);
  });

  it("roundtrip", () => {
    const href = hrefFavoritosCompartidos(["12", "34", "56"]);
    expect(href).toBe("/favoritos/compartido?i=12,34,56");
    expect(parsearIdsFavoritos(href.split("i=")[1])).toEqual(["12", "34", "56"]);
  });

  it("descarta duplicados e inválidos conservando el orden", () => {
    expect(parsearIdsFavoritos("12,12,abc,,34,<script>")).toEqual(["12", "34"]);
  });

  it("350 ids => los 200 primeros", () => {
    const ids = Array.from({ length: 350 }, (_, i) => String(i + 1));
    const salida = parsearIdsFavoritos(ids.join(","));
    expect(salida).toHaveLength(200);
    expect(salida[0]).toBe("1");
    expect(salida[199]).toBe("200");
    expect(parsearIdsFavoritos(hrefFavoritosCompartidos(ids).split("i=")[1])).toHaveLength(200);
  });

  it("ausente, vacío o array => []", () => {
    expect(parsearIdsFavoritos(undefined)).toEqual([]);
    expect(parsearIdsFavoritos("")).toEqual([]);
    expect(parsearIdsFavoritos(["1", "2"])).toEqual([]);
  });

  it("recorta la query larga antes de parsear", () => {
    const basura = "9".repeat(5000);
    expect(parsearIdsFavoritos(`1,2,${basura},3`)).toEqual(["1", "2"]);
    expect(parsearIdsFavoritos(`1,${"2,".repeat(3000)}`).length).toBeLessThanOrEqual(2);
  });

  it("ids demasiado largos se ignoran", () => {
    expect(parsearIdsFavoritos(`${"7".repeat(65)},8`)).toEqual(["8"]);
  });

  it("mensaje para terceros", () => {
    expect(mensajeFavoritos("https://x.example/f")).toBe("Te comparto mi lista de favoritos: https://x.example/f");
  });
});
