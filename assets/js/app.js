const dataUrl = './data/sensor_data.json';
const liveSampleUrl = './api/sensors/sample';
const maxChartSamples = 60;

const formatNumber = (value, decimals = 2) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

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
  const tempAverage = average(temperatureValues);
  const vibrationAverage = rms(vibrationValues);
  const latestTemperature = temperatureValues[temperatureValues.length - 1];
  const latestVibration = vibrationValues[vibrationValues.length - 1];
  const isAnomaly =
    latestTemperature > temperatureThreshold ||
    latestVibration > vibrationThreshold;

  document.getElementById('tempAvg').textContent = `${formatNumber(tempAverage, 1)} °C`;
  document.getElementById('vibrationRms').textContent = `${formatNumber(vibrationAverage, 2)} g`;
  document.getElementById('healthIndex').textContent = isAnomaly ? '1 — Anomalia' : '0 — Normal';
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
let temperatureThreshold = 38;
let vibrationThreshold = 1.2;
let connected = true;
let lastProcessedSequence = -1;
let conditionActive = false;

function renderSystemStatus() {
  const status = document.getElementById('systemStatus');
  const statusText = document.getElementById('statusText');
  if (!status || !statusText) return;

  status.classList.toggle('offline', !connected);
  status.classList.toggle('alert', connected && conditionActive);

  if (!connected) {
    statusText.textContent = 'Sem conexão com os sensores';
  } else if (conditionActive) {
    statusText.textContent = 'Alerta detectado';
  } else {
    statusText.textContent = 'Sistema ativo';
  }
}

function updateAlert(sample) {
  const exceedsThreshold =
    sample.temperature > temperatureThreshold ||
    sample.vibration > vibrationThreshold;

  conditionActive = exceedsThreshold;
  renderSystemStatus();
}

function updateLiveWindow(samples, totalSamples, incidentsToday) {
  const recentSamples = samples.slice(-maxChartSamples);
  const labels = recentSamples.map((sample) => new Date(sample.timestamp).toLocaleTimeString('pt-BR'));
  temperatureValues = recentSamples.map((sample) => sample.temperature);
  vibrationValues = recentSamples.map((sample) => sample.vibration);

  tempChart.data.labels = labels;
  tempChart.data.datasets[0].data = temperatureValues;
  vibChart.data.labels = labels;
  vibChart.data.datasets[0].data = vibrationValues;

  for (const sample of samples) {
    if (sample.sequence > lastProcessedSequence) {
      updateAlert(sample);
      lastProcessedSequence = sample.sequence;
    }
  }

  const latestSample = recentSamples[recentSamples.length - 1];
  temperatureThreshold = latestSample.temperature_threshold;
  vibrationThreshold = latestSample.vibration_threshold;
  sampleCount = totalSamples;
  document.getElementById('incidentCountToday').textContent = Number.isInteger(incidentsToday)
    ? incidentsToday.toLocaleString('pt-BR')
    : '--';
  document.getElementById('incidentCountHelp').textContent = Number.isInteger(incidentsToday)
    ? 'Ocorrências registradas'
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
    const hasIncidentCount = Number.isInteger(payload.incidents_today) && payload.incidents_today >= 0;
    if (
      !Array.isArray(payload.samples) ||
      payload.samples.length === 0 ||
      !Number.isFinite(payload.total_samples) ||
      (payload.incidents_today !== undefined && !hasIncidentCount) ||
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

    connected = true;
    updateLiveWindow(payload.samples, payload.total_samples, hasIncidentCount ? payload.incidents_today : null);
  } catch (error) {
    console.error(error);
    connected = false;
    renderSystemStatus();
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
    temperatureThreshold = payload.temperature.threshold;
    vibrationThreshold = payload.vibration.threshold;

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
    document.getElementById('systemStatus').classList.add('offline');
    document.getElementById('statusText').textContent = 'Erro ao carregar dados';
  }
}

setupThemeToggle();
loadData();
