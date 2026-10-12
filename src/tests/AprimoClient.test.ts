import { AprimoClient, AprimoError, isValidTenantDomain, normalizeTenantDomain, TokenCache } from '../lib/AprimoClient';

const credentials = { tenantDomain: 'acme.aprimo.com', clientId: 'id', clientSecret: 'secret' };

const memoryCache = (): TokenCache & { state: { accessToken?: string; expiresAt?: number } } => {
  const cache = {
    state: {} as { accessToken?: string; expiresAt?: number },
    get: async () => cache.state,
    put: async (accessToken: string, expiresAt: number) => {
      cache.state = { accessToken, expiresAt };
    },
    clear: async () => {
      cache.state = {};
    },
  };
  return cache;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('tenant domain helpers', () => {
  it('accepts only aprimo.com hosts', () => {
    expect(isValidTenantDomain('acme.aprimo.com')).toBe(true);
    expect(isValidTenantDomain('acme.dam.aprimo.com')).toBe(false);
    expect(isValidTenantDomain('evil.com')).toBe(false);
    expect(isValidTenantDomain('acme.aprimo.com.evil.com')).toBe(false);
    expect(isValidTenantDomain('acme.aprimo.com/path')).toBe(false);
  });

  it('normalizes pasted URLs', () => {
    expect(normalizeTenantDomain(' https://Acme.aprimo.com/ ')).toBe('acme.aprimo.com');
  });
});

describe('AprimoClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  it('rejects non-Aprimo domains', () => {
    expect(() => new AprimoClient({ ...credentials, tenantDomain: 'evil.com' }, memoryCache())).toThrow(AprimoError);
  });

  it('fetches a token with client credentials and caches it', async () => {
    const cache = memoryCache();
    fetchMock.mockResolvedValueOnce(json({ access_token: 'tok', expires_in: 3600 }));
    const client = new AprimoClient(credentials, cache);

    expect(await client.getAccessToken()).toBe('tok');
    expect(await client.getAccessToken()).toBe('tok');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://acme.aprimo.com/login/connect/token');
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('api');
    expect(body.get('client_id')).toBe('id');
  });

  it('refreshes an expired cached token', async () => {
    const cache = memoryCache();
    cache.state = { accessToken: 'old', expiresAt: Date.now() + 1000 };
    fetchMock.mockResolvedValueOnce(json({ access_token: 'new', expires_in: 3600 }));
    expect(await new AprimoClient(credentials, cache).getAccessToken()).toBe('new');
  });

  it('does not leak the response body in token errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('invalid_client secret=abc', { status: 400 }));
    const promise = new AprimoClient(credentials, memoryCache()).getAccessToken();
    await expect(promise).rejects.toThrow('Aprimo token request failed (HTTP 400)');
    await expect(promise).rejects.not.toThrow(/secret=abc/);
  });

  it('lists records against the DAM host with auth headers', async () => {
    const cache = memoryCache();
    cache.state = { accessToken: 'tok', expiresAt: Date.now() + 3600000 };
    fetchMock.mockResolvedValueOnce(json({ items: [{ id: '1' }] }));

    const page = await new AprimoClient(credentials, cache).listRecords({
      filter: 'ContentType = "Image"',
      pageSize: 5,
      selectRecord: 'title',
    });

    expect(page.items).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://acme.dam.aprimo.com/api/core/records?filter=ContentType+%3D+%22Image%22&pageSize=5'
    );
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['API-Version']).toBe('1');
    expect(init.headers['select-record']).toBe('title');
  });

  it('retries once with a new token on 401', async () => {
    const cache = memoryCache();
    cache.state = { accessToken: 'stale', expiresAt: Date.now() + 3600000 };
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(json({ access_token: 'fresh', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ id: 'abc' }));

    const record = await new AprimoClient(credentials, cache).getRecord('abc');

    expect(record.id).toBe('abc');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh');
  });

  it('throws AprimoError on non-OK API responses', async () => {
    const cache = memoryCache();
    cache.state = { accessToken: 'tok', expiresAt: Date.now() + 3600000 };
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(new AprimoClient(credentials, cache).getRecord('x')).rejects.toMatchObject({ status: 403 });
  });
});
