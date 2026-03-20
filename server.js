const fs = require("fs");
const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const admin = require("firebase-admin");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function loadServiceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (error) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT no contiene JSON valido.");
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const resolvedPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`No se encontro el archivo en FIREBASE_SERVICE_ACCOUNT_PATH: ${resolvedPath}`);
    }

    try {
      return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    } catch (error) {
      throw new Error("No se pudo leer/parsear el archivo JSON de FIREBASE_SERVICE_ACCOUNT_PATH.");
    }
  }

  throw new Error(
    "Debes configurar FIREBASE_SERVICE_ACCOUNT (JSON) o FIREBASE_SERVICE_ACCOUNT_PATH (ruta al JSON)."
  );
}

function initializeFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return;
  }

  const serviceAccount = loadServiceAccountFromEnv();
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

initializeFirebaseAdmin();

const auth = admin.auth();
const db = admin.firestore();
const userCollections = (process.env.USER_COLLECTIONS || "users")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

function adminKeyMiddleware(req, res, next) {
  const expectedAdminKey = process.env.ADMIN_PANEL_KEY;
  if (!expectedAdminKey) {
    return next();
  }

  const providedAdminKey = req.header("x-admin-key") || "";
  if (providedAdminKey !== expectedAdminKey) {
    return res.status(401).json({
      error: "No autorizado",
      message: "La clave de administrador es invalida o no fue enviada."
    });
  }

  return next();
}

async function listAllUsers() {
  const users = [];
  let nextPageToken;

  do {
    const result = await auth.listUsers(1000, nextPageToken);
    users.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  return users;
}

async function getFirestoreDataByUid(uid) {
  const records = {};

  await Promise.all(
    userCollections.map(async (collectionName) => {
      try {
        const snap = await db.collection(collectionName).doc(uid).get();
        if (snap.exists) {
          records[collectionName] = snap.data();
        }
      } catch (error) {
        records[collectionName] = {
          _error: `No se pudo leer el documento: ${error.message}`
        };
      }
    })
  );

  return records;
}

app.get("/api/admin/users", adminKeyMiddleware, async (req, res) => {
  try {
    const firebaseUsers = await listAllUsers();

    const users = await Promise.all(
      firebaseUsers.map(async (user) => {
        const firestoreData = await getFirestoreDataByUid(user.uid);

        return {
          uid: user.uid,
          email: user.email || null,
          displayName: user.displayName || null,
          phoneNumber: user.phoneNumber || null,
          disabled: user.disabled,
          emailVerified: user.emailVerified,
          providerIds: (user.providerData || []).map((provider) => provider.providerId),
          creationTime: user.metadata?.creationTime || null,
          lastSignInTime: user.metadata?.lastSignInTime || null,
          customClaims: user.customClaims || {},
          firestoreData
        };
      })
    );

    return res.json({
      total: users.length,
      collectionsChecked: userCollections,
      users
    });
  } catch (error) {
    return res.status(500).json({
      error: "Error consultando Firebase",
      message: error.message
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "admin-panel-docente"
  });
});

app.listen(PORT, () => {
  console.log(`Panel admin disponible en http://localhost:${PORT}/admin.html`);
});
