/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UserAdminUpdate } from '../models/UserAdminUpdate';
import type { UserCreate } from '../models/UserCreate';
import type { UserResponse } from '../models/UserResponse';
import type { UserRoleUpdate } from '../models/UserRoleUpdate';
import type { UserSelfUpdate } from '../models/UserSelfUpdate';
import type { UserStatusUpdate } from '../models/UserStatusUpdate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class UsersService {
    /**
     * Get own profile
     * Returns the profile of the currently authenticated user. No special permission required.
     * @returns UserResponse Successful Response
     * @throws ApiError
     */
    public static getMeUsersMeGet(): CancelablePromise<UserResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/users/me',
            errors: {
                401: `Not authenticated`,
            },
        });
    }
    /**
     * Update own profile
     * Allows any authenticated user to update their own **email** and/or **password**.
     *
     * - Cannot change role or active status (admin-only operations).
     * - Password must meet strength requirements.
     * @param requestBody
     * @returns UserResponse Successful Response
     * @throws ApiError
     */
    public static updateMeUsersMePatch(
        requestBody: UserSelfUpdate,
    ): CancelablePromise<UserResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/users/me',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Not authenticated`,
                409: `Email or username already taken`,
                422: `Validation Error`,
            },
        });
    }
    /**
     * List all users
     * **Permission required:** `users:list` (admin, manager)
     * @returns UserResponse Successful Response
     * @throws ApiError
     */
    public static listUsersUsersGet(): CancelablePromise<Array<UserResponse>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/users/',
            errors: {
                401: `Not authenticated`,
                403: `Insufficient permissions`,
            },
        });
    }
    /**
     * Create a new user
     * **Permission required:** `users:create` (admin only)
     *
     * Creates a new user account. The new account is always assigned the `staff` role — use `PATCH /users/{id}/role` to promote afterwards.
     * @param requestBody
     * @returns UserResponse User created
     * @throws ApiError
     */
    public static createUserUsersPost(
        requestBody: UserCreate,
    ): CancelablePromise<UserResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/users/',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Not authenticated`,
                403: `Insufficient permissions`,
                409: `Email or username already taken`,
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get a user by ID
     * **Permission required:** `users:read` (admin, manager)
     * @param userId
     * @returns UserResponse Successful Response
     * @throws ApiError
     */
    public static getUserUsersUserIdGet(
        userId: number,
    ): CancelablePromise<UserResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/users/{user_id}',
            path: {
                'user_id': userId,
            },
            errors: {
                401: `Not authenticated`,
                403: `Insufficient permissions`,
                404: `User not found`,
                422: `Validation Error`,
            },
        });
    }
    /**
     * Admin update — any field on any user
     * **Permission required:** `users:update` (admin only)
     *
     * Can update email, password, role, and active status in a single call.
     * @param userId
     * @param requestBody
     * @returns UserResponse Successful Response
     * @throws ApiError
     */
    public static adminUpdateUserUsersUserIdPatch(
        userId: number,
        requestBody: UserAdminUpdate,
    ): CancelablePromise<UserResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/users/{user_id}',
            path: {
                'user_id': userId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Not authenticated`,
                403: `Insufficient permissions`,
                404: `User not found`,
                409: `Email or username already taken`,
                422: `Validation Error`,
            },
        });
    }
    /**
     * Delete a user
     * **Permission required:** `users:delete` (admin only)
     *
     * Permanently deletes the user record. This action is **irreversible**.
     *
     * An admin cannot delete their own account.
     * @param userId
     * @returns void
     * @throws ApiError
     */
    public static deleteUserUsersUserIdDelete(
        userId: number,
    ): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/users/{user_id}',
            path: {
                'user_id': userId,
            },
            errors: {
                401: `Not authenticated`,
                403: `Insufficient permissions`,
                404: `User not found`,
                422: `Validation Error`,
            },
        });
    }
    /**
     * Change a user's role
     * **Permission required:** `users:change_role` (admin only)
     *
     * Valid roles: `admin`, `manager`, `staff`.
     *
     * An admin cannot change their own role.
     * @param userId
     * @param requestBody
     * @returns UserResponse Successful Response
     * @throws ApiError
     */
    public static changeRoleUsersUserIdRolePatch(
        userId: number,
        requestBody: UserRoleUpdate,
    ): CancelablePromise<UserResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/users/{user_id}/role',
            path: {
                'user_id': userId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Not authenticated`,
                403: `Insufficient permissions`,
                404: `User not found`,
                422: `Validation Error`,
            },
        });
    }
    /**
     * Activate or deactivate a user
     * **Permission required:** `users:deactivate` (admin only)
     *
     * Set `is_active: false` to block a user from logging in without deleting their account.
     *
     * An admin cannot deactivate their own account.
     * @param userId
     * @param requestBody
     * @returns UserResponse Successful Response
     * @throws ApiError
     */
    public static changeStatusUsersUserIdStatusPatch(
        userId: number,
        requestBody: UserStatusUpdate,
    ): CancelablePromise<UserResponse> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/users/{user_id}/status',
            path: {
                'user_id': userId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Not authenticated`,
                403: `Insufficient permissions`,
                404: `User not found`,
                422: `Validation Error`,
            },
        });
    }
}
