const { createCanvas } = require('canvas');
const https = require('https');

const WMO_ICONS = {
  0: 'SOLEIL', 1: 'SOLEIL', 2: 'NUAGEUX', 3: 'COUVERT',
  45: 'BROUIL', 48: 'BROUIL',
  51: 'PLUIE', 53: 'PLUIE', 55: 'PLUIE',
  61: 'PLUIE', 63: 'PLUIE', 65: 'PLUIE',
  71: 'NEIGE', 73: 'NEIGE', 75: 'NEIGE',
  80: 'AVERSE', 81: 'AVERSE', 82: 'ORAGE',
  95: 'ORAGE', 96: 'ORAGE', 99: 'ORAGE',
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

const WMO_SYMBOLS = {
  'SOLEIL': { symbol: '★', color: '#FFD700' },
  'NUAGEUX': { symbol: '◆', color: '#B0BEC5' },
  'COUVERT': { symbol: '■', color: '#90A4AE' },
  'BROUIL': { symbol: '≈', color: '#B0BEC5' },
  'PLUIE': { symbol: '▼', color: '#64B5F6' },
  'NEIGE': { symbol: '❋', color: '#E3F2FD' },
  'AVERSE': { symbol: '▼', color: '#42A5F5' },
  'ORAGE': { symbol: '✦', color: '#FFF176' },
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

  // Canvas 1920x1080 paysage
  // L'overlay sera dans la partie BASSE du canvas (qui devient gauche après rotation -90° de l'écran)
  // On dessine l'overlay en HORIZONTAL en bas du canvas
  // Après rotation 90° CW de la vidéo pour affichage portrait, le bas devient la gauche visible

 const canvas = createCanvas(1920, 1080);
const ctx = canvas.getContext('2d');

// Force le fond transparent
const imageData = ctx.getImageData(0, 0, 1920, 1080);
ctx.putImageData(imageData, 0, 0);
ctx.clearRect(0, 0, 1920, 1080);

  // Zone overlay en bas du canvas — 1920px de large, 320px de haut
  // Positionnée en bas car l'écran physique est tourné -90° antihoraire
  // donc le bas du canvas = gauche de l'écran = bas de l'écran physique portrait
  const overlayH = 320;
  const overlayY = 1080 - overlayH - 20;
  const overlayX = 20;
  const overlayW = 1880;

  // Fond semi-transparent
  ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
  roundRect(ctx, overlayX, overlayY, overlayW, overlayH, 20);
  ctx.fill();

  // Nom de la ville centré en haut de l'overlay
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px DejaVu Sans';
  ctx.textAlign = 'center';
  ctx.fillText(cityName.toUpperCase(), 1920 / 2, overlayY + 55);

  // Ligne séparatrice
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(overlayX + 40, overlayY + 70);
  ctx.lineTo(overlayX + overlayW - 40, overlayY + 70);
  ctx.stroke();

  // 3 jours côte à côte
  const dayW = overlayW / 3;

  for (let i = 0; i < 3; i++) {
    const code = daily.weathercode[i];
    const tMax = Math.round(daily.temperature_2m_max[i]);
    const tMin = Math.round(daily.temperature_2m_min[i]);
    const label = WMO_LABELS[code] || '';
    const iconKey = WMO_ICONS[code] || 'SOLEIL';
    const iconData = WMO_SYMBOLS[iconKey];
    const dateLabel = formatDate(daily.time[i], i);

    const dayX = overlayX + i * dayW;
    const centerX = dayX + dayW / 2;

    // Séparateur vertical entre jours
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dayX, overlayY + 80);
      ctx.lineTo(dayX, overlayY + overlayH - 20);
      ctx.stroke();
    }

    // Jour
    ctx.fillStyle = i === 0 ? '#FFD700' : 'rgba(255,255,255,0.85)';
    ctx.font = i === 0 ? 'bold 32px DejaVu Sans' : '28px DejaVu Sans';
    ctx.textAlign = 'center';
    ctx.fillText(dateLabel, centerX, overlayY + 108);

    // Symbole météo
    ctx.fillStyle = iconData.color;
    ctx.font = 'bold 56px DejaVu Sans';
    ctx.fillText(iconData.symbol, centerX, overlayY + 178);

    // Description
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '24px DejaVu Sans';
    ctx.fillText(label, centerX, overlayY + 214);

    // Températures
    ctx.font = 'bold 36px DejaVu Sans';
    ctx.fillStyle = '#FF6B6B';
    ctx.textAlign = 'right';
    ctx.fillText(`${tMax}°`, centerX + 30, overlayY + 268);

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '28px DejaVu Sans';
    ctx.textAlign = 'center';
    ctx.fillText('/', centerX + 45, overlayY + 268);

    ctx.fillStyle = '#74B9FF';
    ctx.font = 'bold 30px DejaVu Sans';
    ctx.textAlign = 'left';
    ctx.fillText(`${tMin}°`, centerX + 60, overlayY + 268);
  }

  // Force PNG avec canal alpha
return canvas.toBuffer('image/png', { compressionLevel: 6, filters: canvas.PNG_FILTER_NONE });
}

module.exports = { generateMeteoOverlay };
