import { esES } from "@clerk/localizations";

/**
 * Textos de los componentes de Clerk en el registro del sitio: español formal
 * de usted (ver "Registro de textos de UI" en CLAUDE.md).
 *
 * `esES` ya trata de usted en casi todo, pero mezcla "tú" en algunas cadenas y
 * usa giros peninsulares. Clerk no tiene es-AR, así que se pisan solo las
 * cadenas que se ven en los flujos que usamos — el resto queda en esES.
 *
 * Sin anotación de tipo a propósito: `@clerk/types` está deprecado en Core 3 y
 * no es dependencia directa. El literal infiere solo y `ClerkProvider` lo
 * valida estructuralmente al pasarlo.
 */
export const esAR = {
  ...esES,

  formFieldLabel__emailAddress: "Correo electrónico",
  formFieldInputPlaceholder__emailAddress: "Ingrese su correo electrónico",
  formFieldInputPlaceholder__password: "Ingrese su contraseña",
  formFieldLabel__firstName: "Nombre",
  formFieldLabel__lastName: "Apellido",

  signIn: {
    ...esES.signIn,
    start: {
      ...esES.signIn?.start,
      title: "Ingresar",
      subtitle: "para continuar a {{applicationName}}",
      actionText: "¿No tiene cuenta?",
      actionLink: "Regístrese",
    },
    password: {
      ...esES.signIn?.password,
      actionLink: "Usar otro método",
    },
  },

  signUp: {
    ...esES.signUp,
    start: {
      ...esES.signUp?.start,
      title: "Cree su cuenta",
      subtitle: "para continuar a {{applicationName}}",
      actionText: "¿Ya tiene cuenta?",
      actionLink: "Ingrese",
    },
  },

  userButton: {
    ...esES.userButton,
    action__signOut: "Cerrar sesión",
    action__manageAccount: "Administrar cuenta",
  },
};
