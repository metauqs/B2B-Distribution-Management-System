'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@mdi/react';
import { mdiAccountBadge, mdiLock, mdiShieldAccount } from '@mdi/js';
import { DEFAULT_LOGO_BASE64 } from '@/utils/logoBase64';

export default function LoginPage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!employeeId.trim()) {
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
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ employeeId: employeeId.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error ?? 'Invalid Employee ID or password');
        setLoading(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F4F8F0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      position: 'relative',
    }}>
      {/* Top Header Banner with Company Logo */}
      <div style={{
        position: 'absolute',
        top: '28px',
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 24px',
      }}>
        <img 
          src={DEFAULT_LOGO_BASE64} 
          alt="Halal Vegg Supplies" 
          style={{ height: '90px', width: 'auto', objectFit: 'contain' }} 
        />
      </div>

      {/* Login Card */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #D4E6CC',
        borderRadius: '14px',
        maxWidth: 410,
        width: '100%',
        overflow: 'hidden',
        boxShadow: '0 16px 40px rgba(26,60,40,0.12)',
        marginTop: '80px',
      }}>
        {/* Card Header */}
        <div style={{
          background: 'linear-gradient(135deg, #1A3C28 0%, #2D6A4F 100%)',
          padding: '30px 28px 26px',
          textAlign: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.15)',
        }}>
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)',
          }}>
            <Icon path={mdiShieldAccount} size={1.3} color="#FFFFFF" />
          </div>
          <h2 style={{ fontSize: 21, color: '#FFFFFF', margin: 0, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Employee Portal
          </h2>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 6, fontWeight: 500 }}>
            Sign in with your Employee ID & Password
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '28px 28px 32px' }}>
          {error && (
            <div style={{
              background: '#FDF2F2',
              border: '1px solid #F8B4B4',
              borderRadius: 8,
              padding: '12px 14px',
              fontSize: 13,
              color: '#9B1C1C',
              marginBottom: 20,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Employee ID Field */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#2D3748' }}>
              Employee ID
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{
                position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                color: '#A0AEC0', display: 'flex', alignItems: 'center',
              }}>
                <Icon path={mdiAccountBadge} size={0.9} color="#718096" />
              </div>
              <input
                id="employeeId"
                type="text"
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
                placeholder="Enter Employee ID"
                required
                autoFocus
                style={{
                  width: '100%',
                  padding: '11px 12px 11px 40px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E0',
                  fontSize: 14,
                  outline: 'none',
                  color: '#1A202C',
                  background: '#F8FAFC',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Password Field */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#2D3748' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{
                position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                color: '#A0AEC0', display: 'flex', alignItems: 'center',
              }}>
                <Icon path={mdiLock} size={0.9} color="#718096" />
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                style={{
                  width: '100%',
                  padding: '11px 12px 11px 40px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E0',
                  fontSize: 14,
                  outline: 'none',
                  color: '#1A202C',
                  background: '#F8FAFC',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '13px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, #1A3C28 0%, #2D6A4F 100%)',
              color: '#FFFFFF',
              border: 'none',
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.75 : 1,
              transition: 'all 0.2s',
              boxShadow: '0 4px 14px rgba(26,60,40,0.25)',
              letterSpacing: '0.02em',
            }}
          >
            {loading ? 'Authenticating…' : 'Sign In'}
          </button>
        </form>
      </div>

      {/* Footer info */}
      <div style={{ marginTop: 24, fontSize: 12, color: '#718096', textAlign: 'center' }}>
        Halal Vegg Supplies Distribution Management System
      </div>
    </div>
  );
}
