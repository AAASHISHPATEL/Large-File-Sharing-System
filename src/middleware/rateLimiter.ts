import { Request, Response, NextFunction } from 'express';
import redisClient from '../services/redisClient';
import { AuthRequest } from './authMiddleware';

/**
 * Sliding Window Rate Limiter using Redis Sorted Sets
 * @param limit Max number of requests allowed in the window
 * @param windowMs Time window in milliseconds
 * @param keyPrefix Prefix for the Redis key to separate different limits
 */
export const slidingWindowRateLimiter = (limit: number, windowMs: number, keyPrefix: string) => {
    return async (req: Request | AuthRequest, res: Response, next: NextFunction) => {
        try {
            // Identify user by IP or authenticated User ID
            const identifier = (req as AuthRequest).user?.id || req.ip || 'unknown';
            const redisKey = `ratelimit:${keyPrefix}:${identifier}`;
            
            const now = Date.now();
            const windowStart = now - windowMs;

            // Execute Redis commands atomically
            const multi = redisClient.multi();
            
            // 1. Remove all records outside the current window
            multi.zRemRangeByScore(redisKey, 0, windowStart);
            
            // 2. Add current request
            multi.zAdd(redisKey, { score: now, value: now.toString() + '-' + Math.random().toString(36).substring(7) });
            
            // 3. Count requests in current window
            multi.zCard(redisKey);
            
            // 4. Set expiry on the key to automatically clean up inactive users
            multi.expire(redisKey, Math.ceil(windowMs / 1000) * 2);

            const results = await multi.exec();
            
            if (!results) {
                return res.status(500).json({ error: 'Rate limiter error' });
            }

            // zCard result is at index 2
            const requestCount = results[2] as unknown as number;

            // Set standard rate limit headers
            res.setHeader('X-RateLimit-Limit', limit);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - requestCount));

            if (requestCount > limit) {
                res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
                return res.status(429).json({ 
                    error: 'Too Many Requests',
                    message: `You have exceeded the limit of ${limit} requests per ${windowMs / 1000} seconds. Please try again later.`
                });
            }

            next();
        } catch (error) {
            console.error('Rate Limiter Error:', error);
            // Fail open to avoid blocking legitimate users if Redis hiccups
            next();
        }
    };
};
