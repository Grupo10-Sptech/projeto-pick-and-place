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

      if (!Number.isInteger(payload.count) || payload.count < 0) {
        throw new Error("Formato de alertas inválido.");
      }

      updateAlertCount(payload.count);
    } catch (error) {
      console.error("Erro ao atualizar contador de alertas:", error);
    } finally {
      window.setTimeout(pollAlertCount, refreshInterval);
    }
  }

  pollAlertCount();
}
