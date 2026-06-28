-- Enable pgvector for embedding columns and similarity search.
-- Installed into the dedicated `extensions` schema (Supabase convention);
-- `extensions` is on the default search_path, so the `vector` type and the
-- `<=>` cosine-distance operator resolve unqualified.
create extension if not exists vector with schema extensions;
