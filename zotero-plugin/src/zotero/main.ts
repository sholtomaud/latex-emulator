/**
 * The plugin inside Zotero (ADR 0024): adds the MCP endpoint to Zotero's
 * server on 127.0.0.1:23119, keeps paired clients in Zotero's preferences,
 * asks the user before pairing, and registers the settings pane.
 * `bootstrap.js` (written by scripts/build-zotero-plugin.ts) calls
 * startup() and shutdown().
 */
import { MCP_PATH } from '../protocol.ts';
import type { Scope } from '../protocol.ts';
import { createServer } from '../server.ts';
import type { Client, PairingRequest } from '../server.ts';
import {
  mcpCommand,
  pairingPrompt,
  parseClients,
  parseOrigins,
  tokenFromBytes,
} from '../config.ts';
import { zoteroPort } from './port.ts';

declare const __PLUGIN__: { id: string; version: string; site: string };

const CLIENTS = 'extensions.latex-emulator.clients';
const ORIGINS = 'extensions.latex-emulator.origins';

// Reason phrases Zotero's server lacks for statuses the endpoint returns.
const EXTRA_CODES: Record<number, string> = {
  202: 'Accepted',
  401: 'Unauthorized',
  405: 'Method Not Allowed',
};

let paneID: string | null = null;
let addedCodes: number[] = [];

const clients = () => parseClients(Zotero.Prefs.get(CLIENTS, true));
const saveClients = (list: Client[]) =>
  Zotero.Prefs.set(CLIENTS, JSON.stringify(list), true);
const origins = () =>
  parseOrigins(Zotero.Prefs.get(ORIGINS, true), __PLUGIN__.site);

function randomToken(): string {
  const random = Components.classes[
    '@mozilla.org/security/random-generator;1'
  ].getService(Components.interfaces.nsIRandomGenerator) as {
    generateRandomBytes(n: number): number[];
  };
  return tokenFromBytes(Uint8Array.from(random.generateRandomBytes(32)));
}

/** Zotero's dialog; resolves when the user answers (Deny is the default). */
function confirmPairing(request: PairingRequest): Promise<boolean> {
  return new Promise((resolve) => {
    // Let the HTTP request finish being handled before the modal dialog.
    setTimeout(() => {
      const win = Zotero.getMainWindow();
      win?.focus();
      const p = Services.prompt;
      const flags =
        p.BUTTON_POS_0 * p.BUTTON_TITLE_IS_STRING +
        p.BUTTON_POS_1 * p.BUTTON_TITLE_IS_STRING +
        p.BUTTON_POS_1_DEFAULT;
      const button = p.confirmEx(
        win,
        'Connect to Zotero?',
        pairingPrompt(request),
        flags,
        'Allow',
        'Deny',
        null,
        null,
        { value: false }
      );
      resolve(button === 0);
    }, 0);
  });
}

/** Called by the settings pane (preferences.ts). */
const api = {
  site: () => __PLUGIN__.site,
  clients: () => clients().map(({ token: _token, ...c }) => c),
  revoke(id: string) {
    saveClients(clients().filter((c) => c.id !== id));
  },
  /** A client for an outside agent; returns the command to paste. */
  addAgent(name: string, scopes: Scope[] = ['read']): string {
    const token = randomToken();
    saveClients([
      ...clients(),
      {
        id: `client-${Date.now()}`,
        name,
        origin: null,
        token,
        scopes,
        createdAt: Date.now(),
      },
    ]);
    return mcpCommand(token);
  },
  extraOrigins: () => String(Zotero.Prefs.get(ORIGINS, true) ?? ''),
  setExtraOrigins(text: string) {
    Zotero.Prefs.set(ORIGINS, text, true);
  },
};

export function startup({
  rootURI,
}: {
  id: string;
  version: string;
  rootURI: string;
}) {
  const server = createServer({
    port: zoteroPort,
    clients: { list: clients, add: (c) => saveClients([...clients(), c]) },
    allowedOrigins: origins,
    confirmPairing,
    randomToken,
    now: () => Date.now(),
    info: { pluginVersion: __PLUGIN__.version, zoteroVersion: Zotero.version },
  });

  // Zotero's server makes a new endpoint object per request.
  function Endpoint() {}
  const endpoint: ZoteroEndpoint = {
    supportedMethods: ['GET', 'POST', 'DELETE'],
    supportedDataTypes: ['application/json', 'text/plain'],
    // Browser requests are dropped unless the endpoint opts in; ours then
    // checks Host, Origin and the token itself (server.ts).
    allowRequestsFromUnsafeWebContent: true,
    async init(request) {
      try {
        const res = await server.handle({
          method: request.method,
          headers: request.headers,
          body: request.data,
        });
        return [res.status, res.headers, res.body];
      } catch (e) {
        Zotero.logError(e);
        return [500, { 'Content-Type': 'text/plain' }, 'The plugin failed.'];
      }
    },
  };
  Endpoint.prototype = endpoint;
  Zotero.Server.Endpoints[MCP_PATH] = Endpoint;

  addedCodes = [];
  for (const [code, text] of Object.entries(EXTRA_CODES))
    if (!Zotero.Server.responseCodes[Number(code)]) {
      Zotero.Server.responseCodes[Number(code)] = text;
      addedCodes.push(Number(code));
    }

  Zotero.LatexEmulator = api;
  void Zotero.PreferencePanes.register({
    pluginID: __PLUGIN__.id,
    src: rootURI + 'preferences.xhtml',
    label: 'LaTeX Emulator',
    scripts: [rootURI + 'preferences.js'],
  }).then((id) => (paneID = id));
  Zotero.debug(`LaTeX Emulator: MCP endpoint at ${MCP_PATH}`);
}

export function shutdown() {
  delete Zotero.Server.Endpoints[MCP_PATH];
  for (const code of addedCodes) delete Zotero.Server.responseCodes[code];
  delete Zotero.LatexEmulator;
  if (paneID) Zotero.PreferencePanes.unregister(paneID);
  paneID = null;
}
