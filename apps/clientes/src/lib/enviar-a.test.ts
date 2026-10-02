import { describe, expect, it, vi } from "vitest";
import type { DireccionEnvio } from "./direcciones-envio";
import {
  cargarDirecciones,
  cargarLocales,
  cuerpoDeOpcion,
  cuerpoLocalidad,
  guardarEleccion,
  idNuevo,
  lineasEnviarA,
  opcionDireccion,
  opcionLocal,
  opcionVigente,
  opcionesDirecciones,
  opcionesLocales,
  puedeAgregarDireccion,
} from "./enviar-a";
import { TEXTOS_UBICACION } from "./ubicacion";

const dir = (over: Partial<DireccionEnvio> = {}): DireccionEnvio => ({
  id: "11111111-1111-4111-8111-111111111111",
  etiqueta: "Casa",
  calle: "Calle Ejemplo 123",
  ciudad: "Ciudad Ejemplo",
  provincia: "Córdoba",
  cp: "5000",
  referencias: null,
  predeterminada: true,
  ...over,
});

const respuesta = (status: number, cuerpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo }) as Response;

describe("lineasEnviarA (header de dos líneas)", () => {
  it("con sesión y dirección guardada: Enviar a {nombre} / {calle altura}", () => {
    const l = lineasEnviarA(
      {
        tipo: "envio",
        direccion: { id: "x", calle: "Calle Ejemplo 123", ciudad: "Ciudad Ejemplo", cp: "5000", etiqueta: null },
        localidad: "Ciudad Ejemplo",
        provincia: "cordoba",
      },
      "Ana",
    );
    expect(l).toEqual({ retiro: false, etiqueta: "Enviar a Ana", valor: "Calle Ejemplo 123" });
  });

  it("sin nombre de pila: sólo «Enviar a»", () => {
    const l = lineasEnviarA(
      {
        tipo: "envio",
        direccion: { id: "x", calle: "Calle Ejemplo 123", ciudad: "Ciudad Ejemplo", cp: null, etiqueta: null },
        localidad: "Ciudad Ejemplo",
        provincia: "cordoba",
      },
      null,
    );
    expect(l.etiqueta).toBe("Enviar a");
  });

  it("sin sesión con localidad y CP: Enviar a / {localidad} ({CP})", () => {
    const l = lineasEnviarA({ tipo: "envio", localidad: "Ciudad Ejemplo", provincia: "cordoba", cp: "5000" }, null);
    expect(l).toEqual({ retiro: false, etiqueta: "Enviar a", valor: "Ciudad Ejemplo (5000)" });
  });

  it("localidad sin CP (geolocalización incompleta): sólo {localidad}", () => {
    const l = lineasEnviarA({ tipo: "envio", localidad: "Ciudad Ejemplo", provincia: "cordoba" }, null);
    expect(l.valor).toBe("Ciudad Ejemplo");
  });

  it("vacío: Enviar a / Indique su ubicación", () => {
    expect(lineasEnviarA({ tipo: "ninguna" }, null)).toEqual({
      retiro: false,
      etiqueta: "Enviar a",
      valor: "Indique su ubicación",
    });
  });

  it("retiro: Retirar en / {local}; local único: «el local»", () => {
    expect(
      lineasEnviarA(
        { tipo: "retiro", sucursal: { slug: "local-a", nombre: "Local A", ciudad: "Ciudad Ejemplo", provincia: "Córdoba" } },
        "Ana",
      ),
    ).toEqual({ retiro: true, etiqueta: "Retirar en", valor: "Local A" });
    expect(lineasEnviarA({ tipo: "retiro", sucursal: null }, null)).toEqual({
      retiro: true,
      etiqueta: "Retirar en",
      valor: "el local",
    });
  });
});

