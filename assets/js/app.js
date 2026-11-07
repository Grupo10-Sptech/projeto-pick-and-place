import { requireDashboardRole } from "./auth.js";
import {
  startAlertCountPolling,
  updateSystemStatus
} from './header-indicators.js';

await requireDashboardRole("production");

const dataUrl = './data/sensor_data.json';
const liveSampleUrl = './api/sensors/sample';
const minuteSamplesUrl = './api/sensors/minute-samples';
const maxChartSamples = 60;
const maxMinuteChartSamples = 10;
const chartRefreshInterval = 10000;

const formatNumber = (value, decimals = 2) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);

function applyTheme(theme) {
  const isLight = theme === 'light';
  document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    const label = isLight ? 'Ativar tema escuro' : 'Ativar tema claro';
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
  }

  if (tempChart && vibChart) {
    const chartTextColor = isLight ? '#5b6b7d' : '#9aafc8';
    const gridColor = isLight ? 'rgba(48, 71, 98, 0.12)' : 'rgba(142, 174, 208, 0.12)';
    const chartColors = isLight ? ['#008f86', '#426fd0'] : ['#42dfd0', '#82aaff'];

    [tempChart, vibChart].forEach((chart, index) => {
      chart.options.scales.x.ticks.color = chartTextColor;
      chart.options.scales.y.ticks.color = chartTextColor;
      chart.options.scales.y.grid.color = gridColor;
      chart.options.plugins.tooltip.titleColor = isLight ? '#ffffff' : '#eaf4ff';
      chart.options.plugins.tooltip.bodyColor = isLight ? '#e1eaf4' : '#c4d6e9';
      chart.data.datasets[0].borderColor = chartColors[index];
      chart.data.datasets[0].backgroundColor = index === 0
        ? `${chartColors[index]}33`
        : 'transparent';
      chart.update('none');
    });
  }
}

function setupThemeToggle() {
  const savedTheme = localStorage.getItem('pick-and-place-theme');
  applyTheme(savedTheme === 'light' ? 'light' : 'dark');

  document.getElementById('themeToggle').addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('pick-and-place-theme', nextTheme);
    applyTheme(nextTheme);
  });
}

