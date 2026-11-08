import { beforeEach, describe, expect, it, vi } from "vitest";
import { MARCA_POR_DEFECTO, resolverMarca, resolverMarcaPropia } from "@/lib/marca-base";
import { sanearTemaTenant } from "@/lib/tema-tenant";

const { getMarcaMock, getTemaMock, dibujos, readFileMock } = vi.hoisted(() => ({
  getMarcaMock: vi.fn(),
  getTemaMock: vi.fn(),
  dibujos: [] as unknown[],
  readFileMock: vi.fn(async () => "AAAA"),
}));

vi.mock("@/lib/marca", () => ({ getMarca: getMarcaMock }));
vi.mock("@/lib/tema-tenant-datos", () => ({ getTemaTenant: getTemaMock }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: readFileMock, default: { readFile: readFileMock } }));
vi.mock("@/lib/fuente-sora", () => ({ sora: vi.fn(async () => ({ name: "Sora", data: new ArrayBuffer(1), weight: 400, style: "normal" })) }));
vi.mock("sharp", () => ({
  default: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from("jpg") }) }),
}));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(elemento: unknown) {
      dibujos.push(elemento);
    }
    async arrayBuffer() {
      return new ArrayBuffer(1);
    }
  },
}));

import OpengraphImage, { alt } from "./opengraph-image";

describe("imagen Open Graph por marca", () => {
  beforeEach(() => {
    dibujos.length = 0;
    readFileMock.mockClear();
    getTemaMock.mockResolvedValue(sanearTemaTenant(null));
  });

  it("la tienda de Central dibuja su foto y su logo", async () => {
    getMarcaMock.mockResolvedValue(MARCA_POR_DEFECTO);
    await OpengraphImage();
    expect(readFileMock).toHaveBeenCalled();
    expect(JSON.stringify(dibujos[0])).toContain("data:image/png;base64");
  });

  it("un sitio propio sin imagen: nombre sobre la paleta, nunca la foto ni el logo de Central", async () => {
    getMarcaMock.mockResolvedValue(resolverMarcaPropia({ nombre: "Tienda B" }));
    await OpengraphImage();
    expect(readFileMock).not.toHaveBeenCalled();
    const json = JSON.stringify(dibujos[0]);
    expect(json).toContain("Tienda B");
    expect(json).not.toMatch(/central|data:image/i);
  });

  it("una marca sobre la base de Central pero con otro nombre tampoco usa los recursos de Central", async () => {
    getMarcaMock.mockResolvedValue(resolverMarca({ nombre: "Otra Tienda" }));
    await OpengraphImage();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("el alt (que sale en el HTML de todas las marcas) no nombra a ninguna", () => {
    expect(alt).not.toMatch(/central/i);
  });
});
