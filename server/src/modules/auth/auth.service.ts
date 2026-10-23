import prisma from '../../config/database';
import { hashPassword, comparePassword } from '../../utils/password';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, TokenPayload } from '../../utils/jwt';
import { AppError } from '../../middleware/errorHandler';
import { resolveIdentityFields } from '../../utils/identity';
import { RegisterInput, LoginInput } from './auth.validation';

export class AuthService {
  async register(data: RegisterInput) {
    // Normalises and rejects duplicate email / phone before touching the DB, so
    // a clash is a clear 409 rather than a raw unique-constraint failure.
    const { email, phone } = await resolveIdentityFields({
      email: data.email,
      phone: data.phone,
    });

    const passwordHash = await hashPassword(data.password);

    const user = await prisma.users.create({
      data: {
        email: email!,
        password_hash: passwordHash,
        role: 'customer',
        phone,
        customer: {
          create: {
            first_name: data.first_name,
            last_name: data.last_name,
            date_of_birth: data.date_of_birth ? new Date(data.date_of_birth) : null,
            gender: data.gender || null,
          },
        },
      },
      include: {
        customer: true,
      },
    });

    const tokenPayload: TokenPayload = { userId: user.id, email: user.email, role: user.role, authVersion: user.auth_version };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        customer: user.customer,
      },
      accessToken,
      refreshToken,
    };
  }

  async login(data: LoginInput) {
    const user = await prisma.users.findUnique({
      where: { email: data.email },
      include: {
        customer: true,
        staff: true,
      },
    });

    if (!user || user.deleted_at) {
      throw new AppError('Invalid email or password', 401);
    }

    if (user.status !== 'active') {
      throw new AppError('Account is not active', 403);
    }

    const isValidPassword = await comparePassword(data.password, user.password_hash);
    if (!isValidPassword) {
      throw new AppError('Invalid email or password', 401);
    }

    await prisma.users.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    const tokenPayload: TokenPayload = { userId: user.id, email: user.email, role: user.role, authVersion: user.auth_version };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        customer: user.customer,
        staff: user.staff,
      },
      accessToken,
      refreshToken,
    };
  }

  async refreshToken(token: string) {
    let payload: TokenPayload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    const user = await prisma.users.findUnique({ where: { id: payload.userId } });
    if (!user || user.status !== 'active' || user.deleted_at) {
      throw new AppError('User not found or inactive', 401);
    }
    if ((payload.authVersion ?? 0) !== user.auth_version) {
      throw new AppError('Session expired. Please sign in again.', 401);
    }

    const tokenPayload: TokenPayload = { userId: user.id, email: user.email, role: user.role, authVersion: user.auth_version };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return { accessToken, refreshToken };
  }

  async getProfile(userId: number) {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: {
        customer: true,
        staff: true,
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      phone: user.phone,
      customer: user.customer,
      staff: user.staff,
    };
  }
}

export const authService = new AuthService();
