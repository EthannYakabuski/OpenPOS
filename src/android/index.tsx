import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { AndroidClient } from './client';
import type { AndroidNativePort } from './native';
import { mountApp } from '../renderer/mount';

if (!Capacitor.isNativePlatform()) {
  document.getElementById('root')!.textContent =
    'OpenPOS Android runs in its installed app. Use the Windows application on a computer.';
} else {
  const native = registerPlugin<AndroidNativePort>('OpenPOSNative');
  const client = new AndroidClient(native);
  window.openpos = client;
  document.documentElement.dataset.platform = 'android';
  void NativeApp.addListener('appStateChange', ({ isActive }) => {
    client.setActive(isActive);
    if (!isActive) window.dispatchEvent(new Event('openpos:locked'));
  });
  void NativeApp.addListener('backButton', () => {
    // Let shared dialogs close first. Do not discard a ticket or exit with an accidental tap.
    const close = document.querySelector<HTMLButtonElement>(
      '.modal-overlay .modal-close, .modal-backdrop [aria-label="Close dialog"]'
    );
    if (close) close.click();
    else void NativeApp.minimizeApp();
  });
  window.addEventListener('pagehide', () => client.setActive(false));
  mountApp();
}
