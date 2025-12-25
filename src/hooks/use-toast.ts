export function useToast() {
  return {
    toast: (_opts: any) => {},
    dismiss: (_id?: string) => {},
  };
}
