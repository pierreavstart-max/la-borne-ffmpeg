const { createCanvas, loadImage, registerFont } = require('canvas');
const https = require('https');
const http = require('http');

// Icônes météo WMO → emoji
const WMO_ICONS = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '❄️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

const WMO_LABELS = {
  0: 'Ensoleillé', 1: 'Peu nuageux', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine forte',
  61: 'Pluie légère', 63: 'Pluie', 65: 'Pluie forte',
  71: 'Neige légère', 73: 'Neige', 75: 'Neige forte',
  80: 'Averses légères', 81: 'Averses', 82: 'Averses fortes',
  95: 'Orage', 96: 'Orage avec grêle', 99: 'Orage fort',
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

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const months = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

async function generateMeteoOverlay(cityName, lat, lon, orientation) {
  // Récupère la météo
  const meteo = await fetchMeteo(lat, lon);
  const { daily } = meteo;

  // Canvas en 1920x1080 (paysage)
  // L'overlay sera dans la partie gauche (400px de large)
  // car l'écran est tourné -90° donc gauche = bas de l'écran
  const canvas = createCanvas(1920, 1080);
const ctx = canvas.getContext('2d');

// Fond complètement transparent
ctx.clearRect(0, 0, 1920, 1080);
ctx.globalCompositeOperation = 'source-over';

  // Zone overlay — partie gauche 380px x 1080px
  const overlayX = 20;
  const overlayY = 20;
  const overlayW = 360;
  const overlayH = 1040;

  // Fond semi-transparent
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  roundRect(ctx, overlayX, overlayY, overlayW, overlayH, 20);
  ctx.fill();

  // Nom de la ville
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(cityName, overlayX + overlayW / 2, overlayY + 55);

  // Ligne séparatrice
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(overlayX + 20, overlayY + 70);
  ctx.lineTo(overlayX + overlayW - 20, overlayY + 70);
  ctx.stroke();

  // 3 jours de météo
  const dayHeight = (overlayH - 90) / 3;

  for (let i = 0; i < 3; i++) {
    const code = daily.weathercode[i];
    const tMax = Math.round(daily.temperature_2m_max[i]);
    const tMin = Math.round(daily.temperature_2m_min[i]);
    const icon = WMO_ICONS[code] || '🌡️';
    const label = WMO_LABELS[code] || '';
    const dateLabel = i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : formatDate(daily.time[i]);

    const dayY = overlayY + 90 + i * dayHeight;
    const centerX = overlayX + overlayW / 2;

    // Jour
    ctx.fillStyle = i === 0 ? '#FFD700' : 'rgba(255,255,255,0.7)';
    ctx.font = i === 0 ? 'bold 28px Arial' : '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(dateLabel, centerX, dayY + 28);

    // Icône météo (emoji)
    ctx.font = '64px Arial';
    ctx.fillText(icon, centerX, dayY + 100);

    // Description
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '20px Arial';
    ctx.fillText(label, centerX, dayY + 130);

    // Températures
    ctx.font = 'bold 32px Arial';
    ctx.fillStyle = '#FF6B6B';
    ctx.textAlign = 'right';
    ctx.fillText(`${tMax}°`, centerX + 40, dayY + 170);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('/', centerX + 50, dayY + 170);

    ctx.fillStyle = '#74B9FF';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`${tMin}°`, centerX + 60, dayY + 170);

    // Séparateur entre jours
    if (i < 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(overlayX + 20, dayY + dayHeight - 10);
      ctx.lineTo(overlayX + overlayW - 20, dayY + dayHeight - 10);
      ctx.stroke();
    }
  }

  return canvas.toBuffer('image/png');
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

module.exports = { generateMeteoOverlay };
