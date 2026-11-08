"use client";

import { useEffect } from "react";
import { useMarca } from "@/components/MarcaProvider";
import { fuenteLogo } from "@/lib/marca-base";
import { argumentosLogoConsola } from "@/lib/logo-consola";
import { cuandoOcioso } from "@/lib/tracking/ocioso";
import logoCentral from "@/assets/central-led-logo.svg";

let mostrado = false;

/** Logo de la tienda en la consola del navegador, una vez por carga y sin competir con la página. */
export function LogoConsola() {
  const marca = useMarca();
  useEffect(() => {
    if (mostrado) return;
    const fuente = fuenteLogo(marca);
    const ruta = fuente === "propio" ? marca.logoUrl : fuente === "central" ? logoCentral.src : undefined;
    const logoUrl = ruta ? new URL(ruta, window.location.origin).href : null;
    return cuandoOcioso(() => {
      mostrado = true;
      console.log(...argumentosLogoConsola({ logoUrl, nombre: marca.nombre }));
    });
  }, [marca]);
  return null;
}