describe("valores de opción y cuerpo del POST", () => {
  it("opción vigente según la elección", () => {
    expect(
      opcionVigente({
        tipo: "envio",
        direccion: { id: "abc", calle: "c", ciudad: "x", cp: null, etiqueta: null },
        localidad: "x",
        provincia: null,
      }),
    ).toBe(opcionDireccion("abc"));
    expect(opcionVigente({ tipo: "retiro", sucursal: { slug: "local-a", nombre: "A", ciudad: "", provincia: "" } })).toBe(
      opcionLocal("local-a"),
    );
    expect(opcionVigente({ tipo: "retiro", sucursal: null })).toBe(opcionLocal(null));
    expect(opcionVigente({ tipo: "envio", localidad: "x", provincia: "cordoba" })).toBeUndefined();
    expect(opcionVigente({ tipo: "ninguna" })).toBeUndefined();
  });

  it("cuerpo del POST: dirección, retiro con local y retiro del local único", () => {
    expect(cuerpoDeOpcion(opcionDireccion("abc"))).toEqual({ direccionId: "abc" });
    expect(cuerpoDeOpcion(opcionLocal("local-a"))).toEqual({ tipo: "retiro", sucursal: "local-a" });
    expect(cuerpoDeOpcion(opcionLocal(null))).toEqual({ tipo: "retiro" });
    expect(cuerpoDeOpcion("otra-cosa")).toBeNull();
    expect(cuerpoDeOpcion("dir:")).toBeNull();
  });
});

describe("opciones del modal", () => {
  it("direcciones: calle como título, localidad y CP de descripción, badge en la vigente y acción Editar", () => {
    const onEditar = vi.fn();
    const d1 = dir();
    const d2 = dir({ id: "22222222-2222-4222-8222-222222222222", etiqueta: null, calle: "Otra Calle 45", cp: null });
    const ops = opcionesDirecciones([d1, d2], d1.id, onEditar);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      value: opcionDireccion(d1.id),
      label: "Calle Ejemplo 123",
      badge: { label: TEXTOS_UBICACION.actual },
    });
    expect(ops[0].description).toContain("Casa");
    expect(ops[0].description).toContain("Ciudad Ejemplo");
    expect(ops[0].description).toContain("CP 5000");
    expect(ops[1].badge).toBeUndefined();
    expect(ops[1].action?.label).toBe(TEXTOS_UBICACION.editar);
    expect(ops[1].action?.ariaLabel).toBe("Editar Otra Calle 45");
    ops[1].action?.onClick();
    expect(onEditar).toHaveBeenCalledWith(d2);
  });

  it("locales: uno por local con dirección y horario; local único: «Retirar en el local» sin datos inventados", () => {
    const ops = opcionesLocales({
      unico: false,
      locales: [
        { slug: "local-a", nombre: "Local A", direccion: "Av. Ejemplo 1", horario: "Lun a Vie 9 a 18" },
        { slug: "local-b", nombre: "Local B", direccion: "", horario: "" },
      ],
    });
    expect(ops.map((o) => o.value)).toEqual([opcionLocal("local-a"), opcionLocal("local-b")]);
    expect(ops[0].label).toBe("Local A");
    expect(ops[0].description).toBe("Av. Ejemplo 1 · Lun a Vie 9 a 18");
    expect(ops[1].description).toBeUndefined();

    const unico = opcionesLocales({ unico: true, locales: [] });
    expect(unico).toEqual([{ value: opcionLocal(null), label: TEXTOS_UBICACION.retirarEnElLocal }]);
  });

  it("límite de 10 direcciones", () => {
    expect(puedeAgregarDireccion(Array.from({ length: 9 }, () => dir()))).toBe(true);
    expect(puedeAgregarDireccion(Array.from({ length: 10 }, () => dir()))).toBe(false);
  });

  it("idNuevo: la dirección que no estaba antes", () => {
    const d1 = dir();
    const d2 = dir({ id: "22222222-2222-4222-8222-222222222222" });
    expect(idNuevo([d1], [d2, d1])).toBe(d2.id);
    expect(idNuevo([d1], [d1])).toBeNull();
  });
});

