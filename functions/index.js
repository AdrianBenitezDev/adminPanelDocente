const express = require("express");
const admin = require("firebase-admin");
const functions = require("firebase-functions");

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const app = express();
const auth = admin.auth();
const db = admin.firestore();

const userCollections = (process.env.USER_COLLECTIONS || "users")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

function getExpectedAdminKey() {
  const envKey = process.env.ADMIN_PANEL_KEY;
  if (envKey) {
    return envKey;
  }

  try {
    const cfg = functions.config();
    return cfg?.admin?.key || "";
  } catch (_error) {
    return "";
  }
}

function adminKeyMiddleware(req, res, next) {
  const expectedAdminKey = getExpectedAdminKey();

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

app.get("/api/admin/users", adminKeyMiddleware, async (_req, res) => {
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
  res.json({ status: "ok", service: "admin-panel-docente-functions" });
});

exports.api = functions.https.onRequest(app);
