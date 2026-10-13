// Nitro wraps createError({ data }) so the API body ends up at err.data.data.
// These helpers read the error shape defensively from either nesting level.

function errorBody(err: any): any {
  return err?.data?.data?.error ?? err?.data?.error ?? undefined
}

export function apiErrorMessage(err: any, fallback: string): string {
  const message = err?.data?.data?.error?.message || err?.data?.error?.message || err?.statusMessage
  return typeof message === 'string' && message ? message : fallback
}

export function apiErrorDetails(err: any): any {
  return errorBody(err)?.details
}

export function apiErrorStatus(err: any): number | undefined {
  const status = err?.statusCode ?? err?.status ?? err?.response?.status ?? err?.data?.statusCode
  return typeof status === 'number' ? status : undefined
}
