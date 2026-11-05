import type { Metadata } from "next";
import { Alert, Button } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { confirmarBajaAviso } from "@/lib/aviso-reingreso-baja-accion";
import { BAJA } from "@/lib/aviso-reingreso-textos";

export const metadata: Metadata = {
  title: BAJA.titulo,
  robots: { index: false, follow: false },
};

/** Según cómo lo entregue Next, el segmento puede venir codificado o no; nunca lanza. */
function tokenDeRuta(segmento: string): string {
  try {
    return decodeURIComponent(segmento);
  } catch {
    return segmento;
  }
}

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ estado?: string | string[] }>;
};

/**
 * Baja del aviso de reingreso desde el enlace del mail. Pública y sin sesión. Abrirla (GET) NO da de
 * baja: muestra el botón de confirmación; la baja la hace la server action (POST). El token no se
 * consulta acá, así que la página se ve igual con un enlace válido que con uno inválido.
 */
export default async function BajaAvisoPage({ params, searchParams }: Props) {
  const [{ token }, { estado }] = await Promise.all([params, searchParams]);
  const resultado = Array.isArray(estado) ? estado[0] : estado;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="font-display text-3xl font-medium tracking-tight text-text">{BAJA.titulo}</h1>

      {resultado === "hecho" ? (
        <Alert tone="success" role="status">
          {BAJA.hecho}
        </Alert>
      ) : resultado === "invalido" ? (
        <Alert tone="warning" role="status">
          {BAJA.invalido}
        </Alert>
      ) : (
        <>
          {resultado === "error" ? (
            <Alert tone="danger" role="alert">
              {BAJA.error}
            </Alert>
          ) : null}
          <p className="text-muted">{BAJA.descripcion}</p>
          <form action={confirmarBajaAviso}>
            <input type="hidden" name="token" value={tokenDeRuta(token)} />
            <Button type="submit">{BAJA.boton}</Button>
          </form>
        </>
      )}

      <div>
        <BotonEnlace href="/" variant="secondary">
          {BAJA.volver}
        </BotonEnlace>
      </div>
    </main>
  );
}
