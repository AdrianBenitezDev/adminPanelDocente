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

const ADMIN_WHITELIST_TAG = "admin_whitelist";
const PAC_REGISTRY_DEFAULT_LIMIT = 5;
const PAC_REGISTRY_MAX_LIMIT = 25;

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
const userCollectionsForDelete = Array.from(new Set([...userCollections, "usuarios", "users"]));

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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function shortText(value, maxLength = 280) {
  return String(value || "").trim().slice(0, Math.max(0, Number(maxLength) || 0));
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
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

function timestampToMillis(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  if (typeof value.toMillis === "function") {
    try {
      return value.toMillis();
    } catch (_error) {
      return null;
    }
  }

  if (typeof value.toDate === "function") {
    const asDate = value.toDate();
    return asDate instanceof Date && !Number.isNaN(asDate.getTime()) ? asDate.getTime() : null;
  }

  if (typeof value.seconds === "number") {
    const asDate = new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000));
    return Number.isNaN(asDate.getTime()) ? null : asDate.getTime();
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value < 2_000_000_000 ? Math.floor(value * 1000) : Math.floor(value);
  }

  if (typeof value === "string") {
    const parsedNumber = Number(value);
    if (Number.isFinite(parsedNumber)) {
      return parsedNumber < 2_000_000_000
        ? Math.floor(parsedNumber * 1000)
        : Math.floor(parsedNumber);
    }
    const parsedDate = Date.parse(value);
    return Number.isFinite(parsedDate) ? parsedDate : null;
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

function readProfileValue(profile, mapKey, fieldKey) {
  if (!profile || typeof profile !== "object") {
    return undefined;
  }
  const mapValue = profile[mapKey];
  if (mapValue && typeof mapValue === "object" && fieldKey in mapValue) {
    return mapValue[fieldKey];
  }
  const dottedKey = `${mapKey}.${fieldKey}`;
  if (dottedKey in profile) {
    return profile[dottedKey];
  }
  return undefined;
}

function profileTenantId(profile) {
  if (!profile || typeof profile !== "object") {
    return "";
  }
  return String(profile.tenantId || "").trim();
}

function profileAccessAppEnabled(profile) {
  return readProfileValue(profile, "access", "appEnabled") === true;
}

function profileBillingStatusRaw(profile) {
  const raw = readProfileValue(profile, "billing", "status");
  return raw === undefined ? null : raw;
}

function profileAccessEnabledAt(profile) {
  return readProfileValue(profile, "access", "enabledAt") || null;
}

function profileOnboardingTenantProvisionedAt(profile) {
  return readProfileValue(profile, "onboarding", "tenantProvisionedAt") || null;
}

function profileWhitelistEnabled(profile) {
  if (!profile || typeof profile !== "object") {
    return false;
  }

  const testingEnabled = readProfileValue(profile, "testing", "adminWhitelistEnabled") === true;
  const billingBypassEnabled = readProfileValue(profile, "billing", "bypassEnabled") === true;
  const billingBypassTag = String(readProfileValue(profile, "billing", "bypassTag") || "").trim().toLowerCase();

  return testingEnabled || (billingBypassEnabled && billingBypassTag === ADMIN_WHITELIST_TAG);
}

function normalizeBillingStatusText(value) {
  if (value === true) return "active";
  if (value === false) return "inactive";
  return normalizeString(value || "");
}

function isBillingStatusActive(rawStatus) {
  const text = normalizeBillingStatusText(rawStatus);
  if (!text) {
    return false;
  }
  return ["active", "activo", "activa", "paid", "pagado", "vigente", "al dia", "current"].some((item) => text.includes(item));
}

function buildTenantId() {
  return `tenant_${db.collection("tenants").doc().id}`;
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

async function getUserProfileByUid(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    return null;
  }
  const snap = await db.collection("usuarios").doc(safeUid).get();
  return snap.exists ? (snap.data() || {}) : null;
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

function sanitizeUserProfileForAdmin(profile) {
  const source = profile && typeof profile === "object" ? profile : null;
  if (!source) {
    return null;
  }

  return {
    correo: shortText(source.correo || "", 180),
    correoAlt: shortText(source.correoAlt || "", 180),
    usuario: shortText(source.usuario || "", 80),
    usuarioKey: shortText(source.usuarioKey || "", 80),
    tenantId: shortText(source.tenantId || "", 160),
    access: source.access && typeof source.access === "object" ? source.access : {},
    billing: source.billing && typeof source.billing === "object" ? source.billing : {},
    testing: source.testing && typeof source.testing === "object" ? source.testing : {},
    onboarding: source.onboarding && typeof source.onboarding === "object" ? source.onboarding : {},
    distrito: shortText(source.distrito || "", 80),
    nivel: shortText(source.nivel || "", 120),
    escuela: shortText(source.escuela || "", 120),
    updatedAt: tryToIsoDate(source.updatedAt),
  };
}

async function buildAdminUser(authUser) {
  const firestoreData = await getFirestoreDataByUid(authUser.uid);
  const profile = await getUserProfileByUid(authUser.uid);

  return {
    uid: authUser.uid,
    email: authUser.email || null,
    displayName: authUser.displayName || null,
    phoneNumber: authUser.phoneNumber || null,
    disabled: authUser.disabled,
    emailVerified: authUser.emailVerified,
    providerIds: (authUser.providerData || []).map((provider) => provider.providerId),
    creationTime: authUser.metadata?.creationTime || null,
    lastSignInTime: authUser.metadata?.lastSignInTime || null,
    customClaims: authUser.customClaims || {},
    payment: extractPaymentInfo(firestoreData),
    firestoreData,
    tenantId: profileTenantId(profile || {}),
    appEnabled: profileAccessAppEnabled(profile || {}),
    whitelistEnabled: profileWhitelistEnabled(profile || {}),
    profileData: sanitizeUserProfileForAdmin(profile),
  };
}

async function getAuthUserOrNull(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    return null;
  }

  try {
    return await auth.getUser(safeUid);
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      return null;
    }
    throw error;
  }
}

