-- Preserve the append/enqueue transaction and keep image bytes in live_media.
do $patch$
declare
  definition text;
  input_clause constant text := 'and not (message ? ''image'')' || E'\n        ' ||
    'and char_length(btrim(message->>''content'')) between 1 and 1500';
  payload_clause constant text := 'jsonb_build_object(''urgent'', coalesce(urgent, false))';
begin
  select pg_get_functiondef('public.live_append_jiwoo_text(text,uuid,uuid,jsonb,uuid,boolean)'::regprocedure) into definition;
  if position(input_clause in definition) = 0 or position(payload_clause in definition) = 0 then
    raise exception 'unexpected Jiwoo append function';
  end if;
  definition := replace(definition, input_clause, $input$
        and char_length(btrim(message->>'content')) between 0 and 1500
        and (not (message ? 'image') or message->'image'->>'dataUrl' like 'data:image/%;base64,%')
        and (btrim(message->>'content') <> '' or message ? 'image')
  $input$);
  definition := replace(definition, payload_clause, $payload$
    jsonb_build_object('urgent', coalesce(urgent, false), 'attachedPhotoId',
      (select message->>'id' from jsonb_array_elements(incoming) as entry(message)
       where message->>'id' = reply_to::text and message->>'role' = 'user' and message ? 'image' limit 1))
  $payload$);
  execute definition;
end
$patch$;

-- A Jiwoo image job delivers either an image or a contextual text reply.
do $patch$
declare
  definition text;
  append_clause constant text := 'msg=jsonb_build_object(''id'',''reply:''||j.id';
begin
  select pg_get_functiondef('public.live_reply_work(text,text,uuid,uuid,jsonb)'::regprocedure) into definition;
  if position(append_clause in definition) = 0 then
    raise exception 'unexpected reply delivery function';
  end if;
  execute replace(definition, append_clause, $defer$
    if j.character_id='8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'::uuid
      and nullif(j.result->'photo'->>'fallbackText','') is not null then
      begin
        perform public.live_image_work(server_token,'create',j.id,j.character_id,j.result->'photo');
        update private.live_reply_jobs set status='complete',payload='{}',result=null,updated_at=now() where id=j.id;
        total=total+1;
        photos=photos||jsonb_build_array(j.id);
        continue;
      exception when raise_exception then
        if sqlerrm <> 'IMAGE_DAILY_LIMIT' then raise; end if;
        j.result := j.result - 'photo';
      end;
    end if;
    msg=jsonb_build_object('id','reply:'||j.id$defer$);
end
$patch$;

do $patch$
declare
  definition text;
  completion_clause constant text := 'if action=''complete'' then' || E'\n   ' ||
    'msg=jsonb_build_object(''id'',j.id,''role'',''assistant'',''content'','''',''ts'',floor(extract(epoch from clock_timestamp())*1000),''image'',data->''image'',''imagePrompt'',j.payload->>''scene'');';
  message_id_clause constant text := 'message_id=j.id::text';
  notification_clause constant text := 'select endpoint,j.id::text,jsonb_build_object(''title'',ch.name,''body'',''사진을 보냈어.'',''characterId'',j.character_id,''messageId'',j.id)';
  jiwoo_job constant text := 'j.character_id=''8bda7b48-b3bc-4c8e-900b-7b92b04fe21c''::uuid and nullif(j.payload->>''fallbackText'','''') is not null';
begin
  select pg_get_functiondef('public.live_image_work(text,text,uuid,uuid,jsonb)'::regprocedure) into definition;
  if position(completion_clause in definition) = 0 or position(message_id_clause in definition) = 0 or position(notification_clause in definition) = 0 then
    raise exception 'unexpected image completion function';
  end if;
  definition := replace(definition, completion_clause, format($complete$
  if action='complete' or (%1$s) then
   msg=jsonb_build_object(
    'id',case when (%1$s) then 'reply:'||j.id else j.id::text end,
    'role','assistant','content',case when action='fail' then left(j.payload->>'fallbackText',1500) else '' end,
    'ts',floor(extract(epoch from clock_timestamp())*1000));
   if action='complete' then
    msg := msg || jsonb_build_object('image',data->'image','imagePrompt',j.payload->>'scene');
   end if;
  $complete$, jiwoo_job));
  definition := replace(definition, message_id_clause, 'message_id=msg->>''id''');
  definition := replace(definition, notification_clause,
    'select endpoint,msg->>''id'',jsonb_build_object(''title'',ch.name,''body'',case when action=''complete'' then ''사진을 보냈어.'' else msg->>''content'' end,''characterId'',j.character_id,''messageId'',msg->>''id'')');
  execute definition;
end
$patch$;
notify pgrst, 'reload schema';
