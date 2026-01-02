"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";

export function ProductShot(args: {
  id: string;
  kicker: string;
  title: string;
  copy: string;
  imgSrc: string;
  imgAlt: string;
  bullets: string[];
  reverse?: boolean;
}) {
  const { id, kicker, title, copy, imgSrc, imgAlt, bullets, reverse } = args;

  return (
    <section id={id} className="mx-auto max-w-6xl px-6 py-14">
      <div className={`grid gap-10 lg:grid-cols-12 lg:items-center ${reverse ? "lg:flex-row-reverse" : ""}`}>
        <div className={`lg:col-span-5 space-y-5 ${reverse ? "lg:order-2" : ""}`}>
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
            <span className="font-medium">{kicker}</span>
            <span className="text-muted-foreground">— screenshot from production UI</span>
          </div>

          <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground">{copy}</p>

          <div className="space-y-2">
            {bullets.map((b) => (
              <div key={b} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-2 w-2 rounded-full bg-black/50" />
                <div className="text-sm">{b}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"  href="/deals">
              Open app
            </Link>
            <a className="rounded-xl border px-3 py-2 text-sm hover:bg-muted" href="#top">
              Back to top
            </a>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className={`lg:col-span-7 ${reverse ? "lg:order-1" : ""}`}
        >
          <div className="relative overflow-hidden rounded-3xl border bg-background shadow-sm">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <div className="h-3 w-3 rounded-full border" />
              <div className="h-3 w-3 rounded-full border" />
              <div className="h-3 w-3 rounded-full border" />
              <div className="ml-2 text-xs text-muted-foreground">Buddy — {title}</div>
            </div>
            <div className="relative">
              <Image
                src={imgSrc}
                alt={imgAlt}
                width={1600}
                height={900}
                priority={id === "product"}
                className="w-full"
              />
              <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]" />
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Tip: these screenshots are auto-generated via Playwright from your live routes.
          </div>
        </motion.div>
      </div>
    </section>
  );
}
