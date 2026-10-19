-- Static, server-only story memory. No import or update RPC is exposed.
CREATE TABLE IF NOT EXISTS private.live_story_archive (
 character_id uuid PRIMARY KEY REFERENCES public.live_characters(id),
 source_title text NOT NULL,
 source_url text NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT now(),
 complete boolean NOT NULL DEFAULT false,
 message_count integer NOT NULL,
 instructions text NOT NULL,
 current_state text NOT NULL,
 style_guide text NOT NULL,
 chapters jsonb NOT NULL DEFAULT '[]',
 examples jsonb NOT NULL DEFAULT '[]',
 source_messages jsonb NOT NULL DEFAULT '[]',
 source_instructions text NOT NULL DEFAULT '',
 memory_excerpts jsonb NOT NULL DEFAULT '[]',
 source_hash text NOT NULL
);
ALTER TABLE private.live_story_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.live_story_archive FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.live_story_memory(server_token text,target_character uuid,query_terms text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; excerpts jsonb;
BEGIN
 IF NOT private.live_server_ok(server_token) THEN RAISE insufficient_privilege; END IF;
 SELECT to_jsonb(a)-'source_messages'-'source_hash'-'source_instructions'-'memory_excerpts' INTO result FROM private.live_story_archive a WHERE a.character_id=target_character;
 IF result IS NULL THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(found.item ORDER BY (found.item->>'seq')::integer),'[]'::jsonb) INTO excerpts
 FROM (
  SELECT e.item,(SELECT coalesce(sum(CASE WHEN length(t.term)>2 THEN 3 ELSE 1 END),0) FROM unnest(query_terms[1:100]) t(term) WHERE length(t.term) BETWEEN 2 AND 30 AND position(lower(t.term) IN lower(e.item->>'text'))>0) AS relevance
  FROM private.live_story_archive a CROSS JOIN LATERAL jsonb_array_elements(a.memory_excerpts) e(item)
  WHERE a.character_id=target_character
  ORDER BY relevance DESC,(e.item->>'seq')::integer DESC LIMIT 6
 ) found WHERE found.relevance>0;
 RETURN result||jsonb_build_object('retrieved',excerpts);
END;$$;
REVOKE ALL ON FUNCTION public.live_story_memory(text,uuid,text[]) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.live_story_memory(text,uuid,text[]) TO anon;
-- Retire the old update capability when switching to this archive.
DROP FUNCTION IF EXISTS public.live_project_context(text,uuid,text,jsonb);
-- Old private records may remain as an inert backup; they are not read by the app.
