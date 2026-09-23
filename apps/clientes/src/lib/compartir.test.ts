import { describe, expect, it, vi } from "vitest";
import { compartirEnlace } from "./compartir";

const datos = { url: "https://tienda.cliente.example/producto/42", titulo: "Lámpara LED" };

describe("compartirEnlace", () => {
  it("usa la hoja nativa si existe", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await compartirEnlace(datos, { share, clipboard: { writeText } as never })).toBe("compartido");
    expect(share).toHaveBeenCalledWith({ title: "Lámpara LED", url: datos.url });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("si el usuario cierra la hoja, no copia ni avisa error", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" }));
    const writeText = vi.fn();
    expect(await compartirEnlace(datos, { share, clipboard: { writeText } as never })).toBe("cancelado");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("si la hoja nativa falla por otro motivo, copia el enlace", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await compartirEnlace(datos, { share, clipboard: { writeText } as never })).toBe("copiado");
    expect(writeText).toHaveBeenCalledWith(datos.url);
  });

  it("sin hoja nativa copia al portapapeles", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await compartirEnlace(datos, { clipboard: { writeText } as never })).toBe("copiado");
  });

  it("sin portapapeles o si falla la copia: error", async () => {
    expect(await compartirEnlace(datos, {})).toBe("error");
    const writeText = vi.fn().mockRejectedValue(new Error("denegado"));
    expect(await compartirEnlace(datos, { clipboard: { writeText } as never })).toBe("error");
  });
});
