const refreshInterval = 10000;

export function updateSystemStatus(isActive) {
  const status = document.getElementById("systemStatus");
  const statusText = document.getElementById("statusText");

  if (!status || !statusText) return;

  status.classList.toggle("offline", !isActive);
  statusText.textContent = isActive ? "Sistema ativo" : "Sistema inativo";
}

export function updateAlertCount(count) {
  const alertCount = document.getElementById("alertCount");
  const alertBell = document.getElementById("alertBell");

  if (!alertCount || !alertBell) return;

  const formattedCount = count.toLocaleString("pt-BR");
  const alertLabel = `${formattedCount} alertas registrados`;
  alertCount.textContent = formattedCount;
  alertBell.setAttribute("aria-label", alertLabel);
  alertBell.setAttribute("title", alertLabel);
  alertBell.classList.toggle("has-alerts", count > 0);
}

function formatIncidentTimestamp(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return { date: "Data indisponível", time: "--:--" };
  }

  return {
    date: date.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    }),
    time: date.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
  };
}

function getIncidentDescription(reason) {
  const descriptions = {
    temperatura: "Temperatura elevada",
    vibracao: "Vibração elevada",
    temperatura_e_vibracao: "Temperatura e vibração elevadas"
  };

  return descriptions[reason] || "Incidente registrado";
}

function initializeAlertPopup() {
  const alertBell = document.getElementById("alertBell");
  const wrapper = alertBell?.parentElement;

  if (!alertBell || !wrapper) return null;

  let popup = wrapper.querySelector(".alert-popup");
  if (popup) return popup;

  alertBell.setAttribute("aria-haspopup", "dialog");
  alertBell.setAttribute("aria-expanded", "false");

  popup = document.createElement("section");
  popup.className = "alert-popup";
  popup.id = "alertPopup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-labelledby", "alertPopupTitle");
  popup.hidden = true;

  const header = document.createElement("div");
  header.className = "alert-popup-header";

  const title = document.createElement("h2");
  title.id = "alertPopupTitle";
  title.textContent = "Incidentes recentes";

  const closeButton = document.createElement("button");
  closeButton.className = "alert-popup-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Fechar incidentes");
  closeButton.textContent = "×";
  header.append(title, closeButton);

  const list = document.createElement("div");
  list.className = "alert-popup-list";
  list.setAttribute("aria-live", "polite");
  list.textContent = "Carregando incidentes...";

  popup.append(header, list);
  wrapper.appendChild(popup);
  alertBell.setAttribute("aria-controls", popup.id);

  function closePopup() {
    popup.hidden = true;
    alertBell.setAttribute("aria-expanded", "false");
  }

  alertBell.addEventListener("click", () => {
    const isOpen = !popup.hidden;
    popup.hidden = isOpen;
    alertBell.setAttribute("aria-expanded", String(!isOpen));
  });
  closeButton.addEventListener("click", closePopup);
  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) closePopup();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popup.hidden) {
      closePopup();
      alertBell.focus();
    }
  });

  return popup;
}

function updateAlertPopup(incidents) {
  const popup = initializeAlertPopup();
  if (!popup) return;

  const list = popup.querySelector(".alert-popup-list");
  list.replaceChildren();

  if (incidents.length === 0) {
    list.textContent = "Nenhum incidente recente.";
    return;
  }

  incidents.forEach((incident) => {
    const item = document.createElement("article");
    item.className = "alert-popup-item";

    const machine = document.createElement("strong");
    machine.textContent = incident.machine_name || "Máquina não identificada";

    const details = document.createElement("span");
    const timestamp = formatIncidentTimestamp(incident.timestamp);
    details.textContent =
      `${getIncidentDescription(incident.reason)} · ${timestamp.date} às ${timestamp.time}`;

    item.append(machine, details);
    list.appendChild(item);
  });
}

export function startSystemStatusPolling() {
  async function pollSystemStatus() {
    try {
      const response = await fetch("/api/system/status", { cache: "no-store" });

      if (response.status === 401) {
        window.location.replace("/login.html");
        return;
      }

      if (!response.ok) {
        throw new Error(`Erro ao consultar o status: ${response.status}`);
      }

      const payload = await response.json();

      if (typeof payload.active !== "boolean") {
        throw new Error("Resposta inválida recebida para o status.");
      }

      updateSystemStatus(payload.active);
    } catch (error) {
      console.error("Erro ao consultar status do sistema:", error);
      updateSystemStatus(false);
    } finally {
      window.setTimeout(pollSystemStatus, refreshInterval);
    }
  }

  pollSystemStatus();
}

export function startAlertCountPolling() {
  initializeAlertPopup();

  async function pollAlertCount() {
    try {
      const response = await fetch("/api/alerts/count", { cache: "no-store" });

      if (response.status === 401) {
        window.location.replace("/login.html");
        return;
      }

      if (!response.ok) {
        throw new Error(`Erro ao consultar alertas: ${response.status}`);
      }

      const payload = await response.json();

      if (
        !Number.isInteger(payload.count) ||
        payload.count < 0 ||
        !Array.isArray(payload.incidents) ||
        !payload.incidents.every((incident) =>
          typeof incident.timestamp === "string" &&
          typeof incident.machine_name === "string" &&
          typeof incident.reason === "string"
        )
      ) {
        throw new Error("Formato de alertas inválido.");
      }

      updateAlertCount(payload.count);
      updateAlertPopup(payload.incidents);
    } catch (error) {
      console.error("Erro ao atualizar contador de alertas:", error);
      const popup = initializeAlertPopup();
      const list = popup?.querySelector(".alert-popup-list");
      if (list) list.textContent = "Não foi possível carregar os incidentes.";
    } finally {
      window.setTimeout(pollAlertCount, refreshInterval);
    }
  }

  pollAlertCount();
}
