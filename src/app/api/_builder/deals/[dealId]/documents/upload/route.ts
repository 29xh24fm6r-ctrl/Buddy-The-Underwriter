import "server-only";

import { createBuilderUploadHandler } from "@/lib/builder/builderUploadCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createBuilderUploadHandler();
