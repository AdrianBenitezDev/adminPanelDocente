# adminPanelDocente

Panel de administrador para listar usuarios de Firebase Authentication y mostrar los datos de Firestore por `uid`.

## Requisitos

- Node.js 18+
- Firebase CLI (`npm i -g firebase-tools`)
- Proyecto Firebase con permisos de Admin SDK

## Instalacion local

```bash
npm install
```

## Configuracion local

1. Copia `.env.example` a `.env`
2. Configura credenciales de Firebase Admin:
   - `FIREBASE_SERVICE_ACCOUNT` con JSON en una linea, o
   - `FIREBASE_SERVICE_ACCOUNT_PATH` apuntando al archivo JSON
3. Opcional: define `ADMIN_PANEL_KEY` para proteger el endpoint
4. Ajusta `USER_COLLECTIONS` con las colecciones donde guardas datos del usuario

## Ejecutar local

```bash
npm start
```

Abre `http://localhost:3000/admin.html`

## Deploy en Firebase (Hosting + Functions)

Este repo ya incluye:

- `firebase.json`
- `.firebaserc` (proyecto por defecto: `horario-escuelas`)
- `functions/index.js` con endpoint `/api/admin/users`

Pasos:

```bash
cd functions
npm install
cd ..
firebase deploy
```

### Clave de admin en deploy (opcional)

Puedes definir la clave del panel en Functions Config:

```bash
firebase functions:config:set admin.key="tu-clave-admin"
```

Luego vuelve a desplegar:

```bash
firebase deploy --only functions,hosting
```

## Endpoint

- `GET /api/admin/users`
  - Lista usuarios de Firebase Auth
  - Busca `doc(uid)` en colecciones de `USER_COLLECTIONS`
  - Devuelve datos combinados

Si configuras `ADMIN_PANEL_KEY` (local) o `admin.key` (functions config), debes enviar:

- `x-admin-key: <tu-clave>`
