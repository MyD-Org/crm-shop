"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@myd-org/ui";
import { guardarEleccion } from "@/lib/enviar-a";
import { TEXTOS_UBICACION } from "@/lib/ubicacion";

/** "Cambiar": elige ese local como retiro (POST /api/ubicacion) y refresca la ficha. */
export function CambiarRetiro({ sucursal }: { sucursal: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  return (
    <Button
      variant="link"
      size="inline"
      loading={enviando}
      onClick={async () => {
        setEnviando(true);
        const r = await guardarEleccion(fetch, { tipo: "retiro", sucursal });
        setEnviando(false);
        if (r.ok) router.refresh();
      }}
    >
      {TEXTOS_UBICACION.cambiarLocal}
    </Button>
  );
}
