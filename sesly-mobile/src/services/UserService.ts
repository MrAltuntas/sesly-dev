/**
 * User Service
 * Handles user profile management
 */

import type { AxiosRequestConfig } from 'axios';
import ApiClient from './ApiClient';
import { hasApiStatus } from './ApiError';
import {
  User,
  parseUserFromJSON,
  UpdateUserRequest,
  updateUserRequestToJSON,
  parseUploadAvatarResponseFromJSON,
} from '../models/User';

// ============================================================================
// User Service Class (Singleton)
// ============================================================================

class UserService {
  private static instance: UserService;

  private constructor() {}

  public static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService();
    }
    return UserService.instance;
  }

  // ============================================================================
  // User Profile
  // ============================================================================

  /**
   * Get current user profile. `config` reaches the request (the launch
   * restore passes a short timeout).
   */
  public async getCurrentUser(config?: AxiosRequestConfig): Promise<User> {
    try {
      const response = await ApiClient.get<unknown>('/users/me', config);
      return parseUserFromJSON(response);
    } catch (error) {
      // 401 (expired session) is handled by the caller's session flow.
      if (!hasApiStatus(error, 401)) {
        console.error('Failed to get current user:', error);
      }
      throw error;
    }
  }

  /**
   * Update current user profile
   */
  public async updateProfile(request: UpdateUserRequest): Promise<User> {
    try {
      const response = await ApiClient.patch<unknown>(
        '/users/me',
        updateUserRequestToJSON(request),
      );
      return parseUserFromJSON(response);
    } catch (error) {
      console.error('Failed to update user profile:', error);
      throw error;
    }
  }

  /**
   * Upload avatar image
   */
  public async uploadAvatar(
    imageUri: string,
    onProgress?: (progress: number) => void,
  ): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('avatar', {
        uri: imageUri,
        type: 'image/jpeg',
        name: `avatar_${Date.now()}.jpg`,
      } as any);

      const response = await ApiClient.upload<unknown>(
        '/users/me/avatar',
        formData,
        progressEvent => {
          if (onProgress && progressEvent.total) {
            const progress = Math.round(
              (progressEvent.loaded / progressEvent.total) * 100,
            );
            onProgress(progress);
          }
        },
      );

      const parsedResponse = parseUploadAvatarResponseFromJSON(response);
      return parsedResponse.avatarUrl;
    } catch (error) {
      console.error('Failed to upload avatar:', error);
      throw error;
    }
  }

  /**
   * Delete current user account
   */
  public async deleteAccount(): Promise<void> {
    try {
      await ApiClient.delete('/users/me');
      console.log('User account deleted');
    } catch (error) {
      console.error('Failed to delete account:', error);
      throw error;
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default UserService.getInstance();
