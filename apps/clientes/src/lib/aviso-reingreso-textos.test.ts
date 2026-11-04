import { describe, expect, it } from "vitest";
import { infracciones, REGISTRO } from "@/test/registro-usted";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ERRORES, TEXTOS } from "./aviso-reingreso-textos";

const fuente = readFileSync(fileURLToPath(new URL("./aviso-reingreso-textos.ts", import.meta.url)), "utf8");
const todos = [...Object.values(TEXTOS), ...Object.values(ERRORES)];

describe("textos del aviso de reingreso", () => {
  it("están en usted: sin tuteo ni voseo", () => {
    expect(infracciones(fuente, REGISTRO)).toEqual([]);
    for (const t of todos) expect(t).not.toMatch(REGISTRO);
  });

  it("no usan dominios reales (solo reservados .example)", () => {
    const dominios = fuente.match(/[a-z0-9-]+\.(?:com|com\.ar|ar|net|org|io)\b/gi) ?? [];
    expect(dominios).toEqual([]);
  });

  it("la confirmación no promete reserva ni precio", () => {
    expect(TEXTOS.ok).toBe("Listo. Le avisaremos por correo cuando vuelva a estar disponible.");
    for (const t of [TEXTOS.ok, TEXTOS.okEncargar]) expect(t).not.toMatch(/reserv|precio/i);
  });

  it("el mensaje de rate limit es el acordado", () => {
    expect(ERRORES.demasiados).toBe("Demasiados intentos. Inténtelo más tarde.");
  });
});
