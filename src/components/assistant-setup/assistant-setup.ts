import { BaseComponent } from '../../core/base-component.ts';
import { assistant, assistantKeys } from '../../assistant/assistant-service.ts';
import type { AssistantState } from '../../assistant/assistant-controller.ts';
import { PROVIDER_IDS, PROVIDERS } from '../../assistant/providers.ts';
import type { ProviderId } from '../../assistant/providers.ts';
import template from './assistant-setup.html?raw';
import style from './assistant-setup.css?raw';

/**
 * Assistant setup, a view of the primary side bar (ADR 0022, 0023): which
 * provider the chat uses, each provider's key, model and (for a local
 * server) address, with Load models and Test connection.
 */
export class AssistantSetupComponent extends BaseComponent {
  static tagName = 'assistant-setup';

  constructor() {
    super(template, style);
  }

  init() {
    const host = this.querySelector<HTMLElement>('.setup-providers')!;
    const tpl = this.querySelector<HTMLTemplateElement>('.provider-template')!;
    const keysNote = this.querySelector<HTMLElement>('.setup-keys-note')!;
    const unlock = this.querySelector<HTMLButtonElement>('.setup-unlock')!;

    keysNote.textContent = assistantKeys.canRemember
      ? 'Keys are kept for this session. Tick “Remember” to save them with this browser’s passwords; the browser may ask first.'
      : 'This browser has no password manager API, so keys are kept for this session only and asked for again after a reload.';
    unlock.hidden = !assistantKeys.canRemember;
    unlock.addEventListener('click', async () => {
      unlock.disabled = true;
      const found = await assistantKeys.unlock();
      unlock.disabled = false;
      unlock.hidden = found;
      if (!found) keysNote.textContent = 'No saved keys were found.';
    });

    const rows = new Map<ProviderId, () => void>();
    for (const id of PROVIDER_IDS) {
      const info = PROVIDERS[id];
      const row = tpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
      row.dataset.provider = id;
      row.setAttribute('aria-label', info.name);
      const q = <T extends Element>(s: string) => row.querySelector<T>(s)!;
      const use = q<HTMLInputElement>('.provider-use');
      const url = q<HTMLInputElement>('.provider-url');
      const key = q<HTMLInputElement>('.provider-key');
      const remember = q<HTMLInputElement>('.provider-remember');
      const model = q<HTMLInputElement>('.provider-model');
      const models = q<HTMLDataListElement>('.provider-models');
      const status = q<HTMLElement>('.provider-status');
      q('.provider-name').textContent = info.name;
      q('.provider-help').textContent = info.keyHelp;
      q('.key-label').textContent = info.needsKey
        ? 'API key'
        : 'API key (optional)';
      // Accessible names that say which provider each control is for.
      use.setAttribute('aria-label', `Use ${info.name}`);
      url.setAttribute('aria-label', `${info.name} server address`);
      key.setAttribute('aria-label', `${info.name} API key`);
      remember.setAttribute('aria-label', `Remember the ${info.name} key`);
      model.setAttribute('aria-label', `${info.name} model`);
      q<HTMLButtonElement>('.provider-load').setAttribute(
        'aria-label',
        `Load ${info.name} models`
      );
      q<HTMLButtonElement>('.provider-test').setAttribute(
        'aria-label',
        `Test ${info.name} connection`
      );
      models.id = `assistant-models-${id}`;
      model.setAttribute('list', models.id);
      model.placeholder =
        info.defaultModel ||
        (id === 'local' ? 'the server’s model' : 'Load models, or type one');
      q<HTMLElement>('.field-url').hidden = id !== 'local';
      q<HTMLElement>('.provider-remember-label').hidden =
        !assistantKeys.canRemember;

      use.addEventListener(
        'change',
        () => use.checked && assistant.setProvider(id)
      );
      url.addEventListener('change', () => {
        const problem = assistant.setLocalBaseUrl(url.value);
        status.textContent = problem ?? '';
        url.setAttribute('aria-invalid', String(!!problem));
      });
      const saveKey = async () => {
        try {
          await assistantKeys.set(id, key.value.trim(), remember.checked);
          status.textContent = '';
        } catch {
          status.textContent =
            'The browser didn’t save the key; it is kept for this session.';
        }
      };
      key.addEventListener('change', () => void saveKey());
      remember.addEventListener('change', () => void saveKey());
      model.addEventListener('change', () =>
        assistant.setModel(id, model.value)
      );
      q('.provider-load').addEventListener('click', async () => {
        status.textContent = 'Loading models…';
        try {
          const ids = await assistant.loadModels(id);
          models.replaceChildren(
            ...ids.map((m) =>
              Object.assign(document.createElement('option'), { value: m })
            )
          );
          status.textContent = ids.length
            ? `${ids.length} models: choose one in Model.`
            : 'The server listed no models.';
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : String(e);
        }
      });
      q('.provider-test').addEventListener('click', async () => {
        status.textContent = 'Testing…';
        status.textContent = await assistant.testConnection(id);
      });

      rows.set(id, () => {
        const s = assistant.store.getState();
        use.checked = s.settings.provider === id;
        row.classList.toggle('chosen', use.checked);
        if (document.activeElement !== url) url.value = s.settings.localBaseUrl;
        if (document.activeElement !== model)
          model.value = s.settings.models[id] ?? '';
        if (document.activeElement !== key) key.value = assistantKeys.get(id);
        remember.checked = assistantKeys.remembered(id);
      });
      host.append(row);
    }
    const render = () => rows.forEach((r) => r());
    render();
    assistant.store.addEventListener('change', ((
      _e: CustomEvent<AssistantState>
    ) => render()) as EventListener);
    assistantKeys.addEventListener('change', render);
  }
}

if (!customElements.get(AssistantSetupComponent.tagName)) {
  customElements.define(
    AssistantSetupComponent.tagName,
    AssistantSetupComponent
  );
}
