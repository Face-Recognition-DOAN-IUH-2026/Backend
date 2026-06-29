import { config } from '../config';
import { createInternalAuth } from '../../../shared';

export const internalAuth = createInternalAuth({
  serviceName: 'access-service',
  internalApiKey: config.internalApiKey,
});
