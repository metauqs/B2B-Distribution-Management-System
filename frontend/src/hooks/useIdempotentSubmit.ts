import { useState, useRef, useCallback } from 'react';

export interface UseIdempotentSubmitOptions<TData = any, TResult = any> {
  onSubmit: (data: TData, idempotencyKey: string) => Promise<TResult>;
  onSuccess?: (result: TResult) => void;
  onError?: (error: any) => void;
  /** Optional function to detect if user changed the form fields */
  getFingerprint?: (data: TData) => string;
}

export interface UseIdempotentSubmitReturn<TData = any, TResult = any> {
  isSubmitting: boolean;
  submit: (data?: TData) => Promise<TResult | undefined>;
  handleSubmit: (e: React.FormEvent, data?: TData) => Promise<TResult | undefined>;
  resetKey: () => void;
  idempotencyKey: string;
}

function generateKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Universal Frontend Hook for Synchronous In-Flight Locking & Idempotent Submissions.
 * 
 * Provides:
 * 1. Synchronous inFlightRef locking (defeats double-click & repeated Enter-key submit).
 * 2. Stable Idempotency-Key across network retries of the same logical payload.
 * 3. Automatic key regeneration when form input fingerprint changes.
 * 4. Automatic key clearance and lock release upon successful completion.
 */
export function useIdempotentSubmit<TData = any, TResult = any>(
  options: UseIdempotentSubmitOptions<TData, TResult>
): UseIdempotentSubmitReturn<TData, TResult> {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const inFlightRef = useRef<boolean>(false);
  const idempotencyKeyRef = useRef<string>(generateKey());
  const lastFingerprintRef = useRef<string>('');

  const resetKey = useCallback(() => {
    idempotencyKeyRef.current = generateKey();
    lastFingerprintRef.current = '';
  }, []);

  const submit = useCallback(
    async (data?: TData): Promise<TResult | undefined> => {
      // 1. Synchronous In-Flight Guard: Immediate rejection if already submitting
      if (inFlightRef.current) {
        console.warn('[useIdempotentSubmit] Dropped duplicate submission attempt while in-flight');
        return undefined;
      }

      // Check if data changed; if so, generate new key for new logical operation
      if (options.getFingerprint && data !== undefined) {
        const currentFingerprint = options.getFingerprint(data);
        if (lastFingerprintRef.current && lastFingerprintRef.current !== currentFingerprint) {
          idempotencyKeyRef.current = generateKey();
        }
        lastFingerprintRef.current = currentFingerprint;
      }

      inFlightRef.current = true;
      setIsSubmitting(true);

      const currentKey = idempotencyKeyRef.current;

      try {
        const result = await options.onSubmit(data as TData, currentKey);
        
        // On success: clear lock, generate fresh key for next action
        resetKey();
        options.onSuccess?.(result);
        return result;
      } catch (error: any) {
        // On failure / timeout: keep the same key so user can retry same logical operation safely
        console.error('[useIdempotentSubmit] Submit error:', error);
        options.onError?.(error);
        throw error;
      } finally {
        inFlightRef.current = false;
        setIsSubmitting(false);
      }
    },
    [options, resetKey]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent, data?: TData) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
        e.stopPropagation();
      }
      return submit(data);
    },
    [submit]
  );

  return {
    isSubmitting,
    submit,
    handleSubmit,
    resetKey,
    idempotencyKey: idempotencyKeyRef.current,
  };
}

export default useIdempotentSubmit;
