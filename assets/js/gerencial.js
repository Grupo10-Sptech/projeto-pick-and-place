
import { requireDashboardRole } from "./auth.js";
import {
    startAlertCountPolling,
    startSystemStatusPolling
} from "./header-indicators.js";

await requireDashboardRole("management");

const periodFilter = document.getElementById("periodFilter");
const message = document.getElementById("managementMessage");
const maintenanceHoursPerIncident = 0.5;
const maxMaintenanceHoursPerDay = 24;
const downtimeCostPerIncident = 150;

function formatDate(value) {
    if (!value) return "--";

    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
        return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
    }

    return new Date(value).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo"
    });
}

function formatShortDate(value) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}`;
}

function formatCurrency(value, fractionDigits = 0) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
    }).format(value);
}

function escapeXml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function getChartBuckets(incidents) {
    const combinedDaily = incidents.combined_daily || {};
    const plannedDaily = incidents.planned_hours_daily || {};
    const dates = Object.keys(plannedDaily).sort();
    const bucketSize = 1;
    const buckets = [];

    for (let index = 0; index < dates.length; index += bucketSize) {
        const bucketDates = dates.slice(index, index + bucketSize);
        const firstDate = bucketDates[0];
        const lastDate = bucketDates[bucketDates.length - 1];
        const label = firstDate === lastDate
            ? formatShortDate(firstDate)
            : `${formatShortDate(firstDate)}–${formatShortDate(lastDate)}`;

        buckets.push({
            label,
            startDate: firstDate,
            endDate: lastDate,
            combinedIncidents: bucketDates.reduce(
                (total, date) => total + Number(combinedDaily[date] || 0),
                0
            ),
            hasDailyRecurrence: Number(combinedDaily[firstDate] || 0) >= 2,
            plannedHours: bucketDates.reduce(
                (total, date) => total + Number(plannedDaily[date] || 0),
                0
            )
        });
    }

    return buckets;
}

function formatAxisValue(value, kind) {
    if (kind === "currency") {
        return value >= 1000
            ? `R$${Math.round(value / 1000)}k`
            : `R$${Math.round(value)}`;
    }

    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getNiceMaximum(value, step) {
    return Math.max(step, Math.ceil(value / step) * step);
}

function renderManagementChart(containerId, buckets, chartType) {
    const container = document.getElementById(containerId);

    if (!buckets.length) {
        container.textContent = "Nenhum dado disponível no período.";
        return;
    }

    const width = 960;
    const chartHeight = container.clientHeight || 360;
    const height = Math.max(300, Math.round(chartHeight));
    const left = 24;
    const right = 62;
    const top = 24;
    const bottom = 54;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const slotWidth = plotWidth / buckets.length;
    const barWidth = Math.min(48, slotWidth * 0.82);
    const maxCount = Math.max(...buckets.map((bucket) => bucket.combinedIncidents), 1);
    const values = chartType === "production"
        ? buckets.map((bucket) => {
            const downtimeHours = Math.min(
                bucket.combinedIncidents * maintenanceHoursPerIncident,
                maxMaintenanceHoursPerDay
            );

            return {
                ...bucket,
                downtimeHours,
                productiveHours: Math.max(
                    bucket.plannedHours - downtimeHours,
                    0
                )
            };
        })
        : buckets.map((bucket) => ({
            ...bucket,
            intervalCost: bucket.combinedIncidents * downtimeCostPerIncident
        }));

    let primaryMaximum;
    let secondaryMaximum;
    let secondaryKind;

    if (chartType === "production") {
        primaryMaximum = getNiceMaximum(
            Math.max(...values.map((bucket) =>
                Math.max(bucket.plannedHours, bucket.productiveHours + bucket.downtimeHours)
            )),
            5
        );
        secondaryMaximum = getNiceMaximum(maxCount, 1);
        secondaryKind = "count";
    } else {
        let cumulativeCost = 0;
        values.forEach((bucket) => {
            cumulativeCost += bucket.intervalCost;
            bucket.cumulativeCost = cumulativeCost;
        });
        primaryMaximum = getNiceMaximum(cumulativeCost, 150);
        secondaryMaximum = primaryMaximum;
        secondaryKind = "currency";
    }

    const yFor = (value, maximum) => top + plotHeight - (value / maximum) * plotHeight;
    const xFor = (index) => left + slotWidth * (index + 0.5);
    const grid = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const y = top + plotHeight * ratio;
        const secondaryValue = secondaryMaximum * (1 - ratio);
        return `
            <line class="management-chart-gridline" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line>
            <text class="management-chart-axis-label" x="${width - right + 10}" y="${y + 4}" text-anchor="start">${formatAxisValue(secondaryValue, secondaryKind)}</text>
        `;
    }).join("");

    let bars = "";
    let barValueLabels = "";
    let primaryLine = "";
    const linePoints = [];

    values.forEach((bucket, index) => {
        const centerX = xFor(index);
        const barX = centerX - barWidth / 2;
        const titleDates = bucket.startDate === bucket.endDate
            ? bucket.startDate
            : `${bucket.startDate} – ${bucket.endDate}`;

        if (chartType === "production") {
            const baselineY = yFor(0, primaryMaximum);
            const downtimeHeight = (bucket.downtimeHours / primaryMaximum) * plotHeight;
            const downtimeY = baselineY - downtimeHeight;
            const incidentY = yFor(bucket.combinedIncidents, secondaryMaximum);

            bars += `
                <g>
                  <title>${escapeXml(`${titleDates}: ${bucket.downtimeHours.toFixed(1)} horas de manutenção estimada; incidentes combinados: ${bucket.combinedIncidents}`)}</title>
                  <rect class="management-chart-bar downtime" x="${barX}" y="${downtimeY}" width="${barWidth}" height="${downtimeHeight}" rx="4"></rect>
                </g>
            `;
            barValueLabels += `
                <text class="management-chart-value-label bar-value" x="${centerX}" y="${Math.max(downtimeY - 8, top + 12)}" text-anchor="middle">${escapeXml(`${bucket.downtimeHours.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`)}</text>
            `;
            linePoints.push(`${centerX},${incidentY}`);
        } else {
            const baselineY = yFor(0, primaryMaximum);
            const costY = yFor(bucket.intervalCost, primaryMaximum);
            const cumulativeY = yFor(bucket.cumulativeCost, secondaryMaximum);
            const barClass = bucket.hasDailyRecurrence ? "recurrence" : "daily-cost";
            const recurrenceLabel = bucket.combinedIncidents === 1
                ? "1 incidente combinado"
                : `${bucket.combinedIncidents} incidentes combinados`;
            const recurrenceDetail = bucket.hasDailyRecurrence
                ? "recorrência: 2 ou mais no mesmo dia"
                : "sem 2 ou mais incidentes combinados no mesmo dia";

            bars += `
                <g>
                  <title>${escapeXml(`${titleDates}: ${formatCurrency(bucket.intervalCost)} em manutenção; ${recurrenceLabel}; ${recurrenceDetail}`)}</title>
                  <rect class="management-chart-bar ${barClass}" x="${barX}" y="${costY}" width="${barWidth}" height="${Math.max(baselineY - costY, 1)}" rx="4"></rect>
                </g>
            `;
            barValueLabels += `
                <text class="management-chart-value-label bar-value" x="${centerX}" y="${Math.max(costY - 8, top + 12)}" text-anchor="middle">${escapeXml(formatCurrency(bucket.intervalCost))}</text>
            `;
            linePoints.push(`${centerX},${cumulativeY}`);
        }
    });

    if (chartType === "production") {
        primaryLine = `<polyline class="management-chart-line incidents" points="${linePoints.join(" ")}"></polyline>`;
    } else {
        primaryLine = `<polyline class="management-chart-line cumulative-cost" points="${linePoints.join(" ")}"></polyline>`;
    }

    const markers = values.map((bucket, index) => {
        const centerX = xFor(index);
        const value = chartType === "production"
            ? bucket.combinedIncidents
            : bucket.cumulativeCost;
        const markerClass = chartType === "production" ? "incidents" : "cumulative-cost";
        const markerY = yFor(value, secondaryMaximum);
        const valueLabel = chartType === "cost" && index === values.length - 1
            ? `<text class="management-chart-value-label" x="${centerX}" y="${Math.max(markerY - 10, top + 12)}" text-anchor="middle">${escapeXml(formatCurrency(value))}</text>`
            : "";
        const markerTitle = chartType === "cost"
            ? `<title>${escapeXml(`${values[index].label}: custo acumulado ${formatCurrency(value)}`)}</title>`
            : "";

        return `
            <circle class="management-chart-marker ${markerClass}" cx="${centerX}" cy="${markerY}" r="4">${markerTitle}</circle>
            ${valueLabel}
        `;
    }).join("");

    const labelInterval = Math.max(1, Math.ceil(values.length / 12));
    const labels = values.map((bucket, index) => {
        if (index % labelInterval !== 0 && index !== values.length - 1) return "";
        return `<text class="management-chart-x-label" x="${xFor(index)}" y="${height - 20}" text-anchor="middle">${escapeXml(bucket.label)}</text>`;
    }).join("");

    const chartTitle = chartType === "production"
        ? "Paradas para manutenção e incidentes combinados"
        : "Custo estimado das paradas por intervalo e custo acumulado";

    container.innerHTML = `
        <svg class="management-svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${chartTitle}">
          ${grid}
          ${bars}
          ${barValueLabels}
          ${primaryLine}
          ${markers}
          ${labels}
        </svg>
    `;
}

let currentChartBuckets = [];

function updateIndicators(data) {
    const incidents = data.incidents || {};
    const busiest = incidents.most_incident_day;
    const highestCost = incidents.most_expensive_day;
    const totalCost = Object.values(incidents.combined_daily || {})
        .reduce((total, count) => total + Number(count || 0), 0)
        * downtimeCostPerIncident;

    document.getElementById("combinedIncidents").textContent =
        incidents.combined_total ?? 0;

    document.getElementById("periodTotalCost").textContent =
        `Total no período: ${formatCurrency(totalCost, 2)}`;

    document.getElementById("highestCostAmount").textContent =
        highestCost
            ? formatCurrency(highestCost.cost, 2)
            : "Sem gastos no período";
    document.getElementById("highestCostDay").textContent =
        highestCost
            ? `${formatDate(highestCost.date)} · ${highestCost.incident_count} incidentes`
            : "Sem gastos no período";

    document.getElementById("busiestDay").textContent =
        busiest ? formatDate(busiest.date) : "--";

    document.getElementById("busiestDayCount").textContent =
        busiest ? `${busiest.count} ocorrências` : "Sem registros";
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
        if (
            !data.incidents?.combined_daily ||
            !data.incidents?.planned_hours_daily
        ) {
            throw new Error(
                "A API ainda não fornece as métricas dos gráficos. " +
                "Reinicie o servidor do projeto para atualizar o backend."
            );
        }

        const buckets = getChartBuckets(data.incidents);
        if (!buckets.length) {
            throw new Error("A API não retornou datas para os gráficos neste período.");
        }

        currentChartBuckets = buckets;
        renderManagementChart("productionChart", buckets, "production");
        renderManagementChart("downtimeCostChart", buckets, "cost");
        message.textContent = "";
    
    } catch (error) {
        console.error("Erro no painel gerencial:", error);
        message.textContent = error instanceof Error
            ? error.message
            : "Não foi possível carregar os indicadores.";
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

let chartResizeTimeout;
window.addEventListener("resize", () => {
    window.clearTimeout(chartResizeTimeout);
    chartResizeTimeout = window.setTimeout(() => {
        if (currentChartBuckets.length) {
            renderManagementChart("productionChart", currentChartBuckets, "production");
            renderManagementChart("downtimeCostChart", currentChartBuckets, "cost");
        }
    }, 120);
});

loadManagementData();
