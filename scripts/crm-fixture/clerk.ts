// Test-only identity adapter. Never bundled into the application.
export function useClerk() {
  return { signOut: async () => {} };
}
