import { config } from '../config';
import { createInternalAuth } from '../../../shared';

export const internalAuth = createInternalAuth({
  serviceName: 'automation-service',
  internalApiKey: config.internalApiKey,
});
