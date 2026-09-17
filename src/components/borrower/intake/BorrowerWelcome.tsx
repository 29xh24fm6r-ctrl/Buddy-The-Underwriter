"use client";
import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  HeartHandshake,
  ShieldCheck,
} from "lucide-react";
import { DISCOVERY_CHOICES } from "@/lib/borrower/journey/discovery";
import { ProgramOptions } from "./ProgramOptions";
export function BorrowerWelcome({
  children,
  onGoal,
}: {
  children: ReactNode;
  onGoal: (goal: string) => void;
}) {
  const [goal, setGoal] = useState("");
  const [signIn, setSignIn] = useState(false);
  return (
    <div className="mx-auto max-w-6xl py-6 sm:py-12">
      <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-800">
            BIG PLANS. A FRIENDLIER WAY FORWARD.
          </p>
          <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-6xl">
            Your next chapter starts here.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Buying a business? Making room to grow? Tell Buddy what you have in
            mind. We’ll help you explore financing and build your application,
            one manageable step at a time.
          </p>
          <div className="mt-8 flex flex-wrap gap-5 text-sm text-slate-700">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-sky-700" />
              Save and return
            </span>
            <span className="flex items-center gap-2">
              <HeartHandshake className="h-5 w-5 text-sky-700" />
              Guidance along the way
            </span>
          </div>
          <ol className="mt-10 hidden space-y-5 lg:block">
            {[
              "Tell us your goal",
              "Understand your options",
              "Build your application together",
            ].map((s, i) => (
              <li key={s} className="flex items-center gap-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-sky-800 ring-1 ring-sky-100">
                  {i + 1}
                </span>
                <span className="font-medium text-slate-700">{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <section className="rounded-3xl border border-sky-100 bg-white p-6 shadow-xl shadow-slate-200/30 sm:p-8">
          {signIn ? (
            <>
              <button
                className="mb-5 min-h-11 text-sm font-semibold text-sky-800"
                onClick={() => setSignIn(false)}
              >
                ← Back to your goal
              </button>
              <h2 className="mb-3 text-2xl font-semibold">
                Let’s save your place.
              </h2>
              <p className="mb-5 text-sm leading-6 text-slate-600">
                Verify your email to open or resume your application. Your goal
                stays on this page until you choose to save it.
              </p>
              {children}
            </>
          ) : (
            <>
              <Building2 className="h-8 w-8 text-sky-700" />
              <h2 className="mt-4 text-2xl font-semibold">
                What’s next for your business?
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                No SBA expertise needed. Pick a starting point.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {DISCOVERY_CHOICES.A11.map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={goal === key}
                    onClick={() => {
                      setGoal(key);
                      onGoal(key);
                    }}
                    className={`min-h-14 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${goal === key ? "border-sky-700 bg-sky-50 text-sky-900" : "border-slate-200 hover:border-sky-400 hover:bg-sky-50"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                disabled={!goal}
                onClick={() => setSignIn(true)}
                className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-800 px-5 py-3 font-semibold text-white disabled:opacity-40"
              >
                Build my plan
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  onGoal("");
                  setSignIn(true);
                }}
                className="mt-3 min-h-11 w-full text-sm font-medium text-sky-800 underline"
              >
                Already started? Resume your application
              </button>
            </>
          )}
        </section>
      </div>
      {goal && !signIn && (
        <div className="mt-12 rounded-3xl bg-slate-50 p-6 sm:p-8">
          <ProgramOptions goal={goal} />
        </div>
      )}
    </div>
  );
}
