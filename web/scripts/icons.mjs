import fs from 'node:fs';
const sizes = [192, 512];
for (const s of sizes) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 512 512"><rect width="512" height="512" rx="110" fill="#0b6e4f"/><rect x="150" y="110" width="60" height="292" rx="18" fill="#fff"/><rect x="110" y="150" width="292" height="60" rx="18" fill="#fff" opacity=".85"/></svg>`;
  fs.mkdirSync('public/icons', { recursive: true });
  // PNG veri richiedono sharp; qui salviamo SVG fallback rinominato solo se sharp assente.
  try {
    const { default: sharp } = await import('sharp');
    await sharp(Buffer.from(svg)).png().toFile(`public/icons/icon-${s}.png`);
    console.log('icona', s, 'ok');
  } catch {
    fs.writeFileSync(`public/icons/icon-${s}.png.svg`, svg);
    console.log('sharp assente: creato fallback public/icons/icon-' + s + '.png.svg (convertilo in PNG)');
  }
}
