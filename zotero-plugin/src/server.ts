/**
 * The plugin's MCP endpoint (ADR 0024), as a pure function from an HTTP
 * request to a response. `zotero/endpoint.ts` adapts it to Zotero's server.
 *
 * In order, every request must:
 * 1. name our Host (127.0.0.1 or localhost), against DNS rebinding;
 * 2. come from an allowed Origin, if it has one;
 * 3. carry a known token, bound to that origin (except pairing).
 *
 * The app sends simple requests (text/plain, token in params._meta),
 * because Zotero answers CORS preflights itself; outside agents send
 * standard MCP with a bearer token. Both get the same JSON-RPC.
 */
import {
  PAIR_METHOD,
  PROTOCOL_VERSIONS,
  RPC,
  SCOPES,
  TOKEN_META_KEY,
  ZOTERO_PORT,
} from './protocol.ts';
import type { PairResult, Scope } from './protocol.ts';
import type { ZoteroPort } from './port.ts';
import { ToolError, runTool, toolsFor } from './tools.ts';

export interface HttpRequest {
  method: string;
  /** Lower-case names, as Zotero's server gives them. */
  headers: Record<string, string>;
  /** The raw text, or JSON Zotero already parsed (application/json). */
  body: unknown;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** A paired client: the app (with its origin) or an outside agent (none). */
export interface Client {
  id: string;
  name: string;
  origin: string | null;
  token: string;
  scopes: Scope[];
  createdAt: number;
}

export interface PairingRequest {
  name: string;
  code: string;
  scopes: Scope[];
  origin: string | null;
}

export interface ServerDeps {
  port: ZoteroPort;
  clients: { list(): Client[]; add(client: Client): void };
  allowedOrigins(): string[];
  /** Ask the user in Zotero; resolves true only if they allow it. */
  confirmPairing(request: PairingRequest): Promise<boolean>;
  randomToken(): string;
  now(): number;
  info: { pluginVersion: string; zoteroVersion: string };
}

type Id = string | number | null;

interface Message {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

const HOSTS = [`127.0.0.1:${ZOTERO_PORT}`, `localhost:${ZOTERO_PORT}`];

export function createServer(deps: ServerDeps) {
  let pairing = false;

  async function handle(req: HttpRequest): Promise<HttpResponse> {
    if (!HOSTS.includes(req.headers.host ?? ''))
      return text(403, 'Forbidden host.');
    const origin = req.headers.origin ?? null;
    if (origin !== null && !deps.allowedOrigins().includes(origin))
      return text(403, 'Forbidden origin.');
    const cors: Record<string, string> = origin
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {};
    const reply = (status: number, body: unknown): HttpResponse => ({
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
      body: JSON.stringify(body),
    });

    // Streamable HTTP without SSE or sessions: only POST (MCP spec).
    if (req.method !== 'POST')
      return { status: 405, headers: { Allow: 'POST', ...cors }, body: '' };
    const version = req.headers['mcp-protocol-version'];
    if (version && !PROTOCOL_VERSIONS.includes(version))
      return reply(
        400,
        error(null, RPC.invalidRequest, 'Unsupported protocol version.')
      );

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return reply(400, error(null, RPC.parseError, 'Invalid JSON.'));
      }
    }
    if (!isObject(body) || body.jsonrpc !== '2.0')
      return reply(
        400,
        error(null, RPC.invalidRequest, 'Not a JSON-RPC 2.0 message.')
      );
    // A response or result sent to us: we never ask, so there's nothing to do.
    if (!('method' in body)) {
      if ('result' in body || 'error' in body)
        return { status: 202, headers: cors, body: '' };
      return reply(400, error(null, RPC.invalidRequest, 'No method.'));
    }
    const message = body as unknown as Message;
    if (
      typeof message.method !== 'string' ||
      (message.params !== undefined && !isObject(message.params))
    )
      return reply(
        400,
        error(null, RPC.invalidRequest, 'Bad method or params.')
      );
    const id = message.id ?? null;

    if (message.method === PAIR_METHOD)
      return reply(200, await pair(id, message.params, origin));

