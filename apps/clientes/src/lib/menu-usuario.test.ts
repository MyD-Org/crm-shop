import { describe, expect, it } from "vitest";
import type { CapacidadesDespliegue } from "./mi-cuenta-nav";
import {
  ENTRADAS_MENU,
  HREF_FACTURACION,
  HREF_FAVORITOS,
  HREF_MIS_DATOS,
  HREF_MIS_PEDIDOS,
  entradasMenu,
  etiquetaBotonMenu,
} from "./menu-usuario";
import * as menu from "./menu-usuario";

const D = (p: Partial<CapacidadesDespliegue>): CapacidadesDespliegue => ({
  favoritos: false,
  facturas: false,
  direcciones: true,
  pagos: false,
  presupuestos: false,
  condiciones: false,
  avisos: false,
  ...p,
});

describe("menu del usuario", () => {
  it("ofrece las seis entradas en orden, con Cerrar sesión al final", () => {
    expect(ENTRADAS_MENU.map((e) => e.id)).toEqual([
      "pedidos",
      "favoritos",
      "facturacion",
      "datos",
      "seguridad",
      "salir",
    ]);
    expect(ENTRADAS_MENU.at(-1)).toMatchObject({ id: "salir", tone: "danger" });
  });

  it("Mis pedidos lleva al resumen y Mis datos a su sección", () => {
    expect(HREF_MIS_PEDIDOS).toBe("/mi-cuenta");
    expect(HREF_MIS_DATOS).toBe("/mi-cuenta/datos");
  });

  it("ya no hay pestañas: Mi cuenta es por secciones", () => {
    expect("tabInicial" in menu).toBe(false);
    expect("TABS_MI_CUENTA" in menu).toBe(false);
  });

  it("los textos están en registro formal, sin voseo ni tuteo", () => {
    const textos = [...ENTRADAS_MENU.map((e) => e.label), etiquetaBotonMenu(null)].join(" ");
    expect(textos).not.toMatch(/\b(tu|tus|te|vos)\b/i);
  });

  it("el botón tiene etiqueta accesible con y sin nombre", () => {
    expect(etiquetaBotonMenu("María Romero")).toContain("María Romero");
    expect(etiquetaBotonMenu(null)).toBe("Menú de su cuenta");
  });
});

describe("Favoritos en el menú, detrás de la capacidad de despliegue", () => {
  it("apagada: el menú no ofrece Favoritos", () => {
    expect(entradasMenu(D({})).map((e) => e.id)).toEqual([
      "pedidos",
      "datos",
      "seguridad",
      "salir",
    ]);
  });

  it("el menú del despliegue actual es el de la capacidad encendida", () => {
    expect(ENTRADAS_MENU).toEqual(entradasMenu(D({ favoritos: true, facturas: true })));
  });

  it("encendida: Favoritos va entre Mis pedidos y Mis datos, como en la navegación", () => {
    const entradas = entradasMenu(D({ favoritos: true }));
    expect(entradas.map((e) => e.id)).toEqual(["pedidos", "favoritos", "datos", "seguridad", "salir"]);
    expect(entradas.filter((e) => e.tone === "danger").map((e) => e.id)).toEqual(["salir"]);
    expect(entradas.find((e) => e.id === "favoritos")?.label).toBe("Favoritos");
  });

  it("Facturación entra al header sólo con la sección desplegada, y nunca como 'Cuenta corriente'", () => {
    expect(entradasMenu(D({ favoritos: true })).map((e) => e.id)).not.toContain("facturacion");
    const entradas = entradasMenu(D({ favoritos: true, facturas: true }));
    expect(entradas.map((e) => e.id)).toEqual(["pedidos", "favoritos", "facturacion", "datos", "seguridad", "salir"]);
    expect(entradas.find((e) => e.id === "facturacion")?.label).toBe("Facturas");
    expect(entradas.map((e) => e.label)).not.toContain("Cuenta corriente");
    expect(HREF_FACTURACION).toBe("/mi-cuenta/facturas");
  });

  it("Favoritos lleva a su sección; Mis pedidos sigue en el resumen", () => {
    expect(HREF_FAVORITOS).toBe("/mi-cuenta/favoritos");
    expect(HREF_MIS_PEDIDOS).toBe("/mi-cuenta");
  });
});
