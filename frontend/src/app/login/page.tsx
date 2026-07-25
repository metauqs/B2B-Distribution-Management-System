'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ employeeId }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error ?? 'Invalid Employee ID');
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
      background: 'var(--cream)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      fontFamily: "'IBM Plex Sans', sans-serif",
      position: 'relative',
    }}>
      {/* Top Header Bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '76px',
        background: 'var(--forest)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 24px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
      }}>
        <img 
          src="/logo-light.png" 
          alt="Halal Vegg Supplies" 
          style={{ height: '48px', width: 'auto', objectFit: 'contain' }} 
        />
      </div>

      {/* Login Card */}
      <div style={{
        background: 'var(--paper)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        maxWidth: 380,
        width: '100%',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        marginTop: '60px',
      }}>
        {/* Card Header */}
        <div style={{
          background: 'var(--forest)',
          padding: '24px 28px 20px',
          textAlign: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <h2 style={{ fontSize: 18, color: 'var(--paper)', margin: 0, fontWeight: 600 }}>
            Halal Veg Supplies
          </h2>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 8, fontWeight: 500 }}>
            Sign in to your account
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '26px 28px 28px' }}>
          {error && (
            <div style={{
              background: '#F5E1DE', border: '1px solid #E9C6C6',
              borderRadius: 6, padding: '10px 12px',
              fontSize: 13, color: 'var(--danger)', marginBottom: 16,
              fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          <div className="va-field" style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
              Employee ID
            </label>
            <input
              id="employeeId"
              type="text"
              pattern="[0-9]*"
              inputMode="numeric"
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              placeholder="Enter your Employee ID"
              required
              autoFocus
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                fontSize: 14,
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
            />
          </div>

          <button
            type="submit"
            className="va-btn"
            disabled={loading}
            style={{ width: '100%', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>

      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
      `}</style>
    </div>
  );
}
