alter table public.rp_characters
 add column gender text not null default '',
 add column age text not null default '',
 add column appearance text not null default '',
 add column body text not null default '',
 add column hair text not null default '';
