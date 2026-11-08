import { describe, expect, it, vi } from "vitest";
import { ESPERA_ENCENDIDO_TACTIL_MS, enlazarEncendido, iniciarEscena, type EntornoEscena } from "./escena-piedra-controlador";
import { LA, LUZ_INICIAL, LUZ_QUIETA, cercaDelLA, pasoDeLuz } from "./escena-piedra";

/** Elemento falso: guarda atributos y escucha eventos como un EventTarget. */
function elemento() {
  const et = new EventTarget();
  const attrs: Record<string, string> = {};
  return Object.assign(et, {
    attrs,
    setAttribute: (n: string, v: string) => { attrs[n] = v; },
    hasAttribute: (n: string) => n in attrs,
  });
}

function entorno(sobre: Partial<EntornoEscena> = {}) {
  const hero = elemento();
  const la = elemento();
  const luz = elemento();
  const ambiente = elemento();
  let cola: FrameRequestCallback[] = [];
  const raf = vi.fn((cb: FrameRequestCallback) => { cola.push(cb); return cola.length; });
  const caf = vi.fn();
  let alVer: (visible: boolean) => void = () => {};
  let alPestana: () => void = () => {};
  let pestana = true;
  const env: EntornoEscena = {
    hero, la, luz, ambiente,
    quieto: false,
    aEscena: ev => ({ x: ev.clientX, y: ev.clientY }),
    raf, caf,
    observarVisible: cb => { alVer = cb; return () => {}; },
    observarPestana: cb => { alPestana = cb; return () => {}; },
    pestanaVisible: () => pestana,
    ...sobre,
  };
  const cuadro = () => { const c = cola; cola = []; c.forEach(f => f(0)); };
  return { env, hero, la, luz, ambiente, raf, caf, cuadro,
    ver: (v: boolean) => alVer(v), ocultarPestana: (v: boolean) => { pestana = !v; alPestana(); } };
}

const mouse = (tipo: string, x: number, y: number) =>
  Object.assign(new Event(tipo), { pointerType: "mouse", clientX: x, clientY: y });

describe("escena de la piedra: movimiento reducido", () => {
  it("deja el LA encendido, la luz quieta y no arranca ningún loop", () => {
    const t = entorno({ quieto: true });
    iniciarEscena(t.env);
    t.ver(true);
    expect(t.hero.attrs["data-encendido"]).toBeDefined();
    for (const el of [t.luz, t.ambiente]) {
      expect(Number(el.attrs.cx)).toBe(LUZ_QUIETA.x);
      expect(Number(el.attrs.cy)).toBe(LUZ_QUIETA.y);
    }
    expect(t.raf).not.toHaveBeenCalled();
  });
});

describe("escena de la piedra: loop", () => {
  it("sólo corre con el hero a la vista y la pestaña visible", () => {
    const t = entorno();
    iniciarEscena(t.env);
    expect(t.raf).not.toHaveBeenCalled();
    t.ver(true);
    expect(t.raf).toHaveBeenCalledTimes(1);
    t.cuadro();
    expect(t.raf).toHaveBeenCalledTimes(2);
    t.ver(false);
    expect(t.caf).toHaveBeenCalled();
    const n = t.raf.mock.calls.length;
    t.ocultarPestana(false);
    t.ver(true);
    expect(t.raf.mock.calls.length).toBe(n + 1);
    t.ocultarPestana(true);
    expect(t.caf).toHaveBeenCalledTimes(2);
  });

  it("no arranca si la pestaña está oculta al entrar a pantalla", () => {
    const t = entorno();
    iniciarEscena(t.env);
    t.ocultarPestana(true);
    t.ver(true);
    expect(t.raf).not.toHaveBeenCalled();
  });

  it("mueve la luz por atributos, sin tocar nada más", () => {
    const t = entorno();
    iniciarEscena(t.env);
    t.ver(true);
    t.cuadro();
    expect(Number(t.luz.attrs.cx)).not.toBe(LUZ_INICIAL.x);
    expect(t.luz.attrs.cx).toBe(t.ambiente.attrs.cx);
    expect(t.hero.attrs["data-encendido"]).toBeUndefined();
  });

  it("al limpiar cancela el cuadro pendiente", () => {
    const t = entorno();
    const limpiar = iniciarEscena(t.env);
    t.ver(true);
    limpiar();
    expect(t.caf).toHaveBeenCalled();
  });
});

