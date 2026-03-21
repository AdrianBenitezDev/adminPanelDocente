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

const STATUS_PATHS = [
  ["subscriptionStatus"],
  ["paymentStatus"],
  ["planStatus"],
  ["estadoPago"],
  ["estadoSuscripcion"],
  ["status"],
  ["subscription", "status"],
  ["suscripcion", "estado"],
  ["suscripcion", "status"],
  ["pago", "estado"],
  ["plan", "status"],
  ["billing", "status"],
  ["subscription", "payment", "status"]
];

const ACTIVE_PATHS = [
  ["isActive"],
  ["active"],
  ["subscriptionActive"],
  ["planActive"],
  ["suscripcion", "activa"],
  ["suscripcion", "isActive"],
  ["billing", "active"],
  ["plan", "active"]
];

const PENDING_PATHS = [
  ["pendingPayment"],
  ["paymentPending"],
  ["isPaymentPending"],
  ["suscripcion", "pendiente"],
  ["billing", "pending"],
  ["payment", "pending"]
];

const NEXT_PAYMENT_PATHS = [
  ["nextPaymentDate"],
  ["paymentDueDate"],
  ["dueDate"],
  ["fechaProximoPago"],
  ["proximoPago"],
  ["subscriptionEndDate"],
  ["subscriptionEndsAt"],
  ["renewalDate"],
  ["vencimiento"],
  ["expiresAt"],
  ["plan", "nextPaymentDate"],
  ["suscripcion", "proximoPago"],
  ["billing", "nextPaymentDate"]
];

const LAST_PAYMENT_PATHS = [
  ["lastPaymentDate"],
  ["lastPaidAt"],
  ["ultimoPago"],
  ["fechaUltimoPago"],
  ["paidAt"],
  ["paymentDate"],
  ["billing", "lastPaymentDate"],
  ["suscripcion", "ultimoPago"]
];

function loadServiceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (_error) {
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
    } catch (_error) {
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getByPath(source, pathParts) {
  let current = source;

  for (const part of pathParts) {
    if (!isPlainObject(current) || !(part in current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "si", "yes", "activo", "active"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "inactivo", "inactive"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function normalizeString(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tryToIsoDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value.toDate === "function") {
    const asDate = value.toDate();
    return asDate instanceof Date && !Number.isNaN(asDate.getTime()) ? asDate.toISOString() : null;
  }

  if (typeof value.seconds === "number") {
    const asDate = new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000));
    return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
  }

  if (typeof value === "number" || typeof value === "string") {
    const asDate = new Date(value);
    return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
  }

  return null;
}

function findFirstRecordValue(records, paths) {
  for (const [collectionName, collectionData] of Object.entries(records)) {
    if (!isPlainObject(collectionData) || "_error" in collectionData) {
      continue;
    }

    for (const pathParts of paths) {
      const value = getByPath(collectionData, pathParts);
      if (value !== undefined && value !== null && value !== "") {
        return { value, collectionName };
      }
    }
  }

  return { value: null, collectionName: null };
}

function mapPaymentStatusLabel(status) {
  const labels = {
    active: "Activo",
    pending: "Pendiente",
    overdue: "Vencido",
    canceled: "Cancelado",
    unknown: "Sin datos"
  };

  return labels[status] || labels.unknown;
}

function resolvePaymentStatus({ rawStatus, activeFlag, pendingFlag, nextPaymentDate }) {
  if (rawStatus !== null && rawStatus !== undefined && rawStatus !== "") {
    if (typeof rawStatus === "boolean") {
      return rawStatus ? "active" : "overdue";
    }

    const text = normalizeString(rawStatus);

    if (["active", "activo", "activa", "pagado", "paid", "vigente", "al dia", "current"].some((k) => text.includes(k))) {
      return "active";
    }

    if (["pending", "pendiente", "due", "por pagar", "awaiting"].some((k) => text.includes(k))) {
      return "pending";
    }

    if (["overdue", "expired", "vencido", "vencida", "mora", "past_due"].some((k) => text.includes(k))) {
      return "overdue";
    }

    if (["cancel", "cancelado", "cancelada", "inactive", "inactivo", "inactiva", "paused"].some((k) => text.includes(k))) {
      return "canceled";
    }
  }

  if (pendingFlag === true) {
    return "pending";
  }

  if (activeFlag === true) {
    return "active";
  }

  if (activeFlag === false) {
    return "canceled";
  }

  if (nextPaymentDate) {
    const nextDate = new Date(nextPaymentDate);
    if (!Number.isNaN(nextDate.getTime()) && nextDate.getTime() < Date.now()) {
      return "overdue";
    }
  }

  return "unknown";
}

function extractPaymentInfo(records) {
  const statusCandidate = findFirstRecordValue(records, STATUS_PATHS);
  const activeCandidate = findFirstRecordValue(records, ACTIVE_PATHS);
  const pendingCandidate = findFirstRecordValue(records, PENDING_PATHS);
  const nextPaymentCandidate = findFirstRecordValue(records, NEXT_PAYMENT_PATHS);
  const lastPaymentCandidate = findFirstRecordValue(records, LAST_PAYMENT_PATHS);

  const nextPaymentDate = tryToIsoDate(nextPaymentCandidate.value);
  const lastPaymentDate = tryToIsoDate(lastPaymentCandidate.value);

  const status = resolvePaymentStatus({
    rawStatus: statusCandidate.value,
    activeFlag: toBoolean(activeCandidate.value),
    pendingFlag: toBoolean(pendingCandidate.value),
    nextPaymentDate
  });

  const sourceCollection =
    statusCandidate.collectionName ||
    nextPaymentCandidate.collectionName ||
    lastPaymentCandidate.collectionName ||
    activeCandidate.collectionName ||
    pendingCandidate.collectionName ||
    null;

  return {
    status,
    statusLabel: mapPaymentStatusLabel(status),
    nextPaymentDate,
    lastPaymentDate,
    sourceCollection
  };
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
          payment: extractPaymentInfo(firestoreData),
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

app.patch("/api/admin/users/:uid/disabled", adminKeyMiddleware, async (req, res) => {
  const { uid } = req.params;
  const { disabled } = req.body || {};

  if (!uid) {
    return res.status(400).json({
      error: "Solicitud invalida",
      message: "Falta uid de usuario."
    });
  }

  if (typeof disabled !== "boolean") {
    return res.status(400).json({
      error: "Solicitud invalida",
      message: "El campo 'disabled' debe ser booleano."
    });
  }

  try {
    const updatedUser = await auth.updateUser(uid, { disabled });
    return res.json({
      uid: updatedUser.uid,
      disabled: updatedUser.disabled,
      message: disabled ? "Usuario deshabilitado" : "Usuario habilitado"
    });
  } catch (error) {
    const statusCode = error.code === "auth/user-not-found" ? 404 : 500;
    return res.status(statusCode).json({
      error: "No se pudo actualizar el usuario",
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
