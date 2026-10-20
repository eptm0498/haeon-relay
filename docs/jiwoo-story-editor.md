# Jiwoo full memory editor

In the existing character studio, selecting Jiwoo opens **전체 기억과 말투**.
The profile tab still holds the base role, ElevenLabs voice, reference images and avatar.
The full memory tab edits the complete persona, current state, style guide, chat/voice
instructions, event chapters, dialogue examples and all searchable memory excerpts.
The dedicated **성적인 상황의 대사·반응 (직접 입력)** field starts empty.
Saved text is supplied once to both chat and voice. Empty or whitespace-only values
add no instructions, and older editors that omit the field preserve its saved value.
Shared dialogue rules, character facts, style and medium-specific expression each
have their own section; the chat/voice defaults no longer repeat the persona.
Excerpts support content search and 20-item pages. Fields show full text, resize
vertically and grow with their contents on supporting browsers.

The original project instructions and all 955 captured messages remain available
as paginated comparison records. They are not overwritten by editing runtime memory.
There is no ChatGPT refresh, import or synchronization feature.

`live_editor_story` and `live_editor_story_source` require the existing editor
capability. Their API responses use `no-store`; private archive tables are not exposed.
`live_save_character_with_story` validates all editable structures, then uses the
existing character version/row lock to save the profile, reference images and story
in a single transaction. Conflicts return HTTP 409 and leave all changes unapplied.
Original source messages, original instructions, message count and source hash are
not writable. Other characters retain their existing save path.

`projectContext` reads the saved chat or voice instructions on every generation.
Unset legacy columns use the existing app defaults, also displayed in the studio;
an intentionally saved empty string stays empty. The four generation paths no
longer append another hidden copy of those defaults. The existing dialogue-only
output processing still applies. Editing the base prompt marker does not disconnect
Jiwoo's archive, which also identifies the established character by its ID.

Migrations: `supabase/migrations/20261020025204_live_story_editor.sql` and
`supabase/migrations/20261020041538_live_story_custom_reactions.sql`.
Validation: `node --test tests/story-editor.test.mjs tests/project-context.test.mjs tests/rpc-transport.test.mjs`.
