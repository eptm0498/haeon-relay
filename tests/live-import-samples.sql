-- Read-only regression checks for the sample importer. No editor secrets required.
BEGIN;
DO $test$
DECLARE
  definition text := pg_get_functiondef('public.live_import_samples(text,uuid,jsonb)'::regprocedure);
BEGIN
  ASSERT position('#variable_conflict use_column' in definition) > 0,
    'The RPC parameter must not conflict with the ON CONFLICT column';
  ASSERT position('private.live_editor_ok(edit_token)' in definition) > 0,
    'The editor capability check must remain in place';
  ASSERT position('SET search_path TO ''''' in definition) > 0,
    'The security-definer search path must remain empty';
  ASSERT position('do nothing' in lower(definition)) > 0,
    'Repeated source hashes must remain idempotent';
  BEGIN
    PERFORM public.live_import_samples(
      'invalid-regression-test-token',
      '00000000-0000-0000-0000-000000000000'::uuid,
      '[]'::jsonb
    );
    RAISE EXCEPTION 'Unauthorized imports must be rejected';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    NULL;
  END;
END;
$test$;
ROLLBACK;
SELECT 'live-import-samples regression checks passed' AS result;
