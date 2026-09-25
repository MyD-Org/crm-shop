"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface ModoEdicionContexto {
  /** Admin del Shop: lo prende `HabilitarEdicion`, que solo se monta dentro
   *  del hueco `EdicionSiAdmin` (server, `esAdmin()`). La home no calcula
   *  `esAdmin()` (performance-mobile-shop 4a). */
  puedeEditar: boolean;
  setPuedeEditar: (v: boolean) => void;
  /** Switch "Modo edición" de la barra. */
  activo: boolean;
  setActivo: (v: boolean) => void;
}

/**
 * Default sin provider: `SeccionEditable` se comporta como para un visitante.
 * Sin persistencia (D8): el Switch vuelve apagado en cada carga.
 */
const ModoEdicionContext = createContext<ModoEdicionContexto>({
  puedeEditar: false,
  setPuedeEditar: () => {},
  activo: false,
  setActivo: () => {},
});

export function ModoEdicionProvider({ children }: { children: ReactNode }) {
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [activo, setActivo] = useState(false);
  return (
    <ModoEdicionContext.Provider value={{ puedeEditar, setPuedeEditar, activo, setActivo }}>
      {children}
    </ModoEdicionContext.Provider>
  );
}

export function useModoEdicion(): ModoEdicionContexto {
  return useContext(ModoEdicionContext);
}
