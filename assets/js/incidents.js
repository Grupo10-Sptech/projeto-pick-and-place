import { requireDashboardRole } from "./auth.js";
import {
  startAlertCountPolling,
  startSystemStatusPolling,
} from "./header-indicators.js";

await requireDashboardRole("analyst");

const incidentsUrl = "./api/incidents";
const incidentReportUrl = "./api/incidents/report";
const factoryMapSize = { width: 800, height: 540 };
const machineLayout = [
  { id: "pick-and-place-01", number: 1, x: 170, y: 145 },
  { id: "pick-and-place-02", number: 2, x: 470, y: 145 },
  { id: "pick-and-place-03", number: 3, x: 170, y: 225 },
  { id: "pick-and-place-04", number: 4, x: 470, y: 225 },
  { id: "pick-and-place-05", number: 5, x: 170, y: 305 },
  { id: "pick-and-place-06", number: 6, x: 470, y: 305 },
  { id: "pick-and-place-07", number: 7, x: 170, y: 385 },
  { id: "pick-and-place-08", number: 8, x: 470, y: 385 },
  { id: "pick-and-place-09", number: 9, x: 170, y: 465 },
  { id: "pick-and-place-10", number: 10, x: 470, y: 465 }
];

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

function formatDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "Data indisponível";
}

function formatIncidentTime(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
}

function getCurrentDay() {
  const [day, month, year] = new Date()
    .toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    })
    .split("/");

  return `${day}/${month}/${year}`;
}

function updatePageTitle(date) {
  document.getElementById("historyPageTitle").textContent =
    `Incidentes em ${date}`;
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

  const machine = document.createElement("span");
  machine.className = "incident-machine";
  machine.textContent = incident.machine_name || incident.machine || "Máquina não identificada";

  const time = document.createElement("span");
  time.className = "incident-time";
  time.textContent = formatIncidentTime(incident.timestamp);

  const value = document.createElement("strong");
  value.className = "incident-value";

  if (type === "vibration") {
    value.textContent = `${formatValue(incident.vibration, 3)} g`;
  } else {
    value.textContent = `${formatValue(incident.temperature, 2)} °C`;
  }

  details.append(machine, time, value);
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
    empty.textContent = "Tudo funcional por aqui.";
    container.appendChild(empty);
    return;
  }

  incidents.forEach((incident) => {
    const highlight = highlightedIncidents.has(incident);
    container.appendChild(createIncidentCard(incident, type, highlight));
  });
}

function renderFactoryMap(incidents) {
  const machineIncidents = new Map(
    machineLayout.map((machine) => [
      machine.id,
      { temperature: false, vibration: false }
    ])
  );

  incidents.forEach((incident) => {
    const status = machineIncidents.get(incident.machine);
    if (!status) return;

    if (isTemperatureIncident(incident.reason)) status.temperature = true;
    if (isVibrationIncident(incident.reason)) status.vibration = true;
  });

  const nodes = document.getElementById("factoryMachineNodes");
  nodes.replaceChildren();

  machineLayout.forEach((machine) => {
    const status = machineIncidents.get(machine.id);
    const machineHasIncident = status.temperature || status.vibration;
    const node = document.createElement("div");
    node.className = "factory-machine-node";
    node.style.left = `${(machine.x / factoryMapSize.width) * 100}%`;
    node.style.top = `${(machine.y / factoryMapSize.height) * 100}%`;
    node.setAttribute("role", "group");
    node.setAttribute(
      "aria-label",
      `Máquina ${machine.number}: sensor de temperatura ` +
        `${status.temperature ? "com incidente" : "normal"}; sensor de vibração ` +
        `${status.vibration ? "com incidente" : "normal"}`
    );

    const temperatureSensor = document.createElement("span");
    temperatureSensor.className =
      "factory-sensor-node temperature" +
      (status.temperature ? " has-incident" : "");
    temperatureSensor.textContent = "T";
    temperatureSensor.setAttribute(
      "aria-label",
      `Temperatura ${status.temperature ? "com incidente" : "normal"}`
    );
    temperatureSensor.title =
      `Temperatura ${status.temperature ? "com incidente" : "normal"}`;

    const machineMarker = document.createElement("span");
    machineMarker.className =
      "factory-machine-symbol" + (machineHasIncident ? " has-incident" : "");
    machineMarker.textContent = `M${machine.number}`;
    machineMarker.setAttribute("aria-hidden", "true");

    const vibrationSensor = document.createElement("span");
    vibrationSensor.className =
      "factory-sensor-node vibration" +
      (status.vibration ? " has-incident" : "");
    vibrationSensor.textContent = "V";
    vibrationSensor.setAttribute(
      "aria-label",
      `Vibração ${status.vibration ? "com incidente" : "normal"}`
    );
    vibrationSensor.title =
      `Vibração ${status.vibration ? "com incidente" : "normal"}`;

    node.append(temperatureSensor, machineMarker, vibrationSensor);

    nodes.append(node);
  });
}

function renderIncidents(incidents, currentDate) {
  updatePageTitle(formatDay(currentDate));
  renderFactoryMap(incidents);

  const sortedIncidents = [...incidents].sort(
    (first, second) =>
      new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime()
  );
  const highlightedIncidents = new Set(
    sortedIncidents.slice(0, 2)
  );

  const vibrationIncidents = sortedIncidents.filter((incident) =>
    isVibrationIncident(incident.reason)
  );

  const temperatureIncidents = sortedIncidents.filter((incident) =>
    isTemperatureIncident(incident.reason)
  );

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

async function downloadMonthlyReport() {
  const button = document.getElementById("downloadIncidentReport");
  const status = document.getElementById("incidentReportMessage");

  button.disabled = true;
  status.textContent = "";
  status.classList.remove("error");

  try {
    const response = await fetch(incidentReportUrl, { cache: "no-store" });
    if (response.status === 401) {
      window.location.replace("/login.html");
      return;
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Não foi possível baixar o relatório.");
    }

    const report = await response.blob();
    const downloadUrl = URL.createObjectURL(report);
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = "incidentes.xlsx";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  } catch (error) {
    console.error("Erro ao baixar o relatório mensal:", error);
    status.classList.add("error");
    status.textContent = error instanceof Error
      ? error.message
      : "Não foi possível baixar o relatório.";
  } finally {
    button.disabled = false;
  }
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

    if (
      !Array.isArray(payload.incidents) ||
      typeof payload.date !== "string"
    ) {
      throw new Error("Formato de histórico inválido.");
    }

    renderIncidents(payload.incidents, payload.date);
  } catch (error) {
    console.error("Erro ao carregar histórico:", error);
  } finally {
    window.setTimeout(loadIncidents, 10000);
  }
}

setupHistoryTheme();
updatePageTitle(getCurrentDay());
document
  .getElementById("downloadIncidentReport")
  .addEventListener("click", downloadMonthlyReport);
startSystemStatusPolling();
startAlertCountPolling();
loadIncidents();
