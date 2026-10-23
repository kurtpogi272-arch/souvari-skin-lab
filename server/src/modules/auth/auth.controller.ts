import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { passwordResetService } from './password-reset.service';

export class AuthController {
  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await passwordResetService.requestCode(req.body.email);
      res.set('Cache-Control', 'no-store').json({
        success: true,
        message: result.sent
          ? 'A verification code has been sent to your customer account email. Check your inbox and spam folder.'
          : 'A code was requested recently. Please use the latest code in your email or wait before resending.',
        data: { retryAfterSeconds: result.retryAfterSeconds },
      });
    } catch (error) { next(error); }
  }

  async verifyResetCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await passwordResetService.verifyCode(req.body.email, req.body.code);
      res.set('Cache-Control', 'no-store').json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await passwordResetService.resetPassword(req.body.resetToken, req.body.password);
      res.clearCookie('refreshToken');
      res.set('Cache-Control', 'no-store').json({ success: true, message: 'Password reset successfully. Please sign in with your new password.' });
    } catch (error) { next(error); }
  }

  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await authService.register(req.body);
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });
      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: { user: result.user, accessToken: result.accessToken },
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await authService.login(req.body);
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      res.json({
        success: true,
        message: 'Login successful',
        data: { user: result.user, accessToken: result.accessToken },
      });
    } catch (error) {
      next(error);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.cookies?.refreshToken;
      if (!token) {
        res.status(401).json({ success: false, message: 'Refresh token not found' });
        return;
      }
      const result = await authService.refreshToken(token);
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      res.json({
        success: true,
        data: { accessToken: result.accessToken },
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(_req: Request, res: Response, _next: NextFunction): Promise<void> {
    res.clearCookie('refreshToken');
    res.json({ success: true, message: 'Logged out successfully' });
  }

  async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const profile = await authService.getProfile(req.user!.userId);
      res.json({ success: true, data: profile });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
