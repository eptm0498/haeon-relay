alter table private.live_voip_devices drop constraint live_voip_devices_token_check,
 add constraint live_voip_devices_token_check check (token ~ '^[a-f0-9]+$' and length(token) between 32 and 256 and length(token) % 2 = 0);
