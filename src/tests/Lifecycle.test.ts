import { storage } from '@zaiusinc/app-sdk';
import { Lifecycle } from '../lifecycle/Lifecycle';
import { AprimoClient } from '../lib/AprimoClient';

// `errors` is protected on the SDK result type; cast to inspect field errors in assertions.
const fieldErrors = (result: unknown) => (result as { errors: Record<string, unknown> }).errors;

describe('Lifecycle', () => {
  let lifecycle: Lifecycle;

  beforeEach(() => {
    lifecycle = new Lifecycle();
    jest.clearAllMocks();
  });

  describe('onInstall', () => {
    it('should install successfully', async () => {
      const result = await lifecycle.onInstall();
      expect(result.success).toBeTruthy();
    });
  });

  describe('onSettingsForm (connection)', () => {
    const form = () => ({ tenant_domain: 'https://Acme.aprimo.com/', client_id: ' id ', client_secret: 's3cret' });

    it('rejects an invalid domain without calling Aprimo', async () => {
      const test = jest.spyOn(AprimoClient.prototype, 'testConnection');
      const put = jest.spyOn(storage.settings, 'put');
      const result = await lifecycle.onSettingsForm('connection', 'save', { ...form(), tenant_domain: 'evil.com' });
      expect(fieldErrors(result)).toHaveProperty('tenant_domain');
      expect(test).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    });

    it('does not save when the connection test fails', async () => {
      jest.spyOn(AprimoClient.prototype, 'testConnection').mockRejectedValue(new Error('boom'));
      const put = jest.spyOn(storage.settings, 'put');
      const result = await lifecycle.onSettingsForm('connection', 'save', form());
      expect(fieldErrors(result)).toHaveProperty('client_secret');
      expect(put).not.toHaveBeenCalled();
    });

    it('saves normalized values and marks connected on success', async () => {
      jest.spyOn(AprimoClient.prototype, 'testConnection').mockResolvedValue();
      const put = jest.spyOn(storage.settings, 'put').mockResolvedValue(true);
      await lifecycle.onSettingsForm('connection', 'save', form());
      expect(put).toHaveBeenCalledWith(
        'connection',
        expect.objectContaining({ tenant_domain: 'acme.aprimo.com', client_id: 'id', connected: true })
      );
    });
  });
});
