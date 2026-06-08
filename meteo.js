const { createCanvas, loadImage } = require('canvas');
const https = require('https');

const WMO_LABELS = {
  0: 'Ensoleille', 1: 'Peu nuageux', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine legere', 53: 'Bruine', 55: 'Bruine forte',
  61: 'Pluie legere', 63: 'Pluie', 65: 'Pluie forte',
  71: 'Neige legere', 73: 'Neige', 75: 'Neige forte',
  80: 'Averses legeres', 81: 'Averses', 82: 'Averses fortes',
  95: 'Orage', 96: 'Orage avec grele', 99: 'Orage fort',
};

const WMO_ICONS = {
  0: 'clear-day',
  1: 'mostly-clear-day',
  2: 'partly-cloudy-day',
  3: 'overcast',
  45: 'fog',
  48: 'fog',
  51: 'drizzle',
  53: 'drizzle',
  55: 'drizzle',
  61: 'rain',
  63: 'rain',
  65: 'extreme-rain',
  71: 'snow',
  73: 'snow',
  75: 'extreme-snow',
  80: 'partly-cloudy-day-rain',
  81: 'rain',
  82: 'extreme-rain',
  95: 'thunderstorms',
  96: 'thunderstorms-rain',
  99: 'thunderstorms-extreme-rain',
};

async function fetchMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Europe%2FParis&forecast_days=3`;
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function loadWeatherIcon(code) {
  const iconName = WMO_ICONS[code] || 'clear-day';
  const url = `https://cdn.jsdelivr.net/gh/basmilius/weather-icons/production/fill/all/${iconName}.png`;
  try {
    return await loadImage(url);
  } catch (err) {
    console.log(`Icon load error for ${iconName}:`, err.message);
    return null;
  }
}

function formatDate(dateStr, index) {
  if (index === 0) return "Aujourd'hui";
  if (index === 1) return 'Demain';
  const d = new Date(dateStr);
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const months = ['jan', 'fev', 'mar', 'avr', 'mai', 'jun', 'jul', 'aou', 'sep', 'oct', 'nov', 'dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function generateMeteoOverlay(cityName, lat, lon) {
  const meteo = await fetchMeteo(lat, lon);
  const { daily } = meteo;

  // Précharge les icônes
  const icons = await Promise.all([
    loadWeatherIcon(daily.weathercode[0]),
    loadWeatherIcon(daily.weathercode[1]),
    loadWeatherIcon(daily.weathercode[2]),
  ]);

  const canvas = createCanvas(1920, 1080);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 1920, 1080);

  const OW = 380;
  const OH = 1040;
  const OX = 400;
  const OY = 20;

  const tmpCanvas = createCanvas(OH, OW);
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.clearRect(0, 0, OH, OW);

  // Fond semi-transparent
  tmpCtx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  roundRect(tmpCtx, 10, 10, OH - 20, OW - 20, 20);
  tmpCtx.fill();

  // Nom de la ville
  tmpCtx.fillStyle = '#ffffff';
  tmpCtx.font = 'bold 36px DejaVu Sans';
  tmpCtx.textAlign = 'center';
  tmpCtx.fillText(cityName.toUpperCase(), OH / 2, 58);

  // Ligne séparatrice
  tmpCtx.strokeStyle = 'rgba(255,255,255,0.3)';
  tmpCtx.lineWidth = 1;
  tmpCtx.beginPath();
  tmpCtx.moveTo(40, 72);
  tmpCtx.lineTo(OH - 40, 72);
  tmpCtx.stroke();

  const dayW = (OH - 20) / 3;

  for (let i = 0; i < 3; i++) {
    const code = daily.weathercode[i];
    const tMax = Math.round(daily.temperature_2m_max[i]);
    const tMin = Math.round(daily.temperature_2m_min[i]);
    const label = WMO_LABELS[code] || '';
    const dateLabel = formatDate(daily.time[i], i);
    const icon = icons[i];

    const dayX = 10 + i * dayW;
    const centerX = dayX + dayW / 2;

    // Séparateur vertical
    if (i > 0) {
      tmpCtx.strokeStyle = 'rgba(255,255,255,0.2)';
      tmpCtx.lineWidth = 1;
      tmpCtx.beginPath();
      tmpCtx.moveTo(dayX, 80);
      tmpCtx.lineTo(dayX, OW - 20);
      tmpCtx.stroke();
    }

    // Jour
    tmpCtx.fillStyle = i === 0 ? '#FFD700' : 'rgba(255,255,255,0.85)';
    tmpCtx.font = i === 0 ? 'bold 28px DejaVu Sans' : '24px DejaVu Sans';
    tmpCtx.textAlign = 'center';
    tmpCtx.fillText(dateLabel, centerX, 108);

    // Icône météo
    const iconSize = 80;
    const iconX = centerX - iconSize / 2;
    const iconY = 118;
    if (icon) {
      tmpCtx.drawImage(icon, iconX, iconY, iconSize, iconSize);
    } else {
      // Fallback symbole
      tmpCtx.fillStyle = '#FFD700';
      tmpCtx.font = 'bold 48px DejaVu Sans';
      tmpCtx.textAlign = 'center';
      tmpCtx.fillText('?', centerX, 172);
    }

    // Description
    tmpCtx.fillStyle = 'rgba(255,255,255,0.75)';
    tmpCtx.font = '20px DejaVu Sans';
    tmpCtx.textAlign = 'center';
    tmpCtx.fillText(label, centerX, 216);

    // Températures
    tmpCtx.font = 'bold 30px DejaVu Sans';
    tmpCtx.fillStyle = '#FF6B6B';
    tmpCtx.textAlign = 'right';
    tmpCtx.fillText(`${tMax}`, centerX + 20, 266);

    tmpCtx.fillStyle = 'rgba(255,255,255,0.5)';
    tmpCtx.font = '22px DejaVu Sans';
    tmpCtx.textAlign = 'center';
    tmpCtx.fillText('/', centerX + 30, 266);

    tmpCtx.fillStyle = '#74B9FF';
    tmpCtx.font = 'bold 26px DejaVu Sans';
    tmpCtx.textAlign = 'left';
    tmpCtx.fillText(`${tMin}`, centerX + 40, 266);

    tmpCtx.fillStyle = 'rgba(255,255,255,0.4)';
    tmpCtx.font = '18px DejaVu Sans';
    tmpCtx.textAlign = 'center';
    tmpCtx.fillText('°C', centerX + 70, 266);
  }

  // Rotation 90° CW
  ctx.save();
  ctx.translate(OX + OW, OY);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(tmpCanvas, 0, 0);
  ctx.restore();

  return canvas.toBuffer('image/png', { compressionLevel: 6 });
}

module.exports = { generateMeteoOverlay };
