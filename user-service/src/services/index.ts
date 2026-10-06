import { AppDataSource } from '../data-source';
import { User } from '../entities/User.entity';
import { UserRepository } from '../repositories/UserRepository';
import { PatronRepository } from '../repositories/PatronRepository';
import { RedisService } from './RedisService';
import { AuthService } from './AuthService';
import { UserService } from './UserService';
import { PatronService } from './PatronService';
import { PatronImportService } from './PatronImportService';

const userRepo = new UserRepository(AppDataSource.getRepository(User));
const patronRepo = new PatronRepository(AppDataSource.getRepository(User));
const redis = new RedisService();
const authService = new AuthService(userRepo, redis);
const userService = new UserService(userRepo, patronRepo, redis);
const patronService = new PatronService(patronRepo, redis);
const patronImportService = new PatronImportService(patronRepo, AppDataSource.getRepository(User));

export { authService, userService, patronService, patronImportService, redis, userRepo, patronRepo };
