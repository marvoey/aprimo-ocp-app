import * as App from '@zaiusinc/app-sdk';
import { logger, storage } from '@zaiusinc/app-sdk';
import { BugsnagUnhandledExceptions, convertException } from '@zaiusinc/odpint-utils';

@BugsnagUnhandledExceptions
export class Lifecycle extends App.Lifecycle {
  public async onInstall(): Promise<App.LifecycleResult> {
    try {
      logger.info('Performing Install');
      // TODO: any operation you need to perform during installation
      return { success: true };
    } catch (e) {
      const error = convertException(e);
      logger.error('Error during installation:', error.message);
      return { success: false, retryable: true, message: `Error during installation: ${error.message}` };
    }
  }

  public async onSettingsForm(
    section: string,
    _action: string,
    formData: App.SubmittedFormData
  ): Promise<App.LifecycleSettingsResult> {
    const result = new App.LifecycleSettingsResult();
    try {
      // TODO: any logic you need to perform when a setup form section is submitted
      // When you are finished, save the form data to the settings store
      await storage.settings.put(section, formData);
      return result;
    } catch (e) {
      return result.addToast('danger', 'Sorry, an unexpected error occurred. Please try again in a moment.');
    }
  }

  public async onAuthorizationRequest(
    _section: string,
    _formData: App.SubmittedFormData
  ): Promise<App.LifecycleSettingsResult> {
    const result = new App.LifecycleSettingsResult();
    // TODO: if your application supports the OAuth flow (via oauth_button in the settings form), evaluate the form
    // data and determine where to send the user: `result.redirect('https://<external oauth endpoint>')`
    return result.addToast('danger', 'Sorry, OAuth is not supported.');
  }

  public async onAuthorizationGrant(_request: App.Request): Promise<App.AuthorizationGrantResult> {
    // TODO: if your application supports the OAuth flow, evaluate the inbound request and perform any necessary action
    // to retrieve the access token, then forward the user to the next relevant settings form section:
    // `new App.AuthorizationGrantResult('my_next_section')`
    return new App.AuthorizationGrantResult('').addToast('danger', 'Sorry, OAuth is not supported.');
  }

  public async onUpgrade(_fromVersion: string): Promise<App.LifecycleResult> {
    // TODO: any logic required when upgrading from a previous version of the app
    // Note: `fromVersion` may not be the most recent version or could be a beta version
    return { success: true };
  }

  public async onFinalizeUpgrade(_fromVersion: string): Promise<App.LifecycleResult> {
    // TODO: any logic required when finalizing an upgrade from a previous version
    // At this point, new webhook URLs have been created for any new functions in this version
    return { success: true };
  }

  public async onAfterUpgrade(): Promise<App.LifecycleResult> {
    // TODO: any logic required after the upgrade has been completed.  This is the plugin point
    // for triggering one-time jobs against the upgraded installation
    return { success: true };
  }

  public async canUninstall(): Promise<App.CanUninstallResult> {
    // TODO: any logic required to determine if an installation can be uninstalled.
    return { uninstallable: true };
  }

  public async onUninstall(): Promise<App.LifecycleResult> {
    // TODO: any logic required to properly uninstall the app
    return { success: true };
  }
}