const buildChartConfig = (type, labels, values, label, color, fill = false) => ({
  type,
  data: {
    labels,
    datasets: [{
      label,
      data: values,
      borderColor: color,
      backgroundColor: fill ? `${color}33` : 'transparent',
      borderWidth: 2.5,
      pointRadius: 3,
      pointHoverRadius: 5,
      fill,
      tension: 0.25,
      borderJoinStyle: 'round',
    }],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#111d2e',
        titleColor: '#eaf4ff',
        bodyColor: '#c4d6e9',
        callbacks: {
          label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(2)}`,
        }
      }
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 10,
          color: '#9aafc8',
          autoSkip: true,
          maxRotation: 0,
          minRotation: 0,
        },
        grid: { display: false },
      },
      y: {
        ticks: { color: '#9aafc8' },
        grid: { color: 'rgba(142, 174, 208, 0.12)' },
      },
    },
  },
});

function formatSampleTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function updateKpis(timestamps, temperatureValues, vibrationValues) {
  const sampleCount = Math.min(
    timestamps.length,
    temperatureValues.length,
    vibrationValues.length
  );
  if (!sampleCount) return;

  const validSamples = Array.from({ length: sampleCount }, (_, index) => ({
    timestamp: timestamps[index],
    temperature: Number(temperatureValues[index]),
    vibration: Number(vibrationValues[index])
  })).filter((sample) =>
    Number.isFinite(sample.temperature) && Number.isFinite(sample.vibration)
  );

  if (!validSamples.length) return;

  const temperatureMin = Math.min(...validSamples.map((sample) => sample.temperature));
  const temperatureMax = Math.max(...validSamples.map((sample) => sample.temperature));
  const vibrationMin = Math.min(...validSamples.map((sample) => sample.vibration));
  const vibrationMax = Math.max(...validSamples.map((sample) => sample.vibration));
  const temperatureMinSample = validSamples.find((sample) => sample.temperature === temperatureMin);
  const temperatureMaxSample = validSamples.find((sample) => sample.temperature === temperatureMax);
  const vibrationMinSample = validSamples.find((sample) => sample.vibration === vibrationMin);
  const vibrationMaxSample = validSamples.find((sample) => sample.vibration === vibrationMax);

  document.querySelector('#temperatureMin .kpi-range-number').textContent = formatNumber(temperatureMin, 1);
  document.querySelector('#temperatureMax .kpi-range-number').textContent = formatNumber(temperatureMax, 1);
  document.querySelector('#vibrationMin .kpi-range-number').textContent = formatNumber(vibrationMin, 2);
  document.querySelector('#vibrationMax .kpi-range-number').textContent = formatNumber(vibrationMax, 2);
  document.getElementById('temperatureMinTime').textContent = formatSampleTimestamp(temperatureMinSample.timestamp);
  document.getElementById('temperatureMaxTime').textContent = formatSampleTimestamp(temperatureMaxSample.timestamp);
  document.getElementById('vibrationMinTime').textContent = formatSampleTimestamp(vibrationMinSample.timestamp);
  document.getElementById('vibrationMaxTime').textContent = formatSampleTimestamp(vibrationMaxSample.timestamp);
}

function aggregateMinuteReadings(timestamps, temperatureValues, vibrationValues) {
  const minuteBuckets = new Map();
  const sampleCount = Math.min(
    timestamps.length,
    temperatureValues.length,
    vibrationValues.length
  );

  for (let index = 0; index < sampleCount; index += 1) {
    const timestamp = new Date(timestamps[index]);
    const temperature = Number(temperatureValues[index]);
    const vibration = Number(vibrationValues[index]);

    if (
      Number.isNaN(timestamp.getTime()) ||
      !Number.isFinite(temperature) ||
      !Number.isFinite(vibration)
    ) {
      continue;
    }

    const minuteTimestamp = Math.floor(timestamp.getTime() / 60000) * 60000;
    const bucket = minuteBuckets.get(minuteTimestamp) || {
      temperatureTotal: 0,
      vibrationTotal: 0,
      count: 0
    };

    bucket.temperatureTotal += temperature;
    bucket.vibrationTotal += vibration;
    bucket.count += 1;
    minuteBuckets.set(minuteTimestamp, bucket);
  }

  return [...minuteBuckets.entries()]
    .sort(([firstTimestamp], [secondTimestamp]) => firstTimestamp - secondTimestamp)
    .slice(-maxMinuteChartSamples)
    .reduce((minuteData, [timestamp, bucket]) => {
      minuteData.labels.push(
        new Date(timestamp).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      );
      minuteData.temperatures.push(bucket.temperatureTotal / bucket.count);
      minuteData.vibrations.push(bucket.vibrationTotal / bucket.count);
      return minuteData;
    }, { labels: [], temperatures: [], vibrations: [] });
}

function updateSummary(sampleCount) {
  const sampleCounter = document.getElementById('sampleCounter');
  if (sampleCounter) {
    const count = sampleCounter.querySelector('strong');
    if (count) {
      count.textContent = sampleCount.toLocaleString('pt-BR');
    } else {
      sampleCounter.textContent = `${sampleCount.toLocaleString('pt-BR')} amostras coletadas`;
    }
  }
}

let tempChart;
let vibChart;
let temperatureValues = [];
let vibrationValues = [];
let sampleCount = 0;

function updateLiveWindow(samples, totalSamples, machineStopsToday) {
  const recentSamples = samples.slice(-maxChartSamples);
  const timestamps = recentSamples.map((sample) => sample.timestamp);
  const labels = recentSamples.map((sample) => new Date(sample.timestamp).toLocaleTimeString('pt-BR'));
  temperatureValues = recentSamples.map((sample) => sample.temperature);
  vibrationValues = recentSamples.map((sample) => sample.vibration);

  tempChart.data.labels = labels;
  tempChart.data.datasets[0].data = temperatureValues;
  vibChart.data.labels = labels;
  vibChart.data.datasets[0].data = vibrationValues;

  sampleCount = totalSamples;
  document.getElementById('machineStopsToday').textContent = Number.isInteger(machineStopsToday)
    ? machineStopsToday.toLocaleString('pt-BR')
    : '--';
  document.getElementById('machineStopsHelp').textContent = Number.isInteger(machineStopsToday)
    ? 'Ocorrências combinadas: temperatura + vibração'
    : 'Reinicie o servidor para ativar';
  updateSummary(sampleCount);
  updateKpis(timestamps, temperatureValues, vibrationValues);
  tempChart.update('none');
  vibChart.update('none');
}

async function pollLiveSample() {
  try {
    const response = await fetch(liveSampleUrl, { cache: 'no-store' });
    if (response.status === 401) {
      window.location.replace("/login.html");
      return;
    }
    if (!response.ok) throw new Error(`Erro ao coletar leitura: ${response.status}`);
    const payload = await response.json();
    const hasMachineStopsCount = Number.isInteger(payload.machine_stops_today) && payload.machine_stops_today >= 0;
    if (
      !Array.isArray(payload.samples) ||
      payload.samples.length === 0 ||
      !Number.isFinite(payload.total_samples) ||
      (payload.machine_stops_today !== undefined && !hasMachineStopsCount) ||
      !payload.samples.every((sample) =>
        Number.isFinite(sample.sequence) &&
        Number.isFinite(sample.temperature) &&
        Number.isFinite(sample.vibration) &&
        Number.isFinite(sample.temperature_threshold) &&
        Number.isFinite(sample.vibration_threshold)
      )
    ) {
      throw new Error('Resposta inválida recebida dos sensores.');
    }

    updateSystemStatus(true);
    updateLiveWindow(payload.samples, payload.total_samples, hasMachineStopsCount ? payload.machine_stops_today : null);
  } catch (error) {
    console.error(error);
    updateSystemStatus(false);
  } finally {
    window.setTimeout(pollLiveSample, 10000);
  }
}

async function pollMinuteChart() {
  try {
    const response = await fetch(minuteSamplesUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Erro ao consultar dados por minuto: ${response.status}`);
    }

    const payload = await response.json();
    if (
      !Array.isArray(payload.samples) ||
      !payload.samples.every((sample) =>
        typeof sample.timestamp === 'string' &&
        Number.isFinite(sample.temperature) &&
        Number.isFinite(sample.vibration)
      )
    ) {
      throw new Error('Resposta inválida recebida para os gráficos dos últimos 10 minutos.');
    }

    if (payload.samples.length > 0) {
      const minuteData = aggregateMinuteReadings(
        payload.samples.map((sample) => sample.timestamp),
        payload.samples.map((sample) => sample.temperature),
        payload.samples.map((sample) => sample.vibration)
      );

      tempChart.data.labels = minuteData.labels;
      tempChart.data.datasets[0].data = minuteData.temperatures;
      vibChart.data.labels = minuteData.labels;
      vibChart.data.datasets[0].data = minuteData.vibrations;
      tempChart.update('none');
      vibChart.update('none');
    } else {
      tempChart.data.labels = [];
      tempChart.data.datasets[0].data = [];
      vibChart.data.labels = [];
      vibChart.data.datasets[0].data = [];
      tempChart.update('none');
      vibChart.update('none');
    }
  } catch (error) {
    console.error(error);
  } finally {
    window.setTimeout(pollMinuteChart, chartRefreshInterval);
  }
}

