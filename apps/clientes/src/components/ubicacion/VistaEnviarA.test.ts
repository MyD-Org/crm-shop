import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DireccionEnvio } from "@/lib/direcciones-envio";
import { opcionDireccion, opcionLocal } from "@/lib/enviar-a";
import { TEXTOS_UBICACION as T } from "@/lib/ubicacion";
import { VistaEnviarA, type VistaEnviarAProps } from "./VistaEnviarA";

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const dir = (n: number, over: Partial<DireccionEnvio> = {}): DireccionEnvio => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`,
  etiqueta: null,
  calle: `Calle Ejemplo ${n}00`,
  ciudad: "Ciudad Ejemplo",
  provincia: "Córdoba",
  cp: "5000",
  referencias: null,
  predeterminada: n === 1,
  ...over,
});

const LOCALES = {
  unico: false,
  locales: [
    { slug: "local-a", nombre: "Local A", direccion: "Av. Ejemplo 1", horario: "" },
    { slug: "local-b", nombre: "Local B", direccion: "Av. Ejemplo 2", horario: "" },
  ],
};

const base: VistaEnviarAProps = {
  direcciones: { estado: "ok", direcciones: [dir(1), dir(2)] },
  locales: LOCALES,
  vigente: undefined,
  valor: "",
  onValor: () => {},
  onEditar: () => {},
  onAgregar: () => {},
  onReintentar: () => {},
  formularioLocalidad: createElement("div", { "data-formulario-localidad": "" }),
  error: null,
  enviando: false,
  onConfirmar: () => {},
  conUbicacion: false,
  onQuitar: () => {},
};

const render = (p: Partial<VistaEnviarAProps> = {}) => renderToStaticMarkup(createElement(VistaEnviarA, { ...base, ...p }));

/** ¿El radio con ese value está marcado? */
const marcado = (html: string, value: string) =>
  new RegExp(`<input[^>]*value="${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*checked=""`).test(html) ||
  new RegExp(`<input[^>]*checked=""[^>]*value="${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(html);

describe("VistaEnviarA (contenido del modal)", () => {
  it("con sesión: 2 direcciones con Editar, 2 locales y Agregar nueva dirección; la vigente marcada y con badge", () => {
    const vig = opcionDireccion(dir(2).id);
    const h = render({ vigente: vig, valor: vig });
    const t = texto(h);
    expect(t).toContain(T.legendDirecciones);
    expect(t).toContain("Calle Ejemplo 100");
    expect(t).toContain("Calle Ejemplo 200");
    expect((t.match(/\bEditar\b/g) ?? []).length).toBe(2);
    expect(t).toContain(T.legendLocales);
    expect(t).toContain("Local A");
    expect(t).toContain("Local B");
    expect(t).toContain(T.agregarDireccion);
    expect(t).toContain(T.actual);
    expect(marcado(h, vig)).toBe(true);
    expect(marcado(h, opcionDireccion(dir(1).id))).toBe(false);
    expect(h).toContain('role="radiogroup"');
    expect(h).toContain("<legend");
    expect(h).not.toContain("data-formulario-localidad");
  });

  it("retiro vigente: el local queda marcado", () => {
    const vig = opcionLocal("local-b");
    const h = render({ vigente: vig, valor: vig });
    expect(marcado(h, vig)).toBe(true);
  });

  it("con sesión y sin direcciones: sin sección de direcciones vacía; locales y Agregar", () => {
    const t = texto(render({ direcciones: { estado: "ok", direcciones: [] } }));
    expect(t).not.toContain(T.legendDirecciones);
    expect(t).toContain("Local A");
    expect(t).toContain(T.agregarDireccion);
  });

  it("cargando: indicador accesible, sin listas", () => {
    const t = texto(render({ direcciones: null, locales: undefined }));
    expect(t).toContain(T.cargando);
    expect(t).not.toContain("Local A");
  });

  it("error de carga: mensaje en usted + Reintentar; los locales siguen elegibles", () => {
    const t = texto(render({ direcciones: { estado: "error" } }));
    expect(t).toContain(T.errorCarga);
    expect(t).toContain(T.reintentar);
    expect(t).toContain("Local A");
  });

  it("sin sesión: formulario de localidad + CP (slot) y los locales; sin Agregar", () => {
    const h = render({ direcciones: { estado: "sinSesion" } });
    expect(h).toContain("data-formulario-localidad");
    expect(texto(h)).toContain("Local A");
    expect(texto(h)).not.toContain(T.agregarDireccion);
  });

  it("límite de 10 direcciones: sin botón Agregar y con el aviso", () => {
    const diez = Array.from({ length: 10 }, (_, i) => dir(i % 9 + 1, { id: `${i}0000000-1111-4111-8111-111111111111` }));
    const t = texto(render({ direcciones: { estado: "ok", direcciones: diez } }));
    expect(t).not.toContain(T.agregarDireccion);
    expect(t).toContain(T.limiteDirecciones);
  });

  it("flag sucursales apagado: una sola opción «Retirar en el local» sin dirección ni horario", () => {
    const h = render({ locales: { unico: true, locales: [] } });
    const t = texto(h);
    expect(t).toContain(T.retirarEnElLocal);
    expect(t).not.toContain("Local A");
    expect(h).toContain(`value="${opcionLocal(null)}"`);
  });

  it("error al guardar: visible, con el botón Confirmar", () => {
    const t = texto(render({ error: T.localNoEncontrado, valor: opcionLocal("local-a") }));
    expect(t).toContain(T.localNoEncontrado);
    expect(t).toContain(T.confirmar);
  });

  it("con elección guardada ofrece quitarla", () => {
    expect(texto(render({ conUbicacion: true }))).toContain(T.quitar);
    expect(texto(render({ conUbicacion: false }))).not.toContain(T.quitar);
  });

  it("no pisa estilos del DS (sin className en RadioGroup ni Button)", () => {
    const fuente = readFileSync(join(__dirname, "VistaEnviarA.tsx"), "utf8");
    expect(fuente).not.toMatch(/<RadioGroup[^>]*className=/);
    expect(fuente).not.toMatch(/<Button[^>]*className=/);
  });
});

describe("ModalEnviarA (guardas de fuente del flujo)", () => {
  const modal = readFileSync(join(__dirname, "ModalEnviarA.tsx"), "utf8");

  it("carga lazy al abrir con abort al cerrar", () => {
    expect(modal).toContain("cargarDirecciones(fetch, ctrl.signal)");
    expect(modal).toContain("cargarLocales(fetch, ctrl.signal)");
    expect(modal).toContain("ctrl.abort()");
  });

  it("confirmar: POST /api/ubicacion, cierra y refresca; si falla, muestra el error sin cerrar", () => {
    expect(modal).toContain("guardarEleccion(fetch,");
    expect(modal).toContain("router.refresh()");
    expect(modal).toMatch(/if \(!r\.ok\) \{\s*setError\(r\.error\);/);
  });

  it("sin sesión manda siempre el CP (cuerpoLocalidad) y no envía si es inválido", () => {
    expect(modal).toContain("cuerpoLocalidad(");
  });

  it("alta y edición inline con DireccionForm embebida; el alta queda elegida", () => {
    expect(modal).toContain('variante="embebida"');
    expect(modal).toContain("idNuevo(");
    expect(modal).toContain("{ direccionId:");
  });
});
