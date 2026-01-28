import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user: JwtPayload;
    }
  }
}

/**
 * Get JWT secret from environment variables
 * Validates that JWT_SECRET is set (should be validated at startup)
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured. Please set JWT_SECRET in server/.env file.');
  }
  return secret;
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid token' });
  }
};

// Export getJwtSecret for use in other files
export { getJwtSecret };