describe("cuerpoLocalidad (sin sesión: localidad + CP)", () => {
  it("exige localidad elegida de la lista", () => {
    expect(cuerpoLocalidad(null, "5000")).toEqual({ ok: false, campo: "localidad", error: TEXTOS_UBICACION.elegirLocalidad });
  });
  it("CP vacío: pide el código postal", () => {
    expect(cuerpoLocalidad("123", "  ")).toEqual({ ok: false, campo: "cp", error: TEXTOS_UBICACION.cpRequerido });
  });
  it("CP inválido: error en usted y no envía", () => {
    expect(cuerpoLocalidad("123", "12")).toEqual({ ok: false, campo: "cp", error: TEXTOS_UBICACION.cpInvalido });
  });
  it("CP válido (4 dígitos o CPA): normalizado", () => {
    expect(cuerpoLocalidad("123", " 5000 ")).toEqual({ ok: true, cuerpo: { id: "123", cp: "5000" } });
    expect(cuerpoLocalidad("123", "c 1425 abc")).toEqual({ ok: true, cuerpo: { id: "123", cp: "C1425ABC" } });
  });
});

describe("cargas y guardado (fetch inyectado)", () => {
  it("cargarDirecciones: 200 → lista; 401 → sin sesión; otro → error", async () => {
    const d = dir();
    const ctrl = new AbortController();
    const f200 = vi.fn(async () => respuesta(200, { direcciones: [d] }));
    expect(await cargarDirecciones(f200 as unknown as typeof fetch, ctrl.signal)).toEqual({ estado: "ok", direcciones: [d] });
    expect(f200).toHaveBeenCalledWith("/api/mi-cuenta/direcciones", { signal: ctrl.signal });
    const f401 = vi.fn(async () => respuesta(401, { error: "x" }));
    expect(await cargarDirecciones(f401 as unknown as typeof fetch, ctrl.signal)).toEqual({ estado: "sinSesion" });
    const f500 = vi.fn(async () => respuesta(500, {}));
    expect(await cargarDirecciones(f500 as unknown as typeof fetch, ctrl.signal)).toEqual({ estado: "error" });
    const fRed = vi.fn(async () => {
      throw new TypeError("red");
    });
    expect(await cargarDirecciones(fRed as unknown as typeof fetch, ctrl.signal)).toEqual({ estado: "error" });
  });

  it("cargarDirecciones abortado: null (no pinta nada)", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const f = vi.fn(async () => {
      throw Object.assign(new Error("abort"), { name: "AbortError" });
    });
    expect(await cargarDirecciones(f as unknown as typeof fetch, ctrl.signal)).toBeNull();
  });

  it("cargarLocales: lee {locales, unico}; error → null", async () => {
    const ctrl = new AbortController();
    const ok = vi.fn(async () => respuesta(200, { locales: [{ slug: "a", nombre: "A", direccion: "", horario: "" }], unico: false }));
    expect(await cargarLocales(ok as unknown as typeof fetch, ctrl.signal)).toEqual({
      locales: [{ slug: "a", nombre: "A", direccion: "", horario: "" }],
      unico: false,
    });
    expect(ok).toHaveBeenCalledWith("/api/ubicacion/opciones", { signal: ctrl.signal });
    const mal = vi.fn(async () => respuesta(500, {}));
    expect(await cargarLocales(mal as unknown as typeof fetch, ctrl.signal)).toBeNull();
  });

  it("guardarEleccion: POST JSON; error del API en usted o mensaje genérico", async () => {
    const ok = vi.fn(async () => respuesta(200, { tipo: "retiro" }));
    expect(await guardarEleccion(ok as unknown as typeof fetch, { tipo: "retiro" })).toEqual({ ok: true });
    expect(ok).toHaveBeenCalledWith("/api/ubicacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "retiro" }),
    });
    const mal = vi.fn(async () => respuesta(404, { error: TEXTOS_UBICACION.localNoEncontrado }));
    expect(await guardarEleccion(mal as unknown as typeof fetch, { tipo: "retiro", sucursal: "x" })).toEqual({
      ok: false,
      error: TEXTOS_UBICACION.localNoEncontrado,
    });
    const red = vi.fn(async () => {
      throw new TypeError("red");
    });
    expect(await guardarEleccion(red as unknown as typeof fetch, { tipo: "retiro" })).toEqual({
      ok: false,
      error: TEXTOS_UBICACION.errorGuardar,
    });
  });
});
