import { describe, expect, it, vi } from "vitest";
import { conRespaldoSinCache } from "./cache-respaldo";

describe("conRespaldoSinCache", () => {
  it("con la caché sana no toca la lectura directa", async () => {
    const directa = vi.fn();
    expect(await conRespaldoSinCache("x", async () => 1, directa)).toBe(1);
    expect(directa).not.toHaveBeenCalled();
  });

  it("si la caché falla, devuelve la lectura directa", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cacheada = () => Promise.reject(new Error("Connection closed."));
    expect(await conRespaldoSinCache("x", cacheada, async () => 2)).toBe(2);
  });

  it("si fallan las dos, propaga el error de la directa", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cacheada = () => Promise.reject(new Error("Connection closed."));
    await expect(conRespaldoSinCache("x", cacheada, () => Promise.reject(new Error("base caída")))).rejects.toThrow(
      "base caída",
    );
  });
});
