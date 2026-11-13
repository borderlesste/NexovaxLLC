-- validate_system_setting_value() trigger calls this helper when admins publish settings.
GRANT EXECUTE ON FUNCTION public.validate_typed_json_value(text, jsonb) TO nexovax_api_runtime;
