import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from './auth.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { registerSchema, loginSchema, forgotPasswordSchema, verifyResetCodeSchema, resetPasswordSchema } from './auth.validation';

const router = Router();

const requestCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many reset requests. Please try again in 15 minutes.' },
});
const resetAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many verification attempts. Please try again later.' },
});

router.post('/forgot-password', requestCodeLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/verify-reset-code', resetAttemptLimiter, validate(verifyResetCodeSchema), authController.verifyResetCode);
router.post('/reset-password', resetAttemptLimiter, validate(resetPasswordSchema), authController.resetPassword);

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/profile', authenticate, authController.getProfile);

export default router;
