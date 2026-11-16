/**
 * The settings pane (Zotero → Settings → LaTeX Emulator): paired clients
 * with Remove buttons, "Add an MCP client", and the allowed websites.
 * It talks to the running plugin through Zotero.LatexEmulator (main.ts).
 * Built into preferences.js; Zotero loads it before the pane's markup and
 * then dispatches `load` at the pane, which we catch on the way down.
 */
interface PaneApi {
  site(): string;
  clients(): {
    id: string;
    name: string;
    origin: string | null;
    scopes: string[];
    createdAt: number;
  }[];
  revoke(id: string): void;
  addAgent(name: string): string;
  extraOrigins(): string;
  setExtraOrigins(text: string): void;
}

function init(root: Element) {
  const api = Zotero.LatexEmulator as PaneApi;
  const doc = root.ownerDocument;
  const html = (tag: string) =>
    doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
  const $ = <T extends Element>(s: string) => root.querySelector<T>(s)!;
  const list = $<HTMLUListElement>('.le-clients');
  const none = $<HTMLElement>('.le-none');

  const render = () => {
    const clients = api.clients();
    none.hidden = clients.length > 0;
    list.replaceChildren(
      ...clients.map((c) => {
        const li = html('li');
        const where = c.origin ?? 'a program on this computer';
        li.append(
          `${c.name} — ${where} — ${c.scopes.join(', ')} — since ${new Date(c.createdAt).toLocaleDateString()} `
        );
        const remove = html('button');
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          api.revoke(c.id);
          render();
        });
        li.append(remove);
        return li;
      })
    );
  };

  $('.le-add').addEventListener('click', () => {
    const name = { value: 'Claude Code' };
    if (
      !Services.prompt.prompt(
        null,
        'Add an MCP client',
        'Name it, so you know it in this list:',
        name,
        null,
        { value: false }
      )
    )
      return;
    if (!name.value.trim()) return;
    const command = $<HTMLTextAreaElement>('.le-command');
    command.value = api.addAgent(name.value.trim().slice(0, 60));
    command.hidden = false;
    command.select();
    render();
  });

  $('.le-site').textContent = `Always: ${new URL(api.site()).origin}`;
  const origins = $<HTMLTextAreaElement>('.le-origins');
  origins.value = api.extraOrigins();
  $('.le-save-origins').addEventListener('click', () =>
    api.setExtraOrigins(origins.value)
  );
  render();
}

document.addEventListener(
  'load',
  (e) => {
    const target = e.target as Element | null;
    if (target?.id === 'latex-emulator-prefs') init(target);
  },
  true
);
