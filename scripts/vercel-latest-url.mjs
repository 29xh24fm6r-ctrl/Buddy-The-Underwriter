#!/usr/bin/env node
import { execSync } from "node:child_process";

const run = (cmd) => {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
};

const tryRun = (cmd) => {
  try {
    return run(cmd);
  } catch {
    return null;
  }
};

const normalizeUrl = (value) => {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `https://${value}`;
};

const branch =
  process.env.VERCEL_GIT_COMMIT_REF ||
  process.env.GITHUB_REF_NAME ||
  tryRun("git rev-parse --abbrev-ref HEAD");

if (!branch) {
  console.error("[vercel:preview:url] Unable to determine git branch.");
  process.exit(1);
}

const parseJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const tryJsonDeployments = () => {
  const raw = tryRun("vercel ls --json") || tryRun("npx -y vercel ls --json");
  if (!raw) return null;
  const parsed = parseJson(raw);
  if (!parsed) return null;
  return Array.isArray(parsed) ? parsed : parsed.deployments || parsed;
};

const extractUrl = (deployment) => {
  if (!deployment) return null;
  return deployment.url || deployment.target || deployment.alias || null;
};

const matchesBranch = (deployment) => {
  const meta = deployment.meta || {};
  return (
    meta.githubCommitRef === branch ||
    meta.gitBranch === branch ||
    meta.branch === branch ||
    deployment.gitBranch === branch ||
    deployment.branch === branch
  );
};

let deployments = tryJsonDeployments();

if (!deployments) {
  const raw = tryRun("vercel ls") || tryRun("npx -y vercel ls");
  if (!raw) {
    console.error("[vercel:preview:url] Unable to query Vercel deployments. Ensure vercel CLI is installed and authenticated.");
    process.exit(1);
  }

  const urls = raw
    .split("\n")
    .map((line) => line.match(/([a-zA-Z0-9-]+\.vercel\.app)/))
    .filter(Boolean)
    .map((match) => match[1]);

  if (urls.length === 0) {
    console.error("[vercel:preview:url] No preview URLs found in Vercel output.");
    process.exit(1);
  }

  console.log(normalizeUrl(urls[0]));
  process.exit(0);
}

deployments = deployments
  .filter((deployment) => matchesBranch(deployment))
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

if (deployments.length === 0) {
  console.error(`[vercel:preview:url] No deployments found for branch "${branch}".`);
  process.exit(1);
}

const url = normalizeUrl(extractUrl(deployments[0]));
if (!url) {
  console.error("[vercel:preview:url] Deployment URL missing from Vercel output.");
  process.exit(1);
}

console.log(url);
