import { storage, ValueHash } from '@zaiusinc/app-sdk';

export interface AprimoCredentials {
  tenantDomain: string;
  clientId: string;
  clientSecret: string;
}

export interface TokenCache {
  get(): Promise<{ accessToken?: string; expiresAt?: number }>;
  put(accessToken: string, expiresAt: number): Promise<void>;
  clear(): Promise<void>;
}

export interface ListRecordsOptions {
  /** Aprimo filter expression, e.g. `ContentType = "Image"` */
  filter?: string;
  page?: number;
  pageSize?: number;
  /** Value for the `select-record` header, e.g. `title,fields,masterfileversion` */
  selectRecord?: string;
  /** Value for the `select-fileversion` header, e.g. `renditions` */
  selectFileVersion?: string;
  /** Value for the `select-rendition` header, e.g. `publiclinks` */
  selectRendition?: string;
}

export class AprimoError extends Error {
  public constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'AprimoError';
  }
}

// Only Aprimo-hosted tenants are allowed so a stored/submitted value can never point credentials at another host.
const TENANT_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.aprimo\.com$/;
const REQUEST_TIMEOUT_MS = 30000;
// Refresh slightly early to absorb clock skew and in-flight request time.
const EXPIRY_MARGIN_MS = 60000;
const TOKEN_SECRET_KEY = 'aprimo/token';

export const isValidTenantDomain = (domain: string): boolean => TENANT_DOMAIN_PATTERN.test(domain);

/** Strips a pasted scheme/path so `https://tenant.aprimo.com/` is accepted as `tenant.aprimo.com`. */
export const normalizeTenantDomain = (input: string): string =>
  input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

export const secretsTokenCache: TokenCache = {
  async get() {
    return storage.secrets.get<ValueHash & { accessToken?: string; expiresAt?: number }>(TOKEN_SECRET_KEY);
  },
  async put(accessToken, expiresAt) {
    await storage.secrets.put(TOKEN_SECRET_KEY, { accessToken, expiresAt });
  },
  async clear() {
    await storage.secrets.delete(TOKEN_SECRET_KEY);
  },
};

export class AprimoClient {
  private readonly authHost: string;
  private readonly damHost: string;

  public constructor(
    private readonly credentials: AprimoCredentials,
    private readonly tokenCache: TokenCache = secretsTokenCache,
  ) {
    if (!isValidTenantDomain(credentials.tenantDomain)) {
      throw new AprimoError('Invalid Aprimo tenant domain');
    }
    this.authHost = credentials.tenantDomain;
    this.damHost = credentials.tenantDomain.replace(/\.aprimo\.com$/, '.dam.aprimo.com');
  }

  public static async fromSettings(section = 'connection'): Promise<AprimoClient> {
    const settings = await storage.settings.get<ValueHash>(section);
    const { tenant_domain: tenantDomain, client_id: clientId, client_secret: clientSecret } = settings;
    if (!tenantDomain || !clientId || !clientSecret) {
      throw new AprimoError('Aprimo connection is not configured');
    }
    return new AprimoClient({
      tenantDomain: tenantDomain as string,
      clientId: clientId as string,
      clientSecret: clientSecret as string,
    });
  }

  /** Requests a fresh token (client credentials flow), bypassing and replacing any cached one. */
  public async fetchAccessToken(): Promise<string> {
    const response = await fetch(`https://${this.authHost}/login/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'api',
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Deliberately omit the response body: it can echo request details.
      throw new AprimoError(`Aprimo token request failed (HTTP ${response.status})`, response.status);
    }
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new AprimoError('Aprimo token response did not include an access token');
    }
    const expiresAt = Date.now() + (body.expires_in ?? 3600) * 1000;
    await this.tokenCache.put(body.access_token, expiresAt);
    return body.access_token;
  }

  public async getAccessToken(): Promise<string> {
    const cached = await this.tokenCache.get();
    if (cached.accessToken && cached.expiresAt && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return cached.accessToken;
    }
    return this.fetchAccessToken();
  }

  /** Verifies the credentials by obtaining a token and making a minimal DAM call. */
  public async testConnection(): Promise<void> {
    await this.tokenCache.clear();
    await this.listRecords({ pageSize: 1 });
  }

  public async listRecords(options: ListRecordsOptions = {}): Promise<AprimoRecordPage> {
    const query = new URLSearchParams();
    if (options.filter) {
      query.set('filter', options.filter);
    }
    if (options.page) {
      query.set('page', String(options.page));
    }
    if (options.pageSize) {
      query.set('pageSize', String(options.pageSize));
    }
    const qs = query.toString();
    return this.request<AprimoRecordPage>(`/api/core/records${qs ? `?${qs}` : ''}`, this.selectHeaders(options));
  }

  public async getRecord(
    id: string,
    options: Omit<ListRecordsOptions, 'filter' | 'page' | 'pageSize'> = {},
  ): Promise<AprimoRecord> {
    return this.request<AprimoRecord>(`/api/core/record/${encodeURIComponent(id)}`, this.selectHeaders(options));
  }

  private selectHeaders(options: ListRecordsOptions): Record<string, string> {
    const headers: Record<string, string> = {};
    if (options.selectRecord) {
      headers['select-record'] = options.selectRecord;
    }
    if (options.selectFileVersion) {
      headers['select-fileversion'] = options.selectFileVersion;
    }
    if (options.selectRendition) {
      headers['select-rendition'] = options.selectRendition;
    }
    return headers;
  }

  private async request<T>(path: string, extraHeaders: Record<string, string> = {}): Promise<T> {
    const call = async (token: string): Promise<Response> =>
      fetch(`https://${this.damHost}${path}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'API-Version': '1',
          'Accept': 'application/hal+json',
          ...extraHeaders,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

    let response = await call(await this.getAccessToken());
    if (response.status === 401) {
      // Cached token may have been revoked or expired early; retry once with a fresh one.
      response = await call(await this.fetchAccessToken());
    }
    if (!response.ok) {
      throw new AprimoError(`Aprimo API request failed (HTTP ${response.status})`, response.status);
    }
    return (await response.json()) as T;
  }
}

export interface AprimoRecord {
  id: string;
  title?: string;
  contentType?: string;
  createdOn?: string;
  modifiedOn?: string;
  status?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface AprimoRecordPage {
  items?: AprimoRecord[];
  page?: number;
  pageSize?: number;
  totalCount?: number;
  nextCursor?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
