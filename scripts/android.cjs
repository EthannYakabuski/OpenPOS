/* Native Android builds share the renderer built by build:android. No upload or publishing occurs. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const native = path.join(root, 'apps', 'android');
const command = process.argv[2];
const signed = process.argv.includes('--signed');
const tasks = {
  apk: ':app:assembleDebug',
  bundle: ':app:bundleRelease',
  test: ':app:testDebugUnitTest'
};
function fail(message) {
  console.error(message);
  process.exit(1);
}
if (!tasks[command] || process.argv.slice(3).some((arg) => arg !== '--signed'))
  fail('Usage: node scripts/android.cjs apk|bundle|test [--signed]');
if (signed && command !== 'bundle') fail('--signed is only supported for release bundles.');
const signingVariables = [
  'OPENPOS_ANDROID_KEYSTORE',
  'OPENPOS_ANDROID_STORE_PASSWORD',
  'OPENPOS_ANDROID_KEY_ALIAS',
  'OPENPOS_ANDROID_KEY_PASSWORD'
];
if (signed && signingVariables.some((key) => !process.env[key]))
  fail(
    `A signed release requires ${signingVariables.join(', ')}. No key is generated automatically.`
  );
if (signed && !fs.existsSync(path.resolve(process.env.OPENPOS_ANDROID_KEYSTORE)))
  fail('OPENPOS_ANDROID_KEYSTORE does not point to an existing upload keystore.');
const localJava = path.join(root, '.tools', 'java');
const candidates = [
  process.env.JAVA_HOME,
  ...(fs.existsSync(localJava)
    ? fs.readdirSync(localJava).map((entry) => path.join(localJava, entry))
    : []),
  process.platform === 'win32' &&
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio', 'jbr'),
  process.platform === 'darwin' && '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
].filter(Boolean);
function javaWorks(home) {
  const binary = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!fs.existsSync(binary)) return false;
  const result = spawnSync(binary, ['-version'], { encoding: 'utf8', windowsHide: true });
  const match = `${result.stdout || ''}${result.stderr || ''}`.match(/version "(\d+)/);
  return result.status === 0 && match && Number(match[1]) >= 21;
}
const javaHome = candidates.find(javaWorks);
if (!javaHome)
  fail('Android requires JDK 21 or newer. Set JAVA_HOME to its installation directory.');
const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.platform === 'win32' &&
    process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
  process.platform === 'darwin' &&
    process.env.HOME &&
    path.join(process.env.HOME, 'Library', 'Android', 'sdk'),
  process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk')
].filter(Boolean);
const sdk = sdkCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'platforms', 'android-36', 'android.jar'))
);
if (!sdk)
  fail(
    'Install Android SDK Platform 36 and Build Tools 36.0.0, then set ANDROID_HOME to the SDK directory.'
  );
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path')
);
env[process.platform === 'win32' ? 'Path' : 'PATH'] =
  `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
env.JAVA_HOME = javaHome;
env.ANDROID_HOME = sdk;
env.ANDROID_SDK_ROOT = sdk;
env.GRADLE_USER_HOME = process.env.GRADLE_USER_HOME || path.join(root, '.cache', 'gradle');
if (signed) env.OPENPOS_ANDROID_KEYSTORE = path.resolve(process.env.OPENPOS_ANDROID_KEYSTORE);
else for (const key of signingVariables) delete env[key];
const args = [tasks[command], '--no-daemon', '--console=plain'];
if (signed) args.push('-PopenposSigned=true');
console.log(
  `Building Android ${command}${signed ? ' with the supplied upload key' : ' (no release signing)'}...`
);
const result =
  process.platform === 'win32'
    ? spawnSync(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', `gradlew.bat ${args.join(' ')}`],
        { cwd: native, env, stdio: 'inherit', windowsHide: true }
      )
    : spawnSync('sh', ['./gradlew', ...args], { cwd: native, env, stdio: 'inherit' });
if (result.error) fail(result.error.message);
if (result.status !== 0) process.exit(result.status || 1);
if (command === 'bundle')
  console.log(
    `Bundle: apps/android/app/build/outputs/bundle/release/app-release.aab${signed ? '' : ' (unsigned; sign with your upload key before Play submission)'}`
  );
if (command === 'apk')
  console.log('Development APK: apps/android/app/build/outputs/apk/debug/app-debug.apk');
