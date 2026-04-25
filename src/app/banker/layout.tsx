import { BankerShell } from "@/components/shell/BankerShell";

export const dynamic = "force-dynamic";

export default function BankerLayout({ children }: { children: React.ReactNode }) {
  return <BankerShell>{children}</BankerShell>;
}
