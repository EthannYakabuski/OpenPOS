const fs = require('node:fs');
const path = require('node:path');

const names = ['react', 'react-dom', 'scheduler', '@mdi/js', '@mdi/react', 'webpack'];
const notices = names.map((name) => {
  const folder = path.dirname(require.resolve(`${name}/package.json`));
  const information = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
  const license = ['LICENSE', 'LICENSE.txt', 'LICENSE.md'].find((file) =>
    fs.existsSync(path.join(folder, file))
  );
  if (!license) throw new Error(`License text is missing for ${name}.`);
  return `${name} ${information.version}\n${'='.repeat(72)}\n${fs.readFileSync(path.join(folder, license), 'utf8')}`;
});
fs.writeFileSync(
  path.join(__dirname, '../assets/THIRD-PARTY-NOTICES.txt'),
  `OpenPOS third-party notices\n\nOpenPOS is distributed under Apache-2.0.\nElectron and Chromium notices accompany the application as LICENSE.electron.txt and LICENSES.chromium.html.\n\n${notices.join('\n\n')}\n`
);
