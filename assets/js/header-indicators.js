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

export function startSystemStatusPolling() {
  async function pollSystemStatus() {
    try {
      const response = await fetch("/api/sensors/sample", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Erro ao consultar sensores: ${response.status}`);
      }

      const payload = await response.json();

      if (!Array.isArray(payload.samples) || payload.samples.length === 0) {
        throw new Error("Nenhuma leitura disponível dos sensores.");
      }

      if (
        !Number.isFinite(payload.total_samples) ||
        !payload.samples.every((sample) =>
          Number.isFinite(sample.sequence) &&
          Number.isFinite(sample.temperature) &&
          Number.isFinite(sample.vibration) &&
          Number.isFinite(sample.temperature_threshold) &&
          Number.isFinite(sample.vibration_threshold)
        )
      ) {
        throw new Error("Resposta inválida recebida dos sensores.");
      }

      updateSystemStatus(true);
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
  async function pollAlertCount() {
    try {
      const response = await fetch("/api/incidents", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Erro ao consultar alertas: ${response.status}`);
      }

      const payload = await response.json();

      if (!Array.isArray(payload.incidents)) {
        throw new Error("Formato de alertas inválido.");
      }

      updateAlertCount(payload.incidents.length);
    } catch (error) {
      console.error("Erro ao atualizar contador de alertas:", error);
    } finally {
      window.setTimeout(pollAlertCount, refreshInterval);
    }
  }

  pollAlertCount();
}
