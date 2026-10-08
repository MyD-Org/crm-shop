import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAZO_CARGA_MS,
  alEstarListo,
  alFallarBrick,
  alVencerPlazo,
  esErrorCritico,
  iniciarPlazoCarga,
} from "./pago-mp-carga";
import { AvisoFormularioNoCargo, AvisoPagoRechazado, AvisoSinConfigurar } from "./PagoMercadoPagoAvisos";

const leer = (nombre: string) => readFileSync(fileURLToPath(new URL(nombre, import.meta.url)), "utf8");

describe("onError del Brick: critical vs non_critical", () => {
  it("un error critical (o sin tipo) es crítico", () => {
    expect(esErrorCritico({ type: "critical", cause: "x" })).toBe(true);
    expect(esErrorCritico(new Error("boom"))).toBe(true);
    expect(esErrorCritico(undefined)).toBe(true);
    expect(esErrorCritico(null)).toBe(true);
  });

  it("un error non_critical no es crítico", () => {
    expect(esErrorCritico({ type: "non_critical", cause: "invalid_card" })).toBe(false);
  });

  it("critical → error_formulario desde cargando y desde formulario", () => {
    expect(alFallarBrick({ fase: "cargando" }, { type: "critical" })).toEqual({ fase: "error_formulario" });
    expect(alFallarBrick({ fase: "formulario" }, { type: "critical" })).toEqual({ fase: "error_formulario" });
  });

  it("non_critical → el estado no cambia (sin aviso)", () => {
    for (const fase of ["cargando", "formulario", "error_formulario"]) {
      const e = { fase };
      expect(alFallarBrick(e, { type: "non_critical" })).toBe(e);
    }
  });

  it("un error crítico nunca pisa un pago en curso ni un rechazo", () => {
    for (const fase of ["procesando", "pagado", "pendiente", "rechazado"]) {
      const e = { fase };
      expect(alFallarBrick(e, { type: "critical" })).toBe(e);
    }
  });
});

describe("onReady", () => {
  it("quita el loader (cargando → formulario) y recupera de un error de carga", () => {
    expect(alEstarListo({ fase: "cargando" })).toEqual({ fase: "formulario" });
    expect(alEstarListo({ fase: "error_formulario" })).toEqual({ fase: "formulario" });
  });

  it("no toca un pago en curso ni un rechazo", () => {
    for (const fase of ["procesando", "pagado", "pendiente", "rechazado"]) {
      const e = { fase };
      expect(alEstarListo(e)).toBe(e);
    }
  });
});

describe("tiempo límite de carga", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("el plazo es de 15 s", () => {
    expect(PLAZO_CARGA_MS).toBe(15_000);
  });

  it("a los 15 s sin onReady dispara; antes no", () => {
    const alVencer = vi.fn();
    iniciarPlazoCarga(alVencer);
    vi.advanceTimersByTime(PLAZO_CARGA_MS - 1);
    expect(alVencer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(alVencer).toHaveBeenCalledTimes(1);
  });

  it("cancelarlo (onReady, desmontar o reintentar) evita que dispare", () => {
    const alVencer = vi.fn();
    const cancelar = iniciarPlazoCarga(alVencer);
    vi.advanceTimersByTime(5_000);
    cancelar();
    vi.advanceTimersByTime(PLAZO_CARGA_MS * 2);
    expect(alVencer).not.toHaveBeenCalled();
  });

  it("cada intento reinicia el plazo completo", () => {
    const alVencer = vi.fn();
    const cancelar = iniciarPlazoCarga(alVencer);
    vi.advanceTimersByTime(10_000);
    cancelar(); // Reintentar
    iniciarPlazoCarga(alVencer);
    vi.advanceTimersByTime(10_000);
    expect(alVencer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(alVencer).toHaveBeenCalledTimes(1);
  });

  it("al vencer, cargando → error_formulario; si ya cargó o falló no cambia nada", () => {
    expect(alVencerPlazo({ fase: "cargando" })).toEqual({ fase: "error_formulario" });
    for (const fase of ["formulario", "procesando", "pagado", "rechazado", "error_formulario"]) {
      const e = { fase };
      expect(alVencerPlazo(e)).toBe(e);
    }
  });
});

describe("avisos con el Alert del DS", () => {
  const noop = () => {};

  it("formulario no cargó: aviso de alerta con Reintentar", () => {
    const html = renderToStaticMarkup(createElement(AvisoFormularioNoCargo, { onReintentar: noop }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("No se pudo cargar el formulario de pago");
    expect(html).toContain("Revise su conexión e inténtelo de nuevo.");
    expect(html).toContain("Reintentar");
  });

  it("rechazo: muestra el motivo, sin botón (el formulario de abajo ya quedó listo para reintentar)", () => {
    const html = renderToStaticMarkup(createElement(AvisoPagoRechazado, { mensaje: "Fondos insuficientes" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("No se pudo completar el pago");
    expect(html).toContain("Fondos insuficientes");
    expect(html).not.toContain("Probar de nuevo");
    expect(html).not.toContain("<button");
  });

  it("falta de configuración", () => {
    const html = renderToStaticMarkup(createElement(AvisoSinConfigurar));
    expect(html).toContain('role="alert"');
    expect(html).toContain("no está configurado");
  });
});

describe("PagoMercadoPago.tsx: cableado", () => {
  const fuente = leer("./PagoMercadoPago.tsx");

  it("Reintentar remonta el Brick (key) y vuelve a cargando", () => {
    expect(fuente).toMatch(/<CardPayment\s+key=\{`\$\{tipoTarjeta\}-\$\{intento\}`\}/);
    const fn = fuente.slice(fuente.indexOf("function reintentar()"));
    const cuerpo = fn.slice(0, fn.indexOf("\n  }"));
    expect(cuerpo).toContain("remontarBrick()");
    expect(cuerpo).toContain('setEstado({ fase: "cargando" })');
    // Remontar = nueva `key` y sin el BIN de la tarjeta anterior.
    const remontar = fuente.slice(fuente.indexOf("function remontarBrick()"));
    const cuerpoRemontar = remontar.slice(0, remontar.indexOf("\n  }"));
    expect(cuerpoRemontar).toContain("setIntento((n) => n + 1)");
    expect(cuerpoRemontar).toContain("setBin(null)");
    expect(fuente).toContain("onReintentar={reintentar}");
  });

  it("el plazo corre sólo mientras carga (con configuración) y se reinicia por intento", () => {
    expect(fuente).toContain('cargandoConBrick = !faltaKey && opcion !== "cuenta" && estado.fase === "cargando"');
    expect(fuente).toMatch(/\[cargandoConBrick, intento\]/);
    expect(fuente).toContain("iniciarPlazoCarga(");
  });

  it("onError delega en alFallarBrick (los non_critical no muestran aviso)", () => {
    expect(fuente).toContain("alFallarBrick(e, error)");
  });

  it("no quedan cuadros rojos armados a mano", () => {
    expect(fuente).not.toContain("border-danger/30");
    expect(fuente).not.toContain("bg-danger/5");
  });
});
