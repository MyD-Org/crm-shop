import { describe, expect, it } from "vitest";
import {
  FORMULARIO_VACIO,
  conFacturacion,
  conSugerencia,
  formularioDesde,
  interpretarRespuesta,
  ofrecerFacturacion,
} from "./direcciones-envio-cliente";

const guardada = {
  id: "0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10",
  etiqueta: null,
  calle: "San Martín 5",
  ciudad: "El Dorado",
  provincia: "Misiones",
  cp: "3380",
  referencias: "Timbre 2",
  predeterminada: false,
};
const fact = { calle: "Av. Victoria Aguirre 100", ciudad: "Puerto Iguazú", provincia: "provincia de misiones", cp: "3370" };

describe("formularioDesde", () => {
  it("una guardada, con los nulls como texto vacío", () => {
    expect(formularioDesde(guardada)).toEqual({
      etiqueta: "",
      calle: "San Martín 5",
      ciudad: "El Dorado",
      provincia: "Misiones",
      cp: "3380",
      referencias: "Timbre 2",
      predeterminada: false,
    });
  });
});

describe("conFacturacion", () => {
  it("copia calle, localidad, provincia de la lista y CP; etiqueta 'Facturación' si no tenía", () => {
    expect(conFacturacion({ ...FORMULARIO_VACIO, referencias: "Portón" }, fact)).toEqual({
      ...FORMULARIO_VACIO,
      etiqueta: "Facturación",
      calle: "Av. Victoria Aguirre 100",
      ciudad: "Puerto Iguazú",
      provincia: "Misiones",
      cp: "3370",
      referencias: "Portón",
    });
  });

  it("respeta la etiqueta que ya escribió y deja la provincia vacía si no es de la lista", () => {
    const f = conFacturacion({ ...FORMULARIO_VACIO, etiqueta: "Obra" }, { ...fact, provincia: "Alto Paraná" });
    expect(f.etiqueta).toBe("Obra");
    expect(f.provincia).toBe("");
  });
});

describe("conSugerencia", () => {
  it("pisa sólo lo que la sugerencia trae", () => {
    const antes = { ...FORMULARIO_VACIO, cp: "3370", provincia: "Misiones" };
    expect(conSugerencia(antes, { calle: "Bv. Oroño 1000", ciudad: "Rosario", provincia: "Santa Fe", cp: "" })).toEqual({
      ...antes,
      calle: "Bv. Oroño 1000",
      ciudad: "Rosario",
      provincia: "Santa Fe",
      cp: "3370",
    });
  });

  it("provincia de OSM a la de la lista", () => {
    const f = conSugerencia(FORMULARIO_VACIO, { calle: "x 1", ciudad: "CABA", provincia: "Ciudad Autónoma de Buenos Aires", cp: "C1000AAA" });
    expect(f.provincia).toBe("Ciudad Autónoma de Buenos Aires");
  });
});

describe("ofrecerFacturacion", () => {
  it("no se ofrece sin domicilio de facturación", () => {
    expect(ofrecerFacturacion(null, [], null)).toBe(false);
  });

  it("se ofrece si ninguna otra guardada usa esa calle", () => {
    expect(ofrecerFacturacion(fact, [guardada], null)).toBe(true);
  });

  it("no se ofrece si otra guardada ya la usa; sí al editar esa misma", () => {
    const misma = { ...guardada, calle: "av. victoria  aguirre 100" };
    expect(ofrecerFacturacion(fact, [misma], null)).toBe(false);
    expect(ofrecerFacturacion(fact, [misma], misma.id)).toBe(true);
  });
});

describe("interpretarRespuesta", () => {
  it("ok con la lista", () => {
    expect(interpretarRespuesta(200, { direcciones: [guardada] })).toEqual({ ok: true, direcciones: [guardada] });
    expect(interpretarRespuesta(201, { direccion: guardada, direcciones: [guardada] })).toEqual({
      ok: true,
      direcciones: [guardada],
    });
  });

  it("422 con errores por campo", () => {
    expect(interpretarRespuesta(422, { error: "Revise los datos de la dirección.", errores: { cp: "Indique el código postal." } })).toEqual({
      ok: false,
      error: "Revise los datos de la dirección.",
      errores: { cp: "Indique el código postal." },
    });
  });

  it("401: la sesión venció", () => {
    expect(interpretarRespuesta(401, { error: "No autorizado" })).toEqual({
      ok: false,
      error: "Su sesión venció. Vuelva a iniciar sesión para guardar sus direcciones.",
      errores: {},
    });
  });

  it("sin cuerpo útil: mensaje genérico en usted", () => {
    expect(interpretarRespuesta(500, null)).toEqual({
      ok: false,
      error: "No pudimos guardar los cambios. Inténtelo de nuevo.",
      errores: {},
    });
    expect(interpretarRespuesta(200, { nada: 1 })).toMatchObject({ ok: false });
  });
});
