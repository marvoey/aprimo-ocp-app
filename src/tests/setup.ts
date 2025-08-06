jest.mock('@zaiusinc/app-sdk', () => ({
  ...jest.requireActual('@zaiusinc/app-sdk'),
  getAppContext: jest.fn().mockReturnValue({
    manifest: {
      meta: {
        app_id: 'template_app',
        display_name: 'template_app',
        version: '0.0.0',
        vendor: 'optimizely',
      } as any,
    } as any,
    trackerId: 'mockTrackerId',
    installId: 123456789,
  }),
}));
