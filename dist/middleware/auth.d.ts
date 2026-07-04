import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from '../types';
export declare function signToken(payload: JwtPayload): string;
export declare function verifyToken(token: string): JwtPayload;
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map