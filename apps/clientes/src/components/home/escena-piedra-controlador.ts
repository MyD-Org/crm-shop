import { LUZ_INICIAL, LUZ_QUIETA, cercaDelLA, pasoDeLuz } from "./escena-piedra";

type Escucha = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type ConAtributos = { setAttribute(nombre: string, valor: string): void };

/** Todo lo que toca el navegador entra por acá, así la lógica se prueba sin DOM. */
export interface EntornoEscena {
  hero: Escucha & ConAtributos;
  /** El LA (el botón). */
  la: Escucha;
  /** Los dos círculos que siguen a la luz. */
  luz: ConAtributos;
  ambiente: ConAtributos;
  quieto: boolean;
  /** Del punto en pantalla al lienzo de la escena. */
  aEscena(ev: { clientX: number; clientY: number }): { x: number; y: number } | null;
  raf(cb: FrameRequestCallback): number;
  caf(id: number): void;
  /** Avisa cuando el hero entra o sale de pantalla. */
  observarVisible(cb: (visible: boolean) => void): () => void;
  /** Avisa cuando la pestaña se oculta o se muestra. */
  observarPestana(cb: () => void): () => void;
  pestanaVisible(): boolean;
}

/** Atributo con el que el CSS prende el LA y su halo. */
export const ATRIBUTO_ENCENDIDO = "data-encendido";

/**
 * Anima la luz y enciende el LA. No usa React: la luz se mueve por atributos del SVG.
 * El loop corre sólo con el hero a la vista y la pestaña visible. Devuelve la limpieza.
 */
export function iniciarEscena(env: EntornoEscena): () => void {
  const encender = () => env.hero.setAttribute(ATRIBUTO_ENCENDIDO, "");
  const poner = (p: { x: number; y: number }) => {
    for (const el of [env.luz, env.ambiente]) {
      el.setAttribute("cx", p.x.toFixed(1));
      el.setAttribute("cy", p.y.toFixed(1));
    }
  };

  if (env.quieto) {
    encender();
    poner(LUZ_QUIETA);
    return () => {};
  }

  let pos: { x: number; y: number } = LUZ_INICIAL;
  let t = 0;
  let cursor: { clientX: number; clientY: number } | null = null;
  let enPantalla = false;
  let cuadroId = 0;
  let corriendo = false;

  const cuadro = () => {
    t += 0.0045;
    const punto = cursor ? env.aEscena(cursor) : null;
    if (punto && cercaDelLA(punto)) encender();
    pos = pasoDeLuz(pos, punto, t);
    poner(pos);
    cuadroId = env.raf(cuadro);
  };
  const actualizar = () => {
    const debeCorrer = enPantalla && env.pestanaVisible();
    if (debeCorrer && !corriendo) {
      corriendo = true;
      cuadroId = env.raf(cuadro);
    } else if (!debeCorrer && corriendo) {
      corriendo = false;
      env.caf(cuadroId);
    }
  };

  const mover = (ev: Event) => {
    const p = ev as PointerEvent;
    if (p.pointerType !== "mouse") return;
    cursor = { clientX: p.clientX, clientY: p.clientY };
  };
  const salir = () => { cursor = null; };
  const tecla = (ev: Event) => {
    const k = (ev as KeyboardEvent).key;
    if (k === "Enter" || k === " ") { ev.preventDefault(); encender(); }
  };

  env.hero.addEventListener("pointermove", mover);
  env.hero.addEventListener("pointerleave", salir);
  env.la.addEventListener("click", encender);
  env.la.addEventListener("keydown", tecla);
  poner(pos);
  const sueltaVisible = env.observarVisible(visible => { enPantalla = visible; actualizar(); });
  const sueltaPestana = env.observarPestana(actualizar);

  return () => {
    if (corriendo) env.caf(cuadroId);
    corriendo = false;
    sueltaVisible();
    sueltaPestana();
    env.hero.removeEventListener("pointermove", mover);
    env.hero.removeEventListener("pointerleave", salir);
    env.la.removeEventListener("click", encender);
    env.la.removeEventListener("keydown", tecla);
  };
}
