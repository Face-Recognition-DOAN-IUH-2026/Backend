import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db';
import { config } from '../config';
import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().optional(),
  role: z.string().optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export interface User {
  id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
  role: string;
  created_at: Date;
  updated_at: Date;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  full_name?: string | null;
}

export class UserService {
  async register(data: { email: string; password: string; full_name?: string; role?: string }) {
    const { email, password, full_name, role } = data;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new Error('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = crypto.randomUUID();
    const userRole = role || 'user';
    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, full_name, role, created_at`,
      [id, email, passwordHash, full_name || null, userRole]
    );

    const user = result.rows[0];
    const payload = { userId: String(user.id), email: user.email, role: user.role, full_name: user.full_name };
    const access_token = this.generateToken(payload, 'access');
    const refresh_token = this.generateToken(payload, 'refresh');

    return { id: String(user.id), email: user.email, full_name: user.full_name, role: user.role, access_token, refresh_token };
  }

  async login(data: { email: string; password: string }) {
    const { email, password } = data;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      throw new Error('Invalid credentials');
    }

    const user: User = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      throw new Error('Invalid credentials');
    }

    const payload = { userId: String(user.id), email: user.email, role: user.role, full_name: user.full_name };
    const access_token = this.generateToken(payload, 'access');
    const refresh_token = this.generateToken(payload, 'refresh');

    return {
      access_token,
      refresh_token,
      token_type: 'bearer',
    };
  }

  async getUserById(id: string) {
    const result = await pool.query(
      'SELECT id::text, email, full_name, role, created_at FROM users WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      throw new Error('User not found');
    }
    return result.rows[0];
  }

  async getAllUsers() {
    const result = await pool.query(
      'SELECT id::text, email, full_name, role, created_at FROM users ORDER BY created_at DESC'
    );
    return result.rows;
  }

  async deleteUser(id: string) {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      throw new Error('User not found');
    }
    return { deleted: true, id };
  }

  async refreshToken(refreshTokenStr: string) {
    const payload = this.verifyToken(refreshTokenStr, 'refresh');
    const user = await this.getUserById(payload.userId);
    const newPayload = { userId: String(user.id), email: user.email, role: user.role, full_name: user.full_name };
    const access_token = this.generateToken(newPayload, 'access');
    return { access_token, token_type: 'bearer' };
  }

  private generateToken(payload: TokenPayload, type: 'access' | 'refresh' = 'access'): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = type === 'refresh'
      ? now + config.jwtRefreshExpiresDays * 86400
      : now + config.jwtAccessExpiresMinutes * 60;
    const secret = type === 'refresh' ? config.jwtRefreshSecret : config.jwtSecret;
    const jwtPayload: Record<string, any> = {
      sub: payload.userId,
      email: payload.email,
      iss: config.jwtIssuer,
      aud: config.jwtAudience,
      exp,
      iat: now,
      roles: [payload.role],
      typ: type,
    };
    if (payload.full_name) {
      jwtPayload.full_name = payload.full_name;
    }
    return jwt.sign(jwtPayload, secret);
  }

  verifyToken(token: string, expectedType?: 'access' | 'refresh'): any {
    // Try access secret first, then refresh secret
    let secret = config.jwtSecret;
    try {
      const decoded: any = jwt.verify(token, secret);
      if (expectedType && decoded.typ !== expectedType) {
        throw new Error(`Invalid token type: expected ${expectedType}, got ${decoded.typ}`);
      }
      return { userId: decoded.sub, email: decoded.email || '', role: decoded.roles?.[0] || 'user', full_name: decoded.full_name || null };
    } catch (err: any) {
      if (err.message?.includes('Invalid token type')) throw err;
      // Try refresh secret
      secret = config.jwtRefreshSecret;
      const decoded: any = jwt.verify(token, secret);
      if (expectedType && decoded.typ !== expectedType) {
        throw new Error(`Invalid token type: expected ${expectedType}, got ${decoded.typ}`);
      }
      return { userId: decoded.sub, email: decoded.email || '', role: decoded.roles?.[0] || 'user', full_name: decoded.full_name || null };
    }
  }
}

export const userService = new UserService();