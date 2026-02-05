-- Create bank-documents storage bucket for credit policy and other bank documents
insert into storage.buckets (id, name, public)
values ('bank-documents', 'bank-documents', false)
on conflict (id) do nothing;
