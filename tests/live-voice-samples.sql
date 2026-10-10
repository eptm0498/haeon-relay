-- Capability replacement and sample fixtures are rolled back in full.
begin;
do $test$
declare token text='voice-samples-transaction-fixture'; a uuid=gen_random_uuid(); b uuid=gen_random_uuid();
 active_id uuid; disabled_id uuid; result_count integer;
begin
 update private.live_history_key set key_hash=encode(extensions.digest(token,'sha256'),'hex');
 insert into public.live_characters(id,name,prompt,voice_id) values
  (a,'voice fixture a',repeat('테스트 캐릭터 ',15),repeat('v',20)),(b,'voice fixture b',repeat('테스트 캐릭터 ',15),repeat('v',20));
 insert into private.live_dialogue_samples(character_id,cue,reply,spoken,category,quality,enabled)
 values(a,'뭐 먹었어?','김밥 먹었어 ㅋㅋ','김밥 먹었어','잠/생활',80,true) returning id into active_id;
 insert into private.live_dialogue_samples(character_id,cue,reply,spoken,category,quality,enabled)
 values(a,'뭐 먹었어?','비활성 예시','비활성 예시','잠/생활',99,false) returning id into disabled_id;
 insert into private.live_dialogue_samples(character_id,cue,reply,spoken,category,quality,enabled)
 values(b,'뭐 먹었어?','다른 캐릭터 예시','다른 캐릭터 예시','잠/생활',99,true);
 begin
  perform public.live_voice_samples('invalid',a,array['먹'],'잠/생활','fixture');
  raise exception 'unauthorized archive read accepted';
 exception when sqlstate '28000' then null;end;
 select count(*) into result_count from public.live_voice_samples(token,a,array['먹'],'잠/생활','fixture');
 if result_count<>1 or not exists(select 1 from public.live_voice_samples(token,a,array['먹'],'잠/생활','fixture') where id=active_id) then
  raise exception 'character isolation or enabled-only selection failed';
 end if;
 if not exists(select 1 from public.live_voice_samples(token,a,array[]::text[],'일상','cold-start') where id=active_id) then
  raise exception 'keyword-free fallback missing';
 end if;
 update private.live_dialogue_samples set enabled=false where id=active_id;
 if exists(select 1 from public.live_voice_samples(token,a,array['먹'],'잠/생활','fixture')) then
  raise exception 'editor disable ignored';
 end if;
 begin
  perform public.live_voice_samples(token,a,array_fill('먹'::text,array[13]),'일상','fixture');
  raise exception 'unbounded search accepted';
 exception when sqlstate '22023' then null;end;
 if has_table_privilege('anon','private.live_dialogue_samples','SELECT') then raise exception 'private archive exposed';end if;
end $test$;
rollback;
select 'live-voice-samples checks passed' as result;
