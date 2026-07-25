import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? 'sabzi_ledger_access_secret_30m_dev';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'sabzi_ledger_refresh_secret_7d_dev';

export interface DecodedUser {
  sub: string;
  email: string;
  role: string;
  branchId: string;
  employeeId?: string;
  type?: 'access' | 'refresh';
}

declare global {
  namespace Express {
    interface Request {
      user?: DecodedUser;
    }
  }
}

// In-memory revocation tracking store for Refresh Tokens
const activeRefreshTokens = new Map<string, { userId: string; expiresAt: number }>();

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const cookies = req.headers.cookie;
  if (cookies) {
    const tokenCookie = cookies
      .split(';')
      .find(c => c.trim().startsWith('sabzi_token='));
    if (tokenCookie) {
      return tokenCookie.split('=')[1].trim();
    }
  }

  return null;
}

export function extractRefreshToken(req: Request): string | null {
  if (req.body && req.body.refreshToken) {
    return req.body.refreshToken;
  }

  const cookies = req.headers.cookie;
  if (cookies) {
    const refreshCookie = cookies
      .split(';')
      .find(c => c.trim().startsWith('sabzi_refresh_token='));
    if (refreshCookie) {
      return refreshCookie.split('=')[1].trim();
    }
  }

  return null;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET) as DecodedUser;
    
    // Ensure payload is an access token
    if (decoded.type && decoded.type !== 'access') {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token type' });
    }

    req.user = decoded;
    
    req.headers['x-user-id'] = decoded.sub;
    req.headers['x-user-role'] = decoded.role;
    req.headers['x-branch-id'] = decoded.branchId;
    req.headers['x-user-email'] = decoded.email;
    
    next();
  } catch (err: any) {
    const isExpired = err?.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      error: isExpired ? 'Unauthorized: Access token expired' : 'Unauthorized: Invalid token'
    });
  }
}

export function roleMiddleware(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
}

// Generate Access Token (30 mins) & Refresh Token (7 days)
export function signAuthTokens(payload: { sub: string; email: string; role: string; branchId: string; employeeId?: string }) {
  const accessToken = jwt.sign(
    { ...payload, type: 'access' },
    JWT_ACCESS_SECRET,
    { expiresIn: '30m' } // 30 minutes access token
  );

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: '7d' } // 7 days refresh token
  );

  // Store refresh token in active revocation tracker (expires in 7 days)
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  activeRefreshTokens.set(refreshToken, { userId: payload.sub, expiresAt });

  return { accessToken, refreshToken };
}

// Rotate Refresh Token (revokes old token, issues new 30m access & 7d refresh token)
export function rotateRefreshToken(oldRefreshToken: string): { accessToken: string; refreshToken: string } | null {
  try {
    const decoded = jwt.verify(oldRefreshToken, JWT_REFRESH_SECRET) as DecodedUser;
    
    if (decoded.type && decoded.type !== 'refresh') {
      return null;
    }

    // Check if token was revoked or not tracked
    if (!activeRefreshTokens.has(oldRefreshToken)) {
      return null;
    }

    // Revoke old refresh token (Token Rotation)
    activeRefreshTokens.delete(oldRefreshToken);

    // Issue fresh new token pair
    return signAuthTokens({
      sub: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      branchId: decoded.branchId,
      employeeId: decoded.employeeId,
    });
  } catch (err) {
    // Expired or invalid refresh token
    activeRefreshTokens.delete(oldRefreshToken);
    return null;
  }
}

// Revoke Refresh Token on logout
export function revokeRefreshToken(refreshToken: string): boolean {
  if (refreshToken) {
    activeRefreshTokens.delete(refreshToken);
    return true;
  }
  return false;
}
