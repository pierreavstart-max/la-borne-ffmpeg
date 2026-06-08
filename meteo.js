const { createCanvas } = require('canvas');
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

const WMO_SYMBOLS = {
  0: { s: '★', c: '#FFD700' }, 1: { s: '★', c: '#FFD700' },
  2: { s: '◆', c: '#B0BEC5' }, 3: { s: '■', c: '#90A4AE' },
  45: { s: '~', c: '#B0BEC5' }, 48: { s: '~', c: '#B0BEC5' },
  51: { s: '▼', c: '#64B5F6' }, 53: { s: '▼', c: '#64B5F6' }, 55: { s: '▼', c: '#64B5F6' },
  61: { s: '▼', c: '#42A5F5' }, 63: { s: '▼', c: '#42A5F5' }, 65: { s: '▼', c: '#1565C0' },
  71: { s: '*', c: '#E3F2FD' }, 73: { s: '*', c: '#E3F2FD' }, 75: { s: '*', c: '#E3F2FD' },
  80: { s: '▼', c: '#42A5F5' }, 81: { s: '▼', c: '#1E88E5' }, 82: { s: '✦', c: '#FFF176' },
  95: { s: '✦', c: '#FFF176' }, 96: { s: '✦', c: '#FFF176' }, 99: { s: '✦', c: '#FFF176' },
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

  // Canvas 1920x1080 paysage — fond transparent
  const canvas = createCanvas(1920, 1080);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 1920, 1080);

  // L'écran est physiquement tourné -90° (antihoraire)
  // Pour que l'overlay soit lisible sur l'écran portrait :
  // - On dessine l'overlay en mode portrait (vertical)
  // - On le tourne de 90° horaire dans le canvas paysage
  // - On le place à GAUCHE du canvas paysage
  //   (gauche paysage = bas de l'écran portrait = en bas quand on regarde l'écran)

  // Zone overlay : 380px de large, 1040px de haut, placée à gauche
  const OW = 380;  // largeur de la zone overlay
  const OH = 1040; // hauteur de la zone overlay
  const OX = 20;   // position X (gauche)
  const OY = 20;   // position Y (haut)

  // On dessine dans un canvas temporaire portrait (OH x OW)
  // puis on le rotate 90° CW et on le colle dans le canvas principal
  const tmpCanvas = createCanvas(OH, OW);
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.clearRect(0, 0, OH, OW);

  // Fond semi-transparent dans le canvas temporaire
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

  // 3 jours côte à côte dans le canvas temporaire
  const dayW = (OH - 20) / 3;

  for (let i = 0; i < 3; i++) {
    const code = daily.weathercode[i];
    const tMax = Math.round(daily.temperature_2m_max[i]);
    const tMin = Math.round(daily.temperature_2m_min[i]);
    const label = WMO_LABELS[code] || '';
    const sym = WMO_SYMBOLS[code] || { s: '?', c: '#fff' };
    const dateLabel = formatDate(daily.time[i], i);

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

    // Symbole météo
    tmpCtx.fillStyle = sym.c;
    tmpCtx.font = 'bold 48px DejaVu Sans';
    tmpCtx.fillText(sym.s, centerX, 172);

    // Description
    tmpCtx.fillStyle = 'rgba(255,255,255,0.75)';
    tmpCtx.font = '20px DejaVu Sans';
    tmpCtx.fillText(label, centerX, 206);

    // Températures
    tmpCtx.font = 'bold 30px DejaVu Sans';
    tmpCtx.fillStyle = '#FF6B6B';
    tmpCtx.textAlign = 'right';
    tmpCtx.fillText(`${tMax}`, centerX + 20, 256);

    tmpCtx.fillStyle = 'rgba(255,255,255,0.5)';
    tmpCtx.font = '22px DejaVu Sans';
    tmpCtx.textAlign = 'center';
    tmpCtx.fillText('/', centerX + 30, 256);

    tmpCtx.fillStyle = '#74B9FF';
    tmpCtx.font = 'bold 26px DejaVu Sans';
    tmpCtx.textAlign = 'left';
    tmpCtx.fillText(`${tMin}`, centerX + 40, 256);

    tmpCtx.fillStyle = 'rgba(255,255,255,0.4)';
    tmpCtx.font = '18px DejaVu Sans';
    tmpCtx.textAlign = 'center';
    tmpCtx.fillText('°C', centerX + 70, 256);
  }

  // Applique la rotation 90° CW dans le canvas principal
  // Rotation 90° CW : (x,y) -> (canvasH - y, x) 
  ctx.save();
  ctx.translate(OX + OW, OY);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(tmpCanvas, 0, 0);
  ctx.restore();

  return canvas.toBuffer('image/png', { compressionLevel: 6 });
}

module.exports = { generateMeteoOverlay };
