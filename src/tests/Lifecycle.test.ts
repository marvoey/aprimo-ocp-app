import { Lifecycle } from '../lifecycle/Lifecycle';

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
});
