import { describe, expect, it } from "vitest";
import { ERRORES } from "./aviso-reingreso-textos";
import { leerCamposAviso, leerCantidad, llenadoValido, validarCamposAviso } from "./aviso-reingreso-validacion";

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

const base = { email: "  Ana@Cliente.example ", cantidad: "2" };

describe("leerCamposAviso / validarCamposAviso", () => {
  it("normaliza el email (trim + minúsculas) y acepta lo válido", () => {
    const { campos, whatsappCrudo } = leerCamposAviso(fd(base));
    expect(campos).toMatchObject({ email: "ana@cliente.example", cantidad: 2, quiereEncargar: false, whatsapp: null });
    expect(validarCamposAviso(campos, whatsappCrudo)).toEqual({});
  });

  it("rechaza un email inválido con un mensaje en usted", () => {
    const { campos } = leerCamposAviso(fd({ ...base, email: "no-es-un-correo" }));
    expect(validarCamposAviso(campos).email).toBe("Ingrese un correo válido.");
    expect(ERRORES.email).toBe("Ingrese un correo válido.");
  });

  it("rechaza un email de más de 254 caracteres", () => {
    const { campos } = leerCamposAviso(fd({ ...base, email: `${"a".repeat(250)}@x.example` }));
    expect(validarCamposAviso(campos).email).toBe(ERRORES.emailLargo);
  });

  it.each(["0", "1000", "-1", "2.5", "abc", "", "1e2"])("rechaza la cantidad %j", (cantidad) => {
    const { campos } = leerCamposAviso(fd({ ...base, cantidad }));
    expect(validarCamposAviso(campos).cantidad).toBe(ERRORES.cantidad);
  });

  it.each(["1", "999", " 5 "])("acepta la cantidad %j", (cantidad) => {
    const { campos } = leerCamposAviso(fd({ ...base, cantidad }));
    expect(validarCamposAviso(campos).cantidad).toBeUndefined();
  });

  it("el WhatsApp sin encargar ni consentimiento no se guarda", () => {
    const { campos, whatsappCrudo } = leerCamposAviso(fd({ ...base, whatsapp: "1155550000" }));
    expect(campos.whatsapp).toBeNull();
    expect(campos.consentimientoContacto).toBe(false);
    expect(validarCamposAviso(campos, whatsappCrudo)).toEqual({});
  });

  it("con encargar pero sin consentimiento, el WhatsApp no se guarda y se pide el consentimiento", () => {
    const { campos, whatsappCrudo } = leerCamposAviso(fd({ ...base, quiereEncargar: "on", whatsapp: "1155550000" }));
    expect(campos.whatsapp).toBeNull();
    expect(validarCamposAviso(campos, whatsappCrudo).consentimiento).toBe(ERRORES.consentimiento);
  });

  it("consentimiento sin encargar tildado no cuenta", () => {
    const { campos } = leerCamposAviso(fd({ ...base, consentimientoContacto: "on", whatsapp: "1155550000" }));
    expect(campos.consentimientoContacto).toBe(false);
    expect(campos.whatsapp).toBeNull();
  });

  it("con encargar y consentimiento guarda el WhatsApp", () => {
    const { campos, whatsappCrudo } = leerCamposAviso(
      fd({ ...base, quiereEncargar: "on", consentimientoContacto: "on", whatsapp: "1155550000" }),
    );
    expect(campos).toMatchObject({ quiereEncargar: true, consentimientoContacto: true, whatsapp: "1155550000" });
    expect(validarCamposAviso(campos, whatsappCrudo)).toEqual({});
  });

  it("rechaza un WhatsApp de más de 40 caracteres", () => {
    const { campos, whatsappCrudo } = leerCamposAviso(
      fd({ ...base, quiereEncargar: "on", consentimientoContacto: "on", whatsapp: "1".repeat(41) }),
    );
    expect(validarCamposAviso(campos, whatsappCrudo).whatsapp).toBe(ERRORES.whatsappLargo);
  });
});

describe("leerCantidad", () => {
  it("solo enteros", () => {
    expect(leerCantidad("7")).toBe(7);
    expect(Number.isNaN(leerCantidad("7.0"))).toBe(true);
  });
});

describe("llenadoValido", () => {
  const ahora = 1_800_000_000_000;
  it("rechaza lo muy rápido, lo ausente y lo viejo", () => {
    expect(llenadoValido(String(ahora - 1_000), ahora)).toBe(false);
    expect(llenadoValido(null, ahora)).toBe(false);
    expect(llenadoValido("x", ahora)).toBe(false);
    expect(llenadoValido(String(ahora - 25 * 60 * 60_000), ahora)).toBe(false);
  });
  it("acepta 3 s o más", () => {
    expect(llenadoValido(String(ahora - 3_000), ahora)).toBe(true);
  });
});
