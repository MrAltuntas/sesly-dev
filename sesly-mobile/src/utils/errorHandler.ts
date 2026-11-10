/**
 * Global error handler for the application
 * Converted from Flutter Dart error_handler.dart
 *
 * Note: This module provides error handling and message extraction.
 * For displaying errors in the UI, integrate with your preferred
 * notification system (e.g., react-native-toast-message, Alert, etc.)
 */

import axios, { AxiosError } from 'axios';
import { msg } from '../i18n/messages';

/**
 * Error message structure
 */
export interface ErrorMessage {
  title: string;
  message: string;
  statusCode?: number;
}

/**
 * Error handler configuration
 */
export interface ErrorHandlerConfig {
  onUnauthorized?: () => void;
  showNotification?: (error: ErrorMessage, type: 'error' | 'success' | 'info' | 'warning') => void;
}

let errorHandlerConfig: ErrorHandlerConfig = {};

/**
 * Configure error handler
 */
export const configureErrorHandler = (config: ErrorHandlerConfig): void => {
  errorHandlerConfig = config;
};

/**
 * Extract error message from API response
 */
const extractErrorMessage = (response: any): string | null => {
  try {
    const data = response.data;

    if (typeof data === 'object' && data !== null) {
      // Try common error message fields
      if (data.message && typeof data.message === 'string') {
        return data.message;
      }

      if (data.error) {
        if (typeof data.error === 'string') {
          return data.error;
        } else if (typeof data.error === 'object' && data.error.message) {
          return data.error.message;
        }
      }

      if (data.detail && typeof data.detail === 'string') {
        return data.detail;
      }

      // Validation errors (array of errors)
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        return data.errors
          .map((e: any) =>
            typeof e === 'object' && e !== null ? e.message || String(e) : String(e)
          )
          .join('\n');
      }
    }
  } catch (e) {
    // If extraction fails, return null and use default message
    return null;
  }

  return null;
};

/**
 * Handle unauthorized access (401)
 */
const handleUnauthorized = (): void => {
  if (errorHandlerConfig.onUnauthorized) {
    errorHandlerConfig.onUnauthorized();
  }
};

/**
 * Handle API errors
 */
export const handleError = (
  error: any,
  customMessage?: string
): ErrorMessage => {
  let title = 'Hata';
  let message = customMessage || msg('common.unknown');
  let statusCode: number | undefined;

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    const response = axiosError.response;

    // Network errors
    if (axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')) {
      message = msg('api.timeout');
    } else if (axiosError.code === 'ERR_NETWORK' || !response) {
      message = msg('common.network');
    } else if (response) {
      statusCode = response.status;

      // HTTP status code errors
      switch (response.status) {
        case 400:
          title = msg('api.title.badRequest');
          message =
            extractErrorMessage(response) ||
            msg('api.badData');
          break;

        case 401:
          title = msg('api.title.session');
          message = msg('common.sessionExpired');
          handleUnauthorized();
          break;

        case 403:
          title = 'Yetki Yok';
          message =
            extractErrorMessage(response) ||
            msg('api.forbidden');
          break;

        case 404:
          title = msg('api.title.notFound');
          message =
            extractErrorMessage(response) || msg('api.resourceNotFound');
          // Don't show notification for 404 if it's a silent check
          if (!customMessage) {
            // Silent fail for 404 - caller can check statusCode
            break;
          }
          break;

        case 409:
          title = msg('api.title.conflict');
          message =
            extractErrorMessage(response) || msg('api.conflictDone');
          break;

        case 422:
          title = msg('api.title.validation');
          message =
            extractErrorMessage(response) || msg('api.validation');
          break;

        case 429:
          title = msg('api.title.tooMany');
          message =
            extractErrorMessage(response) ||
            msg('api.tooManyYou');
          break;

        case 500:
        case 502:
        case 503:
        case 504:
          title = msg('api.title.server');
          message = msg('common.server');
          break;

        default:
          message =
            extractErrorMessage(response) ||
            msg('api.statusError', { status: response.status });
      }
    }
  } else if (error instanceof Error) {
    message = error.message.replace(/^Error:\s*/i, '');
  }

  const errorMessage: ErrorMessage = {
    title,
    message,
    statusCode,
  };

  // Show error notification if configured
  if (errorHandlerConfig.showNotification && statusCode !== 404) {
    errorHandlerConfig.showNotification(errorMessage, 'error');
  }

  return errorMessage;
};

/**
 * Show success message
 */
export const showSuccess = (title: string, message: string): void => {
  if (errorHandlerConfig.showNotification) {
    errorHandlerConfig.showNotification({ title, message }, 'success');
  }
};

/**
 * Show info message
 */
export const showInfo = (title: string, message: string): void => {
  if (errorHandlerConfig.showNotification) {
    errorHandlerConfig.showNotification({ title, message }, 'info');
  }
};

/**
 * Show warning message
 */
export const showWarning = (title: string, message: string): void => {
  if (errorHandlerConfig.showNotification) {
    errorHandlerConfig.showNotification({ title, message }, 'warning');
  }
};

/**
 * Check if error is unauthorized (401)
 */
export const isUnauthorizedError = (error: any): boolean => {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 401;
  }
  return false;
};

/**
 * Check if error is network error
 */
export const isNetworkError = (error: any): boolean => {
  if (axios.isAxiosError(error)) {
    return (
      error.code === 'ERR_NETWORK' ||
      !error.response ||
      error.message.includes('Network Error')
    );
  }
  return false;
};

/**
 * Get HTTP status code from error
 */
export const getErrorStatusCode = (error: any): number | null => {
  if (axios.isAxiosError(error) && error.response) {
    return error.response.status;
  }
  return null;
};

// Export all as namespace object
export const ErrorHandler = {
  configure: configureErrorHandler,
  handleError,
  showSuccess,
  showInfo,
  showWarning,
  isUnauthorizedError,
  isNetworkError,
  getErrorStatusCode,
  extractErrorMessage,
};

export default ErrorHandler;
