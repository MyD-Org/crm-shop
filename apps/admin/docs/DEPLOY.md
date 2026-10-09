# Deploy a Vercel

> **Monorepo.** Esta app vive en `apps/admin` del repo `crm-shop`. En el proyecto de Vercel, **Root Directory = `apps/admin`**; Install y Build Command quedan en sus valores por defecto (se ejecutan dentro de esa carpeta). Todos los comandos de este documento se corren parados en `apps/admin`. El Ignored Build Step evita redeploys cuando el cambio no toca esta carpeta. Los workflows programados de esta app están en `.github/workflows/admin-*.yml` de la raíz y usan secrets con prefijo `ADMIN_`. El script `scripts/r2-setup.ts` exige la variable `R2_ALLOWED_ORIGIN`.

Guía para deployar el CRM en Vercel con Postgres en la nube (Neon). El repo ya está
en GitHub (`MyD-Org/crm-shop`); el deploy se hace por la integración GitHub↔Vercel (cada push
a `main` redeploya solo).

> Los **valores secretos** no viven en este doc. Copialos de tu `.env.local` o generá
> nuevos donde se indica.

## 1. Base de datos (Neon)

1. Crear un proyecto en [neon.tech](https://neon.tech) (o usar Vercel → Storage → Postgres,
   que por debajo es Neon). Elegir la región más cercana (ej. `aws-sa-east-1`).
2. Copiar el **connection string pooled** (`postgres://…-pooler.…neon.tech/…?sslmode=require`).
3. Aplicar el schema y el seed contra Neon (desde tu máquina):

   ```bash
   DATABASE_URL="<connection string de Neon>" npm run db:migrate
   DATABASE_URL="<connection string de Neon>" npm run db:seed
   ```

   `db:migrate` incluye la migración `0008` que elimina las columnas de Flexxus.

## 2. Proyecto en Vercel

