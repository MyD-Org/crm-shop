/**
 * Preguntas sugeridas del bloque "¿Dudas sobre este producto?" de la ficha
 * (spec catálogo asistido fase 2, §3). Reglas deterministas, sin IA: salen de
 * la categoría, el nombre y la descripción del producto, con los mismos
 * atributos del catálogo (`atributosDeTexto`: apto exterior, tensión, zócalo,
 * tono). Tocar una la manda al chat tal cual; el contexto de pantalla ya lleva
 * el producto, así que la pregunta no lo nombra.
 *
 * Las preguntas son lo que PREGUNTA el visitante: primera persona y sin
 * pronombres de trato ("¿Sirve para exterior?"), así conviven con el usted del
 * Shop y con el vos del asesor. Módulo puro.
 */
import { atributosDeTexto, normalizarTexto } from "../catalogo-atributos";

/** Cuántas preguntas muestra el bloque. */
export const CANTIDAD_PREGUNTAS = 3;

export const PREGUNTAS = {
  exterior: "¿Sirve para exterior?",
  potencia: "¿Qué potencia necesito para mi espacio?",
  fuenteTira: "¿Qué fuente necesito para esta tira?",
  transformador: "¿Qué transformador necesito?",
  portalamparas: "¿Es compatible con mi portalámparas?",
  tono: "¿Qué tono de luz me conviene?",
  seccionCable: "¿Qué sección de cable necesito?",
  instalacion: "¿Cómo se instala?",
  complementan: "¿Qué productos lo complementan?",
  similares: "¿Qué opciones similares hay?",
} as const;

export interface ProductoParaPreguntas {
  name: string;
  description?: string;
  /** Categoría de Alegra (texto libre, p.ej. "ILUMINACION LED"). */
  category?: string;
}

/** Borde de palabra sobre texto normalizado (minúsculas, sin tildes). */
const palabra = (alternativas: string) => new RegExp(`(^|[^a-z0-9])(${alternativas})([^a-z0-9]|$)`);

/** Algo que da luz: lámparas, artefactos, reflectores, tiras… */
const ILUMINACION = palabra(
  "led|leds|lampara|lamparas|foco|focos|reflector|reflectores|panel|paneles|plafon|plafones|spot|spots|dicroica|dicroicas|aplique|apliques|colgante|colgantes|farola|farolas|artefacto|artefactos|luminaria|luminarias|embutido|embutidos|tubo|tubos|bombilla|bombillas|iluminacion|proyector|proyectores",
);
const TIRA = palabra("tira|tiras|cinta|cintas|manguera|mangueras");
/** Cables y material eléctrico de instalación. */
const ELECTRICO = palabra(
  "cable|cables|llave|llaves|toma|tomas|tomacorriente|tomacorrientes|interruptor|interruptores|disyuntor|disyuntores|termica|termicas|termomagnetica|termomagneticas|zapatilla|zapatillas|prolongador|prolongadores|borne|bornes",
);
/** Ya es una fuente o un transformador: no se le pregunta cuál necesita. */
const FUENTE = palabra("fuente|fuentes|transformador|transformadores|driver|drivers");

/**
 * Tres preguntas, sin repetir, en orden de relevancia: primero las que salen
 * de lo que el producto dice de sí mismo; si no alcanzan, las genéricas
 * ("¿Cómo se instala?", "¿Qué opciones similares hay?"), y al final siempre
 * "¿Qué productos lo complementan?". Siempre `CANTIDAD_PREGUNTAS`.
 */
export function preguntasSugeridas(producto: ProductoParaPreguntas): string[] {
  const texto = normalizarTexto(`${producto.category ?? ""} ${producto.name} ${producto.description ?? ""}`);
  const detectados = atributosDeTexto(`${producto.name} ${producto.description ?? ""}`);
  const atributos = new Set(detectados.map((a) => a.id));
  const grupos = new Set(detectados.map((a) => a.grupo));

  const esFuente = FUENTE.test(texto);
  const esTira = TIRA.test(texto);
  const esElectrico = !esFuente && ELECTRICO.test(texto) && !ILUMINACION.test(texto);
  const esLuz = !esFuente && !esElectrico && (ILUMINACION.test(texto) || esTira || grupos.has("tono") || grupos.has("zocalo"));
  const bajaTension = atributos.has("tension-12v") || atributos.has("tension-24v");

  const candidatas: string[] = [];
  if (atributos.has("apto-exterior")) candidatas.push(PREGUNTAS.exterior);
  if (esTira && !esFuente) candidatas.push(PREGUNTAS.fuenteTira);
  else if (bajaTension && !esFuente) candidatas.push(PREGUNTAS.transformador);
  if (esLuz) candidatas.push(PREGUNTAS.potencia);
  if (grupos.has("zocalo")) candidatas.push(PREGUNTAS.portalamparas);
  if (esLuz && !grupos.has("tono")) candidatas.push(PREGUNTAS.tono);
  if (esElectrico) candidatas.push(PREGUNTAS.seccionCable);

  // "¿Qué productos lo complementan?" siempre entra, última (es la que más
  // vende); antes, hasta dos específicas y, si faltan, las de relleno.
  const resultado = [...new Set(candidatas)].slice(0, CANTIDAD_PREGUNTAS - 1);
  for (const relleno of [PREGUNTAS.instalacion, PREGUNTAS.similares]) {
    if (resultado.length < CANTIDAD_PREGUNTAS - 1) resultado.push(relleno);
  }
  resultado.push(PREGUNTAS.complementan);
  return resultado.slice(0, CANTIDAD_PREGUNTAS);
}
