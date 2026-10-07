/**
 * Sinónimos de la búsqueda v2: cómo dice el cliente → cómo lo dice el
 * catálogo. Módulo puro, en código (la iteración "diccionario editable en el
 * admin" lo convierte en datos sin cambiar la forma).
 *
 * Se armó una vez leyendo los nombres reales del catálogo del tenant de prueba
 * (frecuencia de palabras, 2026-09-30) y se revisó a mano. Ejemplos de lo que
 * resuelve: el catálogo dice "lámpara" y casi nunca "foco" (1 producto contra
 * cientos); "proyector" aparece 3 veces y "reflector" 169; "térmica" son los
 * interruptores termomagnéticos; "zapatilla" no aparece y "prolongador" sí.
 *
 * Reglas:
 * - Claves normalizadas (minúsculas, sin tildes) y en SINGULAR: se comparan
 *   contra `raizPlural` del token ("focos" → "foco"). Las de varias palabras
 *   ("llave de luz") se buscan como frase en la consulta normalizada.
 * - Valores: COMIENZOS de palabra del catálogo (se buscan con borde de palabra
 *   a la izquierda), así "termomagnet" cubre termomagnético/a/os.
 * - Una expansión es un término BLANDO con peso menor que el original
 *   (`PESO_EXPANSION`): suma candidatos y ordena, nunca filtra.
 * - Nada de marcas ni de códigos.
 */

/** Peso de un término que sale de un sinónimo (el original pesa 1). */
export const PESO_EXPANSION = 0.7;

export const SINONIMOS: Readonly<Record<string, readonly string[]>> = {
  // Lámparas y luminarias.
  foco: ["lampara", "bulbo"],
  lamparita: ["lampara", "bulbo"],
  bombita: ["lampara", "bulbo"],
  bombilla: ["lampara", "bulbo"],
  "bajo consumo": ["lampara"],
  dicroica: ["dicro"],
  spot: ["embut", "dicro", "cabezal"],
  "ojo de buey": ["embut"],
  plafonier: ["plafon"],
  proyector: ["reflector"],
  reflector: ["proyector"],
  fluorescente: ["tubo"],
  arana: ["colgante"],
  suspension: ["colgante"],
  "lampara de pie": ["velador", "pie"],
  "lampara de mesa": ["velador"],
  "luz de mesa": ["velador"],
  velador: ["lampara de pie", "lampara de mesa"],
  farola: ["farol"],
  poste: ["farol", "columna"],
  "cinta led": ["tira"],
  "manguera led": ["neon", "tira"],
  neon: ["tira"],
  // «Tira de led» se dice «tira» (cinta) y el catálogo también la nombra «neón flex».
  tira: ["neon"],
  guirnalda: ["guirnalda", "luces"],
  navidad: ["guirnalda"],
  portalampara: ["zocalo"],
  boquilla: ["portalampara"],
  zocalo: ["portalampara"],
  // Protecciones.
  termica: ["termomagnet"],
  "llave termica": ["termomagnet"],
  termomagnetica: ["termomagnet"],
  disyuntor: ["diferencial"],
  diferencial: ["disyuntor"],
  "puesta a tierra": ["jabalina", "tierra"],
  // Llaves, tomas y accesorios.
  "llave de luz": ["interruptor", "tecla", "modulo"],
  interruptor: ["tecla", "llave"],
  tecla: ["interruptor"],
  perilla: ["interruptor", "tecla"],
  enchufe: ["toma", "tomacorriente"],
  toma: ["tomacorriente"],
  tomacorriente: ["toma"],
  zapatilla: ["prolongador", "toma"],
  alargue: ["prolongador"],
  alargador: ["prolongador"],
  dimmer: ["regulador", "variador", "atenuador"],
  regulador: ["dimmer", "variador"],
  // Decorativa: lámparas de filamento/vintage y guirnaldas. Sin "deco" como clave ni como valor: es
  // el nombre de una línea de teclas ("Arq & Deco") y arrastraría interruptores.
  decorativa: ["filamento", "vintage", "guirnalda"],
  decorativo: ["filamento", "vintage", "guirnalda"],
  // Domótica y conectividad.
  celular: ["wifi", "smart", "inteligente"],
  celu: ["wifi", "smart", "inteligente"],
  wifi: ["smart", "inteligente"],
  inteligente: ["smart", "wifi"],
  domotica: ["smart", "wifi"],
  // Sensores, control y automatismo.
  sensor: ["deteccion", "movimiento", "fotocel"],
  movimiento: ["sensor", "deteccion"],
  fotocelula: ["fotocel"],
  // "Que se prenda sola": encendido automático (sensor de movimiento o fotocélula).
  "prenda sola": ["sensor", "movimiento", "fotocel"],
  "prenda solo": ["sensor", "movimiento", "fotocel"],
  "prende sola": ["sensor", "movimiento", "fotocel"],
  "encienda sola": ["sensor", "movimiento", "fotocel"],
  "enciende sola": ["sensor", "movimiento", "fotocel"],
  temporizador: ["timer"],
  timer: ["temporizador"],
  transformador: ["trafo"],
  trafo: ["transformador"],
  fuente: ["driver"],
  driver: ["fuente"],
  bornera: ["borne"],
  canaleta: ["cablecanal"],
  cano: ["corrugado", "cablecanal"],
  tablero: ["gabinete", "caja"],
  gabinete: ["caja"],
  cordon: ["cable"],
  // Ventilación y climatización.
  olor: ["extractor"],
  vapor: ["extractor", "campana"],
  humo: ["extractor", "campana"],
  ventilar: ["extractor", "ventilador"],
  calefactor: ["caloventor", "estufa", "calefaccion"],
  estufa: ["calefactor", "caloventor"],
  caloventor: ["calefactor", "estufa"],
  // Seguridad.
  camara: ["camara", "dvr", "nvr"],
  grabador: ["dvr", "nvr"],
  alarma: ["sirena"],
  // Herramientas.
  tester: ["multimetro", "buscapolo"],
  "medir tension": ["multimetro", "tester", "buscapolo"],
  multimetro: ["tester"],
  atornillador: ["destornillador", "taladro"],
  // «Ajustar/apretar un tornillo»: el catálogo dice destornillador o atornillador.
  ajustar: ["destornill", "atornill"],
  ajustador: ["destornill", "atornill"],
  apretar: ["destornill", "atornill"],
  mecha: ["broca"],
  broca: ["mecha"],
  pila: ["bateria"],
  bateria: ["pila"],
  linterna: ["linterna", "farol"],
};

const CLAVES_FRASE = Object.keys(SINONIMOS).filter((k) => k.includes(" "));

/**
 * Expansiones de una consulta normalizada: por cada clave presente (palabra
 * en singular o frase), sus términos del catálogo, sin repetir lo que ya está
 * en la consulta. En el orden de la consulta.
 */
export function expansiones(tokensSingular: readonly string[], consultaNorm: string): string[] {
  const texto = ` ${consultaNorm} `;
  const claves = [
    ...CLAVES_FRASE.filter((k) => texto.includes(` ${k} `)),
    ...tokensSingular.filter((t) => Object.hasOwn(SINONIMOS, t)),
  ];
  const propios = new Set(tokensSingular);
  const salida: string[] = [];
  for (const c of claves) {
    for (const e of SINONIMOS[c]) {
      if (!propios.has(e) && !salida.includes(e)) salida.push(e);
    }
  }
  return salida;
}
