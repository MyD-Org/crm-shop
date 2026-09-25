"use client";

import { useLayoutEffect } from "react";
import { useModoEdicion } from "./ModoEdicion";

/**
 * Prende `puedeEditar` en el contexto del editor mientras está montado. Solo
 * lo renderiza `EdicionSiAdmin` (server) cuando `esAdmin()` da true, así la
 * página no necesita saber quién la mira. Al desmontarse lo vuelve a apagar
 * (el Switch "Modo edición" no se toca: un refresco tras guardar no lo apaga).
 */
export function HabilitarEdicion() {
  const { setPuedeEditar } = useModoEdicion();
  useLayoutEffect(() => {
    setPuedeEditar(true);
    return () => setPuedeEditar(false);
  }, [setPuedeEditar]);
  return null;
}
