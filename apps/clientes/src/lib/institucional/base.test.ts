import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import { PAGINAS_INSTITUCIONALES } from "./paginas";
import { base } from "./base";

const MARCA = { nombre: "Tienda Ejemplo" };
const texto = (slug: Parameters<typeof base>[0], ...resto: [Parameters<typeof base>[2]?, string?]) =>
  base(slug, MARCA, resto[0] ?? {}, resto[1] ?? "")
    .flatMap((b) => [b.titulo, ...b.parrafos])
    .join("\n");

describe("texto base de las páginas institucionales", () => {
  it.each(PAGINAS_INSTITUCIONALES.map((p) => p.slug))("%s: bloques completos, en usted, sin datos de empresa", (slug) => {
    const bloques = base(slug, MARCA, {}, "");
    expect(bloques.length).toBeGreaterThan(1);
    for (const b of bloques) {
      expect(b.titulo.trim()).not.toBe("");
      expect(b.parrafos.length).toBeGreaterThan(0);
    }
    const t = texto(slug);
    // Sin números: ni plazos, ni montos, ni teléfonos, ni domicilios con altura.
    expect(t).not.toMatch(/\d/);
    expect(t).not.toMatch(/central|led premium|avantec|iguaz/i);
    expect(t).not.toMatch(/https?:|@/);
    expect(infracciones(t, REGISTRO)).toEqual([]);
    expect(t).toMatch(/borrador sujeto a revisión/i);
  });

  it("usa el nombre de la marca donde corresponde", () => {
    expect(texto("nosotros")).toContain("Tienda Ejemplo");
  });

  it("contacto: suma WhatsApp y correo solo si están cargados", () => {
    expect(texto("contacto")).not.toMatch(/WhatsApp:/);
    const bloques = base("contacto", MARCA, { email: "ventas@cliente.example" }, "5491112345678");
    const t = bloques.flatMap((b) => b.parrafos).join("\n");
    expect(t).toContain("ventas@cliente.example");
    const enlaces = bloques.flatMap((b) => b.enlaces ?? []);
    expect(enlaces.map((e) => e.href)).toEqual(["https://wa.me/5491112345678"]);
  });
});
