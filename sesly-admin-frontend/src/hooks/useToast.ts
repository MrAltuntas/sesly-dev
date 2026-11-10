import { toast } from 'sonner'

// Module-level so every caller gets the same reference. Pages list `toast` in
// useCallback/useEffect deps; a fresh object per render re-fired those effects
// forever (storage page looped on /admin/storage/*).
const stableToast = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
  loading: (message: string) => toast.loading(message),
  info: (message: string) => toast.info(message),
  promise: toast.promise,
}

export const useToast = () => stableToast
