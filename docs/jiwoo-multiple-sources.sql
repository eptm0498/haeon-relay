-- Additive migration: legacy columns remain the 01 snapshot for old clients.
-- Source addresses and dialogue are registered privately, never in this file.
ALTER TABLE private.live_project_context ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE OR REPLACE FUNCTION public.live_project_context(server_token text,target_character uuid,action text DEFAULT 'read',data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE saved private.live_project_context%rowtype; idx integer; selected jsonb; candidate jsonb; sid text; total integer;
BEGIN
 IF NOT private.live_server_ok(server_token) THEN RAISE EXCEPTION 'invalid capability' USING errcode='28000'; END IF;
 SELECT * INTO saved FROM private.live_project_context WHERE character_id=target_character FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'project not linked' USING errcode='22023'; END IF;
 IF action IN ('check','save','save_source') THEN
  IF saved.version IS DISTINCT FROM (data->>'version')::integer THEN RAISE EXCEPTION 'project changed' USING errcode='PT409'; END IF;
  sid:=coalesce(data->>'source_id','01');
  SELECT (ordinality-1)::integer,value INTO idx,selected FROM jsonb_array_elements(saved.sources) WITH ORDINALITY WHERE value->>'id'=sid;
  IF jsonb_array_length(saved.sources)>0 AND idx IS NULL THEN RAISE EXCEPTION 'source not linked' USING errcode='22023'; END IF;
  IF action IN ('save','save_source') THEN
   IF jsonb_typeof(data->'messages') IS DISTINCT FROM 'array' OR jsonb_array_length(data->'messages') NOT BETWEEN 1 AND 3000 OR length(data->>'summary')>8000 OR coalesce(data->>'summary','')='' OR coalesce(data->>'content_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid snapshot' USING errcode='22023'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(data->'messages') m WHERE coalesce(m->>'role','') NOT IN ('user','assistant') OR coalesce(m->>'id','') !~ '^[a-zA-Z0-9:_-]{1,120}$' OR length(coalesce(m->>'content','')) NOT BETWEEN 1 AND 30000) OR (SELECT count(*) FROM jsonb_array_elements(data->'messages'))<>(SELECT count(DISTINCT m->>'id') FROM jsonb_array_elements(data->'messages') m) THEN RAISE EXCEPTION 'invalid turns' USING errcode='22023'; END IF;
   IF idx IS NOT NULL THEN
    candidate:=selected||jsonb_build_object('messages',data->'messages','summary',data->>'summary','content_hash',data->>'content_hash','partial',coalesce((data->>'partial')::boolean,true),'updated_at',now(),'checked_at',now());
    saved.sources:=jsonb_set(saved.sources,ARRAY[idx::text],candidate);
   END IF;
   UPDATE private.live_project_context SET sources=saved.sources,
    messages=CASE WHEN sid='01' THEN data->'messages' ELSE messages END,
    summary=CASE WHEN sid='01' THEN data->>'summary' ELSE summary END,
    content_hash=CASE WHEN sid='01' THEN data->>'content_hash' ELSE content_hash END,
    partial=CASE WHEN sid='01' THEN coalesce((data->>'partial')::boolean,true) ELSE partial END,
    version=version+1,updated_at=now(),checked_at=now() WHERE character_id=target_character RETURNING * INTO saved;
  ELSE
   IF idx IS NOT NULL THEN saved.sources:=jsonb_set(saved.sources,ARRAY[idx::text],selected||jsonb_build_object('checked_at',now())); END IF;
   UPDATE private.live_project_context SET sources=saved.sources,checked_at=now() WHERE character_id=target_character RETURNING * INTO saved;
  END IF;
 ELSIF action<>'read' THEN RAISE EXCEPTION 'invalid action' USING errcode='22023'; END IF;
 SELECT coalesce(sum(jsonb_array_length(value->'messages')),0)::integer INTO total FROM jsonb_array_elements(saved.sources);
 RETURN to_jsonb(saved)||jsonb_build_object('message_count',CASE WHEN jsonb_array_length(saved.sources)>0 THEN total ELSE jsonb_array_length(saved.messages) END);
END $function$;
-- Keep the existing capability-guarded RPC grants; the private table stays private.
NOTIFY pgrst,'reload schema';
