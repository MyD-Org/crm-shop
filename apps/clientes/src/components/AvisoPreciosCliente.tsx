import { connection } from "next/server";
import { Alert } from "@myd-org/ui";
import { identidadActual } from "@/lib/auth";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { TEXTOS_PRECIOS_CLIENTE, nombreDelCliente } from "@/lib/precios-cliente-textos";

/** Ícono de etiqueta de precio (trazo, hereda el color del aviso). */
function IconoEtiqueta() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0"
    >
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}

/**
 * Aviso fijo "Está viendo sus precios de cliente · {razón social}" debajo del header, en todas las
 * páginas. Hueco por request del layout (dentro de `<Suspense fallback={null}>`): depende de quién
 * pide, nunca se cachea. Sólo con lista online privada (`listaPrivadaDelComprador`, la misma
 * decisión que `/api/precios-cuenta`); sin ella, o si la base no responde, no dibuja nada y la
 * página queda igual que siempre. `identidadActual` y la lista están memorizadas por request.
 */
export async function AvisoPreciosCliente() {
  await connection();
  const datos = await datosDelAviso().catch((err: unknown) => {
    console.error(`[aviso-precios-cliente] ${err instanceof Error ? err.name : "desconocido"}`);
    return null;
  });
  if (!datos) return null;
  return (
    <div className="mx-auto w-full max-w-contenido px-4 pt-3">
      <Alert tone="success">
        <p className="flex items-start gap-2">
          <IconoEtiqueta />
          <span>
            <span className="font-semibold">{TEXTOS_PRECIOS_CLIENTE.aviso}</span>
            {datos.nombre ? <span> · {datos.nombre}</span> : null}
          </span>
        </p>
      </Alert>
    </div>
  );
}

/** Datos del aviso (nombre del cliente para mostrar), o `null` sin lista privada. */
async function datosDelAviso(): Promise<{ nombre: string | null } | null> {
  const listaId = await listaPrivadaDelComprador();
  if (!listaId) return null;
  const { cliente } = await identidadActual();
  return { nombre: nombreDelCliente(cliente?.razonsocial) };
}
