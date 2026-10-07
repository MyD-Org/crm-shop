# Confusiones a evitar

Palabras que viven en dos familias de producto y lecturas de medidas que parecen correctas y no lo
son. Regla general: **la palabra que acompaña decide**; si no hay ninguna, no se elige por el
cliente (sin categoría dura, sin medida).

## Caso real: "tecla inalámbrica" → cajas moldeadas (PR #468)

"tecla inalambrica" mostraba interruptores de caja moldeada primero. Cadena: `tecla` → sinónimo
`interruptor` → el diccionario proponía, por sustantivo principal, la categoría "Interruptores
termomagnéticos" → las cajas moldeadas sumaban término + categoría y le ganaban a las teclas.
Arreglo: los sustantivos ambiguos (`interruptor`, `llave`) sólo proponen la categoría que empieza
con ellos si están **escritos** en la consulta. La versión amplia (ningún sinónimo propone
categoría) rompía "calefactor para el baño": por eso quedó acotada. Lección: un sinónimo correcto
en una familia arrastra la categoría equivocada si la palabra destino es ambigua.

## Caso real: "luz para el patio" → cámaras y luz de emergencia primero

Sin Jev (la página del catálogo recalcula el plan sin Jev; también el desplegable y los planes que
no se pudieron guardar), "luz para el patio" no tenía ni un término que recuperara (`luz` y `patio`
son contexto, peso 0,3) ni categoría: lo único que recuperaba era el atributo de contexto "apto
exterior" (IP65 o "exterior" en el texto) y traía cualquier producto de intemperie: cámaras bullet,
torreta, cajas estancas, la luz de emergencia IP65. Criterio del rubro: "luz/iluminar/alumbrar +
lugar" pide **luminarias**. Arreglo: con una palabra de luz, un lugar y ninguna palabra de producto
ni sinónimo (`llave de luz`, `luz que se prenda sola` → sensor, `luz de emergencia` quedan afuera),
y sólo sin Jev, el plan suma como blanda la categoría de la luz (la raíz de iluminación) y, en un
lugar de intemperie, la luminaria "exterior". "cámara para el patio" no cambia (su sustantivo lo
resuelve la categoría de cámaras).

## Palabras ambiguas

| Palabra | Familias | Qué decide | Cuidado con |
|---|---|---|---|
| **interruptor** | tecla de luz · termomagnético · diferencial · caja moldeada · de efecto en luminarias | "de luz", "tecla", "pared", "módulo" → tecla; "térmico", "termomagnético", "2x20", "curva", "ka" → protección; "diferencial", "30ma" → diferencial | Sinónimos que DESTINAN a "interruptor" (tecla, llave de luz, perilla) no deben traer protecciones |
| **llave** | llave de luz (tecla) · llave térmica · herramienta (llave de tubo, francesa, combinada, Allen) · llave de paso | "de luz"/"tecla" · "térmica"/amperes · "de tubo"/"francesa"/medida en mm o pulgadas | "llave 10" puede ser 10 A o 10 mm: sin más contexto no hay medida |
| **tubo** | tubo LED (T8) · caño corrugado/rígido · tubo termocontraíble · tubo fluorescente | "led", "t8", "18w", "120 cm" → iluminación; "corrugado", "rígido", "3/4", "20mm" → canalización; "termocontraíble" | "tubo 20mm" es diámetro (`diametro_mm`), no un tubo LED |
| **inalámbrico** | tecla RF (a control remoto) · tecla kinetic (sin pila ni cable) · smart/wifi · timbre inalámbrico · herramienta a batería | "tecla"/"interruptor" → RF/kinetic/wifi; "timbre" → timbre; "taladro"/"atornillador" → batería | No expandir a "batería" ni a "pila" en contexto de teclas |
| **cinta** | tira LED · cinta aisladora · cinta pasacables · cinta métrica | "led", "12v", "5m", "rgb" → tira; "aisladora", "aislante" → aisladora; "pasacable", "guía" → pasacables | Sólo la frase "cinta led" expande a "tira"; "cinta" sola no |
| **módulo** | módulo de tecla (punto, toma) · módulo LED · capacidad de tablero ("12 módulos") | "tecla", "bastidor", "punto", "toma" → tecla; "tablero"/"gabinete" + número → capacidad | "gabinete 12 módulos" no es una tecla ni una medida que se filtre hoy |
| **campana** | campana industrial LED (galpón) · campana de cocina (extractor) | "led", "100w", "galpón", "industrial" → luminaria; "cocina", "vapor", "humo" → extractor | Hoy "vapor"/"humo" → extractor y campana: no sumar "campana" → "extractor" sin contexto |
| **fuente** | fuente/driver para LED · fuente switching de tablero/riel DIN · fuente de PC | "led", "tira", "12v/24v" → driver; "din", "riel" → fuente industrial | El sinónimo fuente ↔ driver está bien para LED; para riel DIN, el dato es tensión de salida |
| **transformador / trafo** | trafo para dicroica 12 V · transformador de control/potencia · driver | "dicroica", "12v", "mr16" → trafo de iluminación; VA/kVA → potencia | La potencia de un trafo es en VA; no confundir con la de la lámpara |
| **regleta** | zapatilla de tomas · listón/regleta para tubo · bornera | "tomas", "enchufes" → zapatilla; "tubo", "18w" → luminaria; "bornes" → bornera | No expandir sin contexto |
| **spot** | embutido (ojo de buey) · cabezal de riel · aplique dirigible | "embutir", "techo", "dicroica" → embutido; "riel" → cabezal | Hoy expande a embut, dicro y cabezal: está bien (todos son "relacionado") |
| **foco** | lámpara (bulbo) · reflector de exterior ("foco LED 50 W") | "e27", "9w", "cálido" → lámpara; potencia ≥ 30 W, "exterior", "ip65", "patio" → reflector | Hoy "foco" → lámpara, bulbo; un "foco 50w exterior" debería ordenar reflectores |
| **ficha** | ficha macho (enchufe) · ficha técnica (PDF) · ficha de conexión | "10a", "20a", "macho", "2p+t" → ficha macho | No confundir con la ficha técnica del producto |
| **toma** | tomacorriente · "toma" verbo ("que toma 220") · toma de aire | Sustantivo + "exterior", "doble", "20a" → tomacorriente | Rara vez es verbo en una búsqueda |
| **unipolar / bipolar** | cable unipolar (un conductor) · protección de 1 o 2 polos | "cable", sección "2,5" → cable; "térmica", amperes → polos | Hoy "unipolar 2,5" (sin la palabra "cable") se lee como **polos = 1** con confianza alta: ver `medidas.md` |
| **taller** | cable tipo taller (TPR) · lugar ("luz para el taller") | "cable" + "taller" → TPR | Hoy "taller" está en `LUGARES` (peso de contexto 0,3): "cable taller" busca sólo "cable" |
| **disyuntor** | en Argentina = diferencial · en otros países = termomagnética | Mercado argentino: diferencial | No "corregirlo" hacia termomagnética |
| **automático** | termomagnética ("el automático") · automático de tanque/bomba · encendido automático (sensor) | "tanque", "bomba", "flotante" → automático de nivel; "luz", "se prenda" → sensor | No expandir a termomagnet sin contexto de tablero |
| **térmico** | relé térmico (motor) · térmica (termomagnética) · "térmico" de un calefactor | "relé", "motor", rango en A → relé térmico | "térmica" (femenino) es la termomagnética de uso común |

