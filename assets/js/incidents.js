import { requireDashboardRole } from "./auth.js";
import {
  startSystemStatusPolling,
  updateAlertCount
} from "./header-indicators.js";

await requireDashboardRole("analyst");

const incidentsUrl = "./api/incidents";

function setupHistoryTheme() {
  const toggle = document.getElementById("themeToggle");
  const savedTheme = localStorage.getItem("pick-and-place-theme");
  const theme = savedTheme === "light" ? "light" : "dark";

  document.documentElement.dataset.theme = theme;

  function updateLabel() {
    const isLight = document.documentElement.dataset.theme === "light";
    const label = isLight ? "Ativar tema escuro" : "Ativar tema claro";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
  }

  updateLabel();

  toggle.addEventListener("click", () => {
    const nextTheme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";

    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("pick-and-place-theme", nextTheme);
    updateLabel();
  });
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : date.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
}

function formatValue(value, decimals) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "--";

  return number.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function createIncidentCard(incident, type, highlight = false) {
  const card = document.createElement("article");
  card.className = `incident-card ${type}-incident`;

  if (highlight) {
    card.classList.add("alert-incident");
  }

  const details = document.createElement("div");
  details.className = "incident-card-details";

  const date = document.createElement("span");
  date.textContent = formatDate(incident.timestamp);

  const value = document.createElement("strong");
  value.className = "incident-value";

  if (type === "vibration") {
    value.textContent = `${formatValue(incident.vibration, 3)} g`;
  } else {
    value.textContent = `${formatValue(incident.temperature, 2)} °C`;
  }

  details.append(date, value);
  card.append(details);

  return card;
}

function isVibrationIncident(reason) {
  return reason === "vibracao" ||
         reason === "temperatura_e_vibracao";
}

function isTemperatureIncident(reason) {
  return reason === "temperatura" ||
         reason === "temperatura_e_vibracao";
}

function renderIncidentList(containerId, countId, incidents, type, highlightedIncidents) {
  const container = document.getElementById(containerId);
  const count = document.getElementById(countId);

  container.replaceChildren();
  count.textContent = incidents.length.toLocaleString("pt-BR");

  if (incidents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "table-message";
    empty.textContent = "Nenhum incidente registrado.";
    container.appendChild(empty);
    return;
  }

  incidents.forEach((incident) => {
    const highlight = highlightedIncidents.has(incident);
    container.appendChild(createIncidentCard(incident, type, highlight));
  });
}

function renderIncidents(incidents) {
  const highlightedIncidents = new Set(
    [...incidents]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 2)
  );

  const vibrationIncidents = incidents.filter((incident) =>
    isVibrationIncident(incident.reason)
  );

  const temperatureIncidents = incidents.filter((incident) =>
    isTemperatureIncident(incident.reason)
  );

  updateSensorReplacement("temperature", temperatureIncidents.length);
  updateSensorReplacement("vibration", vibrationIncidents.length);
  updateAlertCount(incidents.length);

  renderIncidentList(
    "vibrationList",
    "vibrationTotal",
    vibrationIncidents,
    "vibration",
    highlightedIncidents
  );

  renderIncidentList(
    "temperatureList",
    "temperatureTotal",
    temperatureIncidents,
    "temperature",
    highlightedIncidents
  );
}

function updateSensorReplacement(sensor, incidentCount) {
  const replacements = Math.floor(incidentCount / 40);
  const incidentsTowardNextReplacement = incidentCount % 40;

  document.getElementById(`${sensor}SensorReplacements`).textContent =
    replacements.toLocaleString("pt-BR");
  document.getElementById(`${sensor}SensorReplacementProgress`).textContent =
    `${incidentCount.toLocaleString("pt-BR")} incidentes · ` +
    `${incidentsTowardNextReplacement}/40 para próxima troca`;
}

async function loadIncidents() {
  try {
    const response = await fetch(incidentsUrl, { cache: "no-store" });
    if (response.status === 401) {
      window.location.replace("/login.html");
      return;
    }

    if (!response.ok) {
      throw new Error(`Erro ao consultar histórico: ${response.status}`);
    }

    const payload = await response.json();

    if (!Array.isArray(payload.incidents)) {
      throw new Error("Formato de histórico inválido.");
    }

    renderIncidents(payload.incidents);
  } catch (error) {
    console.error("Erro ao carregar histórico:", error);
  } finally {
    window.setTimeout(loadIncidents, 10000);
  }
}

setupHistoryTheme();
startSystemStatusPolling();
loadIncidents();
