import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function ClerkTestPage() {
  return (
    <div style={{ padding: 40 }}>
      <SignedOut>
        <p>You are signed out</p>
      </SignedOut>

      <SignedIn>
        <p>You are signed in</p>
        <UserButton />
      </SignedIn>
    </div>
  );
}