async function deleteDocumentWithSubcollections(docRef) {
  const subcollections = await docRef.listCollections();
  for (const subcollectionRef of subcollections) {
    const docsSnap = await subcollectionRef.get();
    for (const docSnap of docsSnap.docs) {
      await deleteDocumentWithSubcollections(docSnap.ref);
    }
  }
  await docRef.delete();
}

async function deleteDocsFromQuery(query, summary, summaryKey) {
  let deleted = 0;
  const snap = await query.get();
  for (const docSnap of snap.docs) {
    await deleteDocumentWithSubcollections(docSnap.ref);
    deleted += 1;
  }
  summary[summaryKey] = (summary[summaryKey] || 0) + deleted;
  return deleted;
}

async function deleteUidDocFromCollection(collectionName, uid, summary) {
  const safeCollection = String(collectionName || "").trim();
  const safeUid = String(uid || "").trim();
  if (!safeCollection || !safeUid) {
    return false;
  }

  const docRef = db.collection(safeCollection).doc(safeUid);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    return false;
  }

  await deleteDocumentWithSubcollections(docRef);
  summary.deletedByUidDoc = (summary.deletedByUidDoc || 0) + 1;
  return true;
}

async function enableOrDisableWhitelist(uid, enabled) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw new Error("uid_requerido");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const userRef = db.collection("usuarios").doc(safeUid);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new Error("user_profile_missing");
    }

    const userData = userSnap.data() || {};
    const existingTenantId = profileTenantId(userData);
    const shouldCreateTenant = enabled && !existingTenantId;
    const tenantId = existingTenantId || (shouldCreateTenant ? buildTenantId() : "");
    const tenantProvisionedAt = profileOnboardingTenantProvisionedAt(userData) || now;
    const accessEnabledAt = profileAccessEnabledAt(userData) || now;
    const billingActive = isBillingStatusActive(profileBillingStatusRaw(userData));
    const keepAccessEnabled = enabled || billingActive;
    const nextAccessReason = keepAccessEnabled
      ? (enabled ? "admin_whitelist" : "active_subscription")
      : "payment_required";

    if (enabled) {
      const tenantRef = db.collection("tenants").doc(tenantId);
      tx.set(
        tenantRef,
        {
          tenantId,
          ownerUid: safeUid,
          ownerEmail: normalizeEmail(userData.correo || ""),
          ownerUsername: shortText(userData.usuarioKey || "", 120) || null,
          distrito: shortText(userData.distrito || "", 120),
          nivel: shortText(userData.nivel || "", 120),
          escuela: shortText(userData.escuela || "", 120),
          planCode: "plan_pro",
          status: "active",
          createdAt: userData?.createdAt || now,
          updatedAt: now,
        },
        { merge: true }
      );

      tx.set(
        tenantRef.collection("configuraciones").doc("pacExtraccion"),
        {
          tenantId,
          processValue: "0",
          gmailQuery: "",
          useCustomSheet: false,
          customSheetUrl: "https://docs.google.com/spreadsheets/d/1UP0FlTWQdHciMe1dbpj2i1dhsQAk4EsxCtq2Bvxlv2U/edit?usp=sharing",
          customSheetName: "POFA",
          startRow: 2,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      tx.set(
        tenantRef.collection("configuraciones").doc("encabezadoPac"),
        {
          tenantId,
          establecimientoReparticion: "",
          anexo: "",
          domicilioEscuela: "",
          telefono: "",
          email: shortText(userData.correo || "", 180),
          categoria: "",
          turno: "",
          desfavorable: "",
          distrito: shortText(userData.distrito || "", 80),
          tipoOrganizacion: shortText(userData.nivel || "", 120),
          escuela: shortText(userData.escuela || "", 120),
          anio: String(new Date().getFullYear()),
          desde: "",
          hasta: "",
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    const updatePayload = {
      access: {
        appEnabled: keepAccessEnabled,
        reason: nextAccessReason,
        enabledAt: keepAccessEnabled ? accessEnabledAt : null,
      },
      billing: {
        bypassEnabled: enabled,
        bypassTag: enabled ? ADMIN_WHITELIST_TAG : null,
        bypassUpdatedAt: now,
      },
      testing: {
        adminWhitelistEnabled: enabled,
        adminWhitelistTag: enabled ? ADMIN_WHITELIST_TAG : null,
        adminWhitelistUpdatedAt: now,
      },
      onboarding: {
        tenantProvisioned: Boolean(tenantId),
        tenantProvisionedAt: tenantId ? tenantProvisionedAt : null,
      },
      updatedAt: now,
    };

    if (enabled) {
      updatePayload.tenantId = tenantId;
      updatePayload.billing = {
        ...updatePayload.billing,
        planCode: shortText(readProfileValue(userData, "billing", "planCode") || "plan_pro", 80) || "plan_pro",
      };
    }

    tx.set(userRef, updatePayload, { merge: true });
  });
}

async function fetchUserPacRegistry(uid, requestedLimit) {
  const safeUid = String(uid || "").trim();
  const rawLimit = Number(requestedLimit);
  const limit = Math.max(
    1,
    Math.min(
      PAC_REGISTRY_MAX_LIMIT,
      Number.isFinite(rawLimit) ? Math.floor(rawLimit) : PAC_REGISTRY_DEFAULT_LIMIT
    )
  );

  const profile = await getUserProfileByUid(safeUid);
  if (!profile) {
    return {
      uid: safeUid,
      tenantId: "",
      items: [],
      totalLoaded: 0,
      reason: "user_profile_missing",
    };
  }

  const tenantId = profileTenantId(profile);
  if (!tenantId) {
    return {
      uid: safeUid,
      tenantId: "",
      items: [],
      totalLoaded: 0,
      reason: "tenant_not_assigned",
    };
  }

  const tenantRef = db.collection("tenants").doc(tenantId);
  const subcollectionRef = tenantRef.collection("datosExtraidos");

  let pacSnap = null;
  try {
    pacSnap = await subcollectionRef.orderBy("createdAt", "desc").limit(limit).get();
  } catch (_error) {
    pacSnap = await subcollectionRef.limit(limit).get();
  }

  const items = pacSnap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const receivedAtMs = timestampToMillis(data.fechaRecepcionMs || data.fechaRecepcion || data.receivedAt);
    const createdAtMs = timestampToMillis(data.createdAt);
    const updatedAtMs = timestampToMillis(data.updatedAt);

    return {
      id: docSnap.id,
      docId: docSnap.id,
      asunto: shortText(data.asunto || data.subject || "", 220),
      origenEmail: normalizeEmail(data.origenEmail || data.from || ""),
      destinoEmail: normalizeEmail(data.destinoEmail || data.to || ""),
      estado: shortText(data.estado || "procesado", 80),
      source: shortText(data.source || "", 80),
      cuerpoResumen: shortText(data.cuerpoResumen || "", 5000),
      rowsCount: Number(data.rowsCount || rows.length || 0),
      rows: rows,
      ingestion: data.ingestion && typeof data.ingestion === "object" ? data.ingestion : {},
      fechaRecepcion: tryToIsoDate(data.fechaRecepcion) || null,
      fechaRecepcionMs: receivedAtMs || 0,
      createdAt: tryToIsoDate(data.createdAt) || null,
      createdAtMs: createdAtMs || 0,
      updatedAt: tryToIsoDate(data.updatedAt) || null,
      updatedAtMs: updatedAtMs || 0,
    };
  });

  items.sort((a, b) => {
    const left = Number(a.fechaRecepcionMs || a.updatedAtMs || a.createdAtMs || 0);
    const right = Number(b.fechaRecepcionMs || b.updatedAtMs || b.createdAtMs || 0);
    if (left !== right) {
      return right - left;
    }
    return String(b.id || "").localeCompare(String(a.id || ""));
  });

  return {
    uid: safeUid,
    tenantId,
    items: items.slice(0, limit),
    totalLoaded: items.length,
    reason: "",
  };
}

