import { CIUDADES_ENVIO, MINIMO_ENVIO } from "@/lib/envio";

function IconoEnvio() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function IconoLocal() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l1-5h16l1 5M3 9h18v11H3zM9 20v-6h6v6" />
    </svg>
  );
}

function Fila({ icono, titulo, detalle }: { icono: React.ReactNode; titulo: string; detalle: string }) {
  return (
    <li className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 text-sm">
      <span className="mt-0.5 text-accent">{icono}</span>
      <span>
        <span className="block font-semibold text-text">{titulo}</span>
        <span className="text-muted">{detalle}</span>
      </span>
    </li>
  );
}

/**
 * Cómo se entrega, al lado del botón de compra. Mismas reglas que el checkout
 * (src/lib/envio.ts): el envío propio sólo aparece con el flag `envio`
 * prendido, y el retiro siempre.
 */
export function EntregaProducto({ envio }: { envio: boolean }) {
  return (
    <ul className="space-y-3.5 border-t border-border pt-5">
      {envio && (
        <Fila
          icono={<IconoEnvio />}
          titulo="Envío a domicilio"
          detalle={`Gratis en compras desde $${MINIMO_ENVIO.toLocaleString("es-AR")} sin impuestos a ${CIUDADES_ENVIO.join(" y ")}.`}
        />
      )}
      <Fila
        icono={<IconoLocal />}
        titulo="Retiro en el local"
        detalle="Sin cargo. Si está en otra ciudad, coordinamos el envío con usted."
      />
    </ul>
  );
}
