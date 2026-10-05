import { describe, expect, it } from "vitest";
import { filtrosDeEstado } from "@/lib/catalogo-url";
import { VISTA_ACTUAL, estadoBase, vistaProduccion } from "./vista";

describe("vista del banco", () => {
  it("VISTA_ACTUAL es la de hoy: soloVisibles false y stock = todos", () => {
    expect(VISTA_ACTUAL).toEqual({ soloVisibles: false, soloStock: false });
    const estado = estadoBase("lampara", VISTA_ACTUAL);
    expect(estado.query).toBe("lampara");
    expect(estado.soloStock).toBe(false);
    expect(filtrosDeEstado(estado).soloStock).toBe(false);
  });

  it("vistaProduccion(true): soloVisibles y el stock por defecto del Shop (sin `stock`)", () => {
    expect(vistaProduccion(true)).toEqual({ soloVisibles: true, soloStock: true });
    const estado = estadoBase("lampara", vistaProduccion(true));
    expect(estado.soloStock).toBe(true);
    expect(filtrosDeEstado(estado).soloStock).toBe(true);
  });

  it("vistaProduccion(false): sin soloVisibles pero con el stock por defecto", () => {
    expect(vistaProduccion(false)).toEqual({ soloVisibles: false, soloStock: true });
  });

  it("con búsqueda el orden es relevancia", () => {
    expect(estadoBase("lampara", VISTA_ACTUAL).orden).toBe("relevancia");
  });
});
