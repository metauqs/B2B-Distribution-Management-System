import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'sabzi_ledger_jwt_secret_dev_only_change_in_production';

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

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
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
    const decoded = jwt.verify(token, JWT_SECRET) as DecodedUser;
    
    // Ensure payload is an access token if type is specified
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

export function signToken(payload: { sub: string; email: string; role: string; branchId: string; employeeId?: string }): string {
  const expiry = process.env.JWT_EXPIRES_IN ?? '7d';
  return jwt.sign({ ...payload, type: 'access' }, JWT_SECRET, { expiresIn: expiry as any });
}
