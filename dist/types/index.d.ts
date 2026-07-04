export interface Store {
    store_id: string;
    name: string;
    code: string;
    timezone: string;
    created_at: string;
}
export type UserRole = 'owner' | 'manager' | 'supervisor' | 'staff';
export interface User {
    user_id: string;
    username: string;
    display_name: string;
    pin_hash: string;
    role: UserRole;
    store_id: string;
    is_active: number;
    created_at: string;
    updated_at: string;
}
export interface UserPublic {
    user_id: string;
    username: string;
    display_name: string;
    role: UserRole;
    store_id: string;
    store_name: string | null;
}
export interface LoginRequest {
    username: string;
    pin: string;
}
export interface LoginResponse {
    token: string;
    user: UserPublic;
}
export interface ApiError {
    error: string;
    details?: string;
}
export interface JwtPayload {
    user_id: string;
    username: string;
    store_id: string;
    role: UserRole;
}
//# sourceMappingURL=index.d.ts.map