async function loadData() {
  try {
    const response = await fetch(dataUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Erro ao carregar dados: ${response.status}`);
    const payload = await response.json();

    const timestamps = payload.temperature.timestamps.slice(-maxChartSamples);
    temperatureValues = payload.temperature.values.slice(-maxChartSamples);
    vibrationValues = payload.vibration.values.slice(-maxChartSamples);
    sampleCount = Math.max(payload.temperature.values.length, payload.vibration.values.length);
    updateSummary(sampleCount);
    updateKpis(timestamps, temperatureValues, vibrationValues);

    tempChart = new Chart(document.getElementById('temperatureChart'), buildChartConfig(
      'line',
      [],
      [],
      'Temperatura',
      '#42dfd0',
      true
    ));

    vibChart = new Chart(document.getElementById('vibrationChart'), buildChartConfig(
      'line',
      [],
      [],
      'Vibração',
      '#82aaff',
      false
    ));

    applyTheme(document.documentElement.dataset.theme);
    window.addEventListener('resize', () => {
      tempChart.resize();
      vibChart.resize();
    });
    pollMinuteChart();
    pollLiveSample();
  } catch (error) {
    console.error(error);
    updateSystemStatus(false);
  }
}

setupThemeToggle();
startAlertCountPolling();
loadData();
