// @reinvent-commander/backend — OAuth 2.0 Authorization Code + PKCE client
//
// Wraps the AWS Builder ID OAuth endpoints used by the Auth_Service: building
// the authorize URL, exchanging an authorization code for tokens, refreshing
// an access token, and revoking a refresh token. All network I/O goes through
// an injected `fetch` so tests can mock the upstream. Every value is URL- or
// form-encoded exactly once; no token value is ever logged by this module.

import type { FetchLike } from '../upstream.js';

/** Public shared client id for AWS Builder ID (no secret). */
export const OAUTH_CLIENT_ID = '7vmom55m1qstvq8i71ph127bfq';

/** Identity provider is always AWS Builder ID. */
export const OAUTH_IDENTITY_PROVIDER = 'AWSBuilderID';

/** Requested scope (space-separated; URL-encoded by URLSearchParams). */
export const OAUTH_SCOPE = 'openid email events/access';

/** AWS Builder ID OAuth endpoints. */
export const OAUTH_AUTHORIZE_URL = 'https://oauth.awsevents.com/oauth2/authorize';
export const OAUTH_TOKEN_URL = 'https://oauth.awsevents.com/oauth2/token';
export const OAUTH_REVOKE_URL = 'https://oauth.awsevents.com/oauth2/revoke';

/** Default access-token lifetime (seconds) when the response omits `expires_in`. */
export const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 3600;

/** Inputs for building the authorize URL. */
export interface AuthorizeUrlParams {
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

/** The token-endpoint response fields this client reads (all untrusted). */
export interface TokenResponse {
  accessToken: string;
  idToken?: string;
  refreshToken: string;
  /** Access-token lifetime in seconds (defaulted when the upstream omits it). */
  expiresInSeconds: number;
}

export interface OAuthClientOptions {
  /** Injected fetch so tests can mock the OAuth endpoints. */
  fetchImpl?: FetchLike;
  authorizeUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
  clientId?: string;
}

/** A form `fetch` that can carry a urlencoded body (superset of FetchLike). */
type FormFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<Response>;

async function parseJsonSafe(response: Response): Promise<Record<string, unknown> | undefined> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Build a {@link TokenResponse} from an untrusted token-endpoint body. Requires
 * `access_token` and `refresh_token`; defaults the lifetime when `expires_in`
 * is missing or non-numeric. Returns `undefined` when the body is unusable.
 */
function readTokenResponse(body: Record<string, unknown> | undefined): TokenResponse | undefined {
  const accessToken = asString(body?.access_token);
  const refreshToken = asString(body?.refresh_token);
  if (!accessToken || !refreshToken) return undefined;

  const rawExpires = body?.expires_in;
  const expiresInSeconds =
    typeof rawExpires === 'number' && Number.isFinite(rawExpires) && rawExpires > 0
      ? Math.floor(rawExpires)
      : DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS;

  const result: TokenResponse = { accessToken, refreshToken, expiresInSeconds };
  const idToken = asString(body?.id_token);
  if (idToken) result.idToken = idToken;
  return result;
}

export class OAuthClient {
  private readonly fetchImpl: FormFetch;
  private readonly authorizeUrl: string;
  private readonly tokenUrl: string;
  private readonly revokeUrl: string;
  private readonly clientId: string;

  constructor(options: OAuthClientOptions = {}) {
    this.fetchImpl = (options.fetchImpl ?? (globalThis.fetch as FetchLike)) as FormFetch;
    this.authorizeUrl = options.authorizeUrl ?? OAUTH_AUTHORIZE_URL;
    this.tokenUrl = options.tokenUrl ?? OAUTH_TOKEN_URL;
    this.revokeUrl = options.revokeUrl ?? OAUTH_REVOKE_URL;
    this.clientId = options.clientId ?? OAUTH_CLIENT_ID;
  }

  /**
   * Build the authorize URL with exactly the fixed parameter set. The
   * `redirect_uri` here MUST be byte-identical to the one used at token
   * exchange. `URLSearchParams` encodes every value exactly once.
   */
  buildAuthorizeUrl(params: AuthorizeUrlParams): string {
    const query = new URLSearchParams();
    query.set('response_type', 'code');
    query.set('client_id', this.clientId);
    query.set('redirect_uri', params.redirectUri);
    query.set('scope', OAUTH_SCOPE);
    query.set('code_challenge', params.codeChallenge);
    query.set('code_challenge_method', 'S256');
    query.set('state', params.state);
    query.set('identity_provider', OAUTH_IDENTITY_PROVIDER);
    return `${this.authorizeUrl}?${query.toString()}`;
  }

  /**
   * Exchange an authorization `code` for tokens using the PKCE `codeVerifier`.
   * `redirectUri` must be byte-identical to the authorize request.
   */
  async exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<TokenResponse | undefined> {
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', input.code);
    body.set('redirect_uri', input.redirectUri);
    body.set('client_id', this.clientId);
    body.set('code_verifier', input.codeVerifier);

    const response = await this.postForm(this.tokenUrl, body);
    if (!response || response.status < 200 || response.status >= 300) {
      if (response) await response.text().catch(() => undefined);
      return undefined;
    }
    return readTokenResponse(await parseJsonSafe(response));
  }

  /**
   * Refresh an access token with a refresh token. Returns `undefined` when the
   * refresh is rejected (any non-2xx) or the response is unusable, signalling
   * the caller that re-auth is required.
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse | undefined> {
    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', refreshToken);
    body.set('client_id', this.clientId);

    const response = await this.postForm(this.tokenUrl, body);
    if (!response || response.status < 200 || response.status >= 300) {
      if (response) await response.text().catch(() => undefined);
      return undefined;
    }
    const parsed = readTokenResponse(await parseJsonSafe(response));
    if (!parsed) return undefined;
    // A refresh response may omit a new refresh token; reuse the existing one.
    if (!parsed.refreshToken) parsed.refreshToken = refreshToken;
    return parsed;
  }

  /**
   * Revoke a refresh token. Best-effort: resolves `true` on a 2xx, `false`
   * otherwise (including transport failure). The caller clears local session
   * state regardless of the result.
   */
  async revokeToken(refreshToken: string): Promise<boolean> {
    const body = new URLSearchParams();
    body.set('token', refreshToken);
    body.set('client_id', this.clientId);

    const response = await this.postForm(this.revokeUrl, body);
    if (!response) return false;
    const ok = response.status >= 200 && response.status < 300;
    await response.text().catch(() => undefined);
    return ok;
  }

  private async postForm(url: string, body: URLSearchParams): Promise<Response | undefined> {
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: body.toString(),
      });
    } catch {
      return undefined;
    }
  }
}
