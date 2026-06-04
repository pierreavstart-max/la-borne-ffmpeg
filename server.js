const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { writeFileSync, readFileSync, unlinkSync, existsSync } = require('fs');
const https = require('https');
const http = require('http');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'la-borne-ffmpeg' });
});

app.post('/assemble', async (req, res) => {
  const ts = Date.now();
  const tmpBg = `/tmp/bg_${ts}.png`;
  const tmpBgRot = `/tmp/bg_rot_${ts}.png`;
  const tmpVideoIn = `/tmp/vin_${ts}.mp4`;
  const tmpOut = `/tmp/out_${ts}.mp4`;

  try {
    const { bgBase64, videoURL, videoX, videoY, videoW, videoH, orientation, filename, ibApiKey } = req.body;

    console.log('assemble called:', { videoURL, videoX, videoY, videoW, videoH, orientation, filename });

    // Télécharge la vidéo depuis Firebase Storage
    const videoBuf = await downloadFile(videoURL);
    writeFileSync(tmpVideoIn, videoBuf);
    console.log('Video downloaded, size:', videoBuf.length);

    // Décode le fond PNG
    const bgBuf = Buffer.from(bgBase64, 'base64');
    writeFileSync(tmpBg, bgBuf);

    // Coordonnées finales selon orientation
    let finalBg = tmpBg;
    let finalX = videoX;
    let finalY = videoY;
    let finalW = videoW;
    let finalH = videoH;

    if (orientation === 'portrait') {
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(tmpBg)
      .videoFilters('transpose=1')
      .output(tmpBgRot)
      .on('end', resolve)
      .on('error', (err) => { console.log('rotate error:', err.message); reject(err); })
      .run();
  });
  finalBg = tmpBgRot;

  // Rotation 90° sens horaire : canvas 1080x1920 -> 1920x1080
  // newX = H - oldY - oldH = 1920 - videoY - videoH
  // newY = oldX = videoX
  // newW = oldH = videoH  
  // newH = oldW = videoW
  finalX = 1920 - videoY - videoH;
  finalY = videoX;
  finalW = videoH;
  finalH = videoW;
}

    console.log('Final coords:', { finalX, finalY, finalW, finalH });

    // Récupère la durée de la vidéo
    let videoDuration = 35;
    await new Promise((resolve) => {
      ffmpeg.ffprobe(tmpVideoIn, (err, metadata) => {
        if (!err && metadata?.format?.duration) {
          videoDuration = metadata.format.duration;
          console.log('Video duration:', videoDuration);
        }
        resolve();
      });
    });

    // Assemble avec ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(finalBg)
        .inputOptions(['-loop 1'])
        .input(tmpVideoIn)
        .complexFilter([
  `[1:v]transpose=1,scale=${finalW}:${finalH}[scaled]`,
  `[0:v][scaled]overlay=${finalX}:${finalY}[out]`,
])
        .outputOptions([
  '-map [out]',
  '-map 1:a?',
  '-c:v libx264',
  '-c:a aac',
  '-preset ultrafast',
  '-crf 28',
  '-pix_fmt yuv420p',
  '-r 25',
  '-t', String(Math.ceil(videoDuration)),
])
        .output(tmpOut)
        .on('stderr', line => console.log('ffmpeg:', line))
        .on('end', () => { console.log('ffmpeg done'); resolve(); })
        .on('error', (err) => { console.log('ffmpeg error:', err.message); reject(err); })
        .run();
    });

    // Upload sur info-beamer
    const mp4Buffer = readFileSync(tmpOut);
    console.log('Output size:', mp4Buffer.length);

    const form = new FormData();
    const blob = new Blob([mp4Buffer], { type: 'video/mp4' });
    form.append('file', blob, filename);

    const uploadRes = await fetch('https://info-beamer.com/api/v1/asset/upload', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('api:' + ibApiKey).toString('base64'),
      },
      body: form,
    });

    const data = await uploadRes.json();
    console.log('Upload response:', data);

    cleanup(tmpBg, tmpBgRot, tmpVideoIn, tmpOut);

    if (!uploadRes.ok) {
      return res.status(400).json({ error: data.error || 'Upload échoué' });
    }

    res.json({ success: true, assetId: data.asset_id, thumb: data.info?.thumb || null });

  } catch (error) {
    console.error('assemble error:', error);
    cleanup(tmpBg, tmpBgRot, tmpVideoIn, tmpOut);
    res.status(500).json({ error: error.message });
  }
});

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadFile(response.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

function cleanup(...files) {
  files.forEach(f => { try { if (existsSync(f)) unlinkSync(f); } catch {} });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`la-borne-ffmpeg running on port ${PORT}`);
});
