# Staging

`main` es producción. `staging` es una rama fija que Vercel despliega en el entorno **Preview** de
los dos proyectos (admin y Shop). El resto de las ramas no despliega (`git.deploymentEnabled` en
`apps/*/vercel.json`), para no gastar el tope diario del plan.

| | Producción | Staging |
|---|---|---|
| Rama | `main` | `staging` |
| Entorno de Vercel | Production | Preview (variables con rama `staging`) |
| Base | Neon, branch principal | Neon, branch `staging` (copia de prod) |
| Mercado Pago, Payway, Clerk | credenciales reales | credenciales de prueba |
| URL | dominio propio | `*.vercel.app` (Shop con la puerta de usuario y clave; admin con su login) |

Los crons de `apps/admin/vercel.json` corren solo en producción. El `ignoreCommand` nunca saltea `staging`: cada push o Redeploy de staging compila (en `main` sigue salteando la app que no cambió).

## Puesta en marcha (una vez)

1. **Neon:** crear la branch `staging` desde la principal. Copiar su cadena de conexión directa
   (para migrar) y la del pooler (para la app).
2. **Vercel, en cada proyecto:** Settings → Environment Variables → entorno **Preview**, rama
   `staging`. Cargar ahí los valores de staging de las variables de abajo. Las que no cambian
   pueden quedar compartidas con Production.
3. **Vercel, Deployment Protection:** dejar Vercel Authentication **apagado**. Bloquea los
   webhooks (Mercado Pago, Clerk) y las llamadas entre apps. Staging no queda pública: el Shop
   tiene la puerta de `SITE_AUTH_USER`/`SITE_AUTH_PASSWORD` (`proxy.ts`, que deja pasar los
   webhooks) y el admin su login.
4. **Crear la rama:** `git push origin origin/main:refs/heads/staging`.
5. **Webhooks de prueba:** Mercado Pago no necesita nada (cada pago manda la `notification_url`
   del entorno que lo creó). Clerk (instancia de desarrollo): webhook a
   `<URL de staging del Shop>/api/webhooks/clerk` con `user.created`, `user.updated` y
   `user.deleted`; su signing secret va en `CLERK_WEBHOOK_SIGNING_SECRET` (Preview, `staging`).
6. Cuando staging ande, pasar Production a las credenciales reales.

### Variables que cambian en staging

- **Shop (`apps/clientes`):** `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`,
  `MIGRATE_DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `CRM_ADMIN_URL`, `MP_ACCESS_TOKEN`,
  `NEXT_PUBLIC_MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`, `PAYWAY_API_PUBLIC_KEY`,
  `PAYWAY_API_PRIVATE_KEY`, `PAYWAY_BASE_URL` (sandbox), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` y
  `CLERK_SECRET_KEY` (instancia de desarrollo), `CLERK_WEBHOOK_SIGNING_SECRET`,
  `NEXT_PUBLIC_CLERK_PROXY_URL` (vacía en staging), `COOKIE_DOMAIN` (vacía en staging).
- **Admin (`apps/admin`):** `DATABASE_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SHOP_URL`,
  `SHOP_INTERNAL_URL`, `SHOP_REDIRECT_ORIGIN`, `MP_PUBLIC_KEY` (la de prueba), `COOKIE_DOMAIN`
  (vacía en staging), `SENTRY_ENVIRONMENT` y `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (`staging`).
- **Alegra:** si staging usa la misma cuenta que producción, los pedidos de prueba que se facturen
  quedan en la cuenta real. No facturar desde staging salvo que se use una cuenta de prueba.

## Uso diario

- **Probar una rama antes del merge:** traerla a staging con un merge (nunca `push --force`):
  `git switch staging && git merge origin/main && git merge <rama> && git push`.
- **Migraciones:** primero contra la branch `staging` de Neon, se prueba, y recién después contra
  producción (siempre antes de abrir el PR, como hasta ahora).
- **Volver a alinear:** `git switch staging && git merge origin/main && git push`. Si staging
  acumuló ramas descartadas, borrar la rama en GitHub y crearla de nuevo desde `main` (paso 4).
