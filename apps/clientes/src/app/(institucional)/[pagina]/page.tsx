import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaginaLegal } from "@/components/legales/PaginaLegal";
import { getPaginaInstitucional } from "@/lib/institucional/datos";
import { PAGINAS_INSTITUCIONALES } from "@/lib/institucional/paginas";

/**
 * Páginas institucionales (preguntas frecuentes, garantía, envíos y
 * devoluciones, nosotros y contacto). Solo existen los 5 slugs; las rutas
 * estáticas de verdad (/terminos, /privacidad, /envios-y-pagos, /arrepentimiento…)
 * ganan por especificidad. Sin fila publicada para el tenant => 404; un slug
 * desconocido también (con Cache Components `dynamicParams` no se puede usar:
 * `getPaginaInstitucional` devuelve null y la página llama a `notFound()`).
 */
type Props = { params: Promise<{ pagina: string }> };

export function generateStaticParams() {
  return PAGINAS_INSTITUCIONALES.map((p) => ({ pagina: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pagina } = await params;
  const datos = await getPaginaInstitucional(pagina);
  return datos ? { title: datos.titulo } : {};
}

export default async function PaginaInstitucional({ params }: Props) {
  const { pagina } = await params;
  const datos = await getPaginaInstitucional(pagina);
  if (!datos) notFound();
  return <PaginaLegal titulo={datos.titulo} bloques={datos.bloques} />;
}
