import React, { createContext, useContext } from "react";
export const Location = createContext({
  pathname: "/admin/brokerage/crm",
  search: "",
  navigate: (href: string) => {
    void href;
  },
});
export function usePathname() {
  return useContext(Location).pathname;
}
export function useSearchParams() {
  return new URLSearchParams(useContext(Location).search);
}
export function useRouter() {
  const location = useContext(Location);
  return { push: location.navigate, replace: location.navigate, refresh() {} };
}
export default function Link({ href, children, prefetch, ...props }: any) {
  void prefetch;
  const location = useContext(Location);
  return (
    <a
      {...props}
      href={href}
      onClick={(e) => {
        props.onClick?.(e);
        if (!e.defaultPrevented) {
          e.preventDefault();
          location.navigate(href);
        }
      }}
    >
      {children}
    </a>
  );
}
