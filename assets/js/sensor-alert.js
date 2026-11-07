const liveSampleUrl = "./api/sensors/sample";
const formatAlertNumber = (value, decimals) =>
  new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);

let lastProcessedSequence = -1;
let temperatureThreshold = 38;
let vibrationThreshold = 1.2;
let conditionActive = false;
let alertPending = false;
let latestAlert;

const alertDialog = document.getElementById("sensorAlert");
const alertTitle = document.getElementById("alertTitle");
const alertMessage = document.getElementById("alertMessage");
const acknowledgeAlert = document.getElementById("acknowledgeAlert");

function renderSensorAlert() {
  if (!alertPending || !latestAlert) return;

  if (!alertDialog.open) alertDialog.showModal();
  alertTitle.textContent = conditionActive
    ? "Alerta: limite de sensor ultrapassado"
    : "Alerta registrado";

  const time = new Date(latestAlert.timestamp).toLocaleTimeString("pt-BR");
  const resolution = conditionActive ? "" : " Condição normalizada.";
  alertMessage.textContent =
    `Temp. ${formatAlertNumber(latestAlert.temperature, 1)} °C ` +
    `(limite ${formatAlertNumber(temperatureThreshold, 1)} °C); ` +
    `vib. ${formatAlertNumber(latestAlert.vibration, 2)} g ` +
    `(limite ${formatAlertNumber(vibrationThreshold, 2)} g), ${time}.` +
    resolution;
}

function processSample(sample) {
  temperatureThreshold = sample.temperature_threshold;
  vibrationThreshold = sample.vibration_threshold;
  const exceedsThreshold =
    sample.temperature > temperatureThreshold ||
    sample.vibration > vibrationThreshold;

  if (exceedsThreshold) {
    if (!conditionActive) {
      alertPending = true;
      latestAlert = { ...sample };
    } else if (latestAlert) {
      latestAlert.temperature = Math.max(latestAlert.temperature, sample.temperature);
      latestAlert.vibration = Math.max(latestAlert.vibration, sample.vibration);
      latestAlert.timestamp = sample.timestamp;
    }
  }

  conditionActive = exceedsThreshold;
  renderSensorAlert();
}

async function pollSensorAlert() {
  try {
    const response = await fetch(liveSampleUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Erro ao coletar leitura: ${response.status}`);
    }

    const payload = await response.json();
    if (
      !Array.isArray(payload.samples) ||
      payload.samples.length === 0 ||
      !payload.samples.every((sample) =>
        Number.isFinite(sample.sequence) &&
        Number.isFinite(sample.temperature) &&
        Number.isFinite(sample.vibration) &&
        Number.isFinite(sample.temperature_threshold) &&
        Number.isFinite(sample.vibration_threshold) &&
        typeof sample.timestamp === "string"
      )
    ) {
      throw new Error("Resposta inválida recebida dos sensores.");
    }

    for (const sample of payload.samples) {
      if (sample.sequence > lastProcessedSequence) {
        processSample(sample);
        lastProcessedSequence = sample.sequence;
      }
    }
  } catch (error) {
    console.error("Erro ao consultar alertas dos sensores:", error);
  } finally {
    window.setTimeout(pollSensorAlert, 10000);
  }
}

acknowledgeAlert.addEventListener("click", () => {
  alertPending = false;
  alertDialog.close();
});

alertDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
});

pollSensorAlert();
