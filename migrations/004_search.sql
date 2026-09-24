-- A text-only join is immutable; generic array_to_string(anyarray, text) is not.
CREATE OR REPLACE FUNCTION public.search_text_array(items text[])
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE item text; result text := '';
BEGIN
  FOREACH item IN ARRAY coalesce(items, '{}'::text[]) LOOP
    result := result || ' ' || coalesce(item, '');
  END LOOP;
  RETURN result;
END;
$$;
-- statement-break
ALTER TABLE assets ADD COLUMN IF NOT EXISTS search_vector tsvector
GENERATED ALWAYS AS (to_tsvector('english'::regconfig,
  coalesce(caption, '') || ' ' || coalesce(cld_caption, '') || ' ' ||
  public.search_text_array(cld_tags) || ' ' || public.search_text_array(signals) || ' ' ||
  coalesce(activity, ''))) STORED;
-- statement-break
CREATE INDEX IF NOT EXISTS assets_search_vector_idx ON assets USING GIN (search_vector);
