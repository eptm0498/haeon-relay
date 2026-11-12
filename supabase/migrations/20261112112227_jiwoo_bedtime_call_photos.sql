-- Jiwoo's bedtime pack has ten scenes. Other characters retain their eight-photo limit.
alter table private.live_call_photos
  drop constraint live_call_photos_slot_check,
  add constraint live_call_photos_slot_check check (
    slot between 1 and case when character_id = '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'::uuid then 10 else 8 end
  );
