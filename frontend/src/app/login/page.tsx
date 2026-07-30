'use client';

import { useState, useEffect } from 'react';
import Icon from '@mdi/react';
import { mdiShieldAccount, mdiAccount, mdiLock } from '@mdi/js';

export default function LoginPage() {
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoSrc, setLogoSrc] = useState<string>('/logo.png');

  // Convert white background pixels of logo image directly to light green #EDF7EE
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/logo.png';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Convert all white & off-white background pixels (R > 195, G > 195, B > 195) to 100% Transparent (Alpha = 0)
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Target white/off-white background box pixels
          if (r > 195 && g > 195 && b > 195) {
            data[i + 3] = 0; // Set Alpha to 0 (Fully Transparent)
          }
        }

        ctx.putImageData(imageData, 0, 0);
        setLogoSrc(canvas.toDataURL('image/png'));
      } catch (e) {
        console.warn('Logo canvas processing fallback:', e);
      }
    };
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
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ employeeId: trimmedId, password }),
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

      window.location.href = '/';
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
      fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background Decorative Ambient Light Blobs for Glass Effect */}
      <div style={{
        position: 'absolute',
        top: '15%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '550px',
        height: '550px',
        background: 'radial-gradient(circle, rgba(165, 214, 167, 0.45) 0%, rgba(200, 230, 201, 0) 70%)',
        borderRadius: '50%',
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />

      {/* Unified Cohesive Brand + Login Section */}
      <div style={{
        maxWidth: '420px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Prominent Logo Placed Directly on Page Background */}
        <div style={{ marginBottom: '16px', width: '100%', textAlign: 'center' }}>
          <img 
            src={logoSrc} 
            alt="Halal Vegg Supplies Logo" 
            style={{
              width: '90%',
              maxWidth: '370px',
              height: 'auto',
              maxHeight: '140px',
              objectFit: 'contain',
              display: 'inline-block',
              borderRadius: '16px',
            }}
            onError={(e) => {
              (e.target as HTMLElement).setAttribute('src', '/logo-light.png');
            }}
          />
        </div>

        {/* Glassmorphism Login Card */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.78)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderRadius: '24px',
          width: '100%',
          overflow: 'hidden',
          boxShadow: '0 24px 50px rgba(27, 67, 44, 0.12), 0 8px 20px rgba(0, 0, 0, 0.04), inset 0 1px 1px rgba(255, 255, 255, 0.9)',
          border: '1px solid rgba(255, 255, 255, 0.8)',
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
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '14px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
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
                fontWeight: 500,
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
                  placeholder="Enter Employee ID"
                  required
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '11px 14px 11px 40px',
                    borderRadius: '8px',
                    border: '1px solid #CBD5E0',
                    background: '#F8FAFC',
                    fontSize: '14px',
                    color: '#1A202C',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {/* Password Input */}
            <div style={{ marginBottom: '24px' }}>
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
                  placeholder="Enter your password"
                  required
                  style={{
                    width: '100%',
                    padding: '11px 14px 11px 40px',
                    borderRadius: '8px',
                    border: '1px solid #CBD5E0',
                    background: '#F8FAFC',
                    fontSize: '14px',
                    color: '#1A202C',
                    outline: 'none',
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
                borderRadius: '8px',
                border: 'none',
                background: '#215238',
                color: '#FFFFFF',
                fontSize: '15px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.75 : 1,
                transition: 'background-color 0.2s',
                boxShadow: '0 4px 12px rgba(33, 82, 56, 0.2)',
              }}
            >
              {loading ? 'Signing In…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>

      {/* Sub-Footer Note */}
      <div style={{ marginTop: '20px', fontSize: '12px', color: '#718096', textAlign: 'center', fontWeight: 500 }}>
        Halal Vegg Supplies Distribution Management System
      </div>
    </div>
  );
}
