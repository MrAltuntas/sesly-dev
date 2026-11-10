import { PromoCodeType } from '@/types/api.types'

/**
 * Validates promo code creation form
 */
export const validatePromoCode = (
  code: string,
  type: PromoCodeType,
  value: number
): string | null => {
  if (!code || !code.trim() || code.trim().length < 3) {
    return 'Code must be at least 3 characters'
  }

  if (!/^[A-Z0-9_]+$/.test(code.trim())) {
    return 'Code must be uppercase letters, numbers, and underscores only'
  }

  if (type === PromoCodeType.PERCENTAGE) {
    if (value < 1 || value > 100) {
      return 'Percentage must be between 1-100'
    }
  }

  if (type === PromoCodeType.FIXED_AMOUNT) {
    if (value < 1) {
      return 'Amount must be positive'
    }
  }

  if (type === PromoCodeType.FREE_TRIAL) {
    if (value < 1 || value > 365) {
      return 'Trial days must be between 1-365'
    }
  }

  return null
}

/**
 * Validates duration in days
 */
export const validateDuration = (days: number): string | null => {
  if (!days || days < 1) {
    return 'Duration must be at least 1 day'
  }

  if (days > 3650) {
    return 'Duration cannot exceed 10 years (3650 days)'
  }

  return null
}

/**
 * Validates email format
 */
export const validateEmail = (email: string): string | null => {
  if (!email || !email.trim()) {
    return 'Email is required'
  }

  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!regex.test(email.trim())) {
    return 'Invalid email format'
  }

  return null
}

/**
 * Validates story content
 */
export const validateStoryContent = (content: string): string | null => {
  if (!content || !content.trim()) {
    return 'Story content is required'
  }

  if (content.trim().length < 100) {
    return 'Story content must be at least 100 characters'
  }

  return null
}

/**
 * Validates story duration
 */
export const validateStoryDuration = (duration: number): string | null => {
  if (!duration || duration < 1) {
    return 'Duration must be at least 1 minute'
  }

  if (duration > 180) {
    return 'Duration cannot exceed 180 minutes (3 hours)'
  }

  return null
}
