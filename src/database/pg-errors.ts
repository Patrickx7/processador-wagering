export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505';
}
