-- Optional seed: a single sample document (no chunks/embeddings yet — those
-- arrive in Session 3). Idempotent via a NOT EXISTS guard on source_title.
insert into public.documents (source_title, source_url, license, summary)
select
  'Physical Activity Guidelines for Americans, 2nd edition (sample)',
  'https://health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines',
  'Public domain (U.S. Government work)',
  'Sample knowledge-base document seeded in Session 2. Chunking and embeddings are added in Session 3.'
where not exists (
  select 1 from public.documents
  where source_title = 'Physical Activity Guidelines for Americans, 2nd edition (sample)'
);
