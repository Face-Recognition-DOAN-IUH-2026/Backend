import { config } from '../config';
import { createInternalAuth } from '../../../shared';

export const internalAuth = createInternalAuth({
  serviceName: 'notification-service',
  internalApiKey: config.internalApiKey,
});
