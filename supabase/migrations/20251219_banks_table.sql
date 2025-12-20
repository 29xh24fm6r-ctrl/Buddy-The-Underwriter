-- Create banks table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Insert default "Old Glory Bank" if not exists
INSERT INTO public.banks (code, name, active)
VALUES ('OGB', 'Old Glory Bank', true)
ON CONFLICT (code) DO NOTHING;

-- Add bank_id column to deals table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'deals' 
    AND column_name = 'bank_id'
  ) THEN
    ALTER TABLE public.deals ADD COLUMN bank_id uuid REFERENCES public.banks(id);
  END IF;
END $$;

-- Create index on deals.bank_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_deals_bank_id ON public.deals(bank_id);

-- Enable RLS on banks table
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read banks
CREATE POLICY IF NOT EXISTS "Allow authenticated users to read banks"
  ON public.banks
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role full access to banks
CREATE POLICY IF NOT EXISTS "Allow service role full access to banks"
  ON public.banks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
