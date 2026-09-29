@AGENTS.md

## Registro de textos de UI

Todo texto visible del producto —portal, admin, mails, plantillas de WhatsApp y los mensajes
de error que devuelven las API ({error} que se muestran en pantalla)— va en **español formal
de usted**.

- Imperativos: "Seleccione", "Ingrese", "Inténtelo" (con tilde), "Indique", "Cancele".
- Posesivos y objetos: "su/sus", "le", "usted". Nunca "tu/tus", "te", "vos".
- Sin coloquialismos ("Ojo", "Che", "dale", "probá").
- Botones en infinitivo neutro ("Guardar", "Cerrar", "Descargar") están bien.
- Comentarios de código y documentación interna quedan fuera de esta regla.
- Alcance: aplica a todo texto nuevo o modificado en cualquiera de las dos apps. El copy existente de `apps/clientes` no se reescribe por esta regla hasta que se decida en un cambio propio.

**Excepción: el asistente vendedor del chat del Shop.** Los mensajes que genera el agente
tratan de **vos** (rioplatense), con tono cercano y profesional: sin coloquialismos fuertes
("che", "dale"), sin diminutivos de más ni emojis. Esos mensajes salen del prompt del agente en
ai-api, no del código de este repo. La UI del widget del chat y de sus cards (`chat-ia-textos.ts`)
va en **registro neutro** (infinitivos y frases impersonales: "Agregar al carrito", "Se alcanzó el
límite de mensajes de hoy"), para no mezclar usted y vos en la misma pantalla. El resto del
producto sigue en usted. Decisión: platform ADR 0014 y spec del asistente vendedor v1.
