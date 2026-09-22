"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface ModoEdicionContexto {
  activo: boolean;
  setActivo: (v: boolean) => void;
}

/**
 * Default sin provider: así `SeccionEditable` (rebanada B1) funciona aunque
 * `page.tsx` no monte `ModoEdicionProvider` (visitante sin `puedeEditar`).
 * Sin persistencia (D8): el Switch vuelve apagado en cada carga.
 */
const ModoEdicionContext = createContext<ModoEdicionContexto>({
  activo: false,
  setActivo: () => {},
});

export function ModoEdicionProvider({ children }: { children: ReactNode }) {
  const [activo, setActivo] = useState(false);
  return (
    <ModoEdicionContext.Provider value={{ activo, setActivo }}>
      {children}
    </ModoEdicionContext.Provider>
  );
}

export function useModoEdicion(): ModoEdicionContexto {
  return useContext(ModoEdicionContext);
}
