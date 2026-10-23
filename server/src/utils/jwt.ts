import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  userId: number;
  email: string;
  role: string;
  authVersion?: number;
}

function toExpiresIn(value: string): SignOptions['expiresIn'] {
  return value as unknown as SignOptions['expiresIn'];
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: toExpiresIn(env.JWT_ACCESS_EXPIRES_IN),
  });
}

export function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: toExpiresIn(env.JWT_REFRESH_EXPIRES_IN),
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
}
