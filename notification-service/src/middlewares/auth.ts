import { config } from '../config';
import { AuthRequest, createAuth } from '../../../shared';

export { AuthRequest };

const authConfig = {
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
};

export const auth = createAuth(authConfig);
