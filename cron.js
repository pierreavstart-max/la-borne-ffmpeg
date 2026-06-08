const cron = require('node-cron');
const { generateMeteoOverlay } = require('./meteo');
const { writeFileSync, readFileSync, unlinkSync, existsSync } = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const https = require('https');
const http = require('http');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Config depuis les variables d'environnement
const IB_API_KEY = process.env.INFOBEAMER_API_KEY;
const FIREBASE_URL = process.env.FIREBASE_PROJECT_URL; // URL Firestore REST API

async function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.request(url, options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function getBornesMeteo() {
  // Récupère les bornes depuis Firestore REST API
  const url = `https://firestore.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/bornes`;
  const data = await fetchJSON(url);

  if (!data.documents) return [];

  return data.documents
    .map(doc => {
      const fields = doc.fields || {};
      return {
        id: doc.name.split('/').pop(),
        nom: fields.nom?.stringValue,
        client: fields.client?.stringValue,
        ibDeviceId: fields.ibDeviceId?.integerValue || fields.ibDeviceId?.doubleValue,
        ibMeteoFilename: fields.ibMeteoFilename?.stringValue,
        ibMeteoStorageUrl: fields.ibMeteoStorageUrl?.stringValue,
        isMeteoBorne: fields.isMeteoBorne?.booleanValue,
        meteoVille: fields.meteoVille?.stringValue,
      };
    })
    .filter(b => b.isMeteoBorne && b.ibMeteoFilename && b.ibMeteoStorageUrl);
}

async function getDeviceGeo(deviceId) {
  const url = `https://info-beamer.com/api/v1/device/${deviceId}`;
  const data = await fetchJSON(url, {
    headers: {
      'Authorization': 'Basic ' + Buffer.from('api:' + IB_API_KEY).toString('base64'),
    },
  });
  return data.geo || null;
}

async function processMeteoBorne(borne) {
  const ts = Date.now();
  const tmpOverlay = `/tmp/overlay_${ts}.png`;
  const tmpVideo = `/tmp/bg_${ts}.mp4`;
  const tmpOut = `/tmp/meteo_${ts}.mp4`;

  try {
    console.log(`Processing météo for ${borne.nom}...`);

    // Récupère les coordonnées GPS depuis info-beamer
    const geo = await getDeviceGeo(borne.ibDeviceId);
    if (!geo) {
      console.log(`No GPS for ${borne.nom}, skipping`);
      return;
    }

    // Génère l'overlay météo
    const overlayBuf = await generateMeteoOverlay(
      borne.meteoVille || borne.nom,
      geo.lat,
      geo.lon
    );
    writeFileSync(tmpOverlay, overlayBuf);
    console.log(`Overlay generated for ${borne.nom}`);

    // Télécharge la vidéo de fond depuis Firebase Storage
    const videoBuf = await downloadFile(borne.ibMeteoStorageUrl);
    writeFileSync(tmpVideo, videoBuf);
    console.log(`Background video downloaded for ${borne.nom}, size: ${videoBuf.length}`);

    // Récupère la durée de la vidéo
    let videoDuration = 30;
    await new Promise(resolve => {
      ffmpeg.ffprobe(tmpVideo, (err, metadata) => {
        if (!err && metadata?.format?.duration) {
          videoDuration = metadata.format.duration;
          console.log(`Video duration: ${videoDuration}s`);
        }
        resolve();
      });
    });

    // Calcule les timings pour le fondu
    // FPS = 25, apparition après 5 frames = 0.2s, fondu 4 frames = 0.16s
    const fps = 25;
    const fadeInStart = 5 / fps;   // 0.2s
    const fadeInDur = 4 / fps;     // 0.16s
    const fadeOutEnd = videoDuration - (9 / fps);  // 9 frames avant la fin
    const fadeOutStart = fadeOutEnd - (4 / fps);   // commence 4 frames avant

    console.log(`Fade in: ${fadeInStart}s, fade out: ${fadeOutStart}s`);

    // Assemble avec ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(tmpVideo)
        .input(tmpOverlay)
        .complexFilter([
          // Applique le fondu sur l'overlay
          `[1:v]fade=t=in:st=${fadeInStart}:d=${fadeInDur}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${fadeInDur}:alpha=1[overlay_faded]`,
          // Superpose l'overlay sur la vidéo
          `[0:v][overlay_faded]overlay=0:0[out]`,
        ])
        .outputOptions([
          '-map [out]',
          '-map 0:a?',
          '-c:v libx264',
          '-preset ultrafast',
          '-crf 26',
          '-pix_fmt yuv420p',
          '-c:a aac',
          '-r 25',
          '-t', String(Math.ceil(videoDuration)),
        ])
        .output(tmpOut)
        .on('stderr', line => {
          if (line.includes('time=')) console.log('ffmpeg:', line);
        })
        .on('end', () => { console.log(`ffmpeg done for ${borne.nom}`); resolve(); })
        .on('error', (err) => { console.log(`ffmpeg error for ${borne.nom}:`, err.message); reject(err); })
        .run();
    });

    // Upload sur info-beamer avec le même nom de fichier
    const mp4Buffer = readFileSync(tmpOut);
    console.log(`Output size: ${mp4Buffer.length} bytes`);

    const form = new FormData();
    const blob = new Blob([mp4Buffer], { type: 'video/mp4' });
    form.append('file', blob, borne.ibMeteoFilename);

    const uploadRes = await fetch('https://info-beamer.com/api/v1/asset/upload', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('api:' + IB_API_KEY).toString('base64'),
      },
      body: form,
    });

    const uploadData = await uploadRes.json();
    console.log(`Upload result for ${borne.nom}:`, uploadData.ok ? 'OK' : uploadData.error);

  } catch (err) {
    console.error(`Error processing ${borne.nom}:`, err.message);
  } finally {
    [tmpOverlay, tmpVideo, tmpOut].forEach(f => {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    });
  }
}

async function runMeteoJob() {
  console.log('=== METEO JOB STARTED ===', new Date().toISOString());
  try {
    const bornes = await getBornesMeteo();
    console.log(`Found ${bornes.length} bornes with météo enabled`);
    for (const borne of bornes) {
      await processMeteoBorne(borne);
    }
    console.log('=== METEO JOB DONE ===');
  } catch (err) {
    console.error('Meteo job error:', err);
  }
}

// Cron job — tous les jours à 6h00 heure de Paris
cron.schedule('0 6 * * *', runMeteoJob, {
  timezone: 'Europe/Paris',
});

console.log('Cron météo scheduled — every day at 06:00 Paris time');

// Export pour tests manuels
module.exports = { runMeteoJob };
