export type Locale = 'en' | 'es'

export const locales: readonly Locale[] = ['en', 'es']

export const messages = {
  en: {
    navigation: { home: 'Home', party: 'Party', settings: 'Settings' },
    authentication: {
      email: 'Email',
      code: 'Six-digit code',
      requestCode: 'Send code',
      verifyCode: 'Verify code',
      signOut: 'Sign out',
    },
    party: {
      create: 'Create a Party',
      join: 'Join Party',
      leave: 'Leave Party',
      name: 'Party name',
      nickname: 'Nickname',
      welcome: 'Welcome to {name}',
      member: '{nickname}',
    },
    invite: {
      title: 'Party invite',
      copy: 'Copy invite link',
      expired: 'This invite has expired.',
      full: 'This Party is full.',
    },
    avatar: {
      title: 'Cow avatar',
      choose: 'Choose a photo',
      takePhoto: 'Take a photo',
      crop: 'Adjust crop',
      save: 'Save avatar',
      remove: 'Remove avatar',
    },
    error: {
      generic: 'Something went wrong. Try again.',
      authentication: 'We could not verify that code.',
      sessionRestore: 'We could not restore your session.',
      userLoad: 'We could not load your account.',
    },
    empty: {
      party: 'You are not in a Party yet.',
      members: 'No other members are here yet.',
      avatar: 'Add a photo to create your cow avatar.',
    },
    confirmation: {
      join: 'Join this Party?',
      leave: 'Leave this Party?',
      deleteParty: 'Delete this Party?',
      removeAvatar: 'Remove your avatar?',
    },
    language: { label: 'Language', english: 'English', spanish: 'Spanish' },
    home: { ready: 'Client is ready.' },
  },
  es: {
    navigation: { home: 'Inicio', party: 'Grupo', settings: 'Ajustes' },
    authentication: {
      email: 'Correo electrónico',
      code: 'Código de seis dígitos',
      requestCode: 'Enviar código',
      verifyCode: 'Verificar código',
      signOut: 'Cerrar sesión',
    },
    party: {
      create: 'Crear un grupo',
      join: 'Unirse al grupo',
      leave: 'Salir del grupo',
      name: 'Nombre del grupo',
      nickname: 'Apodo',
      welcome: 'Te damos la bienvenida a {name}',
      member: '{nickname}',
    },
    invite: {
      title: 'Invitación al grupo',
      copy: 'Copiar enlace de invitación',
      expired: 'Esta invitación venció.',
      full: 'Este grupo está lleno.',
    },
    avatar: {
      title: 'Avatar de vaca',
      choose: 'Elegir una foto',
      takePhoto: 'Tomar una foto',
      crop: 'Ajustar recorte',
      save: 'Guardar avatar',
      remove: 'Eliminar avatar',
    },
    error: {
      generic: 'Algo salió mal. Inténtalo de nuevo.',
      authentication: 'No pudimos verificar ese código.',
      sessionRestore: 'No pudimos restaurar tu sesión.',
      userLoad: 'No pudimos cargar tu cuenta.',
    },
    empty: {
      party: 'Aún no perteneces a un grupo.',
      members: 'Aún no hay otros miembros aquí.',
      avatar: 'Agrega una foto para crear tu avatar de vaca.',
    },
    confirmation: {
      join: '¿Unirte a este grupo?',
      leave: '¿Salir de este grupo?',
      deleteParty: '¿Eliminar este grupo?',
      removeAvatar: '¿Eliminar tu avatar?',
    },
    language: { label: 'Idioma', english: 'Inglés', spanish: 'Español' },
    home: { ready: 'El cliente está listo.' },
  },
} as const

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && locales.includes(value as Locale)
