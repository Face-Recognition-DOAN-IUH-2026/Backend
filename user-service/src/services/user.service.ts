import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { config } from '../config';
import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().optional(),
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
}

export class UserService {
  async register(data: { email: string; password: string; full_name?: string }) {
    const { email, password, full_name } = data;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new Error('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) 
       VALUES ($1, $2, $3) 
       RETURNING id, email, full_name, role, created_at`,
      [email, passwordHash, full_name || null]
    );

    const user = result.rows[0];
    const token = this.generateToken({ userId: String(user.id), email: user.email, role: user.role });

    return { user, token };
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

    const token = this.generateToken({ userId: String(user.id), email: user.email, role: user.role });

    return {
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      access_token: token,
      refresh_token: token,
    };
  }

  async getUserById(id: string) {
    const result = await pool.query(
      'SELECT id, email, full_name, role, created_at FROM users WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      throw new Error('User not found');
    }
    return result.rows[0];
  }

  async getAllUsers() {
    const result = await pool.query(
      'SELECT id, email, full_name, role, created_at FROM users ORDER BY created_at DESC'
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

  private generateToken(payload: TokenPayload): string {
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      sub: payload.userId,
      email: payload.email,
      iss: 'face-recognition',
      aud: 'face-recognition-users',
      exp: now + 86400,
      iat: now,
      roles: [payload.role],
      typ: 'access',
    };
    return jwt.sign(jwtPayload, config.jwtSecret);
  }

  verifyToken(token: string): any {
    const decoded: any = jwt.verify(token, config.jwtSecret);
    return { userId: decoded.sub, email: '', role: decoded.roles?.[0] || 'user' };
  }
}

export const userService = new UserService();