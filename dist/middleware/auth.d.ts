import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from '../types';
export declare function signToken(payload: JwtPayload): string;
export declare function verifyToken(token: string): JwtPayload;
/** Verify current membership so revoked accounts cannot access store data. */
export declare function requireActiveStore(req: Request, res: Response, next: NextFunction): Promise<void>;
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map