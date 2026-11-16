-- Retag only the photos present when this album was reviewed.
with reviewed(slot, situation, tags) as (
  values
    (1, '잠들기 전 어깨에 기대서 올려다보는 지우', array['포옹', '취침', '침대', '어깨', '올려다봄']),
    (2, '더 가까이 끌어안은 지우의 어깨와 턱선', array['포옹', '취침', '침대', '어깨', '턱선']),
    (4, '다독이며 이불을 끌어 올려 주는 지우', array['위로', '취침', '침대', '이불', '다독임']),
    (7, '품에 안은 채 먼저 잠든 지우', array['포옹', '취침', '침대', '잠든 모습', '품']),
    (11, '가슴 가까이 기대었을 때 턱과 감은 눈 일부가 보이는 지우', array['포옹', '취침', '침대', '감은 눈', '클로즈업']),
    (14, '크림색 이불 위로 가까이 보이는 지우의 복부와 배꼽', array['취침', '침대', '클로즈업', '크림색 이불', '복부']),
    (16, '따뜻한 스탠드 불빛 아래 옆으로 누워 복부와 배꼽이 보이는 지우', array['취침', '침대', '클로즈업', '스탠드', '옆으로 누움']),
    (21, '따뜻한 조명 아래 잠든 얼굴 일부와 가슴이 가까이 보이는 지우', array['취침', '침대', '클로즈업', '따뜻한 조명', '잠든 모습']),
    (27, '팔을 둘러 안은 채 귓속말 끝에 환하게 웃는 지우', array['포옹', '취침', '침대', '귓속말', '웃음']),
    (31, '아래에서 올려다보는 눈높이로 팔을 감싸며 잔잔하게 미소 짓는 지우', array['포옹', '취침', '침대', '아래 시점', '미소']),
    (33, '귓속말할 듯 고개를 가까이 내려 한쪽 눈과 미소만 보이는 지우', array['휴식', '취침', '침대', '클로즈업', '귓속말']),
    (34, '스탠드 불빛 아래 턱밑에 안긴 상대를 한쪽 눈으로 내려다보며 웃는 지우', array['포옹', '취침', '침대', '스탠드', '미소']),
    (35, '푸른 창빛 속에서 목 아래 시점으로 올려다본 지우의 잔잔한 미소', array['포옹', '취침', '침대', '푸른 창빛', '미소']),
    (36, '가슴에 안긴 상대를 내려다보다 볼이 올라가도록 웃음을 참는 지우', array['포옹', '취침', '침대', '내려다봄', '웃음']),
    (38, '푸른 창빛이 턱선을 스칠 때 어깨 너머로 다정하게 내려다보는 지우', array['포옹', '취침', '침대', '푸른 창빛', '어깨']),
    (40, '이불 끝을 가까이 가져오며 품에 안긴 상대를 조용히 내려다보는 지우', array['포옹', '취침', '침대', '이불', '내려다봄'])
)
update private.live_call_photos p
set tags = reviewed.tags, use_for = 'both'
from reviewed
where p.character_id = '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'
  and p.slot = reviewed.slot and p.situation = reviewed.situation;

-- A picture removed or restricted while a message is queued leaves the text available.
create or replace function private.live_jiwoo_album_message(target_character uuid, photo text, msg jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare image text;
begin
  if target_character <> '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c' or photo is null then return msg; end if;
  if photo ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select p.image_base64 into image from private.live_call_photos p
    where p.character_id = target_character and p.id = photo::uuid and p.use_for in ('chat','both');
  end if;
  if image is null then return msg; end if;
  return msg || jsonb_build_object('albumPhotoId', photo, 'image',
    jsonb_build_object('mimeType','image/jpeg','dataUrl','data:image/jpeg;base64,' || image));
end $$;

-- Save a contextual album photo with the existing proactive message and media transaction.
do $patch$
declare
  definition text;
  save_message constant text := 'perform public.live_sync_history(server_token, ''append'', jiwoo, h.epoch, jsonb_build_array(message));';
begin
  select pg_get_functiondef('public.live_jiwoo_proactive_work(text,text,jsonb)'::regprocedure) into definition;
  if (length(definition) - length(replace(definition, save_message, ''))) <> length(save_message) then
    raise exception 'unexpected Jiwoo proactive worker definition';
  end if;
  execute replace(definition, save_message,
    'message := private.live_jiwoo_album_message(jiwoo, data->>''albumPhotoId'', message);' || E'\n    ' || save_message);
end $patch$;
notify pgrst, 'reload schema';
