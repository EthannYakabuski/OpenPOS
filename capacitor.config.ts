import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'org.openpos.mobile',
  appName: 'OpenPOS',
  webDir: 'dist/android',
  loggingBehavior: 'none',
  android: {
    path: 'apps/android',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
    minWebViewVersion: 111
  }
};
export default config;
