'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@mdi/react';
import { mdiShieldAccount, mdiAccount, mdiLock } from '@mdi/js';
import { useAppDispatch, useAppSelector } from '@/store';
import { setUser, fetchCurrentUser } from '@/store/slices/authSlice';
import { getDefaultRouteForRole } from '@/utils/rbac';

export default function LoginPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { user, isAuthenticated, isCheckingSession } = useAppSelector(state => state.auth);

  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoSrc] = useState<string>('/logo-transparent.avif');

  // Verify if valid session cookie exists when opening login page
  useEffect(() => {
    const hasToken = typeof window !== 'undefined'
      ? (!!localStorage.getItem('sabzi_token') || document.cookie.includes('sabzi_token='))
      : false;
    if (hasToken) {
      dispatch(fetchCurrentUser(true));
    }
  }, [dispatch]);

  // If user is already authenticated with a valid verified session token, automatically redirect to Dashboard
  useEffect(() => {
    const hasToken = typeof window !== 'undefined'
      ? (!!localStorage.getItem('sabzi_token') || document.cookie.includes('sabzi_token='))
      : false;
    if (!isCheckingSession && isAuthenticated && user && hasToken) {
      const targetRoute = getDefaultRouteForRole(user.role);
      router.replace(targetRoute);
    }
  }, [isCheckingSession, isAuthenticated, user, router]);

  // Detect session expired flag in URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('expired') === 'true') {
        setError('Your session has expired or is invalid. Please log in again.');
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedId = employeeId ? employeeId.trim() : '';
    if (!trimmedId) {
      setError('Please enter your Employee ID');
      return;
    }
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: trimmedId, password }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch (jsonErr) {
        console.error('[LOGIN JSON PARSE ERROR]', jsonErr);
        data = {};
      }

      if (!res.ok || !data.success) {
        let errMessage = data.error || 'Employee not found';
        if (typeof errMessage === 'string' && (errMessage.toLowerCase().includes('prisma') || errMessage.toLowerCase().includes('invocation') || errMessage.toLowerCase().includes('table'))) {
          errMessage = 'Employee not found';
        }
        setError(errMessage);
        setLoading(false);
        return;
      }

      if (data.accessToken) {
        localStorage.setItem('sabzi_token', data.accessToken);
        document.cookie = `sabzi_token=${data.accessToken}; path=/; max-age=604800; SameSite=Lax`;
      }
      if (data.refreshToken) {
        localStorage.setItem('sabzi_refresh_token', data.refreshToken);
        document.cookie = `sabzi_refresh_token=${data.refreshToken}; path=/; max-age=604800; SameSite=Lax`;
      }

      const loggedInUser = data.data?.user ?? data.user;
      if (loggedInUser) {
        localStorage.setItem('sabzi_user', JSON.stringify(loggedInUser));
        dispatch(setUser(loggedInUser));
        const targetRoute = getDefaultRouteForRole(loggedInUser.role);
        router.prefetch(targetRoute);
        router.push(targetRoute);
      } else {
        router.push('/');
      }
    } catch (err: any) {
      console.error('[LOGIN SUBMIT ERROR]', err);
      setError('Employee not found or network error. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 50% 20%, #EDF7EE 0%, #D8EEDC 50%, #CBE6CE 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: "var(--font-lora, 'Lora', Georgia, serif)",
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background Decorative Ambient Light Blobs */}
      <div style={{
        position: 'absolute',
        top: '15%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '500px',
        height: '500px',
        background: 'radial-gradient(circle, rgba(111, 216, 154, 0.35) 0%, rgba(216, 238, 220, 0) 70%)',
        borderRadius: '50%',
        filter: 'blur(50px)',
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      <div style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        maxWidth: '420px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        {/* Brand Header */}
        <div style={{
          textAlign: 'center',
          marginBottom: '20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}>
          {/* Logo with Dynamic Transparent Canvas Filter */}
          <div style={{
            width: '200px',
            maxHeight: '80px',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={logoSrc} 
              alt="Halal Vegg Supplies Logo" 
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                filter: 'drop-shadow(0 6px 12px rgba(27, 67, 44, 0.15))',
              }}
            />
          </div>

          <span style={{
            fontSize: '11.5px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#B87333',
            fontWeight: 700,
            display: 'block',
            marginTop: '2px',
          }}>
            FRESH FROM MANDI • DAILY DELIVERY
          </span>
        </div>

        {/* High-Performance Login Card */}
        <div style={{
          background: '#FFFFFF',
          borderRadius: '24px',
          width: '100%',
          overflow: 'hidden',
          boxShadow: '0 12px 36px rgba(27, 67, 44, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04)',
          border: '1px solid #E2E8F0',
        }}>
          {/* Dark Green Header */}
          <div style={{
            background: 'linear-gradient(135deg, #215238 0%, #153827 100%)',
            padding: '32px 24px 28px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            {/* Shield Badge */}
            <div style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.18)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '14px',
            }}>
              <Icon path={mdiShieldAccount} size={1.25} color="#FFFFFF" />
            </div>

            <h2 style={{ fontSize: '22px', color: '#FFFFFF', margin: 0, fontWeight: 700, letterSpacing: '0.3px' }}>
              Employee Portal
            </h2>
            <p style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.85)', margin: '6px 0 0 0', fontWeight: 400 }}>
              Sign in with your Employee ID & Password
            </p>
          </div>

          {/* Card Body / Form */}
          <form onSubmit={handleSubmit} style={{ padding: '28px 28px 32px' }}>
            {error && (
              <div style={{
                background: '#FDF2F2',
                border: '1px solid #F87171',
                borderRadius: '8px',
                padding: '12px 14px',
                fontSize: '13px',
                color: '#991B1B',
                marginBottom: '20px',
                fontWeight: 600,
              }}>
                {error}
              </div>
            )}

            {/* Employee ID Input */}
            <div style={{ marginBottom: '20px' }}>
              <label 
                htmlFor="employeeId" 
                style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#2D3748' }}
              >
                Employee ID
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <div style={{ position: 'absolute', left: '12px', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                  <Icon path={mdiAccount} size={0.9} color="#A0AEC0" />
                </div>
                <input
                  id="employeeId"
                  type="text"
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  placeholder="Enter Employee ID (e.g. 1001)"
                  required
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '11px 14px 11px 40px',
                    fontSize: '14px',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E0',
                    background: '#FFFFFF',
                    color: '#1A202C',
                    outline: 'none',
                    transition: 'all 0.2s ease',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)',
                  }}
                  onFocus={e => (e.target.style.borderColor = '#215238')}
                  onBlur={e => (e.target.style.borderColor = '#CBD5E0')}
                />
              </div>
            </div>

            {/* Password Input */}
            <div style={{ marginBottom: '26px' }}>
              <label 
                htmlFor="password" 
                style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#2D3748' }}
              >
                Password
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <div style={{ position: 'absolute', left: '12px', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                  <Icon path={mdiLock} size={0.9} color="#A0AEC0" />
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  style={{
                    width: '100%',
                    padding: '11px 14px 11px 40px',
                    fontSize: '14px',
                    borderRadius: '10px',
                    border: '1px solid #CBD5E0',
                    background: '#FFFFFF',
                    color: '#1A202C',
                    outline: 'none',
                    transition: 'all 0.2s ease',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)',
                  }}
                  onFocus={e => (e.target.style.borderColor = '#215238')}
                  onBlur={e => (e.target.style.borderColor = '#CBD5E0')}
                />
              </div>
            </div>

            {/* Sign In Button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px 16px',
                fontSize: '15px',
                fontWeight: 700,
                color: '#FFFFFF',
                background: loading ? '#81A591' : 'linear-gradient(135deg, #215238 0%, #153827 100%)',
                border: 'none',
                borderRadius: '10px',
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 14px rgba(33, 82, 56, 0.35)',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              {loading ? (
                <span>Signing in…</span>
              ) : (
                <>
                  <span>Sign In</span>
                  <span style={{ fontSize: '16px' }}>→</span>
                </>
              )}
            </button>
          </form>

          {/* Card Footer Info */}
          <div style={{
            background: 'rgba(247, 250, 248, 0.8)',
            padding: '12px 24px',
            borderTop: '1px solid rgba(226, 232, 240, 0.8)',
            textAlign: 'center',
            fontSize: '11px',
            color: '#718096',
          }}>
            🔒 Secure HttpOnly Cookie Session Authentication
          </div>
        </div>

        {/* Footer info */}
        <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '11px', color: '#5A7C67' }}>
          &copy; {new Date().getFullYear()} Halal Vegg Supplies. All rights reserved.
        </div>
      </div>
    </div>
  );
}