## Medidas que no son lo que parecen

| Lectura tentadora | Por qué está mal | Lo correcto |
|---|---|---|
| "guardamotor 5,5 kW" → `potencia_w` = 5500 | Un guardamotor no tiene potencia: protege un motor de esa potencia. Lo que se elige es el **rango de regulación en A** | Ordenar por la potencia como texto o mapear a rango de corriente; nunca filtrar `potencia_w` |
| "contactor 25 A bobina 220 V" → `tension_v` = 220 | Es la tensión de la **bobina** (comando), no la de la carga | La corriente AC-3 es el dato; la bobina es un segundo dato (hoy no hay clave propia) |
| "multímetro 600 V", "pinza 400 A" → `tension_v` / `corriente_a` | Son **rangos de medición** del instrumento, no la tensión ni la corriente del producto | No filtrar instrumentos por esas claves |
| "rack 600x600 P.450" | "P." es **profundidad**; "600x600" es ancho × alto (o ancho × profundidad) en mm, no un panel de 60 cm | Medidas en mm, tres dimensiones; hoy no se lee (sin contexto de panel) |
| "panel 60x60" → 600x600 mm | Correcto para paneles (sin unidad y < 100 = cm) | El parser guarda también la alternativa en mm |
| "tira 14,4 W/m" → `potencia_w` = 14,4 | Es potencia **por metro** (`potencia_w_m`); el rollo de 5 m consume 72 W | El parser borra lo "por metro" antes de leer |
| "2x36W" → `potencia_w` = 36 o 72 | Son dos tubos de 36 W: ambiguo | No leer potencia |
| "110 lm/W" → `flujo_lm` = 110 | Es **eficiencia**, no flujo | El parser la borra |
| "10 kA" → `corriente_a` = 10 | Es **poder de corte** (`poder_corte_ka`) | Se lee primero como kA y se consume |
| "UTP cat 6 4P" → polos = 4 | En telecom "4P" son **4 pares**; "cat 6A" no son amperes | Contexto telecom: sin polos ni corriente |
| "3x2,5" en un cable → polos/corriente | Son **conductores × sección** (mm²) | Sección 2,5; la cantidad de conductores no es clave |
| "2x20" sin contexto | Puede ser térmica, cable, medida de caja… | Sin contexto no se interpreta (queda como texto/código) |
| "lámpara 9" → 9 W | Hipótesis (confianza baja) | No se usa |
| "5050" en una tira | Es el **chip** LED, no flujo ni potencia | No leer |
| "220V" en una lámpara | Casi todo el catálogo es 220 V: no discrimina | Sólo importa cuando hay alternativa (dicroica 12 V vs 220 V, tiras 12/24/220 V) |
| Potencia de un extractor/ventilador | Es la del motor; lo que decide es el **diámetro de boca** o de aspas | Hoy no hay clave para la boca (diametro_mm sólo caños) |
