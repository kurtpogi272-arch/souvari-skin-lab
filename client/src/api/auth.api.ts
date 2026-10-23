import api from './axios';

export const authApi = {
  register: (data: { email: string; password: string; first_name: string; last_name: string; phone?: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  verifyResetCode: (data: { email: string; code: string }) =>
    api.post('/auth/verify-reset-code', data),
  resetPassword: (data: { resetToken: string; password: string; confirmPassword: string }) =>
    api.post('/auth/reset-password', data),
  logout: () => api.post('/auth/logout'),
  getProfile: () => api.get('/auth/profile'),
};
