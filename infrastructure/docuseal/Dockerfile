# SPEC S3 B-1 — DocuSeal, embedded as an unmodified upstream service.
# Pinned to the latest stable tag confirmed at authoring time (2026-07-12):
# docusealco/docuseal releases, https://github.com/docusealco/docuseal/releases.
# Re-verify against current releases before each deploy/upgrade and update
# infrastructure/docuseal/README.md's version log.
FROM docusealco/docuseal:3.1.3

ENV PORT=3000
ENV RAILS_ENV=production
ENV FORCE_SSL=true

EXPOSE 3000
