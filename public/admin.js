const ADMIN_KEY_STORAGE = "paneldocente_admin_key";
const DEFAULT_REGISTRO_LIMIT = 5;

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
  whitelistTotals: document.getElementById("whitelistTotals"),
  whitelistTableBody: document.getElementById("whitelistTableBody"),
  registroUserSelect: document.getElementById("registroUserSelect"),
  loadRegistroBtn: document.getElementById("loadRegistroBtn"),
  registroStatus: document.getElementById("registroStatus"),
  registroTotals: document.getElementById("registroTotals"),
  registroTableBody: document.getElementById("registroTableBody"),
  dialog: document.getElementById("detailDialog"),
  detailJson: document.getElementById("detailJson"),
  closeDialogBtn: document.getElementById("closeDialogBtn"),
  viewButtons: Array.from(document.querySelectorAll(".view-btn")),
  generalView: document.getElementById("generalView"),
  whitelistView: document.getElementById("whitelistView"),
  registroView: document.getElementById("registroView"),
};

let usersCache = [];
let currentView = "general";
let registroItemsCache = [];

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

function whitelistBadge(enabled) {
  if (enabled) {
    return '<span class="badge ok">En whitelist</span>';
  }
  return '<span class="badge pay-unknown">No</span>';
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await parseJsonResponse(response);
  return { response, payload };
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#a93d2d" : "#4b5a7a";
}

function setRegistroStatus(message, isError = false) {
  elements.registroStatus.textContent = message;
  elements.registroStatus.style.color = isError ? "#a93d2d" : "#4b5a7a";
}

function setActiveView(view) {
  currentView = view;

  elements.viewButtons.forEach((button) => {
    const isActive = button.dataset.view === view;
    button.classList.toggle("active", isActive);
  });

  elements.generalView.classList.toggle("hidden", view !== "general");
  elements.whitelistView.classList.toggle("hidden", view !== "whitelist");
  elements.registroView.classList.toggle("hidden", view !== "registro");
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
    tenantId: user.tenantId || "",
    appEnabled: user.appEnabled === true,
    whitelistEnabled: user.whitelistEnabled === true,
    profileData: user.profileData || null,
    firestoreData: user.firestoreData || {},
  };

  elements.detailJson.textContent = JSON.stringify(details, null, 2);
  elements.dialog.showModal();
}

function openRegistroDetails(item) {
  const details = {
    id: item.id || "",
    docId: item.docId || "",
    asunto: item.asunto || "",
    estado: item.estado || "",
    source: item.source || "",
    origenEmail: item.origenEmail || "",
    destinoEmail: item.destinoEmail || "",
    fechaRecepcion: item.fechaRecepcion || null,
    rowsCount: Number(item.rowsCount || 0),
    rows: Array.isArray(item.rows) ? item.rows : [],
    ingestion: item.ingestion && typeof item.ingestion === "object" ? item.ingestion : {},
    cuerpoResumen: item.cuerpoResumen || "",
  };

  elements.detailJson.textContent = JSON.stringify(details, null, 2);
  elements.dialog.showModal();
}

function removeUserFromCache(uid) {
  usersCache = usersCache.filter((user) => user.uid !== uid);
}

function updateUserInCache(uid, patch) {
  usersCache = usersCache.map((user) => {
    if (user.uid !== uid) {
      return user;
    }
    return { ...user, ...patch };
  });
}

function upsertUserInCache(nextUser) {
  const safeUser = nextUser && typeof nextUser === "object" ? nextUser : null;
  if (!safeUser?.uid) {
    return;
  }
  const index = usersCache.findIndex((user) => user.uid === safeUser.uid);
  if (index >= 0) {
    usersCache[index] = safeUser;
    return;
  }
  usersCache.push(safeUser);
}

function createTrashIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm-1 12h12a2 2 0 0 0 2-2V8H4v11a2 2 0 0 0 2 2z"></path>
    </svg>
  `;
}

async function refreshSingleUser(uid) {
  const { response, payload } = await fetchJson(`/api/admin/users/${encodeURIComponent(uid)}`, {
    headers: buildHeaders(),
  });

  if (response.status === 404) {
    removeUserFromCache(uid);
    applyFilters();
    renderWhitelistUsers(usersCache);
    syncRegistroUserOptions();
    return { exists: false, user: null };
  }

  if (!response.ok) {
    throw new Error(payload.message || "No se pudo refrescar el usuario");
  }

  if (payload.user) {
    upsertUserInCache(payload.user);
  }

  applyFilters();
  renderWhitelistUsers(usersCache);
  syncRegistroUserOptions();
  return { exists: true, user: payload.user || null };
}

async function toggleUserState(user) {
  const nextDisabled = !user.disabled;
  const actionText = nextDisabled ? "deshabilitar" : "habilitar";

  if (!window.confirm(`Confirma ${actionText} al usuario ${user.email || user.displayName || user.uid}?`)) {
    return;
  }

  setStatus(`Actualizando usuario (${actionText})...`);

  try {
    const { response, payload } = await fetchJson(`/api/admin/users/${encodeURIComponent(user.uid)}/disabled`, {
      method: "PATCH",
      headers: buildHeaders(true),
      body: JSON.stringify({ disabled: nextDisabled }),
    });

    if (!response.ok) {
      throw new Error(payload.message || "No se pudo actualizar el usuario");
    }

    updateUserInCache(user.uid, { disabled: payload.disabled });
    applyFilters();
    renderWhitelistUsers(usersCache);
    setStatus(payload.message || "Usuario actualizado.");
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

async function deleteUser(user) {
  const displayName = user.email || user.displayName || user.uid;
  const warningText = `Vas a eliminar Authentication + datos de Firestore para ${displayName}. Esta accion no se puede deshacer.`;

  if (!window.confirm(warningText)) {
    return;
  }

  setStatus(`Eliminando usuario ${displayName}...`);

  try {
    const { response, payload } = await fetchJson(`/api/admin/users/${encodeURIComponent(user.uid)}`, {
      method: "DELETE",
      headers: buildHeaders(),
    });

    if (!response.ok) {
      throw new Error(payload.message || "No se pudo eliminar el usuario");
    }

    window.alert(payload.message || "Eliminacion finalizada.");

    const refresh = await refreshSingleUser(user.uid);
    if (!refresh.exists) {
      setStatus(`Usuario ${displayName} eliminado y quitado de la tabla.`);
    } else {
      setStatus(`El usuario ${displayName} todavia existe en Auth. Revisa el detalle y reintenta.`, true);
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

async function toggleWhitelist(user) {
  const nextEnabled = !(user.whitelistEnabled === true);
  const actionText = nextEnabled ? "agregar a" : "quitar de";
  const displayName = user.email || user.displayName || user.uid;

  if (!window.confirm(`Confirma ${actionText} whitelist al usuario ${displayName}?`)) {
    return;
  }

  setStatus(`Actualizando whitelist de ${displayName}...`);

  try {
    const { response, payload } = await fetchJson(`/api/admin/users/${encodeURIComponent(user.uid)}/whitelist`, {
      method: "PATCH",
      headers: buildHeaders(true),
      body: JSON.stringify({ enabled: nextEnabled }),
    });

    if (!response.ok) {
      throw new Error(payload.message || "No se pudo actualizar whitelist");
    }

    if (payload.user) {
      upsertUserInCache(payload.user);
    } else {
      await refreshSingleUser(user.uid);
    }

    applyFilters();
    renderWhitelistUsers(usersCache);
    syncRegistroUserOptions();
    window.alert(payload.message || "Whitelist actualizada.");
    setStatus(payload.message || "Whitelist actualizada.");
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

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "icon-btn";
    deleteBtn.title = "Eliminar usuario y datos";
    deleteBtn.setAttribute("aria-label", "Eliminar usuario y datos");
    deleteBtn.innerHTML = createTrashIconSvg();
    deleteBtn.addEventListener("click", () => deleteUser(user));

    const detailsBtn = document.createElement("button");
    detailsBtn.type = "button";
    detailsBtn.className = "action-btn details";
    detailsBtn.textContent = "Ver JSON";
    detailsBtn.addEventListener("click", () => openDetails(user));

    actionsCell.appendChild(toggleBtn);
    actionsCell.appendChild(deleteBtn);
    actionsCell.style.display = "flex";
    actionsCell.style.gap = "0.4rem";
    detailCell.appendChild(detailsBtn);

    elements.tableBody.appendChild(tr);
  });
}

function renderWhitelistUsers(users) {
  elements.whitelistTableBody.innerHTML = "";

  const sorted = [...users].sort((a, b) => {
    const left = String(a.email || a.displayName || a.uid || "").toLowerCase();
    const right = String(b.email || b.displayName || b.uid || "").toLowerCase();
    return left.localeCompare(right);
  });

  elements.whitelistTotals.textContent = `Mostrando ${sorted.length} de ${usersCache.length}`;

  if (!sorted.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">No hay usuarios para mostrar.</td>`;
    elements.whitelistTableBody.appendChild(tr);
    return;
  }

  sorted.forEach((user) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${user.email || "-"}</td>
      <td>${user.displayName || "-"}</td>
      <td>${user.tenantId || "-"}</td>
      <td>${whitelistBadge(user.whitelistEnabled === true)}</td>
      <td></td>
    `;

    const actionCell = tr.children[4];
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    const shouldAdd = user.whitelistEnabled !== true;
    toggleBtn.className = `action-btn ${shouldAdd ? "whitelist-add" : "whitelist-remove"}`;
    toggleBtn.textContent = shouldAdd ? "Agregar" : "Quitar";
    toggleBtn.addEventListener("click", () => toggleWhitelist(user));
    actionCell.appendChild(toggleBtn);

    elements.whitelistTableBody.appendChild(tr);
  });
}

function renderRegistroRows(items = []) {
  elements.registroTableBody.innerHTML = "";
  const rows = Array.isArray(items) ? items : [];
  registroItemsCache = rows;

  elements.registroTotals.textContent = `Mostrando ${rows.length}`;

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">No hay registros PAC para mostrar.</td>`;
    elements.registroTableBody.appendChild(tr);
    return;
  }

  rows.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(item.fechaRecepcion || item.createdAt)}</td>
      <td>${item.asunto || "-"}</td>
      <td>${item.origenEmail || "-"}</td>
      <td>${Number(item.rowsCount || 0)}</td>
      <td>${item.estado || "-"}</td>
      <td></td>
    `;
    const detailCell = tr.children[5];
    const detailsBtn = document.createElement("button");
    detailsBtn.type = "button";
    detailsBtn.className = "action-btn details";
    detailsBtn.textContent = "Ver JSON";
    detailsBtn.addEventListener("click", () => openRegistroDetails(item));
    detailCell.appendChild(detailsBtn);
    elements.registroTableBody.appendChild(tr);
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

function syncRegistroUserOptions() {
  const currentValue = elements.registroUserSelect.value;
  const sortedUsers = [...usersCache].sort((a, b) => {
    const left = String(a.email || a.displayName || a.uid || "").toLowerCase();
    const right = String(b.email || b.displayName || b.uid || "").toLowerCase();
    return left.localeCompare(right);
  });

  elements.registroUserSelect.innerHTML = '<option value="">Selecciona un usuario</option>';

  sortedUsers.forEach((user) => {
    const option = document.createElement("option");
    option.value = user.uid;
    const email = user.email || "sin-email";
    option.textContent = `${email} (${user.uid})`;
    elements.registroUserSelect.appendChild(option);
  });

  if (currentValue && sortedUsers.some((user) => user.uid === currentValue)) {
    elements.registroUserSelect.value = currentValue;
  } else {
    elements.registroUserSelect.value = "";
  }
}

async function loadRegistroData() {
  const uid = String(elements.registroUserSelect.value || "").trim();
  if (!uid) {
    registroItemsCache = [];
    renderRegistroRows([]);
    setRegistroStatus("Selecciona un usuario para consultar.");
    return;
  }

  setRegistroStatus("Consultando registros PAC...");

  try {
    const { response, payload } = await fetchJson(
      `/api/admin/users/${encodeURIComponent(uid)}/pac-registros?limit=${DEFAULT_REGISTRO_LIMIT}`,
      {
        headers: buildHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(payload.message || "No se pudo consultar el registro PAC");
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    renderRegistroRows(items);

    if (payload.reason === "tenant_not_assigned") {
      setRegistroStatus("El usuario no tiene tenant asignado.");
      return;
    }

    if (payload.reason === "user_profile_missing") {
      setRegistroStatus("El usuario no tiene perfil en coleccion usuarios.");
      return;
    }

    setRegistroStatus(`Consulta completada. Tenant: ${payload.tenantId || "-"}.`);
  } catch (error) {
    renderRegistroRows([]);
    setRegistroStatus(`Error: ${error.message}`, true);
  }
}

async function loadUsers() {
  setStatus("Consultando Firebase...");

  try {
    const { response, payload } = await fetchJson("/api/admin/users", {
      headers: buildHeaders(),
    });

    if (!response.ok) {
      throw new Error(payload.message || "Error desconocido");
    }

    usersCache = Array.isArray(payload.users) ? payload.users : [];
    applyFilters();
    renderWhitelistUsers(usersCache);
    syncRegistroUserOptions();

    const checked = (payload.collectionsChecked || []).join(", ");
    setStatus(`Usuarios cargados. Colecciones consultadas: ${checked || "(ninguna)"}`);
  } catch (error) {
    usersCache = [];
    applyFilters();
    renderWhitelistUsers(usersCache);
    syncRegistroUserOptions();
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
  elements.loadRegistroBtn.addEventListener("click", loadRegistroData);
  elements.registroUserSelect.addEventListener("change", loadRegistroData);

  elements.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextView = button.dataset.view || "general";
      setActiveView(nextView);
    });
  });

  setActiveView(currentView);
  loadUsers();
}

setup();
