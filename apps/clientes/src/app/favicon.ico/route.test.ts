import { describe, expect, it, vi } from "vitest";
import { MARCA_POR_DEFECTO, resolverMarca } from "@/lib/marca-base";

const { getMarcaMock } = vi.hoisted(() => ({ getMarcaMock: vi.fn() }));
vi.mock("@/lib/marca", () => ({ getMarca: getMarcaMock }));

import { GET } from "./route";

describe("GET /favicon.ico", () => {
  it("redirige 308 al ícono de la marca del sitio", async () => {
    getMarcaMock.mockResolvedValue(MARCA_POR_DEFECTO);
    const res = await GET();
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("/images/central-led/favicon.ico");

    getMarcaMock.mockResolvedValue(resolverMarca({ base: "generica", nombre: "Tienda B" }));
    const otra = await GET();
    expect(otra.status).toBe(308);
    expect(otra.headers.get("Location")).toBe("/images/generica/icon.svg");
  });
});