1. En [vercel.com](https://vercel.com) → **Add New → Project** → importar `MyD-Org/crm-shop`.
2. Framework: Next.js (autodetectado). No cambiar build/output.
3. Cargar las variables de entorno (sección siguiente) en **Production**.
4. Deploy. Los crons de `vercel.json` (`/api/cron/notifications` diario,
   `/api/cron/auto-return-bot` horario) quedan activos automáticamente.

## 3. Variables de entorno (Production)

### Base de datos
| Var | Valor |
|---|---|
| `DATABASE_URL` | Connection string pooled de Neon |

### Secretos — generar nuevos para prod
Los de `.env.local` son placeholders de dev. Generar con `openssl`:
```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -hex 32      # CRON_SECRET
openssl rand -hex 32      # ALEGRA_WEBHOOK_SECRET
```
| Var | Cómo |
|---|---|
| `SESSION_SECRET` | Nuevo (firma sesiones y los `crm_token` del agente) |
| `CRON_SECRET` | Nuevo (protege los endpoints de cron) |
| `ALEGRA_WEBHOOK_SECRET` | Nuevo (deriva el token de las URLs de webhooks de contactos de Alegra; cambiarlo obliga a recrear las suscripciones con `scripts/alegra-webhooks-contactos.ts`) |
| `OTP_SECRET` | Opcional. Clave del HMAC con el que se guardan los códigos de acceso al portal (`portal_otps`). Sin la var se usa `SESSION_SECRET`; cargar una propia permite rotarla aparte (`openssl rand -hex 32`) |

### Secretos — reutilizar los de `.env.local`
`INTERNAL_SECRET` y `STAFF_TOKEN_SECRET` son **compartidos con ai-api**: si los cambiás,
actualizalos también allá.
| Var | Nota |
|---|---|
| `INTERNAL_SECRET` | Compartido con ai-api. **No** dárselo al Shop: también abre `/api/agent/*` |
| `SHOP_CRM_SECRET` | Llave propia Shop↔CRM, mismo valor en el proyecto del Shop. La manda el ping de revalidación al Shop. Sin la var el ping es no-op |
| `STAFF_TOKEN_SECRET` | Compartido con ai-api |
| `SHOP_INTERNAL_URL` | Opcional. Base URL del Shop del mismo entorno (ej. `https://dev.cliente.example`). Al guardar Medios de pago el CRM hace `POST {SHOP_INTERNAL_URL}/api/internal/sucursales/revalidar`; sin la var el ping es no-op y el Shop toma los cambios al vencer su caché. |
| `ANTHROPIC_API_KEY` | Opcional. Lector de fichas técnicas del catálogo (botón "Leer ficha técnica", Claude Haiku). Sin la var el botón queda deshabilitado y la ruta responde 503. |
| `RESEND_API_KEY` | Envío de emails (el `RESEND_FROM` debe ser un dominio verificado en Resend) |
| `RESEND_API_KEY_EMAILS` | Correo compartido (Resend Inboxes, beta): clave propia, distinta de `RESEND_API_KEY`. Solo servidor. Sin ella el módulo de correo responde "no configurado" y no hace requests |
| `RESEND_INBOXES_WEBHOOK_SECRET` | Signing secret del webhook de Resend Inboxes (se carga al registrar el endpoint en Resend). Sin él el webhook falla cerrado |
| `ADMIN_EMAIL` | Login del backoffice |
| `ADMIN_PASSWORD` | Login del backoffice — usar una contraseña fuerte en prod |

### Routing / tenant
| Var | Valor |
|---|---|
| `TENANT_IDS` | `central-led` — **solo fallback de arranque**. La lista real sale de la tabla `tenants` (ver "Alta de una empresa"). Sirve para que el proxy responda si la DB está caída o todavía no existe. |
| `TENANT_OVERRIDE` | `central-led` — **necesario** mientras uses el dominio `*.vercel.app`. El proxy resuelve el tenant por subdominio; sin override, `xxx.vercel.app` no matchea y todo da 404. Al pasar a subdominios reales (`empresa.plataforma.example`) se quita. Es no-op en Production por código (ver `tenantOverride()`). |
| `NEXT_PUBLIC_BASE_URL` | La URL pública del deploy (ej. `https://crm-xxx.vercel.app`) |

#### Alta de una empresa: una URL propia por cliente

El modelo es **un subdominio por empresa** bajo el dominio de la plataforma:
`avantec.plataforma.example`, `otracosa.plataforma.example`. El proxy toma el **primer label del host**
y lo usa como id de tenant, así que el alta es un `INSERT` en `tenants` — **sin tocar env
vars y sin redeploy**. El registro se cachea 60s (`getTenantRegistry` en
`src/lib/tenants.ts`), o sea que la URL nueva responde dentro del minuto.

Requisito único, y por una sola vez: el **dominio wildcard `*.plataforma.example` agregado al
proyecto en Vercel** (Settings → Domains). Con eso, cada cliente nuevo no necesita alta de
dominio ni certificado propio.

- **Dominio propio** (ej. Central Led en `crm.cliente.example`): el primer label ("crm")
  no matchea ningún id, así que hay que declarar el host completo en la columna
  `tenants.domains` (coma-separada) y agregar ese dominio en Vercel. La env var
  `{PREFIX}_DOMAINS` sigue existiendo solo como fallback.
- **`plataforma.example` a secas y `www.`** dan 404 acá a propósito: la landing es otro proyecto
  de Vercel, con su propio dominio.
- **Renombrar el id de un tenant**: `npm run tenant:rename -- <viejo> <nuevo>` (dry-run;
  agregar `--apply` para escribir). `tenant_id` es un FK sin `ON UPDATE CASCADE`, así que
  no alcanza con un `UPDATE` sobre `tenants`.

### Tienda (opcional)
| Var | Valor |
|---|---|
| `SHOP_ENABLED` | `false` (o `true` si el shop está deployado) |
| `NEXT_PUBLIC_SHOP_URL` | URL del shop, solo si `SHOP_ENABLED=true` |

### Mercado Pago (aviso de cuotas, opcional)
| Var | Valor |
|---|---|
| `MP_PUBLIC_KEY` | Clave **pública** (`APP_USR-…`) de la cuenta de Mercado Pago de la tienda. No es un secreto ni un interruptor: sólo permite preguntarle a Mercado Pago si las cuotas sin interés de Medios de pago tienen interés en su cuenta. Sin ella, ese aviso no se muestra y nada más cambia. |

### Tenant `central-led`
| Var | Valor |
|---|---|
| `CENTRAL_LED_NAME` | `Central LED` |
| `CENTRAL_LED_SUBTITLE` | `Materiales Eléctricos e Iluminación` |
| `CENTRAL_LED_LOGO` | `/logos/central-led.svg` |
| `CENTRAL_LED_WHATSAPP` | `5493757000000` |
| `CENTRAL_LED_RESEND_FROM` | `portal@central-led.com` |
| `CENTRAL_LED_MOCK` | `true` → el portal corre con **datos de prueba** hasta tener las credenciales de Alegra de Central LED. Setear `CENTRAL_LED_ALEGRA_EMAIL` + `CENTRAL_LED_ALEGRA_TOKEN` y quitar `MOCK` para datos reales. |
| `CENTRAL_LED_AI_API_URL` | URL de prod de **ai-api** (el chat requiere ai-api deployado; si no lo está, dejá el flag `ai-chat-enabled` en off) |
| `CENTRAL_LED_AI_API_KEY` | De `.env.local` |
| `CENTRAL_LED_AI_AGENT_ID` | De `.env.local` |
| `CENTRAL_LED_AI_TENANT_ID` | De `.env.local` |

### Necesaria en BUILD (no en runtime)
- `GITHUB_TOKEN` — el `.npmrc` la usa para bajar `@myd-org/ui` de GitHub Packages
  (`npm.pkg.github.com`). Sin ella el build falla con `401 Unauthorized`. Usar un token
  **classic con solo el scope `read:packages`** (no un PAT amplio). No se usa en runtime.

- La CSP (ver "CSP" al final) se arma en build a partir de `NEXT_PUBLIC_SENTRY_DSN`,
  `R2_SHOP_MEDIA_PUBLIC_URL` y `CSP_REPORT_URI` (opcional): cambiarlas requiere redeploy.

### NO cargar en prod
- `AI_CHAT_ENABLED` — flag de dev; en prod el chat se controla con Vercel Flags (`ai-chat-enabled`).

> Nota: `@myd-org/ai-widget` está vendorizado en `vendor/` y referenciado con path relativo,
> así que no requiere registry ni token.

## 4. Checklist post-deploy
- [ ] Migraciones + seed corridos contra Neon.
- [ ] El portal abre sin 404 (con `TENANT_OVERRIDE=central-led`).
- [ ] Login del backoffice (`/admin`) con `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- [ ] Si se usa email: dominio de `RESEND_FROM` verificado en Resend.
- [ ] Si se usa el chat: `ai-api` deployado y `ai-chat-enabled` activo.

## 5. Comprobantes de pago (storage en R2)

La feature de comprobantes de pago guarda los archivos en un bucket **R2** (Cloudflare),
fuera de la DB. Checklist para prenderla y mantenerla en prod:

### Variables de entorno (Production **y** Preview)
| Var | Nota |
|---|---|
| `R2_ACCOUNT_ID` | Id de la cuenta Cloudflare |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Token de API **scopeado al bucket** (Object Read & Write sobre el bucket del portal, sin tocar otros buckets) |
| `R2_BUCKET` | Nombre del bucket |
| `RECEIPTS_EMAIL_FROM` | Remitente del aviso (dominio verificado en Resend) |

Cargarlas en **Production y en Preview** y redeployar: sin el set completo la feature se
apaga sola (el botón no aparece y las rutas nuevas responden 503), así que cargarlas antes
del merge no rompe nada.

### Bucket (Cloudflare R2)
- **CORS**: `AllowedMethods: ["PUT"]`, `AllowedHeaders: ["content-type"]`,
  `AllowedOrigins` con la lista explícita de orígenes del portal — **sin `*` ni comodines**.
  Cada alta de empresa con dominio propio (u origen nuevo) ⇒ agregarlo acá. Para el preview
  temporal de un PR, agregar el origen exacto del preview y **sacarlo al mergear**.
- **Lifecycle rule**: prefijo `tmp/` → borrado a 1 día (el confirm borra el tmp al
  publicar; esto cubre los abandonados). Nada sobre `receipts/`.
- Los objetos son privados: se leen con URLs firmadas (PUT 10 min al informar, GET 5 min
  para ver/descargar en el admin).

### Orden de la entrega (IMPORTANTE)
1. **Antes de mergear**: aplicar la migración `drizzle/0023_payment_receipts.sql` en prod
   a mano (`DATABASE_URL=… npm run db:migrate`). Es aditiva y el código viejo no la lee,
   pero el código nuevo sí necesita `tenants.receipts_email` (sin la columna, se cae el
   portal y el backoffice de todos los tenants). Verificar el hash en `__drizzle_migrations`.
2. Mergear → la integración GitHub↔Vercel redeploya sola (las env vars ya están cargadas).
3. **Después del merge**: cargar el mail destino en Configuración → Comprobantes de cada tenant.

### Rollback
- **Código**: revertir el PR. La migración `0023` **no se revierte** (es aditiva; el
  código viejo no la toca).
- **Apagar la feature sin revertir**: quitar las env vars `R2_*` y redeployar — el portal
  deja de mostrar el botón y las rutas responden 503; el resto no cambia.

## Cuotas sin interés por lista (reemplaza a cuotas por proveedor v2)

Las cuotas salen de las condiciones (medio de pago + N cuotas) enlazadas a una lista de precios online:
cuota = precio de esa lista / N, sin recargo. Se configuran en Pagos y cuotas → Medios de pago →
Editar (medio con cobro en línea). Se retiraron los escalones, los proveedores, la card de tasas de
Mercado Pago, el endpoint `/api/internal/shop/cuotas` y su contrato v2. Las tablas viejas
(`payment_methods`, `installment_options`, `payment_config_versions`) quedan sin uso y sin borrar.
El Shop cobra en cuotas sólo con el flag `cuotas-cobro` (Vercel Flags, apagado por defecto).

## CSP

Todas las respuestas llevan una **Content-Security-Policy en modo Report-Only**
(`Content-Security-Policy-Report-Only`, armada en `src/lib/headers-seguridad.ts`): el navegador
informa lo que bloquearía pero **no bloquea nada**. Los orígenes que admite salen de variables
(Sentry, fotos del catálogo) y del inventario documentado en ese archivo; las páginas de
`/admin/correo` admiten además `img-src https:` (los mensajes traen imágenes de cualquier host).

Para pasarla a enforcing:

1. Opcional: cargar `CSP_REPORT_URI` (endpoint que reciba los reportes) y redeployar; si no, los
   reportes se ven sólo en la consola del navegador.
2. Con el deploy en Preview (`staging`), recorrer con la consola abierta: login del backoffice,
   **inbox** con una conversación con audio/imagen/documento, **correo** abriendo un mensaje con
   imágenes remotas y pulsando "Mostrar imágenes", **catálogo** con fotos y subida de una foto y de
   una imagen de categoría, **comprobantes** (imagen y PDF, "Abrir en pestaña nueva"), **portal**
   con un PDF de factura y el **chat** del portal, y aceptar las notificaciones push.
3. Cada línea `[Report Only] Refused to load…` es un origen que falta: sumarlo en
   `politicaCsp` (por variable si depende del entorno, nunca un host de prod literal), con su
   test en `headers-seguridad.test.ts`, y repetir el recorrido hasta que la consola quede limpia.
4. Renombrar el header a `Content-Security-Policy` en `headersDeSeguridad` (y ajustar el test que
   exige Report-Only), mergear a `staging`, repetir el recorrido en Preview y promover a `main`.

Rollback: volver el header a `Content-Security-Policy-Report-Only` y redeployar.
