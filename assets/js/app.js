import {
  startAlertCountPolling,
  updateSystemStatus
} from './header-indicators.js';

const dataUrl = './data/sensor_data.json';
const liveSampleUrl = './api/sensors/sample';
const maxChartSamples = 60;

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
      pointRadius: 0,
      pointHoverRadius: 2,
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
          maxTicksLimit: 8,
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

function updateKpis(temperatureValues, vibrationValues) {
  if (!temperatureValues.length || !vibrationValues.length) return;

  const temperatureMin = Math.min(...temperatureValues);
  const temperatureMax = Math.max(...temperatureValues);
  const vibrationMin = Math.min(...vibrationValues);
  const vibrationMax = Math.max(...vibrationValues);

  document.getElementById('temperatureMin').textContent = `${formatNumber(temperatureMin, 1)} °C`;
  document.getElementById('temperatureMax').textContent = `${formatNumber(temperatureMax, 1)} °C`;
  document.getElementById('vibrationMin').textContent = `${formatNumber(vibrationMin, 2)} g`;
  document.getElementById('vibrationMax').textContent = `${formatNumber(vibrationMax, 2)} g`;
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
  updateKpis(temperatureValues, vibrationValues);
  tempChart.update('none');
  vibChart.update('none');
}

async function pollLiveSample() {
  try {
    const response = await fetch(liveSampleUrl, { cache: 'no-store' });
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

async function loadData() {
  try {
    const response = await fetch(dataUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Erro ao carregar dados: ${response.status}`);
    const payload = await response.json();

    const tempLabels = payload.temperature.timestamps.slice(-maxChartSamples);
    temperatureValues = payload.temperature.values.slice(-maxChartSamples);
    const vibLabels = payload.vibration.timestamps.slice(-maxChartSamples);
    vibrationValues = payload.vibration.values.slice(-maxChartSamples);
    sampleCount = Math.max(payload.temperature.values.length, payload.vibration.values.length);
    updateSummary(sampleCount);
    updateKpis(temperatureValues, vibrationValues);

    tempChart = new Chart(document.getElementById('temperatureChart'), buildChartConfig(
      'line',
      tempLabels,
      temperatureValues,
      'Temperatura',
      '#42dfd0',
      true
    ));

    vibChart = new Chart(document.getElementById('vibrationChart'), buildChartConfig(
      'line',
      vibLabels,
      vibrationValues,
      'Vibração',
      '#82aaff',
      false
    ));

    applyTheme(document.documentElement.dataset.theme);
    window.addEventListener('resize', () => {
      tempChart.resize();
      vibChart.resize();
    });
    pollLiveSample();
  } catch (error) {
    console.error(error);
    updateSystemStatus(false);
  }
}

setupThemeToggle();
startAlertCountPolling();
loadData();
