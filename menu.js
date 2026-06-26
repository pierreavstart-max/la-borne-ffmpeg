
const { createCanvas, loadImage } = require('canvas');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const execAsync = promisify(exec);
const admin = require('firebase-admin');

const IB_API_KEY = process.env.INFOBEAMER_API_KEY;

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return destPath;
}

async function pdfToImage(pdfPath, outputDir) {
  // Utilise pdftoppm pour convertir la 1ère page du PDF en PNG haute résolution
  const outputBase = path.join(outputDir, 'menu-page');
  await execAsync(`pdftoppm -png -r 300 -f 1 -l 1 "${pdfPath}" "${outputBase}"`);
  // pdftoppm génère menu-page-1.png
  const pngPath = `${outputBase}-1.png`;
  if (!fs.existsSync(pngPath)) throw new Error('PDF to PNG conversion failed');
  return pngPath;
}

async function processMenu() {
  console.log('=== MENU JOB STARTED ===', new Date().toISOString());

  // 1. Récupérer la config menu depuis Firestore
  const db = admin.firestore();
  const configSnap = await db.collection('menuConfig').get();
  if (configSnap.empty) {
    throw new Error('Aucune configuration menu trouvée dans Firestore');
  }
  const config = configSnap.docs[0].data();

  if (!config.backgroundUrl || !config.pdfUrl) {
    throw new Error('Background ou PDF manquant dans la config');
  }

  console.log('Config loaded:', {
    bgUrl: config.backgroundUrl.substring(0, 80) + '...',
    pdfUrl: config.pdfUrl.substring(0, 80) + '...',
    filename: config.ibFilename,
    x: config.x, y: config.y, w: config.width, h: config.height,
  });

  // 2. Télécharger background et PDF
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-'));
  const bgPath = path.join(tmpDir, 'background.png');
  const pdfPath = path.join(tmpDir, 'menu.pdf');

  await downloadFile(config.backgroundUrl, bgPath);
  await downloadFile(config.pdfUrl, pdfPath);
  console.log('Files downloaded');

  // 3. Convertir PDF en image
  const menuImgPath = await pdfToImage(pdfPath, tmpDir);
  console.log('PDF converted to PNG:', menuImgPath);

  // 4. Charger background et menu, créer le composite
  const bgImage = await loadImage(bgPath);
  const menuImage = await loadImage(menuImgPath);

  // Canvas aux dimensions du background
  const canvas = createCanvas(bgImage.width, bgImage.height);
  const ctx = canvas.getContext('2d');

  // Dessiner le background
  ctx.drawImage(bgImage, 0, 0, bgImage.width, bgImage.height);

  // Dessiner le menu aux coordonnées définies
  ctx.drawImage(menuImage, config.x, config.y, config.width, config.height);

  console.log('Composite created:', bgImage.width, 'x', bgImage.height);

  // 5. Exporter en JPEG
  const outputPath = path.join(tmpDir, config.ibFilename || 'MENU.jpg');
  const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
  fs.writeFileSync(outputPath, jpegBuffer);
  console.log('Output size:', jpegBuffer.length, 'bytes');

  // 6. Upload sur info-beamer (remplace l'asset existant par nom)
  const filename = config.ibFilename || 'MENU.jpg';

  // Chercher l'asset existant par nom pour le remplacer
  const listRes = await fetch('https://info-beamer.com/api/v1/asset/list', {
    headers: { 'Authorization': 'Basic ' + Buffer.from('api:' + IB_API_KEY).toString('base64') },
  });
  const listData = await listRes.json();
  const existingAsset = listData.assets?.find(a => a.filename === filename);

  if (existingAsset) {
    console.log('Existing asset found, deleting:', existingAsset.id);
    await fetch(`https://info-beamer.com/api/v1/asset/${existingAsset.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Basic ' + Buffer.from('api:' + IB_API_KEY).toString('base64') },
    });
  }

  // Upload du nouveau fichier
  const form = new FormData();
  const blob = new Blob([jpegBuffer], { type: 'image/jpeg' });
  form.append('file', blob, filename);

  const uploadRes = await fetch('https://info-beamer.com/api/v1/asset/upload', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + Buffer.from('api:' + IB_API_KEY).toString('base64') },
    body: form,
  });
  const uploadData = await uploadRes.json();
  console.log('Upload result:', uploadData);

  // Nettoyer
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('=== MENU JOB DONE ===');
  return { success: true, assetId: uploadData.asset_id, filename };
}

module.exports = { processMenu };