    const client = authenticate(req, message);
    if (!client)
      return reply(
        401,
        error(id, RPC.unauthorized, 'Pair with the Zotero plugin first.')
      );
    if (client.origin !== origin)
      return reply(
        403,
        error(id, RPC.forbidden, 'This token belongs to another client.')
      );

    if (message.id === undefined)
      return { status: 202, headers: cors, body: '' };
    return reply(200, await dispatch(id, message, client));
  }

  function authenticate(req: HttpRequest, message: Message): Client | null {
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const meta = message.params?._meta;
    const token =
      bearer ??
      (isObject(meta) && typeof meta[TOKEN_META_KEY] === 'string'
        ? meta[TOKEN_META_KEY]
        : '');
    if (!token) return null;
    return deps.clients.list().find((c) => sameToken(c.token, token)) ?? null;
  }

  async function dispatch(id: Id, message: Message, client: Client) {
    const params = message.params ?? {};
    switch (message.method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        return result(id, {
          protocolVersion:
            typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked)
              ? asked
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: 'latex-emulator-zotero',
            title: 'LaTeX Emulator for Zotero',
            version: deps.info.pluginVersion,
          },
          instructions: `The user's Zotero ${deps.info.zoteroVersion} library. Find references with search_items, then read one with get_item.`,
        });
      }
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, {
          tools: toolsFor(client.scopes).map(
            ({ name, title, description, inputSchema, annotations }) => ({
              name,
              title,
              description,
              inputSchema,
              annotations,
            })
          ),
        });
      case 'tools/call':
        return call(id, params, client);
      default:
        return error(
          id,
          RPC.methodNotFound,
          `Unknown method ${message.method}.`
        );
    }
  }

  async function call(id: Id, params: Record<string, unknown>, client: Client) {
    const name = params.name;
    const known = toolsFor(['read', 'write-notes', 'write-items']).find(
      (t) => t.name === name
    );
    if (!known)
      return error(id, RPC.invalidParams, `Unknown tool ${String(name)}.`);
    if (!client.scopes.includes(known.scope))
      return error(id, RPC.forbidden, `This client may not use ${known.name}.`);
    try {
      const out = await runTool(deps.port, known.name, params.arguments ?? {});
      return result(id, {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
      });
    } catch (e) {
      const message =
        e instanceof ToolError
          ? e.message
          : `Zotero could not do that: ${e instanceof Error ? e.message : String(e)}`;
      return result(id, {
        content: [{ type: 'text', text: message }],
        isError: true,
      });
    }
  }

  async function pair(
    id: Id,
    params: Record<string, unknown> | undefined,
    origin: string | null
  ) {
    const name = params?.name;
    const code = params?.code;
    const scopes = params?.scopes;
    if (
      typeof name !== 'string' ||
      name.length < 1 ||
      name.length > 60 ||
      typeof code !== 'string' ||
      !/^\d{4}$/.test(code) ||
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      !scopes.every((s) => (SCOPES as readonly unknown[]).includes(s))
    )
      return error(
        id,
        RPC.invalidParams,
        'Pairing needs a name, a four-digit code and scopes.'
      );
    if (pairing)
      return error(
        id,
        RPC.pairingBusy,
        'Zotero is already asking about another client.'
      );
    pairing = true;
    try {
      const request: PairingRequest = {
        name,
        code,
        scopes: scopes as Scope[],
        origin,
      };
      if (!(await deps.confirmPairing(request).catch(() => false)))
        return error(
          id,
          RPC.pairingRefused,
          'The pairing was not allowed in Zotero.'
        );
      const token = deps.randomToken();
      deps.clients.add({
        id: `client-${deps.now()}`,
        name,
        origin,
        token,
        scopes: request.scopes,
        createdAt: deps.now(),
      });
      const paired: PairResult = { token, scopes: request.scopes };
      return result(id, paired);
    } finally {
      pairing = false;
    }
  }

  return { handle };
}

const result = (id: Id, value: unknown) => ({
  jsonrpc: '2.0',
  id,
  result: value,
});
const error = (id: Id, code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});
const text = (status: number, body: string): HttpResponse => ({
  status,
  headers: { 'Content-Type': 'text/plain' },
  body,
});
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Compare without stopping at the first difference (timing). */
function sameToken(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
