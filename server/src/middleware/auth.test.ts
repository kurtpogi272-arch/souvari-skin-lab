import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, verifyAccessToken, verifyRefreshToken } = vi.hoisted(() => ({
  findUnique: vi.fn(), verifyAccessToken: vi.fn(), verifyRefreshToken: vi.fn(),
}));
vi.mock('../config/database', () => ({ default: { users: { findUnique } } }));
vi.mock('../utils/jwt', () => ({ verifyAccessToken, verifyRefreshToken }));

import { authenticate, optionalAuth } from './auth';
import { AuthService } from '../modules/auth/auth.service';

beforeEach(() => vi.resetAllMocks());

describe('password-reset session invalidation', () => {
  const payload = { userId: 1, role: 'customer', email: 'customer@example.com', authVersion: 0 };
  function response() {
    const res: any = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  }

  it('rejects an access token issued before a password reset', async () => {
    verifyAccessToken.mockReturnValue(payload);
    findUnique.mockResolvedValue({ status: 'active', role: 'customer', auth_version: 1 });
    const res = response();
    const next = vi.fn();
    await authenticate({ headers: { authorization: 'Bearer old-token' } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a current session', async () => {
    verifyAccessToken.mockReturnValue(payload);
    findUnique.mockResolvedValue({ status: 'active', role: 'customer', auth_version: 0 });
    const req: any = { headers: { authorization: 'Bearer current-token' } };
    const next = vi.fn();
    await authenticate(req, response(), next);
    expect(req.user).toEqual(payload);
    expect(next).toHaveBeenCalledOnce();
  });

  it('treats an invalidated optional session as unauthenticated', async () => {
    verifyAccessToken.mockReturnValue(payload);
    findUnique.mockResolvedValue({ status: 'active', role: 'customer', auth_version: 1 });
    const req: any = { headers: { authorization: 'Bearer old-token' } };
    const next = vi.fn();
    await optionalAuth(req, response(), next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not allow an old refresh token to mint a new session', async () => {
    verifyRefreshToken.mockReturnValue(payload);
    findUnique.mockResolvedValue({ status: 'active', role: 'customer', auth_version: 1 });
    await expect(new AuthService().refreshToken('old-refresh-token')).rejects.toThrow('Session expired');
  });
});
