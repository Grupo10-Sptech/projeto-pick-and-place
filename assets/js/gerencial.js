
import { requireDashboardRole } from "./auth.js";
import {
    startAlertCountPolling,
    startSystemStatusPolling
} from "./header-indicators.js";

await requireDashboardRole("management");

const periodFilter = document.getElementById("periodFilter");
const message = document.getElementById("managementMessage");

function formatNumber(value, decimals = 2) {
    if (value === undefined || value === null) return "--";

    return Number(value).toLocaleString("pt-BR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function formatDate(value) {
    if (!value) return "--";

    return new Date(value).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo"
    });
}

function formatDateTime(value) {
    if (!value) return "--";

    return new Date(value).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short"
    });
}

function getReasonLabel(reason) {
    const labels = {
        temperatura: "Temperatura",
        vibracao: "Vibração",
        temperatura_e_vibracao: "Temperatura + vibração"
    };

    return labels[reason] || reason || "Não informado";
}


function renderBars(elementId, data, labelsAreReasons = false) {
    const container = document.getElementById(elementId);
    const entries = Object.entries(data || {});

    if (!entries.length) {
        container.textContent = "Nenhum registro no período.";
        return;
    }

    const maximum = Math.max(
        ...entries.map(([, value]) => Number(value)),
        1
    );

    container.innerHTML = `
        <div style="
            display:flex;
            align-items:flex-end;
            justify-content:space-around;
            gap:16px;
            width:100%;
            height:260px;
            padding:15px 5px 0;
            box-sizing:border-box;
        ">
            ${entries.map(([label, value]) => {
                const height = Math.max(
                    (Number(value) / maximum) * 100,
                    3
                );

                const displayLabel = labelsAreReasons
                    ? getReasonLabel(label)
                    : formatDate(label);

                return `
                    <div style="
                        display:flex;
                        flex-direction:column;
                        align-items:center;
                        justify-content:flex-end;
                        flex:1;
                        min-width:0;
                        height:100%;
                        gap:8px;
                    ">
                        <strong style="
                            color:var(--navy);
                            font-size:13px;
                        ">${value}</strong>

                        <div style="
                            width:100%;
                            max-width:65px;
                            height:${height}%;
                            min-height:4px;
                            background:#3985C6;
                            border-radius:7px 7px 0 0;
                        "></div>

                        <span style="
                            color:var(--gray);
                            font-size:11px;
                            text-align:center;
                            line-height:1.3;
                            overflow-wrap:anywhere;
                        ">${displayLabel}</span>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}


function updateIndicators(data) {
    const incidents = data.incidents || {};
    const primary = incidents.primary_cause;
    const busiest = incidents.most_incident_day;
    const temperature = data.temperature_peak;
    const vibration = data.vibration_peak;

    document.getElementById("totalIncidents").textContent =
        incidents.total ?? 0;

    document.getElementById("primaryCause").textContent =
        primary ? getReasonLabel(primary.reason) : "--";

    document.getElementById("primaryCauseCount").textContent =
        primary ? `${primary.count} ocorrências` : "Sem registros";

    document.getElementById("combinedIncidents").textContent =
        incidents.combined_total ?? 0;

    document.getElementById("busiestDay").textContent =
        busiest ? formatDate(busiest.date) : "--";

    document.getElementById("busiestDayCount").textContent =
        busiest ? `${busiest.count} ocorrências` : "Sem registros";

    document.getElementById("temperaturePeak").textContent =
        temperature ? `${formatNumber(temperature.value)} °C` : "--";

    document.getElementById("temperaturePeakTime").textContent =
        temperature ? formatDateTime(temperature.time) : "Sem registros";

    document.getElementById("vibrationPeak").textContent =
        vibration ? `${formatNumber(vibration.value, 3)} g` : "--";

    document.getElementById("vibrationPeakTime").textContent =
        vibration ? formatDateTime(vibration.time) : "Sem registros";
}

async function loadManagementData() {
    const period = periodFilter.value;

    try {
        const response = await fetch(
            `/api/management?period=${period}`
        );

        if (response.status === 401) {
            window.location.replace("/login.html");
            return;
        }

        if (!response.ok) {
            throw new Error("Falha ao consultar a API.");
        }

        const data = await response.json();

        updateIndicators(data);

        renderBars("dailyIncidents", data.incidents.daily);
        renderBars("incidentReasons", data.incidents.reasons, true);
    
    } catch (error) {
        console.error("Erro no painel gerencial:", error);
        message.textContent = "Não foi possível carregar os indicadores.";
    }
}

function setupManagementTheme() {
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

setupManagementTheme();
startAlertCountPolling();
startSystemStatusPolling();

periodFilter.addEventListener("change", loadManagementData);

loadManagementData();
