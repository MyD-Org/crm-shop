import { beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.fn();
vi.mock("../tracking/track", () => ({ track: (e: unknown) => track(e) }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));

import { PRODUCTOS_POR_PAGINA } from "../catalog";
import { POR_PAGINA, enviarBusquedaEnviada, enviarClickResultado } from "./telemetria";
import { COOKIE_RESUMEN, valorCookieResumen } from "./resumen";

beforeEach(() => track.mockClear());

describe("telemetría de la búsqueda", () => {
  it("busqueda_enviada una sola vez, con el resumen de /buscar, el total y la consulta normalizada", () => {
    const doc = {
      cookie: `otra=1; ${COOKIE_RESUMEN}=${encodeURIComponent(valorCookieResumen({ intencion: "necesidad", fuente: "jev", duros: 1, blandos: 2, ms_jev: 480 }))}`,
    };
    expect(enviarBusquedaEnviada("Algo para el BAÑO", 42, doc)).toBe(true);
    expect(track).toHaveBeenCalledWith({
      tipo: "busqueda_enviada",
      intencion: "necesidad",
      fuente: "jev",
      duros: 1,
      blandos: 2,
      ms_jev: 480,
      total: 42,
      consulta: "algo para el bano",
    });
    expect(doc.cookie).toContain("max-age=0");
  });

  it("sin cookie (recarga, paginar, link compartido) no hay evento; un dato personal no viaja", () => {
    expect(enviarBusquedaEnviada("x", 1, { cookie: "otra=1" })).toBe(false);
    const doc = { cookie: `${COOKIE_RESUMEN}=${encodeURIComponent(valorCookieResumen({ intencion: "producto", fuente: "cache", duros: 0, blandos: 0, ms_jev: null }))}` };
    enviarBusquedaEnviada("juan@correo.example", 3, doc);
    expect(track.mock.calls[0][0]).not.toHaveProperty("consulta");
  });

  it("click con la posición absoluta", () => {
    enviarClickResultado(2, 0, true);
    expect(track).toHaveBeenCalledWith({ tipo: "busqueda_resultado_click", posicion: 25, ia: true });
    expect(POR_PAGINA).toBe(PRODUCTOS_POR_PAGINA);
  });
});
