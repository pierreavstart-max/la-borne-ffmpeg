const cron = require('node-cron');
const { generateMeteoOverlay } = require('./meteo');
const { writeFileSync, readFileSync, unlinkSync, existsSync } = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const https = require('https');
const http = require('http');
const admin = require('firebase-admin');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
ffmpeg.setFfprobePath(ffprobeInstaller.path);
console.log('ffprobe path:', ffprobeInstaller.path);



// Init Firebase Admin
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  console.log('Firebase init - projectId:', projectId);
  console.log('Firebase init - clientEmail:', clientEmail);
  console.log('Firebase init - privateKey exists:', !!privateKey);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(`Missing Firebase credentials: projectId=${projectId}, clientEmail=${clientEmail}, privateKey=${!!privateKey}`);
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

const db = admin.firestore();
const IB_API_KEY = process.env.INFOBEAMER_API_KEY;

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
  const snap = await db.collection('bornes').where('isMeteoBorne', '==', true).get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(b => b.ibMeteoFilename && b.ibMeteoStorageUrl);
}

async function getDeviceGeo(deviceId) {
  try {
    const res = await fetch(`https://info-beamer.com/api/v1/device/${deviceId}`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from('api:' + IB_API_KEY).toString('base64'),
      },
    });
    const data = await res.json();
    return data.geo || null;
  } catch (err) {
    console.error('getDeviceGeo error:', err.message);
    return null;
  }
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
    console.log(`GPS: ${geo.lat}, ${geo.lon}`);

    // Génère l'overlay météo
    const overlayBuf = await generateMeteoOverlay(
      borne.meteoVille || borne.nom,
      geo.lat,
      geo.lon
    );
    writeFileSync(tmpOverlay, overlayBuf);
    console.log(`Overlay generated for ${borne.nom}, size: ${overlayBuf.length} bytes`);

    // Télécharge la vidéo de fond depuis Firebase Storage
    const videoBuf = await downloadFile(borne.ibMeteoStorageUrl);
    writeFileSync(tmpVideo, videoBuf);
    console.log(`Background video downloaded, size: ${videoBuf.length}`);

    // Récupère la durée de la vidéo
    let videoDuration = 30;
    await new Promise(resolve => {
      ffmpeg.ffprobe(tmpVideo, (err, metadata) => {
        if (!err && metadata?.format?.duration) {
          videoDuration = metadata.format.duration;
          console.log(`Video duration: ${videoDuration}s`);
        } else {
          console.log('ffprobe error:', err?.message);
          console.log('Using default duration:', videoDuration);
        }
        resolve();
      });
    });

    // Calcule les timings pour le fondu
    const fps = 25;
    const fadeInStart = 5 / fps;
    const fadeInDur = 4 / fps;
    const fadeOutStart = videoDuration - (9 / fps) - (4 / fps);

    console.log(`Fade in: ${fadeInStart}s, fade out: ${fadeOutStart}s, total: ${videoDuration}s`);

    // Assemble avec ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(tmpVideo)
        .input(tmpOverlay)
        .complexFilter([
  `[1:v]fade=t=in:st=${fadeInStart}:d=${fadeInDur}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${fadeInDur}:alpha=1[overlay_faded]`,
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
        .on('error', (err) => { console.log(`ffmpeg error:`, err.message); reject(err); })
        .run();
    });

    // Upload sur info-beamer
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
    console.log(`Upload result for ${borne.nom}:`, uploadData.ok ? `OK — asset ${uploadData.asset_id}` : uploadData.error);

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

module.exports = { runMeteoJob };