async function deleteUserData(uid) {
  const safeUid = String(uid || "").trim();
  const summary = {
    deletedByUidDoc: 0,
    usernamesDeleted: 0,
    billingAttemptsDeleted: 0,
    nestedBillingAttemptsDeleted: 0,
    billingPreapprovalsDeleted: 0,
    billingEventsDeleted: 0,
    unidentifiedEmailsDeleted: 0,
    tenantDeleted: false,
    tenantSkippedShared: false,
    authDeleted: false,
  };

  const profile = await getUserProfileByUid(safeUid);
  const tenantId = profileTenantId(profile || {});

  const usernameCandidates = Array.from(new Set([
    normalizeUsername(profile?.usuarioKey || ""),
    normalizeUsername(profile?.usuario || ""),
  ].filter(Boolean)));

  for (const collectionName of userCollectionsForDelete) {
    await deleteUidDocFromCollection(collectionName, safeUid, summary);
  }

  const userNestedBillingAttemptsSnap = await db.collection("usuarios").doc(safeUid).collection("billingAttempts").get();
  for (const docSnap of userNestedBillingAttemptsSnap.docs) {
    await deleteDocumentWithSubcollections(docSnap.ref);
    summary.nestedBillingAttemptsDeleted += 1;
  }

  for (const usernameKey of usernameCandidates) {
    const usernameRef = db.collection("usernames").doc(usernameKey);
    const usernameSnap = await usernameRef.get();
    if (usernameSnap.exists) {
      await deleteDocumentWithSubcollections(usernameRef);
      summary.usernamesDeleted += 1;
    }
  }

  await deleteDocsFromQuery(
    db.collection("usernames").where("uid", "==", safeUid),
    summary,
    "usernamesDeleted"
  );

  await deleteDocsFromQuery(
    db.collection("billingAttempts").where("uid", "==", safeUid),
    summary,
    "billingAttemptsDeleted"
  );

  await deleteDocsFromQuery(
    db.collection("billingPreapprovals").where("uid", "==", safeUid),
    summary,
    "billingPreapprovalsDeleted"
  );

  await deleteDocsFromQuery(
    db.collection("billingEvents").where("uid", "==", safeUid),
    summary,
    "billingEventsDeleted"
  );

  await deleteDocsFromQuery(
    db.collection("emailsNoIdentificados").where("ingestion.matchedUid", "==", safeUid),
    summary,
    "unidentifiedEmailsDeleted"
  );

  if (tenantId) {
    const tenantUsersSnap = await db.collection("usuarios").where("tenantId", "==", tenantId).get();
    const otherUsers = tenantUsersSnap.docs.filter((docSnap) => docSnap.id !== safeUid);
    if (otherUsers.length > 0) {
      summary.tenantSkippedShared = true;
    } else {
      const tenantRef = db.collection("tenants").doc(tenantId);
      const tenantSnap = await tenantRef.get();
      if (tenantSnap.exists) {
        await deleteDocumentWithSubcollections(tenantRef);
        summary.tenantDeleted = true;
      }
    }
  }

  try {
    await auth.deleteUser(safeUid);
    summary.authDeleted = true;
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
    summary.authDeleted = false;
  }

  const authStillExists = await getAuthUserOrNull(safeUid);
  const profileStillExists = await getUserProfileByUid(safeUid);

  return {
    uid: safeUid,
    summary,
    authStillExists: Boolean(authStillExists),
    profileStillExists: Boolean(profileStillExists),
  };
}

