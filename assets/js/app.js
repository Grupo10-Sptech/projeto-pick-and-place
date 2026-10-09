const dataUrl = './data/sensor_data.json';

const formatNumber = (value, decimals = 2) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

const buildChartConfig = (type, labels, values, label, color, fill = false) => {
  const step = Math.max(1, Math.floor(labels.length / 16));
  const compactLabels = labels.filter((_, index) => index % step === 0 || index === labels.length - 1);
  const compactValues = values.filter((_, index) => index % step === 0 || index === values.length - 1);

  return {
    type,
    data: {
      labels: compactLabels,
      datasets: [{
        label,
        data: compactValues,
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
          backgroundColor: '#1e2942',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          callbacks: { label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(2)}` }
        }
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 8,
            color: '#5b6166',
            autoSkip: true,
            maxRotation: 0,
            minRotation: 0,
          },
          grid: { display: false },
        },
        y: {
          ticks: { color: '#5b6166' },
          grid: { color: 'rgba(91, 97, 102, 0.12)' },
        },
      },
    },
  };
};

function updateKpis(temperatureValues, vibrationValues) {
  const tempAverage = average(temperatureValues);
  const vibrationAverage = rms(vibrationValues);
  const health = Math.max(0, Math.min(100, 100 - (vibrationAverage * 40) - (Math.max(0, tempAverage - 30) * 4)));

  document.getElementById('tempAvg').textContent = `${formatNumber(tempAverage, 1)} °C`;
  document.getElementById('vibrationRms').textContent = `${formatNumber(vibrationAverage, 2)} g`;
  document.getElementById('healthIndex').textContent = `${formatNumber(health, 0)} / 100`;
}

function updateSummary(payload) {
  const sampleCount = payload.temperature.values.length;
  const sampleCounter = document.getElementById('sampleCounter');
  if (sampleCounter) {
    sampleCounter.innerHTML = `<strong>${sampleCount.toLocaleString('pt-BR')}</strong> amostras coletadas`;
  }
}

function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-button');
  const panels = document.querySelectorAll('.view-panel');

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetView = button.dataset.view;

      navButtons.forEach((item) => item.classList.toggle('active', item === button));
      panels.forEach((panel) => {
        const isActive = panel.id === `${targetView}View`;
        panel.classList.toggle('active', isActive);
      });
    });
  });
}

async function loadData() {
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`Erro ao carregar dados: ${response.status}`);
    const payload = await response.json();

    const tempLabels = payload.temperature.timestamps;
    const tempValues = payload.temperature.values;
    const vibLabels = payload.vibration.timestamps;
    const vibValues = payload.vibration.values;

    updateSummary(payload);
    updateKpis(tempValues, vibValues);

    const tempChart = new Chart(document.getElementById('temperatureChart'), buildChartConfig(
      'line',
      tempLabels,
      tempValues,
      'Temperatura',
      '#5faab5',
      true
    ));

    const vibChart = new Chart(document.getElementById('vibrationChart'), buildChartConfig(
      'line',
      vibLabels,
      vibValues,
      'Vibração',
      '#1e2942',
      false
    ));

    window.addEventListener('resize', () => {
      tempChart.resize();
      vibChart.resize();
    });
  } catch (error) {
    console.error(error);
    document.body.innerHTML = `
      <div style="padding: 40px; font-family: Arial, sans-serif; color: #1e2942;">
        <h2>Erro ao carregar os dados simulados</h2>
        <p>Verifique se o script Python foi executado antes de abrir a página.</p>
      </div>
    `;
  }
}

setupNavigation();
loadData();
