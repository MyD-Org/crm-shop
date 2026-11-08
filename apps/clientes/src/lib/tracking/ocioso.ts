/**
 * Corre `fn` cuando la página ya cargó y el navegador está libre, para que el
 * tracking no compita con lo que el visitante ve primero. Devuelve cómo cancelarlo.
 */
export function cuandoOcioso(
  fn: () => void,
  w: Window = window,
  maxEsperaMs = 4000,
): () => void {
  let cancelado = false;
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const correr = () => {
    if (!cancelado) fn();
  };
  const programar = () => {
    if (cancelado) return;
    if (typeof w.requestIdleCallback === "function") {
      idle = w.requestIdleCallback(correr, { timeout: maxEsperaMs });
    } else {
      timer = setTimeout(correr, 1);
    }
  };
  if (w.document.readyState === "complete") programar();
  else w.addEventListener("load", programar, { once: true });

  return () => {
    cancelado = true;
    w.removeEventListener("load", programar);
    if (idle !== undefined) w.cancelIdleCallback?.(idle);
    if (timer !== undefined) clearTimeout(timer);
  };
}
