const ADMIN_KEY_STORAGE = "paneldocente_admin_key";

const elements = {
  adminKey: document.getElementById("adminKey"),
  saveKeyBtn: document.getElementById("saveKeyBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  status: document.getElementById("status"),
  totals: document.getElementById("totals"),
  tableBody: document.getElementById("usersTableBody"),
  dialog: document.getElementById("detailDialog"),
  detailJson: document.getElementById("detailJson"),
  closeDialogBtn: document.getElementById("closeDialogBtn")
};

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

function badge(yes) {
  const css = yes ? "ok" : "warn";
  const text = yes ? "Si" : "No";
  return `<span class="badge ${css}">${text}</span>`;
}

function renderUsers(users) {
  elements.tableBody.innerHTML = "";

  if (!users.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7">No hay usuarios para mostrar.</td>`;
    elements.tableBody.appendChild(tr);
    return;
  }

  users.forEach((user) => {
    const tr = document.createElement("tr");

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
      firestoreData: user.firestoreData
    };

    tr.innerHTML = `
      <td>${user.uid}</td>
      <td>${user.email || "-"}</td>
      <td>${user.displayName || "-"}</td>
      <td>${badge(user.emailVerified)}</td>
      <td>${badge(!user.disabled)}</td>
      <td>${formatDate(user.lastSignInTime)}</td>
      <td><button type="button" class="link-btn">Ver JSON</button></td>
    `;

    tr.querySelector(".link-btn").addEventListener("click", () => {
      elements.detailJson.textContent = JSON.stringify(details, null, 2);
      elements.dialog.showModal();
    });

    elements.tableBody.appendChild(tr);
  });
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#a93d2d" : "#4b5a7a";
}

async function loadUsers() {
  setStatus("Consultando Firebase...");
  const adminKey = localStorage.getItem(ADMIN_KEY_STORAGE) || "";

  try {
    const response = await fetch("/api/admin/users", {
      headers: adminKey ? { "x-admin-key": adminKey } : {}
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "Error desconocido");
    }

    renderUsers(payload.users || []);
    elements.totals.textContent = `Total: ${payload.total || 0}`;

    const checked = (payload.collectionsChecked || []).join(", ");
    setStatus(`Usuarios cargados. Colecciones consultadas: ${checked || "(ninguna)"}`);
  } catch (error) {
    renderUsers([]);
    elements.totals.textContent = "Total: 0";
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
  const storedKey = localStorage.getItem(ADMIN_KEY_STORAGE) || "";
  elements.adminKey.value = storedKey;

  elements.saveKeyBtn.addEventListener("click", saveKey);
  elements.reloadBtn.addEventListener("click", loadUsers);
  elements.closeDialogBtn.addEventListener("click", () => elements.dialog.close());

  loadUsers();
}

setup();
