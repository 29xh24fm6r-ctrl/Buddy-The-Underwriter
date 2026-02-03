-- Add branding fields to banks table for website and logo
ALTER TABLE public.banks
  ADD COLUMN IF NOT EXISTS website_url text NULL,
  ADD COLUMN IF NOT EXISTS logo_url text NULL;

-- Optional: add brand color for future theming
-- ALTER TABLE public.banks ADD COLUMN IF NOT EXISTS brand_color text NULL;
