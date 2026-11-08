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
      // Chrome no dibuja en la consola una imagen de otra URL: va embebida como data URL.
      // Si no se puede leer (CORS, red), sólo el nombre.
      void comoDataUrl(logoUrl).then((logo) =>
        console.log(
          ...argumentosLogoConsola({ logoUrl: logo?.dataUrl ?? null, proporcion: logo?.proporcion, nombre: marca.nombre }),
        ),
      );
    });
  }, [marca]);
  return null;
}

/**
 * La imagen pasa por un canvas y no por `fetch`: la CSP permite los medios en img-src, no en
 * connect-src. `crossOrigin` + CORS del bucket dejan leer el canvas.
 */
function comoDataUrl(url: string | null): Promise<{ dataUrl: string; proporcion: number } | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolver) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const escala = Math.min(1, 480 / (img.naturalWidth || 480));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((img.naturalWidth || 480) * escala));
        canvas.height = Math.max(1, Math.round((img.naturalHeight || 96) * escala));
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolver({ dataUrl: canvas.toDataURL("image/png"), proporcion: canvas.width / canvas.height });
      } catch {
        resolver(null);
      }
    };
    img.onerror = () => resolver(null);
    img.src = url;
  });
}
