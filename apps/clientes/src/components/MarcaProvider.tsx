"use client";

import { createContext, useContext, type ReactNode } from "react";
import { MARCA_POR_DEFECTO } from "@/lib/marca-base";

/** Lo mínimo de la marca que necesitan los componentes cliente (el layout lo lee de la base). */
export interface MarcaCliente {
  /** "central": con los recursos propios de Central (fotos del editor); "generica": sin ellos. */
  base: "central" | "generica";
  nombre: string;
  /** Línea bajo el nombre en el header. Vacío = sin línea. */
  lema: string;
  logoUrl?: string;
}

const MarcaContext = createContext<MarcaCliente>({
  base: "central",
  nombre: MARCA_POR_DEFECTO.nombre,
  lema: MARCA_POR_DEFECTO.lema,
});

export function MarcaProvider({ marca, children }: { marca: MarcaCliente; children: ReactNode }) {
  return <MarcaContext.Provider value={marca}>{children}</MarcaContext.Provider>;
}

/** Marca de la tienda en un componente cliente. Sin provider, la de Central. */
export function useMarca(): MarcaCliente {
  return useContext(MarcaContext);
}