describe("escena de la piedra: pantalla táctil", () => {
  function conReloj() {
    let pendientes: { id: number; cb: () => void }[] = [];
    let n = 0;
    const programar = vi.fn((cb: () => void) => { n += 1; pendientes.push({ id: n, cb }); return n; });
    const cancelarProgramado = vi.fn((id: number) => { pendientes = pendientes.filter(p => p.id !== id); });
    const correr = () => { const p = pendientes; pendientes = []; p.forEach(x => x.cb()); };
    return { programar, cancelarProgramado, correr };
  }

  it("el LA se enciende solo tras unos segundos a la vista", () => {
    const r = conReloj();
    const t = entorno({ tactil: true, programar: r.programar, cancelarProgramado: r.cancelarProgramado });
    iniciarEscena(t.env);
    t.ver(true);
    expect(r.programar).toHaveBeenCalledWith(expect.any(Function), ESPERA_ENCENDIDO_TACTIL_MS);
    expect(t.hero.attrs["data-encendido"]).toBeUndefined();
    r.correr();
    expect(t.hero.attrs["data-encendido"]).toBeDefined();
  });

  it("si sale de pantalla antes, no se enciende", () => {
    const r = conReloj();
    const t = entorno({ tactil: true, programar: r.programar, cancelarProgramado: r.cancelarProgramado });
    iniciarEscena(t.env);
    t.ver(true);
    t.ver(false);
    r.correr();
    expect(t.hero.attrs["data-encendido"]).toBeUndefined();
  });

  it("con cursor (no táctil) no se enciende solo", () => {
    const r = conReloj();
    const t = entorno({ tactil: false, programar: r.programar, cancelarProgramado: r.cancelarProgramado });
    iniciarEscena(t.env);
    t.ver(true);
    expect(r.programar).not.toHaveBeenCalled();
  });
});

describe("escena de la piedra: encendido del LA", () => {
  it("se enciende al acercar el mouse y se queda encendido", () => {
    const t = entorno();
    iniciarEscena(t.env);
    t.ver(true);
    t.hero.dispatchEvent(mouse("pointermove", 100, 100));
    t.cuadro();
    expect(t.hero.attrs["data-encendido"]).toBeUndefined();
    t.hero.dispatchEvent(mouse("pointermove", LA.x + 10, LA.y));
    t.cuadro();
    expect(t.hero.attrs["data-encendido"]).toBeDefined();
    t.hero.dispatchEvent(mouse("pointermove", 0, 0));
    t.cuadro();
    expect(t.hero.attrs["data-encendido"]).toBeDefined();
  });

  it("ignora el puntero táctil para la linterna", () => {
    const t = entorno();
    iniciarEscena(t.env);
    t.ver(true);
    t.hero.dispatchEvent(Object.assign(new Event("pointermove"), { pointerType: "touch", clientX: LA.x, clientY: LA.y }));
    t.cuadro();
    expect(t.hero.attrs["data-encendido"]).toBeUndefined();
  });

  it("se enciende con clic, Enter y Espacio, pero no con otras teclas", () => {
    for (const [tipo, tecla, enciende] of [["click", "", true], ["keydown", "Enter", true], ["keydown", " ", true], ["keydown", "a", false]] as const) {
      const t = entorno();
      iniciarEscena(t.env);
      const ev = Object.assign(new Event(tipo, { cancelable: true }), { key: tecla });
      t.la.dispatchEvent(ev);
      expect(t.hero.attrs["data-encendido"] !== undefined, `${tipo} ${tecla}`).toBe(enciende);
    }
  });
});

describe("geometría de la luz", () => {
  it("sigue al cursor con suavizado y deriva sola sin cursor", () => {
    const sigue = pasoDeLuz({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    expect(sigue.x).toBeCloseTo(14);
    const sola = pasoDeLuz({ x: 0, y: 0 }, null, 0);
    // Hacia donde la lleva la deriva (x = 1500 en t = 0), pero con paso más corto que siguiendo al cursor.
    expect(sola.x).toBeCloseTo(1500 * 0.03);
    expect(sola.x / 1500).toBeLessThan(sigue.x / 100);
  });
  it("el LA se enciende dentro de su radio", () => {
    expect(cercaDelLA({ x: LA.x + 229, y: LA.y })).toBe(true);
    expect(cercaDelLA({ x: LA.x + 231, y: LA.y })).toBe(false);
  });
});

describe("enlazarEncendido (lo que comparten el hero y los bloques quietos)", () => {
  const tecla = (key: string) => Object.assign(new Event("keydown", { cancelable: true }), { key });

  it("enciende con un toque, con Enter y con Espacio; otras teclas no", () => {
    const hero = elemento();
    const la = elemento();
    enlazarEncendido({ hero, la });
    la.dispatchEvent(tecla("a"));
    expect(hero.hasAttribute("data-encendido")).toBe(false);
    const espacio = tecla(" ");
    la.dispatchEvent(espacio);
    expect(hero.hasAttribute("data-encendido")).toBe(true);
    expect(espacio.defaultPrevented).toBe(true);

    const hero2 = elemento();
    const la2 = elemento();
    enlazarEncendido({ hero: hero2, la: la2 });
    la2.dispatchEvent(new Event("click"));
    expect(hero2.hasAttribute("data-encendido")).toBe(true);

    const hero3 = elemento();
    const la3 = elemento();
    enlazarEncendido({ hero: hero3, la: la3 });
    la3.dispatchEvent(tecla("Enter"));
    expect(hero3.hasAttribute("data-encendido")).toBe(true);
  });

  it("soltar quita los oyentes", () => {
    const hero = elemento();
    const la = elemento();
    enlazarEncendido({ hero, la }).soltar();
    la.dispatchEvent(new Event("click"));
    expect(hero.hasAttribute("data-encendido")).toBe(false);
  });

  it("no pide ningún cuadro de animación: es sólo eventos", () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    enlazarEncendido({ hero: elemento(), la: elemento() });
    vi.unstubAllGlobals();
    expect(raf).not.toHaveBeenCalled();
  });
});
