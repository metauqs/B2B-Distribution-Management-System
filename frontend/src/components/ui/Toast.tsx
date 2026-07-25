'use client';

import { useEffect, useState } from 'react';

// ─── Simple toast — same style as original va-toast ───────────────────────────
export interface ToastMessage {
  id:  string;
  msg: string;
}

let _addToast: ((msg: string) => void) | null = null;

export function toast(msg: string) {
  _addToast?.(msg);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    _addToast = (msg: string) => {
      const id = Math.random().toString(36).slice(2);
      setToasts(prev => [...prev, { id, msg }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2200);
    };
    return () => { _addToast = null; };
  }, []);

  return (
    <>
      {toasts.map(t => (
        <div key={t.id} className="va-toast">{t.msg}</div>
      ))}
    </>
  );
}
