/**
 * SPEC-AUTH-SIGNOUT-1 CI Guard
 *
 * HeroBar must expose a sign-out control wired to Clerk's signOut so users
 * can recover when their session token expires. Without this, expired
 * sessions leave users stuck with 500 errors and no UI recovery path.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(__dirname, "../HeroBar.tsx");

test("Guard: HeroBar imports useClerk and renders a sign-out button", () => {
  const src = readFileSync(FILE, "utf8");
  assert.match(
    src,
    /import \{ useClerk \} from "@clerk\/nextjs"/,
    "HeroBar must import useClerk from @clerk/nextjs.",
  );
  assert.match(
    src,
    /const \{ signOut \} = useClerk\(\)/,
    "HeroBar must destructure signOut from useClerk().",
  );
  assert.match(
    src,
    /onClick=\{\(\) => signOut\(\{ redirectUrl: "\/sign-in" \}\)\}/,
    "Sign-out button must call signOut with redirectUrl='/sign-in'.",
  );
  assert.match(
    src,
    /aria-label="Sign out"/,
    "Sign-out control must have aria-label for accessibility.",
  );
});
