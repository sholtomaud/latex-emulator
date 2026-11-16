import { BaseComponent } from '../../core/base-component.ts';
import { zoteroPluginStore } from '../../store/zotero-plugin-store.ts';
import type { ZoteroPluginState } from '../../store/zotero-plugin-store.ts';
import { zoteroPluginActions } from '../../references/zotero-plugin-service.ts';
import { pluginStatusText } from '../../references/zotero-plugin.ts';
import template from './zotero-plugin-panel.html?raw';
import style from './zotero-plugin-panel.css?raw';

/**
 * Get the Zotero plugin, connect (pair) and see its status (ADR 0024).
 * It sits in a closed <details> in References, and only checks for
 * Zotero once that is opened.
 */
export class ZoteroPluginPanelComponent extends BaseComponent {
  static tagName = 'zotero-plugin-panel';

  constructor() {
    super(template, style);
  }

  init() {
    const get = this.querySelector<HTMLAnchorElement>('.zp-get')!;
    get.href = `${window.BOBA_BASE_URL ?? '/'}zotero/latex-emulator-zotero.xpi`;
    const remember =
      this.querySelector<HTMLInputElement>('.zp-remember-input')!;
    const connect = this.querySelector<HTMLButtonElement>('.zp-connect')!;
    const disconnect = this.querySelector<HTMLButtonElement>('.zp-disconnect')!;
    remember.addEventListener('change', () =>
      zoteroPluginActions.setRemember(remember.checked)
    );
    connect.addEventListener('click', () => void zoteroPluginActions.connect());
    disconnect.addEventListener(
      'click',
      () => void zoteroPluginActions.disconnect()
    );

    const details = this.closest('details');
    const check = () => {
      if (!details || details.open) void zoteroPluginActions.check();
    };
    details?.addEventListener('toggle', check);
    check();

    const render = ({ status, remember: keep }: ZoteroPluginState) => {
      this.querySelector('.zp-status')!.textContent = pluginStatusText(status);
      const connected = status.state === 'connected';
      const busy = status.state === 'pairing' || status.state === 'checking';
      // Once connected, the install steps have done their job.
      this.querySelector<HTMLElement>('.zp-steps')!.hidden = connected;
      connect.hidden = connected;
      connect.disabled = busy;
      disconnect.hidden = !connected;
      remember.checked = keep;
      remember.disabled = connected || busy;
    };
    render(zoteroPluginStore.getState());
    zoteroPluginStore.addEventListener('change', ((
      e: CustomEvent<ZoteroPluginState>
    ) => render(e.detail)) as EventListener);
  }
}

if (!customElements.get(ZoteroPluginPanelComponent.tagName)) {
  customElements.define(
    ZoteroPluginPanelComponent.tagName,
    ZoteroPluginPanelComponent
  );
}
