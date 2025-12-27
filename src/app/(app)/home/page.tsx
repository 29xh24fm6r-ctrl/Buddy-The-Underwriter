import { CommandBridgeShell } from "@/components/home/CommandBridgeShell";
import { CommandBridgeV3 } from "@/components/home/CommandBridgeV3";

export default function Home() {
  return (
    <CommandBridgeShell>
      <CommandBridgeV3 bankId="demo-bank" bankName="Demo Bank" />
    </CommandBridgeShell>
  );
}
