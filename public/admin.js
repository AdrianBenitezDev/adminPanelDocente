const ADMIN_KEY_STORAGE = "paneldocente_admin_key";

const elements = {
  adminKey: document.getElementById("adminKey"),
  saveKeyBtn: document.getElementById("saveKeyBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  searchInput: document.getElementById("searchInput"),
  paymentFilter: document.getElementById("paymentFilter"),
  userFilter: document.getElementById("userFilter"),
  status: document.getElementById("status"),
  totals: document.getElementById("totals"),
  tableBody: document.getElementById("usersTableBody"),
  dialog: document.getElementById("detailDialog"),
  detailJson: document.getElementById("detailJson"),
  closeDialogBtn: document.getElementById("closeDialogBtn")
};

let usersCache = [];

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("es-AR");
}

function yesNoBadge(yes) {
  const css = yes ? "ok" : "warn";
  const text = yes ? "Si" : "No";
  return `<span class="badge ${css}">${text}</span>`;
}

function userStateBadge(disabled) {
  if (disabled) {
    return '<span class="badge warn">Deshabilitado</span>';
  }

  return '<span class="badge ok">Habilitado</span>';
}

function paymentBadge(payment) {
  const status = payment?.status || "unknown";
  const label = payment?.statusLabel || "Sin datos";
  return `<span class="badge pay-${status}">${label}</span>`;
}

function getAdminKey() {
  return localStorage.getItem(ADMIN_KEY_STORAGE) || "";
}

function buildHeaders(includeJson = false) {
  const headers = {};
  const adminKey = getAdminKey();

  if (adminKey) {
    headers["x-admin-key"] = adminKey;
  }

  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`Respuesta no JSON (${response.status}). Preview: ${preview}`);
  }
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#a93d2d" : "#4b5a7a";
}

function openDetails(user) {
  const details = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    phoneNumber: user.phoneNumber,
    disabled: user.disabled,
    emailVerified: user.emailVerified,
    providerIds: user.providerIds,
    customClaims: user.customClaims,
    creationTime: user.creationTime,
    lastSignInTime: user.lastSignInTime,
    payment: user.payment,
    firestoreData: user.firestoreData
  };

  elements.detailJson.textContent = JSON.stringify(details, null, 2);
  elements.dialog.showModal();
}

function updateUserInCache(uid, patch) {
  usersCache = usersCache.map((user) => {
    if (user.uid !== uid) {
      return user;
    }

    return { ...user, ...patch };
  });
}

async function toggleUserState(user) {
  const nextDisabled = !user.disabled;
  const actionText = nextDisabled ? "deshabilitar" : "habilitar";

  if (!window.confirm(`Confirma ${actionText} al usuario ${user.email || user.displayName || user.uid}?`)) {
    return;
  }

  setStatus(`Actualizando usuario (${actionText})...`);

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(user.uid)}/disabled`, {
      method: "PATCH",
      headers: buildHeaders(true),
      body: JSON.stringify({ disabled: nextDisabled })
    });

    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "No se pudo actualizar el usuario");
    }

    updateUserInCache(user.uid, { disabled: payload.disabled });
    applyFilters();
    setStatus(payload.message || "Usuario actualizado.");
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

function renderUsers(users) {
  elements.tableBody.innerHTML = "";

  if (!users.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8">No hay usuarios para mostrar.</td>`;
    elements.tableBody.appendChild(tr);
    return;
  }

  users.forEach((user) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${user.email || "-"}</td>
      <td>${user.displayName || "-"}</td>
      <td>${userStateBadge(user.disabled)}</td>
      <td>${paymentBadge(user.payment)}</td>
      <td>${formatDate(user.payment?.nextPaymentDate)}</td>
      <td>${formatDate(user.lastSignInTime)}</td>
      <td></td>
      <td></td>
    `;

    const actionsCell = tr.children[6];
    const detailCell = tr.children[7];

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = `action-btn ${user.disabled ? "enable" : "disable"}`;
    toggleBtn.textContent = user.disabled ? "Habilitar" : "Deshabilitar";
    toggleBtn.addEventListener("click", () => toggleUserState(user));

    const detailsBtn = document.createElement("button");
    detailsBtn.type = "button";
    detailsBtn.className = "action-btn details";
    detailsBtn.textContent = "Ver JSON";
    detailsBtn.addEventListener("click", () => openDetails(user));

    actionsCell.appendChild(toggleBtn);
    detailCell.appendChild(detailsBtn);

    elements.tableBody.appendChild(tr);
  });
}

function applyFilters() {
  const searchText = (elements.searchInput.value || "").trim().toLowerCase();
  const paymentFilter = elements.paymentFilter.value;
  const userFilter = elements.userFilter.value;

  const filtered = usersCache.filter((user) => {
    const nameText = `${user.email || ""} ${user.displayName || ""}`.toLowerCase();
    const paymentStatus = user.payment?.status || "unknown";

    if (searchText && !nameText.includes(searchText)) {
      return false;
    }

    if (paymentFilter !== "all" && paymentStatus !== paymentFilter) {
      return false;
    }

    if (userFilter === "enabled" && user.disabled) {
      return false;
    }

    if (userFilter === "disabled" && !user.disabled) {
      return false;
    }

    return true;
  });

  elements.totals.textContent = `Mostrando ${filtered.length} de ${usersCache.length}`;
  renderUsers(filtered);
}

async function loadUsers() {
  setStatus("Consultando Firebase...");

  try {
    const response = await fetch("/api/admin/users", {
      headers: buildHeaders()
    });

    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.message || "Error desconocido");
    }

    usersCache = payload.users || [];
    applyFilters();

    const checked = (payload.collectionsChecked || []).join(", ");
    setStatus(`Usuarios cargados. Colecciones consultadas: ${checked || "(ninguna)"}`);
  } catch (error) {
    usersCache = [];
    applyFilters();
    setStatus(`Error: ${error.message}`, true);
  }
}

function saveKey() {
  const key = elements.adminKey.value.trim();
  if (!key) {
    localStorage.removeItem(ADMIN_KEY_STORAGE);
    setStatus("Clave eliminada. Intentando sin x-admin-key.");
    return;
  }

  localStorage.setItem(ADMIN_KEY_STORAGE, key);
  setStatus("Clave guardada en este navegador.");
}

function setup() {
  const storedKey = getAdminKey();
  elements.adminKey.value = storedKey;

  elements.saveKeyBtn.addEventListener("click", saveKey);
  elements.reloadBtn.addEventListener("click", loadUsers);
  elements.closeDialogBtn.addEventListener("click", () => elements.dialog.close());

  elements.searchInput.addEventListener("input", applyFilters);
  elements.paymentFilter.addEventListener("change", applyFilters);
  elements.userFilter.addEventListener("change", applyFilters);

  loadUsers();
}

setup();