app.get("/api/admin/users", adminKeyMiddleware, async (_req, res) => {
  try {
    const firebaseUsers = await listAllUsers();
    const users = await Promise.all(firebaseUsers.map((user) => buildAdminUser(user)));

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

app.get("/api/admin/users/:uid", adminKeyMiddleware, async (req, res) => {
  const uid = String(req.params?.uid || "").trim();
  if (!uid) {
    return res.status(400).json({
      error: "Solicitud invalida",
      message: "Falta uid de usuario.",
    });
  }

  try {
    const authUser = await getAuthUserOrNull(uid);
    if (!authUser) {
      return res.status(404).json({
        error: "No encontrado",
        message: "El usuario no existe en Authentication.",
      });
    }

    const user = await buildAdminUser(authUser);
    return res.json({
      ok: true,
      user,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Error consultando usuario",
      message: error.message,
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

app.patch("/api/admin/users/:uid/whitelist", adminKeyMiddleware, async (req, res) => {
  const uid = String(req.params?.uid || "").trim();
  const { enabled } = req.body || {};

  if (!uid) {
    return res.status(400).json({
      error: "Solicitud invalida",
      message: "Falta uid de usuario.",
    });
  }

  if (typeof enabled !== "boolean") {
    return res.status(400).json({
      error: "Solicitud invalida",
      message: "El campo 'enabled' debe ser booleano.",
    });
  }

  try {
    await enableOrDisableWhitelist(uid, enabled);
    const authUser = await getAuthUserOrNull(uid);
    const user = authUser ? await buildAdminUser(authUser) : null;

    return res.json({
      ok: true,
      uid,
      enabled,
      message: enabled ? "Usuario agregado a whitelist." : "Usuario quitado de whitelist.",
      user,
    });
  } catch (error) {
    const statusCode = String(error?.message || "") === "user_profile_missing" ? 404 : 500;
    return res.status(statusCode).json({
      error: "No se pudo actualizar whitelist",
      message: statusCode === 404
        ? "No existe perfil en coleccion usuarios para este uid."
        : error.message,
    });
  }
});

app.get("/api/admin/users/:uid/pac-registros", adminKeyMiddleware, async (req, res) => {
  const uid = String(req.params?.uid || "").trim();
  if (!uid) {
    return res.status(400).json({
      error: "Solicitud invalida",
      message: "Falta uid de usuario.",
    });
  }

  try {
    const result = await fetchUserPacRegistry(uid, req.query?.limit);
    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      error: "No se pudo consultar registro PAC",
      message: error.message,
    });
  }
});

app.delete("/api/admin/users/:uid", adminKeyMiddleware, async (req, res) => {
  const uid = String(req.params?.uid || "").trim();
  if (!uid) {
    return res.status(400).json({
      error: "Solicitud invalida",
      message: "Falta uid de usuario.",
    });
  }

  try {
    const result = await deleteUserData(uid);
    return res.json({
      ok: true,
      uid,
      message: "Eliminacion finalizada.",
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      error: "No se pudo eliminar usuario",
      message: error.message,
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
