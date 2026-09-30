const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
(async () => {
  const input = path.join(__dirname, '../assets/logo.svg');
  await sharp(input).resize(512, 512).png().toFile(path.join(__dirname, '../assets/icon.png'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map((size) => sharp(input).resize(size, size).png().toBuffer())
  );
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((buffer, i) => {
    const at = 6 + 16 * i;
    header[at] = header[at + 1] = sizes[i] === 256 ? 0 : sizes[i];
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(buffer.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += buffer.length;
  });
  fs.writeFileSync(path.join(__dirname, '../assets/icon.ico'), Buffer.concat([header, ...images]));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
