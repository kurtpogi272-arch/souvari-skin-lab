import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Eye, EyeOff } from 'lucide-react';
import { authApi } from '../../api/auth.api';

type Step = 'email' | 'code' | 'password' | 'success';

export default function ForgotPassword() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const requestCode = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await authApi.forgotPassword(email.trim().toLowerCase());
      setCode('');
      setCooldown(60);
      setNotice(response.data.message);
      setStep('code');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Unable to request a code. Please try again.');
    } finally { setBusy(false); }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (step === 'email') { await requestCode(); return; }
    setError('');
    if (step === 'password' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (step === 'code') {
        const response = await authApi.verifyResetCode({
          email: email.trim().toLowerCase(), code,
        });
        setResetToken(response.data.data.resetToken);
        setCode('');
        setNotice('Email verified. Choose a new password within 10 minutes.');
        setStep('password');
      } else if (step === 'password') {
        await authApi.resetPassword({ resetToken, password, confirmPassword });
        setResetToken('');
        setPassword('');
        setConfirmPassword('');
        setNotice('');
        setStep('success');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Unable to complete this step. Please try again.');
    } finally { setBusy(false); }
  };

  const startAgain = () => {
    setResetToken('');
    setCode('');
    setPassword('');
    setConfirmPassword('');
    setNotice('');
    setError('');
    setStep('email');
  };

  const title = step === 'email' ? 'Forgot password?' : step === 'code' ? 'Check your email'
    : step === 'password' ? 'Set a new password' : 'Password reset';

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <div className="border-b border-neutral-800 bg-neutral-900">
        <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-center">
          <Link to="/">
            <img src="/images/souvari-logo.png" alt="Souvari Skin Lab" className="h-8 sm:h-9 w-auto object-contain" />
          </Link>
        </div>
      </div>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-neutral-200 p-8 md:p-10">
          <div className="text-center mb-8">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-primary-600">Customer account recovery</p>
            <h1 className="mt-4 text-3xl font-sans font-semibold text-neutral-900">{title}</h1>
            <p className="text-sm text-neutral-500 mt-2">
              {step === 'email' && 'Enter your registered email to receive a verification code.'}
              {step === 'code' && <>Enter the 6-digit code sent to <span className="font-medium break-all">{email}</span>. Codes expire in 10 minutes.</>}
              {step === 'password' && 'Use at least 8 characters for your new password.'}
              {step === 'success' && 'You can now sign in with your new password. Previous sessions have been signed out.'}
            </p>
          </div>

          {notice && <p role="status" className="text-sm bg-primary-50 text-primary-800 p-3 mb-5">{notice}</p>}
          {error && <p role="alert" className="text-sm bg-red-50 text-red-700 p-3 mb-5">{error}</p>}

          {step !== 'success' ? (
            <form onSubmit={onSubmit} className="space-y-5">
              {step === 'email' && (
                <div>
                  <label htmlFor="recovery-email" className="label">Email address</label>
                  <input id="recovery-email" type="email" autoComplete="email" required maxLength={255}
                    value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} className="input-field" />
                </div>
              )}
              {step === 'code' && (
                <div>
                  <label htmlFor="recovery-code" className="label">Verification code</label>
                  <input id="recovery-code" type="text" inputMode="numeric" autoComplete="one-time-code"
                    required pattern="[0-9]{6}" maxLength={6} minLength={6}
                    value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    disabled={busy} className="input-field text-center tracking-[0.4em]" />
                  <p className="text-xs text-neutral-500 mt-2">Check your spam folder. Only the latest code is valid.</p>
                </div>
              )}
              {step === 'password' && (
                <>
                  <div>
                    <label htmlFor="recovery-password" className="label">New password</label>
                    <div className="relative">
                      <input id="recovery-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                        required minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)}
                        disabled={busy} className="input-field pr-10" />
                      <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600">
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="recovery-confirm-password" className="label">Confirm new password</label>
                    <input id="recovery-confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                      required minLength={8} maxLength={72} value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)} disabled={busy} className="input-field" />
                  </div>
                </>
              )}
              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? 'Please wait...' : step === 'email' ? 'Send verification code' : step === 'code' ? 'Verify code' : 'Reset password'}
              </button>
              {step === 'code' && (
                <button type="button" disabled={busy || cooldown > 0} onClick={() => void requestCode()}
                  className="w-full text-sm text-primary-700 hover:underline disabled:text-neutral-400 disabled:no-underline">
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </button>
              )}
              {(step === 'code' || step === 'password') && (
                <button type="button" onClick={startAgain} disabled={busy} className="w-full text-sm text-neutral-500 hover:underline">
                  {step === 'code' ? 'Use a different email' : 'Start again'}
                </button>
              )}
            </form>
          ) : (
            <div className="text-center">
              <CheckCircle className="mx-auto mb-6 text-primary-600" size={40} />
              <Link to="/login" className="btn-primary w-full">Sign in</Link>
            </div>
          )}
          {step !== 'success' && <p className="text-center text-sm mt-7"><Link to="/login" className="text-primary-700 hover:underline">Back to sign in</Link></p>}
        </div>
      </main>
    </div>
  );
}
